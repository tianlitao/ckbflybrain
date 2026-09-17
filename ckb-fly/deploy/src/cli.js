#!/usr/bin/env node
/**
 * Deploys and drives the CKB Fly organism.
 *
 * # What this program is, and what it deliberately is not
 *
 * It is the *chain* half of the port: it builds, signs and sends transactions, and it
 * keeps a record of what it deployed. It is **not** a second implementation of the fly.
 * Every byte that reaches the chain — the state cell's contents, the action in the
 * witness, the type script's args, the capacity the output must hold — is produced by
 * `crates/flyplan`, which is a wrapper over the same `flycore` the validator executes.
 *
 * That division is the point. A deployer that reimplemented the dynamics in JavaScript
 * would be a second source of truth for the thing the whole port is about, and the two
 * would drift exactly when it mattered.
 *
 * # Usage
 *
 * ```sh
 * node src/cli.js plan                                  # what would be deployed, no network
 * node src/cli.js deploy --lock flylock                  # public fly (the default)
 * node src/cli.js deploy --lock owner                    # private fly under this key
 * node src/cli.js adopt                                  # rebuild a record from live code cells
 * node src/cli.js adopt 0x3235…                          # …restricted to one transaction
 * node src/cli.js genesis                               # another fly from the same code cells
 * node src/cli.js status                                # read the fly
 * node src/cli.js history                               # recover its whole life from the chain
 * node src/cli.js tick 64
 * node src/cli.js stimulate 1 4 4 32                    # channel 1 (cue), wedge 4, strength 4, 32 steps
 * node src/cli.js feed 10000
 * node src/cli.js resurrect 10000 1234
 * ```
 *
 * This module is also the chain layer that `serve.js` — the indexer and the front-end's
 * host — imports. `main` runs only when this file is the entry point.
 *
 * Environment: `CKB_RPC_URL`, `CKB_PRIVATE_KEY`, `FLY_MODE` (release|debug),
 * `FLY_PARAMS` (v1|v2|sim), `FLY_ECON` (testnet|free), `FLY_ENERGY`, `FLY_STATE`.
 *
 * A deployment mints a random eight-byte **instance** nonce for the fly it creates. It is
 * what makes two flies with the same genome two organisms rather than one — see
 * `flycore::args` for why that is not optional.
 *
 * @module cli
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import * as ccc from "@ckb-ccc/core";

import {
  PROJECT_ROOT,
  N,
  TAG,
  CH,
  PARAMS_V1,
  PARAMS_V2,
  ECON_TESTNET,
  ECON_FREE,
  SHANNONS_PER_CKB,
  flybrainBinary,
  flylockBinary,
  flyworldBinary,
  circuitTable,
  decodeState,
  genesisState,
} from "./fly.js";
import * as plan from "./plan.js";
import { findHead, identity, readChain, summarise } from "./history.js";
import { describeBranches, lockKind, signableLock } from "./watch.js";

// ---------------------------------------------------------------- configuration

/** The dev chain's pre-funded key, from `resource/specs/dev.toml`. Not a secret. */
const DEVNET_KEY = "0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc";

/** CKB's floor: 1,000 shannons per kilobyte of transaction. Cycles are not charged. */
const FEE_RATE = 1_000n;

/**
 * The chronicle's capacity, which never changes.
 *
 * `flyworld` refuses any transaction in which its own capacity differs between input and
 * output, so this is a constant in the strongest sense: a record is not a bank, and a rule
 * that says so is cheaper than a rule that has to reason about what happens when a record
 * accumulates money. 1,000 CKB against the 235 the cell occupies.
 */
const WORLD_CAPACITY = 1_000n * SHANNONS_PER_CKB;

/**
 * How the code cells are referenced, and why it is not `"data"`.
 *
 * Both `"data"` and `"data1"` identify a code cell by `blake2b256` of its contents, so
 * both give a code hash that can be reproduced by rebuilding. The difference is which
 * CKB-VM runs the script, and it is not a detail:
 *
 * | hash type | VM | ISA | writable segments |
 * |---|---|---|---|
 * | `data`  | 0 | `IMC` | marked frozen |
 * | `data1` | 1 | `IMC` + bit manipulation | writable |
 * | `data2` | 2 | `IMC` + bit manipulation | writable |
 *
 * The contracts are built with `-C target-feature=+zba,+zbb,+zbc,+zbs` because the
 * hash-heavy inner loop is much cheaper with them. On VM 0 those instructions are not
 * decoded at all, so the script misbehaves in a way that surfaces as
 * `MemWriteOnExecutablePage` — the PC ends up outside `.text` and the instruction fetch
 * hits the W^X check. The error names a write, which sends you looking at the heap.
 *
 * This is worth stating plainly because **the integration tests cannot catch it**:
 * `ckb-testtool` runs the newest VM and does not implement `select_version`, so a
 * `hash_type: "data"` deployment passes 21 CKB-VM tests and then fails on a real node.
 * That is exactly what happened here.
 *
 * `data1` rather than `data2` because it needs only `ckb2021`, which every live chain
 * has had for years, while `data2` needs `ckb2023`. The ISA is identical.
 */
const CODE_HASH_TYPE = "data1";

const NETWORK =
  process.env.CKB_NETWORK ??
  (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(
    process.env.CKB_RPC_URL ?? "http://127.0.0.1:8114",
  )
    ? "devnet"
    : "preview");

/**
 * The record's path defaults to a file named for the network, and that is not decoration.
 *
 * A record describes one deployment on one chain, and the fly it points at is a different
 * organism on each chain. A single `deployment.json` that means "the dev chain" on Monday
 * and "preview testnet" on Tuesday — with the difference carried by an environment variable
 * someone has to remember — is a record that gets overwritten by the next deployment, and
 * the loss is silent: the file is valid, the fly it names exists, it is just a different
 * fly. Naming the file after the network removes the opportunity.
 *
 * A dev chain keeps the unqualified name because that is the record already on disk, and
 * renaming it would strand a live fly for no gain.
 */
const CONFIG = {
  rpc: process.env.CKB_RPC_URL ?? "http://127.0.0.1:8114",
  mode: process.env.FLY_MODE ?? "release",
  params: process.env.FLY_PARAMS ?? "v1",
  economics: process.env.FLY_ECON ?? "testnet",
  energy: BigInt(process.env.FLY_ENERGY ?? "1000000"),
  network: NETWORK,
  statePath:
    process.env.FLY_STATE ??
    join(
      PROJECT_ROOT,
      "deploy",
      NETWORK === "devnet" ? "deployment.json" : `deployment.${NETWORK}.json`,
    ),
  // Named for the network for the same reason, and one more: a key at the plain `.key` wins
  // on *every* network, so a testnet key placed there would quietly become the key that
  // signs mainnet transactions. It also has to be a file rather than a constant, because a
  // deployment's code cells are locked by it and anyone holding it can spend them.
  keyPath:
    process.env.FLY_KEY_FILE ??
    join(PROJECT_ROOT, "deploy", NETWORK === "devnet" ? ".key" : `.key.${NETWORK}`),
};

/**
 * Which key pays, and which key owns the code cells.
 *
 * Resolution order, and why it is this order:
 *
 * 1. `CKB_PRIVATE_KEY` — an explicit choice always wins.
 * 2. `FLY_KEY_FILE`, or `deploy/.key` — the key `node src/cli.js key` wrote.
 * 3. The dev chain's published key — **only on a dev chain**.
 *
 * That last restriction is the point of this function. `resource/specs/dev.toml` publishes
 * that key because a dev chain's coins are worthless and everyone needs the same starting
 * balance. On any other network it is a key the whole world has — and the code cells are
 * locked by it, so deploying with it would mean anyone could spend the capacity the
 * deployment locked up. The deployer refuses rather than quietly doing that with someone
 * else's testnet funds.
 */
function resolvePrivateKey() {
  if (process.env.CKB_PRIVATE_KEY) {
    return { key: process.env.CKB_PRIVATE_KEY, source: "CKB_PRIVATE_KEY" };
  }
  if (existsSync(CONFIG.keyPath)) {
    return { key: readFileSync(CONFIG.keyPath, "utf8").trim(), source: CONFIG.keyPath };
  }
  if (CONFIG.network === "devnet") {
    return { key: DEVNET_KEY, source: "the dev chain's published key" };
  }
  throw new Error(
    `no key for ${CONFIG.network}. Run \`node src/cli.js key\` to make one, or set ` +
      `CKB_PRIVATE_KEY. The dev chain's key is deliberately not used here: it is published ` +
      `in resource/specs/dev.toml, so anyone could spend the code cells it locks.`,
  );
}

// ---------------------------------------------------------------- ccc plumbing

