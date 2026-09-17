/**
 * Reading the chain, from either side of the wire.
 *
 * # Why this is a module and not four lines in `serve.js`
 *
 * A fly's whole readable state is four questions: which organisms exist, where is this one's
 * live cell, how did it get there, and what does its chronicle say. `serve.js` answered all
 * four, which was fine while the server was the only thing that could. It is not any more —
 * a page with a CORS-enabled RPC and `flywasm` can answer them itself, and the two answers
 * have to agree, because they are the same page.
 *
 * So the questions live here, where a test can reach them without a node, a chain or a
 * server. The transport is CCC's client, which is the same client in Node and in a browser:
 * it is `fetch` in both, and the only thing the browser adds is the origin check that
 * `testnet.ckb.dev` answers with `access-control-allow-origin: *`.
 *
 * # The one thing that is not a question
 *
 * A fly is supposed to have exactly one live cell, and the type script cannot enforce it: it
 * validates one transaction at a time, so two transactions that each consume a different
 * predecessor are both valid. Everything here therefore *enumerates* rather than picking —
 * `liveCells`, `readFlies` returning every row — and the choice, when one has to be made, is
 * made by the caller that knows what it is for. See `watch.js` for why a branched fly is
 * branched for good.
 *
 * @module chain
 */

import * as ccc from "@ckb-ccc/core";

import { decodeState, paramsNamed, worldDecode } from "./fly.js";
import { liveCells, readChain } from "./history.js";

/**
 * A client for one RPC endpoint.
 *
 * `fallbacks: []` is load-bearing and is the same reason `cli.js` sets it: without it, a
 * failure to reach the configured node becomes a silent request to CCC's published testnet.
 * On a page that is pointed at a particular chain, "the node is down" and "the node answered
 * about a different chain" have to be different messages.
 *
 * The *testnet* script table is used for every network, including a dev chain, because
 * `secp256k1_blake160_sighash_all`'s code hash and hash type are properties of the binary
 * rather than of the chain. Reading does not need the table at all; sending does, and a dev
 * chain would additionally need its genesis out points, which is `cli.js`'s job and not a
 * page's.
 */
export function createClient({ rpc, fallbacks = [] }) {
  if (!rpc) {
    throw new Error("no RPC endpoint: the deployment record's `network` is empty");
  }
  return new ccc.ClientPublicTestnet(ccc.ClientPublicTestnet.resolveConfig({ url: rpc, fallbacks }));
}

/**
 * Every live organism built from these contract binaries.
 *
 * Discovery is by **code hash with a prefix match on the args**, which is the only search
 * that can express "any fly": each organism has a different type script, so there is no
 * single script to look up. An empty args prefix means "any args".
 *
 * The state is decoded here rather than by the caller, because the caller cannot decide which
 * organisms matter without knowing how far each has got — the roster is sorted by nothing, so
 * the only thing that distinguishes the rows is what they contain.
 *
 * @returns {Promise<object[]>} one row per live cell, each carrying its own `typeHash`,
 *   `script`, `lock`, `instance`, `outPoint` and decoded `state`
 */
export async function readFlies(client, { codeCells, params }) {
  const { flybrain } = codeCells;
  const rows = [];
  for await (const cell of client.findCells(
    {
      script: { codeHash: flybrain.codeHash, hashType: flybrain.hashType, args: "0x" },
      scriptType: "type",
      scriptSearchMode: "prefix",
    },
    "asc",
    200,
  )) {
    const script = ccc.Script.from(cell.cellOutput.type);
    const { v, bias, inp, ...state } = decodeState(ccc.bytesFrom(cell.outputData));
    rows.push({
      typeHash: script.hash(),
      script,
      lock: ccc.Script.from(cell.cellOutput.lock),
      // The instance nonce: eight bytes after the version byte, and nothing else. It is what
      // makes two organisms with the same genome two organisms, so it is worth showing.
      instance: "0x" + script.args.slice(2 + 2, 2 + 2 + 16),
      // `outPoint.index` is a BigInt, which `JSON.stringify` refuses. The snapshot is JSON, so
      // it becomes a number here rather than blowing up at the edge.
      outPoint: { txHash: cell.outPoint.txHash, index: Number(cell.outPoint.index) },
      state,
    });
  }
  return rows;
}

/**
 * The chronicle's type script for a fly.
 *
 * The args are `version ‖ fly type hash`, so this is constructed rather than searched for.
 * A prefix search would work too and would be a worse answer: it would return whichever
 * chronicle the indexer happened to order first, and a chronicle's whole job is to be the one
 * that belongs to this fly.
 */
export function worldScriptFor({ codeCells, flyTypeHash }) {
  const { flyworld } = codeCells;
  return ccc.Script.from({
    codeHash: flyworld.codeHash,
    hashType: flyworld.hashType,
    args: "0x01" + flyTypeHash.slice(2),
  });
}

/**
 * The chronicle watching one fly, decoded, or `null` if it has none.
 *
 * Found by asking the chain rather than by trusting a stored out point: the chronicle moves
 * whenever the fly does, so a remembered position is stale the moment anything touches it —
 * and "anything" includes a keeper running in another terminal.
 */
export async function readChronicle(client, { codeCells, flyTypeHash }) {
  const typeScript = worldScriptFor({ codeCells, flyTypeHash });
  const cells = await liveCells(client, typeScript);
  if (cells.length === 0) {
    return null;
  }
  const cell = cells[0];
  return {
    outPoint: { txHash: cell.outPoint.txHash, index: Number(cell.outPoint.index) },
    capacity: String(cell.cellOutput.capacity),
    // Nothing is computed here. The contract derived every field from the fly in the same
    // transaction that moved it, so this is decoding what is on chain and no more.
    ...worldDecode(ccc.bytesFrom(cell.outputData)),
  };
}

/**
 * One organism, as much as can be read: its identity, its live cells, its life, its chronicle.
 *
 * `cells` is a list and `head` is the first of it. A caller that only draws should use `head`;
 * a caller that is about to *spend* one has to look at `cells` and refuse if there is more
 * than one, because moving one branch of a branched fly abandons the others silently.
 *
 * @param {object} options
 * @param {object} options.client from {@link createClient}
 * @param {object} options.deployment the record: `params`, `economics`, `codeCells`, `fly`
 * @param {object} options.typeScript the organism's type script
 * @param {string} options.typeHash its hash, which is its address
 * @param {number} [options.limit] how many transitions to recover at most
 * @param {boolean} [options.full] decode the newest state's per-neuron arrays
 * @param {Set<string>} [options.stopAt] transaction hashes already known
 * @param {boolean} [options.withChronicle] look for the chronicle as well (one more query)
 */
export async function readFly({
  client,
  deployment,
  typeScript,
  typeHash,
  limit = 500,
  full = true,
  stopAt = null,
  withChronicle = true,
}) {
  const identity = {
    typeScript,
    typeHash,
    lockScript: ccc.Script.from(deployment.fly.lockScript),
    params: deployment.params,
    paramsStruct: paramsNamed(deployment.params),
    economics: deployment.economics,
    codeCells: deployment.codeCells,
  };

  const cells = await liveCells(client, typeScript);
  if (cells.length === 0) {
    throw new Error(
      `no live cell wears type script ${typeHash}. Either the organism has not been created yet, or its successor is not yet committed.`,
    );
  }

  const entries = await readChain({ client, head: cells[0], identity, limit, full, stopAt });
  const chronicle = withChronicle
    ? await readChronicle(client, { codeCells: deployment.codeCells, flyTypeHash: typeHash })
    : null;

  return { identity, cells, head: cells[0], entries, chronicle };
}
