/**
 * Does the testnet side of the deploy path work, before any CKB is spent?
 *
 * A dev chain never exercises this. `makeClient` borrows CCC's published testnet table
 * (`TESTNET_SCRIPTS`) on every network, and on a dev chain it *overwrites* the entries it
 * cares about with out points read out of block 0 (`devChainScripts`), because a dev
 * chain's genesis is rebuilt on every `ckb init` and its system cells therefore live at
 * different out points on every machine. On preview testnet that substitution does not
 * happen: the published table is used verbatim, out points and all.
 *
 * That leaves exactly one thing unverified until the moment real money is at stake — that
 * the out points in that table still name live cells on *this* chain. A table entry is a
 * claim about a chain; nothing in it can check itself. If a dep group has been spent or
 * the table has drifted from preview testnet, the failure lands after funding, in the
 * middle of building a transaction, as a confusing "cell not found".
 *
 * So this resolves the table against the chain and reports, for each entry the deployer
 * will actually reference: the code hash, the dep cell, and — for a dep group — every
 * out point the group's payload expands to. All read-only.
 *
 * Usage — one environment variable, because the record and the key are both named for the
 * network and derived from the RPC URL:
 *
 *   CKB_RPC_URL=https://testnet.ckb.dev/ node preflight-testnet.mjs
 *
 * Read-only: nothing is signed, nothing is spent.
 */
import { existsSync } from "node:fs";

import * as ccc from "@ckb-ccc/core";

import { CONFIG, makeClient, makeSigner } from "./src/cli.js";

/** The address the deployer will spend from, so a mismatch is caught before funding. */
const EXPECTED = "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfzqfc9ys2rv2wg8avksdhh9slpmxje32s2cj47p";

/** 1 CKB, in shannons. */
const SHANNON = 1_0000_0000n;

let failures = 0;

function ok(label, detail) {
  console.log("  ok    " + label.padEnd(34) + detail);
}

function bad(label, detail) {
  failures += 1;
  console.log("  FAIL  " + label.padEnd(34) + detail);
}

function short(hash) {
  return hash.slice(0, 10) + "…" + hash.slice(-6);
}

/**
 * Decode a dep group's payload: a little-endian count, then that many out points, each a
 * 32-byte transaction hash followed by a little-endian 4-byte index.
 *
 * Duplicated from `cli.js` on purpose rather than exported from it: this file is a probe
 * that should keep working — and keep being readable — even if the deployer is refactored
 * around it. A probe that shares code with its subject can only ever confirm they agree.
 */
function parseOutPointList(data) {
  if (data.length < 4) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  if (data.length !== 4 + count * 36) {
    return null;
  }
  const refs = [];
  for (let i = 0; i < count; i += 1) {
    const at = 4 + i * 36;
    refs.push({
      txHash: ccc.hexFrom(data.slice(at, at + 32)),
      index: view.getUint32(at + 32, true),
    });
  }
  return refs;
}

console.log("configuration");
console.log("  rpc        " + CONFIG.rpc);
console.log("  network    " + CONFIG.network);
console.log("  state      " + CONFIG.statePath);
console.log("  key file   " + CONFIG.keyPath);
console.log("");

// The two traps, checked before anything else. Both are silent when they happen, and both
// are now only reachable by *setting* an environment variable — the defaults are named for
// the network. That is exactly why they are still worth checking: an override is a
// deliberate act, and a deliberate act is where the mistake lives.
if (CONFIG.keyPath.endsWith("/.key")) {
  bad("key file is not the default", "a key at deploy/.key wins on EVERY network");
} else if (!existsSync(CONFIG.keyPath)) {
  bad("key file exists", CONFIG.keyPath + " is missing");
} else {
  ok("key file", CONFIG.keyPath.split("/").pop());
}
if (CONFIG.network !== "devnet" && CONFIG.statePath.endsWith("deployment.json")) {
  bad("state record is network-specific", "this would overwrite the dev chain's record");
} else {
  ok("state record", CONFIG.statePath.split("/").pop());
}
if (CONFIG.statePath.includes("/deploy/deploy/")) {
  bad("state record path resolves", "a relative FLY_STATE was resolved against cwd");
}

const t0 = Date.now();
const client = await makeClient();
const tip = await client.getTipHeader();
console.log("");
console.log("chain");
ok("rpc reachable", "tip " + Number(tip.number) + ", " + (Date.now() - t0) + " ms");

const signer = makeSigner(client);
const address = await signer.getRecommendedAddress();
const balance = await signer.getBalance();

console.log("");
console.log("the key that will pay");
if (address === EXPECTED) {
  ok("address", address);
} else {
  bad("address", address + "  expected " + EXPECTED);
}
const funded = balance / SHANNON;
if (balance > 0n) {
  ok("balance", funded.toLocaleString("en-US") + " CKB");
} else {
  bad("balance", "0 CKB — nothing to spend");
}

// Every well-known script the deployer can reach for. `Secp256k1Blake160` is the one that
// matters (it is the deployer's own lock, so a broken entry breaks signing, not just the
// fly); the rest are listed because a table entry can rot independently.
console.log("");
console.log("system scripts, resolved against this chain");

const wanted = [
  ccc.KnownScript.Secp256k1Blake160,
  ccc.KnownScript.Secp256k1Multisig,
  ccc.KnownScript.NervosDao,
];

for (const name of wanted) {
  let info;
  try {
    // A method, and `async` — `getKnownScript(name)` without `await` hands back a rejected
    // promise that reads as a perfectly ordinary object until something touches it.
    info = await client.getKnownScript(name);
  } catch (error) {
    bad(name, error.message);
    continue;
  }

  const deps = await client.getCellDeps(info.cellDeps);
  const problems = [];

  for (const dep of deps) {
    const cell = await client.getCell(dep.outPoint);
    if (!cell) {
      problems.push("dep cell " + short(dep.outPoint.txHash) + ":" + dep.outPoint.index + " is spent or missing");
      continue;
    }
    if (dep.depType === "depGroup") {
      // The group's payload is what the transaction actually needs; the group cell itself
      // being live says nothing about the out points it points at.
      const refs = parseOutPointList(ccc.bytesFrom(cell.outputData));
      if (!refs) {
        problems.push("dep group " + short(dep.outPoint.txHash) + " does not decode as an out point list");
        continue;
      }
      for (const ref of refs) {
        const member = await client.getCell(ref);
        if (!member) {
          problems.push("group member " + short(ref.txHash) + ":" + ref.index + " is spent or missing");
        }
      }
      if (!problems.length) {
        ok(name, info.codeHash.slice(0, 12) + "… via dep group of " + refs.length + " live cell(s)");
      }
    } else if (!problems.length) {
      ok(name, info.codeHash.slice(0, 12) + "… via live dep cell");
    }
  }

  if (problems.length) {
    bad(name, info.codeHash.slice(0, 12) + "…");
    for (const problem of problems) {
      console.log("          " + problem);
    }
  }
}

console.log("");
if (failures) {
  console.log(failures + " check(s) failed. Do not deploy until these are understood.");
  process.exitCode = 1;
} else {
  console.log("all checks passed — the testnet deploy path resolves end to end, unspent.");
}