/**
 * A client for the configured RPC.
 *
 * The *testnet* deployment table is used even for a local dev chain, because the dev
 * chain's `secp256k1_blake160_sighash_all` has the same code hash and hash type as
 * testnet's — `resource/specs/dev.toml` says so explicitly, and the code hashes are
 * properties of the binaries rather than of the chain. Using the testnet table also means
 * the same code path works against preview testnet, which is the next step after this
 * one. `fallbacks: []` is load-bearing: without it a local failure would silently become
 * a request to the public testnet.
 *
 * What the table cannot supply on a dev chain is the *out points* of those cells, so
 * `discover` reads them from the chain instead (see {@link devChainScripts}).
 */
async function makeClient({ discover = true } = {}) {
  const config = ccc.ClientPublicTestnet.resolveConfig({ url: CONFIG.rpc, fallbacks: [] });
  if (discover && CONFIG.network === "devnet") {
    const probe = new ccc.ClientPublicTestnet(config);
    config.scripts = { ...config.scripts, ...(await devChainScripts(probe)) };
  }
  return new ccc.ClientPublicTestnet(config);
}

/**
 * Read the well-known system scripts' cell deps out of a locally initialised dev chain.
 *
 * A dev chain cannot be described by a published table the way testnet and mainnet can:
 * `ckb init` bakes a timestamp into the genesis cell, so the genesis block — and with it
 * every system cell's out point — differs on every machine. Hardcoding the out points
 * would work exactly until the next `ckb init`.
 *
 * They are still discoverable, because CKB's genesis contains one **dep group** per
 * well-known script: a cell whose data is the list of out points that script needs. So
 * block 0 is read, the dep group cells are identified by their shape (a little-endian
 * count followed by exactly that many 36-byte out points, every one of them referring to
 * a transaction in block 0), and the script each one serves is identified by the hash of
 * the type script on the cells it points at.
 *
 * That last detail is the one worth remembering: these system cells are created with
 * `create_type_id = true`, so they are referenced with `hash_type: "type"` and their
 * `code_hash` is the hash of the **type script**, not of the binary sitting in the cell.
 * Hashing the data instead yields a plausible-looking value that matches nothing — which
 * is exactly what the first attempt here did.
 *
 * @returns {Promise<Record<string, object>>} a partial `scripts` table for CCC
 */
async function devChainScripts(client) {
  const block = await client.getBlockByNumber(0, "0x2");
  const inGenesis = new Set(block.transactions.map((t) => t.hash()));

  // Map each well-known script's code hash to its name, taken from CCC's own table rather
  // than typed in here — those hashes are properties of the binaries, so they are the one
  // part of a dev chain that *can* be borrowed.
  const published = ccc.ClientPublicTestnet.resolveConfig({}).scripts ?? {};
  const nameOfCodeHash = {};
  for (const name of ["Secp256k1Blake160", "Secp256k1Multisig"]) {
    const info = published[name];
    if (info?.codeHash) {
      nameOfCodeHash[info.codeHash] = name;
    }
  }

  const scripts = {};
  for (const tx of block.transactions) {
    for (const [i, out] of tx.outputs.entries()) {
      const refs = parseOutPointList(ccc.bytesFrom(tx.outputsData[i]), inGenesis);
      if (!refs) {
        continue;
      }
      for (const ref of refs) {
        const cell = await client.getCell(ref);
        const type = cell?.cellOutput?.type;
        if (!type) {
          continue;
        }
        const name = nameOfCodeHash[ccc.Script.from(type).hash()];
        if (name && !scripts[name]) {
          scripts[name] = {
            codeHash: ccc.Script.from(type).hash(),
            hashType: "type",
            cellDeps: [
              { cellDep: { outPoint: { txHash: tx.hash(), index: i }, depType: "depGroup" } },
            ],
          };
        }
      }
    }
  }
  return scripts;
}

/**
 * Decode a dep group's payload: a little-endian count, then that many out points, each a
 * 32-byte transaction hash followed by a little-endian 4-byte index.
 *
 * The layout is `4 + 36n` bytes, and the exact length is part of the test — an ordinary
 * data cell that merely starts with a plausible count is rejected rather than scanned,
 * which is what keeps a 15 KB connectome table from being mistaken for a dep group.
 *
 * Returns `null` for anything that is not exactly a list of out points pointing inside
 * the block.
 */
function parseOutPointList(data, inGenesis) {
  if (data.length < 4) {
    return null;
  }
  const count = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
  if (count === 0 || data.length !== 4 + 36 * count) {
    return null;
  }
  const refs = [];
  for (let k = 0; k < count; k++) {
    const o = 4 + 36 * k;
    const txHash = ccc.hexFrom(data.slice(o, o + 32));
    if (!inGenesis.has(txHash)) {
      return null;
    }
    const index = data[o + 32] | (data[o + 33] << 8) | (data[o + 34] << 16) | (data[o + 35] << 24);
    refs.push({ txHash, index });
  }
  return refs;
}

function makeSigner(client) {
  return new ccc.SignerCkbPrivateKey(client, resolvePrivateKey().key);
}

/**
 * Occupied capacity of a cell, in shannons: 1 byte = 1 CKB.
 *
 * This is CKB's own accounting rule, from
 * `util/gen-types/src/extension/capacity.rs`:
 *
 * ```text
 * occupied = 8                          // the capacity field itself
 *          + data.len()
 *          + (lock.args.len() + 33)     // code hash (32) + hash type (1)
 *          + (type.args.len() + 33)     // only when the cell wears a type script
 * ```
 *
 * Note what is *not* here: molecule's table headers, its per-field offset words, its
 * four-byte length prefixes, or the four-byte alignment padding on `Bytes`. The node
 * charges for the payload, not for the encoding around it — so a cell whose molecule
 * serialization is 1,451 bytes can occupy 1,376. `CellOutput.occupiedSize` from CCC is
 * exactly the script-and-capacity part of this sum, which is why the data length is added
 * separately rather than modelled as a padded byte vector.
 */
function capacityFor({ lock, type, data }) {
  const probe = ccc.CellOutput.from({ capacity: 0n, lock, ...(type ? { type } : {}) });
  return (BigInt(probe.occupiedSize) + BigInt(data.length)) * SHANNONS_PER_CKB;
}

function makeOutput({ lock, type, data, capacity }) {
  const hex = ccc.hexFrom(data);
  const out = ccc.CellOutput.from(
    { capacity: capacity ?? capacityFor({ lock, type, data }), lock, ...(type ? { type } : {}) },
    hex,
  );
  return [out, hex];
}

function dep(outPoint) {
  return { outPoint, depType: "code" };
}

/**
 * An out point as the deployment record stores it: a hex string and a *number*.
 *
 * `Cell.outPoint.index` from CCC is a `bigint`, and `JSON.stringify` refuses those outright
 * — so a record built straight from a chain cell throws on write rather than being wrong,
 * which is the better failure but still a failure. The record has always held plain numbers
 * (`outPointAt` in `deploy` builds them that way), so the conversion belongs at the one
 * place a cell becomes a record entry, not at every call site.
 */
function outPointJson(outPoint) {
  return { txHash: outPoint.txHash, index: Number(outPoint.index) };
}

function sha256(bytes) {
  return "0x" + createHash("sha256").update(bytes).digest("hex");
}

async function sendAndWait(client, signer, tx) {
  const signed = await signer.signTransaction(tx);
  const hash = await client.sendTransaction(signed);
  await client.waitTransaction(hash, 0, 120_000, 500);
  return hash;
}

// ---------------------------------------------------------------- deployment record

function readDeployment() {
  if (!existsSync(CONFIG.statePath)) {
    throw new Error(
      `no deployment at ${CONFIG.statePath}. Run \`node src/cli.js deploy\` first.`,
    );
  }
  return JSON.parse(readFileSync(CONFIG.statePath, "utf8"));
}

function writeDeployment(d) {
  writeFileSync(CONFIG.statePath, JSON.stringify(d, null, 2) + "\n");
}

function note(d, entry) {
  d.history = d.history ?? [];
  d.history.push({ at: new Date().toISOString(), ...entry });
}

/**
 * Fail before spending, if the deployment record could not be written.
 *
 * `deploy` sends the code cells and only then writes the record, because the record needs
 * the transaction hash that the chain assigns. That order means a bad `FLY_STATE` — a
 * relative path resolved against the wrong directory, or a directory that does not exist —
 * is discovered *after* the capacity is committed and the transaction is already in a
 * block. The cells are recoverable (see {@link cmdAdopt}), but the coin is spent either
 * way, so the path is checked first.
 *
 * The trap worth naming: a relative `FLY_STATE` is resolved against the *current
 * directory*, not against the project root, and the commands are normally run from
 * `ckb-fly/deploy`. So `FLY_STATE=deploy/deployment.preview.json` means
 * `ckb-fly/deploy/deploy/deployment.preview.json` — a plausible-looking path that silently
 * does not exist. From that directory, `FLY_STATE=deployment.preview.json` is what was
 * meant; an absolute path is unambiguous from anywhere and is the safer habit.
 */
