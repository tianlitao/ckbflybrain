/**
 * The event layer: a fly's history, recovered from the chain.
 *
 * # Why this exists, and why it is not a log
 *
 * Upstream, the front-end's live view, its replay and its death record were all built on
 * three EVM events — `Ticked`, `Fed`, `Stimulated`. The migration plan flagged their loss
 * as the most under-estimated piece of the port, and the worry was justified: there is no
 * event log on CKB, and no amount of wishing produces one.
 *
 * The replacement is not a log. It is the chain itself. A fly *is* a chain of state cells:
 * each transition consumes one and creates its successor, so walking backwards from the
 * current cell through each transaction's fly input recovers the entire life, in order,
 * with no gaps and no way to lie about it.
 *
 * The action comes back too, and for free. It is in the witness, which is not a claim
 * about what happened — it is the input the type script validated before it agreed to the
 * transition. So the indexer's history is not the indexer's opinion of what a transaction
 * meant; it is the same parse the contract performed. That is a stronger guarantee than
 * an event log gives, and it costs one RPC call per transition.
 *
 * @module history
 */

import * as ccc from "@ckb-ccc/core";

import * as plan from "./plan.js";

/**
 * Decode a `WitnessArgs`.
 *
 * The layout is a molecule table of three `BytesOpt` fields — lock, inputType,
 * outputType — and an `BytesOpt` is an option of a byte vector, which molecule encodes as
 * a bare `Bytes` whose length of zero means `None`. So each field is either empty or a
 * four-byte length followed by that many bytes.
 *
 * This is written out rather than taken from CCC's `WitnessArgs.from`, which returns
 * `undefined` for every field of a witness this shape — including one that demonstrably
 * carries a six-byte action. The format is nine lines of code and does not need a wrapper
 * that has to be debugged first.
 *
 * @param {string} hex
 * @returns {{lock: string|null, inputType: string|null, outputType: string|null}}
 */
export function readWitnessArgs(hex) {
  const b = Buffer.from(hex.slice(2), "hex");
  const u32 = (o) => b.readUInt32LE(o);
  const total = u32(0);
  if (total !== b.length) {
    throw new Error(`WitnessArgs says ${total} bytes, the witness is ${b.length}`);
  }
  const offsets = [u32(4), u32(8), u32(12)];
  const field = (from, to) => {
    if (from === to) {
      return null;
    }
    const len = u32(from);
    const start = from + 4;
    if (start + len > to) {
      throw new Error("a WitnessArgs field overruns its own table");
    }
    return "0x" + b.subarray(start, start + len).toString("hex");
  };
  return {
    lock: field(offsets[0], offsets[1]),
    inputType: field(offsets[1], offsets[2]),
    outputType: field(offsets[2], total),
  };
}

/**
 * The fly's identity, as the chain sees it.
 *
 * The type script hash is the fly's address in the strictest sense: two organisms with
 * different parameters, a different connectome or different prices are different type
 * scripts, and therefore different cells. Given only that hash, everything else here can
 * be found — which is why the indexer does not need the deployer's local record, and can
 * be pointed at a chain it did not create.
 */
export function identity({ deployment }) {
  const typeScript = ccc.Script.from(deployment.fly.typeScript);
  return {
    typeScript,
    typeHash: typeScript.hash(),
    lockScript: ccc.Script.from(deployment.fly.lockScript),
    params: deployment.params,
    economics: deployment.economics,
    codeCells: deployment.codeCells,
  };
}

/**
 * The live cell wearing the fly's type script — the tip of its life.
 *
 * Found by asking the chain rather than by trusting a stored out point, so a stale
 * deployment record cannot make the indexer report a fly that has already moved on.
 */
export async function findHead(client, { typeScript }) {
  const cell = await client.findSingletonCellByType(typeScript, true);
  if (!cell) {
    throw new Error(
      `no live cell wears type script ${typeScript.hash()}. Either the fly has not been created yet, or its successor is not yet committed.`,
    );
  }
  return cell;
}