function assertStateWritable() {
  const dir = dirname(CONFIG.statePath);
  if (!existsSync(dir)) {
    throw new Error(
      `FLY_STATE is ${CONFIG.statePath}, but ${dir} does not exist. A relative FLY_STATE ` +
        `resolves against the current directory (${process.cwd()}), not against the project.`,
    );
  }
}

// ---------------------------------------------------------------- commands

/**
 * Print what a deployment would create, without touching a network.
 *
 * Worth having as its own command: the numbers here (code hashes, capacities, the type
 * script hash) are the fly's identity, and they can be checked against `flyplan` and the
 * integration tests before any of them are committed to a chain.
 */
async function cmdPlan() {
  const circuit = plan.circuit();
  // A fresh nonce per deployment. This is the fly's address: everything else in the args
  // describes a species, and without this two flies would be the same organism as far as
  // the chain is concerned.
  const instance = "0x" + randomBytes(8).toString("hex");
  const args = plan.args({ instance, params: CONFIG.params, economics: CONFIG.economics });
  const flybrain = flybrainBinary(CONFIG.mode);
  const flylock = flylockBinary(CONFIG.mode);
  const flyworld = flyworldBinary(CONFIG.mode);
  const table = circuitTable();

  const flyType = ccc.Script.from({
    codeHash: ccc.hashCkb(flybrain),
    hashType: CODE_HASH_TYPE,
    args: args.args,
  });
  const flyLock = ccc.Script.from({ codeHash: ccc.hashCkb(flylock), hashType: CODE_HASH_TYPE, args: "0x" });

  const genesis = plan.genesis({ params: CONFIG.params, energy: CONFIG.energy });
  const econ = CONFIG.economics === "free" ? ECON_FREE : ECON_TESTNET;

  const lines = [
    `network        ${CONFIG.rpc}`,
    `params         ${CONFIG.params}`,
    `economics      ${CONFIG.economics}`,
    "",
    `flybrain       ${flybrain.length} bytes  code_hash ${ccc.hashCkb(flybrain)}`,
    `flylock        ${flylock.length} bytes  code_hash ${ccc.hashCkb(flylock)}`,
    `flyworld       ${flyworld.length} bytes  code_hash ${ccc.hashCkb(flyworld)}`,
    `circuit table  ${table.length} bytes  keccak256 ${circuit.hash}`,
    "",
    `type args      ${args.args}  (${args.len} bytes)`,
    `type script    ${flyType.hash()}`,
    `lock script    ${flyLock.hash()}`,
    "",
    `genesis state  ${genesis.len} bytes, energy ${CONFIG.energy}, born at block 0`,
    `genesis cap    ${econ.bodyCapacity + econ.backingPerStep * CONFIG.energy} shannons`,
    "",
    "occupied capacity (the code cells wear the deployer's secp256k1 lock):",
  ];

  // The code cells wear the deployer's own lock, so the offline view has to derive it.
  // That is a pure function of the private key, and the lock's code hash comes from the
  // published table rather than from the chain — so `plan` still touches no network.
  const signer = makeSigner(await makeClient({ discover: false }));
  const { script: myLock } = await signer.getAddressObjSecp256k1();

  lines.push(
    `  flybrain     ${capacityFor({ lock: myLock, data: flybrain }) / SHANNONS_PER_CKB} CKB`,
    `  flylock      ${capacityFor({ lock: myLock, data: flylock }) / SHANNONS_PER_CKB} CKB`,
    `  flyworld     ${capacityFor({ lock: myLock, data: flyworld }) / SHANNONS_PER_CKB} CKB`,
    `  circuit      ${capacityFor({ lock: myLock, data: table }) / SHANNONS_PER_CKB} CKB`,
    "",
    `the state cell occupies ${capacityFor({ lock: flyLock, type: flyType, data: new Uint8Array(genesis.len) }) / SHANNONS_PER_CKB} CKB,`,
    `against a body of ${econ.bodyCapacity / SHANNONS_PER_CKB} CKB — the deposit is covered, with headroom.`,
  );
  console.log(lines.join("\n"));
}

/**
 * Deploy the code cells, the connectome table and the first fly.
 *
 * The code cells are referenced by `code_hash` + `hash_type: data`, i.e. by the blake2b
 * hash of their contents rather than by their location. That is what makes the fly's
 * identity reproducible: the same binaries produce the same code hash on any chain, so a
 * deployment can be verified by rebuilding rather than by trusting an out point.
 */
async function cmdDeploy(force, lockSpec) {
  assertStateWritable();

  const client = await makeClient();
  const signer = makeSigner(client);
  const myLock = (await signer.getAddressObjSecp256k1()).script;

  let record = existsSync(CONFIG.statePath)
    ? JSON.parse(readFileSync(CONFIG.statePath, "utf8"))
    : null;
  if (record && !force) {
    throw new Error(
      `${CONFIG.statePath} already exists. Pass --force to redeploy (this creates a second, unrelated fly).`,
    );
  }

  const flybrain = flybrainBinary(CONFIG.mode);
  const flylock = flylockBinary(CONFIG.mode);
  const flyworld = flyworldBinary(CONFIG.mode);
  const table = circuitTable();
  const circuitHash = plan.circuit().hash;

  console.log(`deploying from ${CONFIG.rpc} as ${await signer.getRecommendedAddress()}`);

  // ---- 1. the four immutable cells
  const tx = ccc.Transaction.default();
  const artifacts = [
    { name: "flybrain", data: flybrain },
    { name: "flylock", data: flylock },
    { name: "flyworld", data: flyworld },
    { name: "circuit", data: table },
  ];
  for (const a of artifacts) {
    const [out, hex] = makeOutput({ lock: myLock, data: a.data });
    tx.addOutput(out, hex);
  }
  // `completeFeeBy` picks the deployer's cells, adds the change output, and prepares the
  // witness for the signature. Without it the transaction has no inputs at all, which the
  // node rejects as `Empty(Inputs)`.
  await tx.completeFeeBy(signer, FEE_RATE);
  const codeTx = await sendAndWait(client, signer, tx);
  console.log(`code cells: ${codeTx}`);

  const outPointAt = (i) => ({ txHash: codeTx, index: i });
  const codeCells = {
    flybrain: {
      codeHash: ccc.hashCkb(flybrain),
      hashType: CODE_HASH_TYPE,
      bytes: flybrain.length,
      sha256: sha256(flybrain),
      outPoint: outPointAt(0),
    },
    flylock: {
      codeHash: ccc.hashCkb(flylock),
      hashType: CODE_HASH_TYPE,
      bytes: flylock.length,
      sha256: sha256(flylock),
      outPoint: outPointAt(1),
    },
    flyworld: {
      codeHash: ccc.hashCkb(flyworld),
      hashType: CODE_HASH_TYPE,
      bytes: flyworld.length,
      sha256: sha256(flyworld),
      outPoint: outPointAt(2),
    },
    circuit: {
      keccak256: circuitHash,
      bytes: table.length,
      outPoint: outPointAt(3),
    },
  };

  record = {
    network: CONFIG.rpc,
    mode: CONFIG.mode,
    params: CONFIG.params,
    economics: CONFIG.economics,
    deployedAt: new Date().toISOString(),
    codeCells,
    fly: null,
    world: null,
    history: [],
  };
  writeDeployment(record);
  console.log(`  flybrain code_hash ${codeCells.flybrain.codeHash}`);
  console.log(`  flylock  code_hash ${codeCells.flylock.codeHash}`);
  console.log(`  flyworld code_hash ${codeCells.flyworld.codeHash}`);
  console.log(`  circuit  keccak256 ${circuitHash}`);

  // ---- 2. the first fly
  await createGenesis(client, signer, record, myLock, lockSpec);
}

/**
 * Create a newborn fly, reusing the code cells already on chain.
 *
 * Anyone can run this: a genesis transaction creates a new organism rather than touching
 * an existing one, and the type script checks that the state really is a newborn. It is
 * how the "multi-fly factory" the roadmap mentions would work — a front-end concern, not
 * a contract change.
 *
 * `lockSpec` is deliberately an argument rather than a deployment setting. A deployment record
 * can hold multiple organisms with different locks over its life, and the lock on an organism
 * is permanent; changing a setting after the fact must not change what an existing record's
 * `genesis` means.
 */
/**
 * Which lock the fly's state cell — and its chronicle — will wear.
 *
 * **This is the one place where "who may advance this fly" is decided.** The type script pins
 * `output.lock == input.lock`, so the lock is chosen once, at genesis, and can never change;
 * everything afterwards is enforcement. `contracts/flylock/src/main.rs` states the same thing
 * from the contract's side.
 *
 * Three forms:
 *
 * - `flylock` (the default) — a lock that accepts every transaction, because upstream anyone
 *   may call `tick()`. All the rules live in the type script.
 * - `owner` — the deploying key's own `secp256k1_blake160` lock. A **private fly**: only the
 *   holder of that key can advance it. It needs no new code cell and no contract change; the
 *   same type script enforces everything else.
 * - `<codeHash>:<hashType>:<args>` — any lock at all. This is the form that lets a wallet's
 *   lock (an OmniLock, a JoyID lock, anything) be used without this program changing, which is
 *   the difference between a parameter and a code change.
 *
 * @param {string|undefined} spec what the caller asked for
 * @param {object} record the deployment record, for the `flylock` code hash
 * @param {object} myLock the deploying key's lock, for `owner`
 * @returns {object} a `ccc.Script`
 */
function resolveLock(spec, record, myLock) {
  const wanted = (spec ?? "flylock").trim();

  if (wanted === "flylock") {
    return ccc.Script.from({
      codeHash: record.codeCells.flylock.codeHash,
      hashType: CODE_HASH_TYPE,
      args: "0x",
    });
  }

  if (wanted === "owner") {
    // The key's own lock, exactly as the deployer already derives it for the code cells. Note
    // that this is the *same* lock the code cells wear, so a private fly's capacity is
    // recoverable with the same key that paid for it — which is convenient and also the reason
    // the key has to be guarded: losing it loses the fly, and there is no recovery path,
    // because the type script will not let the lock change.
    return ccc.Script.from({
      codeHash: myLock.codeHash,
      hashType: myLock.hashType,
      args: myLock.args,
    });
  }

  const parts = wanted.split(":");
  if (parts.length !== 3) {
    throw new Error(
      `--lock must be \`flylock\`, \`owner\`, or \`<codeHash>:<hashType>:<args>\`. ` +
        `Got \`${wanted}\`, which splits into ${parts.length} part(s) rather than 3.`,
    );
  }
  const [codeHash, hashType, args] = parts;
  if (!/^0x[0-9a-fA-F]{64}$/.test(codeHash)) {
    throw new Error(`--lock: the code hash must be 0x followed by 64 hex digits, got \`${codeHash}\``);
  }
  if (!["data", "data1", "data2", "type"].includes(hashType)) {
    throw new Error(
      `--lock: the hash type must be data, data1, data2 or type. Got \`${hashType}\`. ` +
        `Note that these are strings, not the TypeScript enums — those are undefined at runtime.`,
    );
  }
  if (args !== "0x" && !/^0x([0-9a-fA-F]{2})*$/.test(args)) {
    throw new Error(`--lock: the args must be 0x followed by whole bytes, got \`${args}\``);
  }
  return ccc.Script.from({ codeHash, hashType, args });
}

async function createGenesis(client, signer, record, myLock, lockSpec) {
  // A fresh instance nonce, always. See `plan.mintInstance` for why a second fly must not
  // inherit the first one's: it is the difference between two organisms and one organism
  // wearing two cells.
  const instance = plan.mintInstance();
  const args = plan.args({
    instance,
    params: record.params,
    economics: record.economics,
    circuitHash: record.codeCells.circuit.keccak256,
  });

  // The lock the fly — and its chronicle — will wear, for the rest of its existence. See
  // `resolveLock` for why this is a parameter rather than a constant.
  const flyLock = resolveLock(lockSpec, record, myLock);
  const flyType = ccc.Script.from({
    codeHash: record.codeCells.flybrain.codeHash,
    hashType: CODE_HASH_TYPE,
    args: args.args,
  });

  const tip = await client.getTip();
  const bornBlock = tip + 1n;
  const newborn = plan.genesis({
    params: record.params,
    energy: CONFIG.energy,
    bornBlock,
  });

  const econ = record.economics === "free" ? ECON_FREE : ECON_TESTNET;
  const capacity = econ.bodyCapacity + econ.backingPerStep * CONFIG.energy;

  // The chronicle is created in the same transaction as the fly, because that is the only
  // transaction in which the chain can witness a birth: `flyworld` refuses to open a
  // chronicle for a fly that already exists, since its `born_step` is a claim about a birth
  // and a record that guesses would be worse than no record.
  const worldArgs = plan.worldArgs({ flyTypeHash: flyType.hash() });
  const worldType = ccc.Script.from({
    codeHash: record.codeCells.flyworld.codeHash,
    hashType: CODE_HASH_TYPE,
    args: worldArgs.args,
  });
  const chronicle = plan.worldOpen({ flyState: newborn.state, capacity });

  const tx = ccc.Transaction.default();
  tx.addCellDeps(
    dep(record.codeCells.flybrain.outPoint),
    dep(record.codeCells.flylock.outPoint),
    dep(record.codeCells.flyworld.outPoint),
    dep(record.codeCells.circuit.outPoint),
  );
  const [out, hex] = makeOutput({ lock: flyLock, type: flyType, data: newborn.state, capacity });
  tx.addOutput(out, hex);
  const [worldOut, worldHex] = makeOutput({
    lock: flyLock,
    type: worldType,
    data: chronicle.data,
    capacity: WORLD_CAPACITY,
  });
  tx.addOutput(worldOut, worldHex);
  await tx.completeFeeBy(signer, FEE_RATE);

  const genesisTx = await sendAndWait(client, signer, tx);

  record.world = {
    typeArgs: worldArgs.args,
    typeScript: {
      codeHash: worldType.codeHash,
      hashType: worldType.hashType,
      args: worldArgs.args,
    },
    typeHash: worldType.hash(),
    stateOutPoint: { txHash: genesisTx, index: 1 },
    capacity: String(WORLD_CAPACITY),
  };

  record.fly = {
    instance,
    typeArgs: args.args,
    typeScript: { codeHash: flyType.codeHash, hashType: flyType.hashType, args: args.args },
    typeHash: flyType.hash(),
    lockScript: { codeHash: flyLock.codeHash, hashType: flyLock.hashType, args: flyLock.args },
    stateOutPoint: { txHash: genesisTx, index: 0 },
    energy: String(CONFIG.energy),
    bornBlock: String(bornBlock),
    genesisTx,
  };
  // The log starts over, because it describes *this* fly and it is about to describe a
  // different one. `--force` replaces `record.fly`, so anything already in `history` belongs to
  // the organism that record used to point at: appending would leave a reader counting seven
  // transitions for a fly whose chain of state cells holds five. Measured on the preview
  // deployment — the record listed two `genesis` rows, one of them a previous attempt's.
  //
  // The chain is the authority and the indexer walks it, so nothing downstream was wrong; but a
  // record whose only job is to say what happened should not need that caveat.
  record.history = [];
  note(record, { action: "genesis", txHash: genesisTx, step: "0", energy: String(CONFIG.energy) });
  writeDeployment(record);

  console.log(`fly genesis: ${genesisTx}`);
  console.log(`  instance    ${instance}`);
  console.log(`  type hash   ${flyType.hash()}`);
  console.log(`  state cell  ${genesisTx}:0, ${capacity / SHANNONS_PER_CKB} CKB`);
  console.log(`  chronicle   ${genesisTx}:1, ${WORLD_CAPACITY / SHANNONS_PER_CKB} CKB`);
  console.log(`  born block  ${bornBlock}`);
}

/**
 * Rebuild a deployment record from the chain, after one was lost.
 *
 * `deploy` sends the four code cells and only then writes the record, because the record
 * needs the transaction hash the chain assigns. Anything that fails in between — a
 * mistyped `FLY_STATE`, a full disk, a killed process — leaves the cells on chain and the
 * record unwritten, which is exactly the state that makes a redeploy tempting. Redeploying
 * would send four more copies and spend the capacity a second time.
 *
 * It is recoverable, and specifically because of how the cells are referenced: by
 * `code_hash` plus `hash_type: data1`, i.e. by the blake2b hash of their *contents*, never
 * by location. The identity of a deployment is therefore a property of the artifacts, which
 * are still on disk; the record is a cache of where the chain happened to put them. This
 * command rebuilds that cache.
 *
 * # Why this searches for cells rather than reading the transaction back
 *
 * The obvious implementation — `get_transaction`, then take the outputs — does not work on
 * a node that has been restarted, and fails in the worst possible way. CKB's
 * `get_transaction` is served from an index that lives in memory and is not persisted, so a
 * node returns `transaction: null, status: "unknown"` for any transaction committed before
 * it started, *while still reporting the transaction as found*. Public nodes are load
 * balanced across restarted instances, so the same query answers differently minute to
 * minute. A record rebuilt from that would be silently empty.
 *
 * Searching for the cells instead is also strictly stronger: the indexer only returns
 * **live** cells, so a successful adoption is simultaneously a proof that the code cells
 * are still unspent. Reading a historical transaction proves nothing about that.
 *
 * Cells are identified by hashing their data and matching it against the artifacts this
 * build produces — never by their position. `deploy` does add them in a fixed order, but
 * position is not evidence, and a record that is right by luck is worse than one that
 * refuses. Two matches for one artifact is likewise an error, not a tie to be broken: it
 * means the same build was deployed twice and the caller has to say which one they mean.
 *
 * @param {string} [txHash] restrict the search to cells created by this transaction
 */