/**
 * Walk the fly's life backwards from `head`, and return it oldest first.
 *
 * Each step is one transaction. The fly's input is the one whose previous cell wears the
 * fly's type script — not "input 0", which is what the deployer happens to produce but
 * not what the protocol promises. Its witness carries the action; the output that wears
 * the type script is the state it produced.
 *
 * The walk stops at a transaction with no fly input, which is genesis: a fly created by a
 * transaction that consumed no fly. That is the beginning of the life by definition, and
 * the type script enforces it (a genesis whose state is not exactly a newborn is refused),
 * so there is no earlier history to look for.
 *
 * @param {object} options
 * @param {import("@ckb-ccc/core").Client} options.client
 * @param {object} options.head a `Cell`, or an out point
 * @param {object} options.identity from {@link identity}
 * @param {number} [options.limit] how many transitions to recover at most
 * @param {boolean} [options.full] include the per-neuron arrays on the newest entry
 * @param {Set<string>} [options.stopAt] transaction hashes already known; the walk stops
 *   when it reaches one. This is what makes the indexer incremental: after the first read,
 *   a new tick costs one RPC call rather than a full re-walk of the fly's life.
 */
export async function readChain({
  client,
  head,
  identity: id,
  limit = 500,
  full = false,
  stopAt = null,
}) {
  const { typeHash, params } = id;

  // Cell lookups are the expensive part of the walk and the same cell is asked for more
  // than once, so they are cached for the duration of one read.
  const cellCache = new Map();
  const getCell = async (outPoint) => {
    const key = `${outPoint.txHash}:${outPoint.index}`;
    if (!cellCache.has(key)) {
      cellCache.set(key, await client.getCell(outPoint));
    }
    return cellCache.get(key);
  };

  const wearsFlyType = (cellOutput) => {
    const type = cellOutput?.type;
    return !!type && ccc.Script.from(type).hash() === typeHash;
  };

  const entries = [];
  let outPoint = { txHash: head.outPoint.txHash, index: head.outPoint.index };

  while (outPoint && entries.length < limit) {
    if (stopAt?.has(outPoint.txHash)) {
      break;
    }
    const response = await client.getTransaction(outPoint.txHash);
    if (!response) {
      break;
    }
    const tx = response.transaction;

    const outputIndex = tx.outputs.findIndex((o) => wearsFlyType(o));
    if (outputIndex < 0) {
      throw new Error(
        `${outPoint.txHash} creates no cell wearing the fly's type script, yet its successor exists. The chain and the type script disagree, which should be impossible.`,
      );
    }
    const output = tx.outputs[outputIndex];
    const stateHex = tx.outputsData[outputIndex];

    // Which input is the fly? Ask the chain, do not assume an index.
    let flyInputIndex = -1;
    for (let i = 0; i < tx.inputs.length; i++) {
      const previous = await getCell(tx.inputs[i].previousOutput);
      if (wearsFlyType(previous?.cellOutput)) {
        flyInputIndex = i;
        break;
      }
    }

    const isNewest = entries.length === 0;
    const state = plan.decode({
      params,
      state: stateHex,
      full: full && isNewest,
    });

    let action = null;
    let actionBytes = null;
    if (flyInputIndex >= 0) {
      const witness = tx.witnesses[flyInputIndex];
      if (!witness) {
        throw new Error(`${outPoint.txHash} has no witness for its fly input`);
      }
      actionBytes = readWitnessArgs(witness).inputType;
      if (!actionBytes) {
        throw new Error(
          `${outPoint.txHash} consumes a fly without declaring an action. The type script reads the action from witness[${flyInputIndex}].inputType, so this transaction could not have been accepted.`,
        );
      }
      // Decoded and validated by the contract's own parser, so a history entry cannot
      // describe an action the fly would have refused.
      action = plan.decodeAction({ params, action: actionBytes });
    }

    entries.push({
      txHash: outPoint.txHash,
      blockNumber: response.blockNumber === undefined ? null : String(response.blockNumber),
      status: response.status,
      action,
      actionBytes,
      capacity: String(output.capacity),
      state,
      isGenesis: flyInputIndex < 0,
    });

    outPoint = flyInputIndex < 0 ? null : tx.inputs[flyInputIndex].previousOutput;
  }

  return entries.reverse();
}

/**
 * A compact summary of a state, for the history list.
 *
 * The per-neuron arrays are dropped: a hundred history entries carrying 465 numbers each
 * is a megabyte of JSON that nothing is going to draw.
 */
export function summarise(entry) {
  const { v, bias, inp, ...rest } = entry.state;
  return { ...entry, state: rest };
}