async function cmdAdopt(txHash) {
  assertStateWritable();

  const client = await makeClient();
  const signer = makeSigner(client);
  const myLock = (await signer.getAddressObjSecp256k1()).script;

  const artifacts = {
    flybrain: flybrainBinary(CONFIG.mode),
    flylock: flylockBinary(CONFIG.mode),
    flyworld: flyworldBinary(CONFIG.mode),
    circuit: circuitTable(),
  };
  const hashOf = Object.fromEntries(
    Object.entries(artifacts).map(([name, bytes]) => [name, ccc.hashCkb(bytes)]),
  );
  const nameOfHash = Object.fromEntries(Object.entries(hashOf).map(([n, h]) => [h, n]));

  // The code cells wear the deployer's own lock and no type script, which is what makes
  // them findable: a lock search is the only handle the indexer has on them.
  const candidates = {};
  let scanned = 0;
  for await (const cell of client.findCells(
    { script: myLock, scriptType: "lock", scriptSearchMode: "exact" },
    "asc",
    64,
  )) {
    if (txHash && cell.outPoint.txHash !== txHash) {
      continue;
    }
    scanned += 1;
    const name = nameOfHash[ccc.hashCkb(ccc.bytesFrom(cell.outputData))];
    if (name) {
      (candidates[name] ??= []).push(cell);
    }
  }

  if (!scanned) {
    throw new Error(
      `no live cells at all wear ${myLock.hash()} on ${CONFIG.rpc}. ` +
        (txHash ? `Either ${txHash} is not this key's, or its cells are spent.` : ``),
    );
  }

  const codeCells = {};
  for (const name of Object.keys(artifacts)) {
    const found = candidates[name] ?? [];
    if (!found.length) {
      throw new Error(
        `no live cell on ${CONFIG.rpc} holds ${name} (code_hash ${hashOf[name]}). ` +
          `Either it was never deployed from this build, or it has been spent.`,
      );
    }
    if (found.length > 1) {
      const where = found
        .map((c) => `${c.outPoint.txHash}:${c.outPoint.index}`)
        .join(", ");
      throw new Error(
        `${found.length} live cells hold ${name}: ${where}. This build was deployed more ` +
          `than once; pass the txHash of the one you mean.`,
      );
    }
    const cell = found[0];
    codeCells[name] = {
      codeHash: hashOf[name],
      hashType: CODE_HASH_TYPE,
      bytes: artifacts[name].length,
      sha256: sha256(artifacts[name]),
      outPoint: outPointJson(cell.outPoint),
    };
  }

  // The four code cells come from one transaction when they came from `deploy`, and the
  // record's shape assumes it. Say so rather than emitting a record whose out points could
  // not have been produced by the deployer.
  const txHashes = new Set(Object.values(codeCells).map((c) => c.outPoint.txHash));
  if (txHashes.size !== 1) {
    throw new Error(
      `the four code cells come from ${txHashes.size} different transactions. That is not a ` +
        `deployment this program made, and the record would misdescribe it.`,
    );
  }
  const from = [...txHashes][0];

  const record = {
    network: CONFIG.rpc,
    mode: CONFIG.mode,
    params: CONFIG.params,
    economics: CONFIG.economics,
    // `get_transaction` may or may not still be answerable (see above), so the deployment
    // time is recorded when the node can still supply it and left null when it cannot —
    // rather than being filled in with the time of the adoption, which is a different fact.
    deployedAt: await deploymentTime(client, from),
    // `adoptedFrom`/`adoptedAt` mark this record as rebuilt rather than written by a
    // `deploy` that watched the transaction land. Kept out of `history`, which counts
    // *fly* actions — an adoption is an event in the record's life, not in the fly's.
    adoptedFrom: from,
    adoptedAt: new Date().toISOString(),
    codeCells,
    fly: null,
    world: null,
    history: [],
  };
  writeDeployment(record);

  console.log(`adopted ${from} as the deployment at ${CONFIG.statePath}`);
  for (const name of Object.keys(artifacts)) {
    console.log(
      `  ${name.padEnd(9)} :${codeCells[name].outPoint.index}  ${codeCells[name].codeHash}`,
    );
  }
  console.log(`  deployedAt ${record.deployedAt ?? "(the node can no longer say)"}`);
  console.log("");
  console.log("all four are live cells, so nothing needs re-deploying.");
  console.log("no fly yet — `node src/cli.js genesis` creates one from these code cells.");
}

/**
 * When the code-cell transaction was committed, or null if the node cannot say.
 *
 * `get_transaction` is not persisted across restarts (see {@link cmdAdopt}), so this is
 * best-effort by design: an unavailable answer is reported as unavailable rather than
 * guessed at.
 */
async function deploymentTime(client, txHash) {
  try {
    const found = await client.getTransaction(txHash);
    if (found?.blockHash) {
      const header = await client.getHeaderByHash(found.blockHash);
      if (header?.timestamp !== undefined) {
        return new Date(Number(header.timestamp)).toISOString();
      }
    }
  } catch {
    // An unavailable index is the expected case, not an error.
  }
  return null;
}

/**
 * What a first deployment locks into cells.
 *
 * Computed from the artifacts rather than written down, because a number in a message is a
 * number that goes stale: the flybrain binary grew by 168 bytes when the args gained an
 * instance field, and any figure quoted here would have been wrong from that moment on.
 */
function deploymentCost(lock) {
  const econ = CONFIG.economics === "free" ? ECON_FREE : ECON_TESTNET;
  const parts = [
    ["flybrain code cell", capacityFor({ lock, data: flybrainBinary(CONFIG.mode) })],
    ["flylock code cell", capacityFor({ lock, data: flylockBinary(CONFIG.mode) })],
    ["flyworld code cell", capacityFor({ lock, data: flyworldBinary(CONFIG.mode) })],
    ["connectome table", capacityFor({ lock, data: circuitTable() })],
    ["the fly", econ.bodyCapacity + econ.backingPerStep * CONFIG.energy],
    ["its chronicle", WORLD_CAPACITY],
  ];
  return { parts, total: parts.reduce((n, [, c]) => n + c, 0n) };
}

/**
 * Make a key, or show the one that already exists.
 *
 * A deployment's code cells are locked by this key, so it has to be one nobody else has.
 * The command is separate from `deploy` because generating a key is the one step that has to
 * happen *before* the address can be funded, and on a testnet funding means a faucet and a
 * human.
 */
async function cmdKey() {
  if (CONFIG.network === "devnet" && !existsSync(CONFIG.keyPath)) {
    // A dev chain funds its own key in genesis, and it is the only funded key there is. A
    // fresh one would have nothing to spend, so this is a mistake rather than a choice.
    throw new Error(
      `a ${CONFIG.network} chain funds its own key in genesis, so there is nothing to make ` +
        `here. Point CKB_RPC_URL at a real network (and set CKB_NETWORK) to make a ` +
        `deployment key.`,
    );
  }

  if (!existsSync(CONFIG.keyPath)) {
    const key = "0x" + randomBytes(32).toString("hex");
    writeFileSync(CONFIG.keyPath, key + "\n", { mode: 0o600 });
    console.log(`wrote ${CONFIG.keyPath} (mode 600)`);
  } else {
    console.log(`using the existing ${CONFIG.keyPath}`);
  }

  const client = await makeClient({ discover: false });
  const signer = makeSigner(client);
  const address = await signer.getRecommendedAddress();
  const balance = await signer.getBalance();

  console.log(`\n  address   ${address}`);
  console.log(`  network   ${CONFIG.network}  (${CONFIG.rpc})`);
  console.log(`  balance   ${(Number(balance) / 1e8).toLocaleString("en-US")} CKB`);

  const { parts, total } = deploymentCost((await signer.getAddressObjSecp256k1()).script);
  const ckb = (shannons) =>
    (Number(shannons) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 });

  console.log("\n  a first deployment locks:");
  for (const [what, capacity] of parts) {
    console.log(`    ${what.padEnd(20)} ${ckb(capacity).padStart(12)} CKB`);
  }
  console.log(`    ${"total".padEnd(20)} ${ckb(total).padStart(12)} CKB  (all refundable in principle)`);

  if (balance === 0n) {
    console.log(
      "\n  The address has no CKB yet. The faucet gives 300,000 per address per month, so one\n" +
        "  claim covers this. It asks for a GitHub login, which is the one step of this that a\n" +
        "  program cannot do for you.",
    );
    console.log("\n  Claim at  https://faucet.nervos.org/  then run `node src/cli.js balance`.");
  } else if (balance < total) {
    console.log(
      `\n  That is ${ckb(total - balance)} CKB short. Claim at https://faucet.nervos.org/`,
    );
  } else {
    console.log(`\n  Enough to deploy, with ${ckb(balance - total)} CKB to spare.`);
  }
}

/** What the key can spend. */
async function cmdBalance() {
  const client = await makeClient({ discover: false });
  const signer = makeSigner(client);
  const { source } = resolvePrivateKey();
  const address = await signer.getRecommendedAddress();
  const balance = await signer.getBalance();
  console.log(`key from  ${source}`);
  console.log(`address   ${address}`);
  console.log(`network   ${CONFIG.network}  (${CONFIG.rpc})`);
  console.log(`balance   ${(Number(balance) / 1e8).toLocaleString("en-US")} CKB`);
  if (balance === 0n) {
    console.log("\n  nothing to spend. See `node src/cli.js key`.");
  }
}

/**
 * Recover the fly's whole life from the chain, newest last.
 *
 * This is the event layer, from the terminal. Nothing is read from the deployment record
 * except the fly's identity — the current cell is found by asking the chain, and the
 * history is walked backwards from it — so this works against a fly this machine did not
 * create, as long as it knows the type script hash.
 */
async function cmdHistory() {
  const record = readDeployment();
  const client = await makeClient();
  const id = identity({ deployment: record });
  const head = await findHead(client, id);
  const entries = await readChain({ client, head, identity: id });

  console.log(`fly ${id.typeHash}`);
  console.log(`${entries.length} transitions, recovered from ${entries.length + 1} state cells\n`);
  console.log("  #  block    action                                   step   energy      spikes  head");
  for (const [i, e] of entries.entries()) {
    const a = e.action
      ? `${e.action.kind}${describeAction(e.action)}`
      : "genesis (no fly consumed)";
    const s = e.state;
    console.log(
      `  ${String(i).padStart(2)}  ${String(e.blockNumber ?? "-").padStart(7)}  ${a.padEnd(40)}  ` +
        `${String(s.step).padStart(4)}  ${String(s.energy).padStart(9)}  ${String(s.totalSpikes).padStart(6)}  ` +
        `(${s.headX}, ${s.headY})`,
    );
  }
  void summarise;
}

function describeAction(a) {
  switch (a.kind) {
    case "tick":
      return `(${a.steps})`;
    case "stimulate":
      return `(ch ${a.channel}, p ${a.param}, str ${a.strength}, ${a.steps} steps)`;
    case "feed":
      return `(${a.steps})`;
    case "resurrect":
      return `(${a.steps}, born ${a.bornBlock})`;
    default:
      return "";
  }
}

/** Read the fly's state cell and describe it. */
/**
 * Where a cell wearing this type script currently is.
 *
 * Resolved from the chain every time, never from the deployment record. A cell moves
 * whenever it is spent, so a recorded out point is stale the moment anything touches it —
 * a keeper, a visitor with the page open, a second machine. Keeping positions in a file
 * works exactly until the first time two things run at once, and then it fails in the most
 * confusing way available: the transaction names a cell that no longer exists.
 *
 * So the record keeps **identities** — the type scripts, and through them the hashes — and
 * positions come from the chain. That also makes the deployer able to drive a fly it did not
 * create, which is what a keeper for someone else's fly would need.
 */
async function liveCells(client, scriptLike) {
  const script = ccc.Script.from(scriptLike);
  // Enumerated rather than asked for as "the" singleton. `findSingletonCellByType` returns
  // one of them, so when several live cells wear the same type script it picks silently — and
  // then every tick consumes a different branch and creates another one, so the duplication
  // grows instead of surfacing.
  const matches = [];
  for await (const cell of client.findCells(
    {
      script: { codeHash: script.codeHash, hashType: script.hashType, args: script.args },
      scriptType: "type",
      scriptSearchMode: "prefix",
    },
    "asc",
    8,
  )) {
    matches.push(cell);
  }
  return { script, matches };
}

/**
 * The one live cell wearing this type script, or a refusal.
 *
 * Used by everything that *moves* a cell. There is no "the fly" when several live cells wear
 * its type script, only branches — and choosing one is not a decision a tool gets to make on
 * the caller's behalf, because the branch it abandons is abandoned silently. Note that this
 * state is not recoverable by spending the extras: the type script requires exactly one
 * successor wearing the same script, so a tick moves a branch forward rather than removing
 * it. A branched fly is branched for good; the remedy is a new instance, not a repair.
 */
async function liveCell(client, scriptLike) {
  const { script, matches } = await liveCells(client, scriptLike);

  if (matches.length === 0) {
    throw new Error(
      `no live cell wears type script ${script.hash()}. Either it has not been created, or it has been spent and its successor is not yet committed.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(describeBranches(script.hash(), matches.map((cell) => cell.outPoint)));
  }
  return matches[0];
}

async function cmdStatus() {
  const record = readDeployment();
  const client = await makeClient();
  const { script, matches } = await liveCells(client, record.fly.typeScript);

  if (matches.length === 0) {
    throw new Error(
      `no live cell wears type script ${script.hash()}. Either it has not been created, or it has been spent and its successor is not yet committed.`,
    );
  }

  // `status` is read-only, so a branched fly is something to *describe* rather than refuse —
  // refusing would leave the chain unreadable with no way to see what is wrong. The detail
  // below is printed for the most advanced branch, which is a choice, so it is labelled as
  // one; `applyAction` is where the choice is refused outright.
  let cell = matches[0];
  if (matches.length > 1) {
    console.log(
      `WARNING: ${matches.length} live cells wear type script ${record.fly.typeHash}.`,
    );
    console.log(
      "  A state cell is consumed and recreated, so a fly should have exactly one live cell.",
    );
    console.log("  This one has branched, and a branch cannot be removed by spending it:");
    console.log("  the type script requires exactly one successor wearing the same script.");
    console.log("  Everything below describes the most advanced branch. Nothing can drive it.");
    for (const match of matches) {
      const branch = decodeState(ccc.bytesFrom(match.outputData));
      console.log(
        `    ${match.outPoint.txHash}:${match.outPoint.index}  step ${branch.step}  ` +
          `energy ${branch.energy}  ${branch.alive ? "alive" : "dead"}  gen ${branch.generation}`,
      );
    }
    cell = matches.reduce((best, match) => {
      const here = decodeState(ccc.bytesFrom(match.outputData));
      const there = decodeState(ccc.bytesFrom(best.outputData));
      return BigInt(here.step) > BigInt(there.step) ? match : best;
    }, matches[0]);
    console.log();
  }

  const data = ccc.bytesFrom(cell.outputData);
  const s = decodeState(data);
  console.log(`fly at ${cell.outPoint.txHash}:${cell.outPoint.index}`);
  console.log(`  type hash     ${record.fly.typeHash}`);
  {
    // The lock is the answer to "who may advance this", so a bare hash is not enough: it says
    // nothing about whether *this* key can. Name the kind, and say when the answer is no.
    const flyLock = record.fly.lockScript;
    const myLock = (await makeSigner(client).getAddressObjSecp256k1()).script;
    const kind = lockKind(flyLock, {
      myLock,
      alwaysLockCodeHash: record.codeCells.flylock.codeHash,
    });
    const label =
      kind === "flylock"
        ? "public — flylock accepts every transaction, anyone may advance it"
        : kind === "owner"
          ? "private — only this key's secp256k1 lock accepts it"
          : kind === "none"
            ? "(not recorded — this record predates the lock being a choice)"
            : `someone else's — ${ccc.Script.from(flyLock).hash()}`;
    console.log(`  lock          ${label}`);
  }
  console.log(`  capacity      ${cell.cellOutput.capacity} shannons`);
  console.log(
    `  alive         ${s.alive}${s.alive ? "" : " (dead — only resurrect is meaningful)"}`,
  );
  console.log(`  step          ${s.step}`);
  console.log(`  energy        ${s.energy} steps of life left`);
  console.log(`  generation    ${s.generation}`);
  console.log(`  spikes        ${s.totalSpikes} (life: ${s.lifeSpikes})`);
  console.log(`  head          (${s.headX}, ${s.headY})`);
  console.log(`  position      (${s.posX}, ${s.posY})`);
  console.log(`  stimulus      channel ${s.stimChannel}, param ${s.stimParam}, strength ${s.stimStrength}, until ${s.stimUntil}`);
  console.log(
    `  non-zero      v ${s.nonZeroV}/${N}, bias ${s.nonZeroBias}/${N}, inp ${s.nonZeroInp}/${N}`,
  );
  console.log(`  heading hist  [${s.headingHist.join(", ")}]`);
  console.log(`  history       ${(record.history ?? []).length} recorded actions`);

  // The chronicle, if there is one. Every number below was derived by the contract from
  // the fly in the same transaction — none of it was supplied by whoever sent it.
  if (record.world) {
    const { script: worldScript, matches: worldMatches } = await liveCells(
      client,
      record.world.typeScript,
    );
    if (worldMatches.length === 0) {
      throw new Error(`no live cell wears the chronicle's type script ${worldScript.hash()}`);
    }
    // The chronicle branched with the fly: one record per branch, each one claiming to be the
    // record of the same organism. Read-only, so describe the branches rather than refuse.
    const decoded = worldMatches.map((cell) => ({
      cell,
      w: plan.worldDecode({ world: ccc.hexFrom(cell.outputData) }),
    }));
    if (decoded.length > 1) {
      console.log(
        `\nWARNING: ${decoded.length} live chronicles wear type script ${record.world.typeHash}.`,
      );
      for (const { cell: branch, w: seen } of decoded) {
        console.log(
          `    ${branch.outPoint.txHash}:${branch.outPoint.index}  ` +
            `last sighting step ${seen.step}  sightings ${seen.sightings}`,
        );
      }
    }
    const best = decoded.reduce((a, b) => (BigInt(b.w.step) > BigInt(a.w.step) ? b : a));
    const worldCell = best.cell;
    const w = best.w;
    // Eight decimals, because a step of life is 0.0001 CKB: rounding to three would turn a
    // 64-step tick's release into "0.006" and an 8-step one into "0.001", which is the kind
    // of small lie a record should not tell.
    const ckb = (shannons) =>
      `${(Number(shannons) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 })} CKB`;
    console.log(`\nchronicle at ${worldCell.outPoint.txHash}:${worldCell.outPoint.index}`);
    console.log(`  type hash     ${record.world.typeHash}`);
    console.log(`  capacity      ${ckb(worldCell.cellOutput.capacity)} (it never changes)`);
    console.log(`  life          ${w.alive ? "alive" : "dead"}, generation ${w.generation}`);
    console.log(`  born at step  ${w.bornStep}${w.alive ? "" : `, died at step ${w.diedStep}`}`);
    console.log(`  last sighting step ${w.step}, energy ${w.energy}`);
    console.log(`  sightings     ${w.sightings}`);
    console.log(`  fed           ${ckb(w.totalAdded)}`);
    console.log(`  released      ${ckb(w.totalReleased)}`);
    const net = BigInt(w.netCapacity);
    console.log(
      `  net           ${net >= 0n ? "+" : "-"}${ckb(net < 0n ? -net : net)} ` +
        `(${net >= 0n ? "people have fed it more than tickers took" : "tickers have taken more than people fed"})`,
    );
  }
}

/**
 * Build the transaction for an action — unsigned, and with no fee paid.
 *
 * Split out of {@link applyAction} for the page. A visitor's wallet must be able to drive a
 * public fly without the server holding a key for it, and the honest way to do that is not to
 * move the signing into the browser (the successor state comes from the Rust simulation, and a
 * second implementation of the dynamics in JavaScript would be a second source of truth for the
 * one thing this port is about). It is to keep *one* implementation of "what the successor is",
 * on the server, and let the browser do the only part that needs a private key: paying the fee
 * and signing. So this builds everything up to and including the action witness and stops.
 *
 * What the payer must do, and why (see `POST /api/prepare`, which documents the same contract
 * to the browser):
 *
 * 1. `completeFeeBy(signer, FEE_RATE)` — the visitor's own coins pay, and the change comes back
 *    to them. The server's key is not in this transaction and never learns one.
 * 2. `setWitnessArgsAt(0, { inputType })` again, because completing a fee can rewrite the
 *    witness list.
 * 3. Check that the fly is still input 0 — the contract reads the action from witness 0 of the
 *    type script's input group, and that group must have exactly one member.
 *
 * `signerLock` is required rather than optional. It is the lock that is going to sign — this
 * server's key for the CLI and the keeper, the visitor's wallet for the page — and checking it
 * here rather than at each call site means a builder cannot be reached without one.
 *
 * The output cell's capacity is not computed here — it comes back from the planner as
 * `outCapacity`, which is `input.capacity - capacity_release(in.energy, out.energy)`. The
 * type script compares it for equality, so a value derived any other way would be refused.
 *
 * @param {object} actionSpec `{kind, ...}` as `plan.action` expects
 * @param {{deployment?: object|null, signerLock: object, client?: object|null}} options
 */
async function buildAction(actionSpec, { deployment = null, signerLock, client = null } = {}) {
  // `deployment` is an in-memory target supplied by the public page. It has the same code
  // cells and economics as the local record, but its `fly`/`world` identity is the organism
  // the page is watching. It is never written back: the deployment record is the server's
  // default fly, not a mutable "last public click" slot.
  const record = deployment ?? readDeployment();
  client = client ?? (await makeClient());

  // Refuse before building anything, if the key that will sign cannot satisfy the lock the fly
  // wears. `completeFeeBy` would fail on its own, but with a message about a signature rather
  // than about ownership, and the useful fact here is that the lock was chosen at genesis and
  // cannot be changed — so this is not a problem to work around, it is a different key.
  if (!signerLock) {
    throw new Error(
      "buildAction needs the lock that will sign the transaction, so it can refuse a fly that " +
        "lock cannot move",
    );
  }
  const refusal = signableLock(record.fly.lockScript, {
    myLock: signerLock,
    alwaysLockCodeHash: record.codeCells.flylock.codeHash,
  });
  if (refusal) {
    throw new Error(refusal);
  }

  const action = plan.action({ ...actionSpec, params: record.params });

  const cell = await liveCell(client, record.fly.typeScript);
  const prev = { txHash: cell.outPoint.txHash, index: cell.outPoint.index };

  const before = plan.decode({ params: record.params, state: ccc.hexFrom(cell.outputData) });
  const after = plan.apply({
    params: record.params,
    economics: record.economics,
    state: ccc.hexFrom(cell.outputData),
    action: action.action,
    inCapacity: cell.cellOutput.capacity,
  });

  const flyLock = ccc.Script.from(record.fly.lockScript);
  const flyType = ccc.Script.from(record.fly.typeScript);

  const tx = ccc.Transaction.default();
  tx.addCellDeps(
    dep(record.codeCells.flybrain.outPoint),
    dep(record.codeCells.flylock.outPoint),
    dep(record.codeCells.flyworld.outPoint),
    dep(record.codeCells.circuit.outPoint),
  );
  // The fly goes in and out first, so its witness is witness 0 — which is where the type
  // script looks for the action.
  tx.addInput({ previousOutput: prev, since: 0n });
  const [out, hex] = makeOutput({
    lock: flyLock,
    type: flyType,
    data: after.state,
    capacity: BigInt(after.outCapacity),
  });
  tx.addOutput(out, hex);

  // The chronicle, if this fly has one, is updated in the *same* transaction as the
  // transition it records. That is the whole design: the world cell is not told what the
  // fly did, it is required to look, and the only moment the fly is there to look at is the
  // moment it moves.
  let chronicle = null;
  let chronicleCapacity = null;
  if (record.world) {
    const worldCell = await liveCell(client, record.world.typeScript);
    chronicleCapacity = worldCell.cellOutput.capacity;
    chronicle = plan.worldSight({
      world: ccc.hexFrom(worldCell.outputData),
      flyState: after.state,
      // The fly's capacities, not the chronicle's: the chronicle's own capacity never
      // changes, and its type script refuses a transaction that tries to change it.
      inCapacity: cell.cellOutput.capacity,
      outCapacity: after.outCapacity,
    });
    tx.addInput({ previousOutput: worldCell.outPoint, since: 0n });
    const [worldOut, worldHex] = makeOutput({
      lock: flyLock,
      type: ccc.Script.from(record.world.typeScript),
      data: chronicle.data,
      capacity: chronicleCapacity,
    });
    tx.addOutput(worldOut, worldHex);
  }

  // The action lives in `WitnessArgs.inputType` of the state cell's input. Set here so that
  // whoever completes the fee is estimating the size of a transaction that already contains it;
  // they must set it again afterwards, because completion can touch the witness list.
  tx.setWitnessArgsAt(0, { inputType: action.action });

  return { record, client, action, cell, prev, before, after, tx, chronicle };
}

/**
 * Apply an action: build it, sign it with this server's key, send it, report what changed.
 *
 * The CLI and the keeper use this. The page does not — a visitor's wallet signs there, through
 * `buildAction` and `POST /api/prepare` — and the difference is only who pays and who holds a
 * key: everything about the transaction itself comes from `buildAction`.
 */
async function applyAction(
  actionSpec,
  { quiet = false, record: keepRecord = true, deployment = null } = {},
) {
  const client = await makeClient();
  const signer = makeSigner(client);
  const myLock = (await signer.getAddressObjSecp256k1()).script;

  const { record, action, cell, prev, before, after, tx, chronicle } = await buildAction(
    actionSpec,
    { deployment, signerLock: myLock, client },
  );

  await tx.completeFeeBy(signer, FEE_RATE);

  // The contract reads the action from witness[0] of the type script's input group, and
  // that group must have exactly one member. If completion ever moved the fly off input 0
  // the transaction would be refused on chain with `MissingWitness` or `WrongInputCount`,
  // so it is worth failing here, where the reason is visible.
  if (!tx.inputs[0].previousOutput.eq(prev)) {
    throw new Error("the fly is no longer input 0 after completing the fee; refusing to send");
  }
  tx.setWitnessArgsAt(0, { inputType: action.action });

  const txHash = await sendAndWait(client, signer, tx);

  // The recorded positions are a hint for a human reading the file, not the source of
  // truth — everything resolves them from the chain. A keeper turns recording off, because a
  // log of a thousand ticks belongs to the chain and to the indexer, not to a deployment
  // record that would grow without bound.
  if (keepRecord) {
    record.fly.stateOutPoint = { txHash, index: 0 };
    if (record.world) {
      record.world.stateOutPoint = { txHash, index: 1 };
    }
    note(record, {
      action: actionSpec.kind,
      spec: actionSpec,
      txHash,
      step: after.step,
      energy: after.energy,
      release: after.release,
    });
    writeDeployment(record);
  }

  const burned = BigInt(before.energy) - BigInt(after.energy);
  const result = {
    txHash,
    kind: actionSpec.kind,
    chronicle,
    spec: actionSpec,
    actionBytes: action.action,
    capacityBefore: String(cell.cellOutput.capacity),
    before,
    after,
    burned: String(burned),
  };

  if (!quiet) {
    console.log(`${actionSpec.kind} -> ${txHash}`);
    console.log(`  action        ${action.action} (${action.len} bytes)`);
    console.log(`  step          ${before.step} -> ${after.step}`);
    console.log(`  energy        ${before.energy} -> ${after.energy}  (${burned} steps spent)`);
    console.log(`  alive         ${before.alive} -> ${after.alive}`);
    console.log(`  spikes        ${before.totalSpikes} -> ${after.totalSpikes}`);
    console.log(`  head          (${before.headX}, ${before.headY}) -> (${after.headX}, ${after.headY})`);
    console.log(`  state hash    ${after.stateHash}`);
    console.log(
      `  capacity      ${cell.cellOutput.capacity} -> ${after.outCapacity} shannons (released ${after.release})`,
    );
    console.log(`  new state     ${txHash}:0`);
    if (chronicle) {
      console.log(
        `  chronicle     step ${chronicle.step}, ${chronicle.alive ? "alive" : "dead"}, ` +
          `generation ${chronicle.generation}, ${chronicle.sightings} sightings, ` +
          `net ${Number(chronicle.netCapacity) >= 0 ? "+" : ""}${Number(chronicle.netCapacity) / 1e8} CKB`,
      );
      console.log(`  new chronicle ${txHash}:1`);
    }
  }

  return result;
}

// ---------------------------------------------------------------- entry point

const USAGE = `usage: node src/cli.js <command>

  plan                                  what would be deployed, without a network
  deploy [--force] [--lock L]           code cells, circuit table, and the first fly
  adopt [txHash]                        rebuild a lost record from the live code cells
  genesis [--force] [--lock L]          create another fly from the deployed code cells
  key                                   make a deployment key, and say where to fund it
  balance                               what that key can spend
  status                                read the fly
  history                               recover the whole life from the chain
  tick <steps>                          advance 1..=64 steps
  stimulate <ch> <param> <str> <steps>  channel 1=cue 2=left 3=right 4=shock
  feed <steps>                          buy steps of life with capacity
  resurrect <steps> <bornBlock>         revive a dead fly

environment: CKB_RPC_URL, CKB_PRIVATE_KEY, FLY_MODE, FLY_PARAMS, FLY_ECON, FLY_ENERGY, FLY_STATE

--lock (on deploy and genesis) decides what the fly's state cell wears, and therefore who may
ever advance it — the type script pins output.lock == input.lock, so the choice is permanent:

  flylock                    the default. Accepts every transaction, because upstream anyone
                             may call tick(); all the rules live in the type script.
  owner                      the deploying key's own secp256k1_blake160 lock. A private fly.
  <codeHash>:<hashType>:<args>   any lock at all — how a wallet's lock gets in without this
                             program changing. hashType is data, data1, data2 or type.`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "plan":
      return await cmdPlan();
    case "deploy":
      return cmdDeploy(rest.includes("--force"), option(rest, "--lock"));
    case "adopt":
      return cmdAdopt(rest[0]);
    case "genesis": {
      const record = readDeployment();
      // A record describes one fly. Creating a second here is legitimate — that is what the
      // multi-fly factory is — but it would overwrite `record.fly` and so drop the first fly
      // from the record while leaving it live on chain. Refusing by default, because the
      // loss is silent and the fly keeps existing: the record would simply stop mentioning
      // it, and `status` would start describing the new one as though it were the only one.
      if (record.fly && !rest.includes("--force")) {
        throw new Error(
          `this record already holds a fly (type hash ${record.fly.typeHash}). Creating ` +
            `another would drop it from the record while leaving it on chain. Pass --force, ` +
            `or point FLY_STATE at a record of its own.`,
        );
      }
      const client = await makeClient();
      const signer = makeSigner(client);
      const myLock = (await signer.getAddressObjSecp256k1()).script;
      return createGenesis(client, signer, record, myLock, option(rest, "--lock"));
    }
    case "key":
      return await cmdKey();
    case "balance":
      return await cmdBalance();
    case "history":
      return cmdHistory();
    case "status":
      return cmdStatus();
    case "tick":
      return applyAction({ kind: "tick", steps: number(rest[0], "steps") });
    case "stimulate":
      return applyAction({
        kind: "stimulate",
        channel: number(rest[0], "channel"),
        param: number(rest[1], "param"),
        strength: number(rest[2], "strength"),
        steps: number(rest[3], "steps"),
      });
    case "feed":
      return applyAction({ kind: "feed", steps: number(rest[0], "steps") });
    case "resurrect":
      return applyAction({
        kind: "resurrect",
        steps: number(rest[0], "steps"),
        bornBlock: number(rest[1], "bornBlock"),
      });
    case undefined:
    case "-h":
    case "--help":
      console.log(USAGE);
      return;
    default:
      throw new Error(`unknown command \`${command}\`\n\n${USAGE}`);
  }
}

/**
 * The value of `--name <value>` or `--name=<value>` in an argv slice, or `undefined`.
 *
 * Both spellings are accepted because both are natural to type. The important part is what
 * happens when the flag is present but the value is not: this **throws**, rather than returning
 * `undefined`. A bare `--lock` that quietly fell through to the default would create a public
 * fly where a private one was asked for — and the mistake would be invisible, because a public
 * fly is a perfectly valid thing to create.
 */
function option(args, name) {
  const at = args.indexOf(name);
  if (at >= 0) {
    const value = args[at + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} needs a value`);
    }
    return value;
  }
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed !== undefined) {
    const value = prefixed.slice(name.length + 1);
    if (!value) {
      throw new Error(`${name} needs a value`);
    }
    return value;
  }
  return undefined;
}

function number(value, name) {
  if (value === undefined) {
    throw new Error(`missing <${name}>`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`<${name}> must be a non-negative integer`);
  }
  return n;
}

// ---------------------------------------------------------------- as a library
//
// `serve.js` — the indexer and the front-end's host — needs the same client, the same
// deployment record and the same `applyAction`. Rather than keep a second copy of the
// chain layer (and a second place for it to drift), it imports them from here, and the
// CLI is what this module happens to look like from a terminal.
//
// `main` therefore runs only when this file is the entry point. Importing it must not
// execute a command.

export {
  CONFIG,
  makeClient,
  makeSigner,
  readDeployment,
  writeDeployment,
  applyAction,
  buildAction,
  capacityFor,
  liveCells,
  liveCell,
  // The page needs the same fee rate the CLI uses, or the two would price the same action
  // differently and the difference would only show up as a rejected replacement.
  FEE_RATE,
};

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((err) => {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  });
}
