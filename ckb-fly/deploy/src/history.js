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

import { action as actionCodec, decodeState, paramsNamed, readWitnessArgs } from "./fly.js";

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
    // The name the record stores, for display and for a caller that wants to look the set up.
    params: deployment.params,
    // The struct itself, for anything that has to range-check an action against it. Resolved
    // here rather than at each use because every reader of a record needs the same answer.
    paramsStruct: paramsNamed(deployment.params),
    economics: deployment.economics,
    codeCells: deployment.codeCells,
  };
}

/**
 * Every live cell wearing a type script.
 *
 * Plural on purpose. `findSingletonCellByType` returns the first of these and says nothing
 * about the rest, which is fine right up until a fly is branched — and a branched fly is not
 * hypothetical: the type script validates one transaction at a time, so two transactions that
 * each consume a different predecessor are both valid, and the chain has no way to prefer one.
 * Everything downstream of a singleton lookup then picks a branch silently.
 *
 * @returns {Promise<object[]>} the live cells, in the indexer's order
 */
export async function liveCells(client, typeScript) {
  const cells = [];
  for await (const cell of client.findCellsByType(typeScript, true)) {
    cells.push(cell);
  }
  return cells;
}

/**
 * The live cell wearing the fly's type script — the tip of its life.
 *
 * Found by asking the chain rather than by trusting a stored out point, so a stale
 * deployment record cannot make the indexer report a fly that has already moved on.
 *
 * When more than one cell wears the script this returns the indexer's first and does not
 * pretend otherwise: the *report* belongs to whoever is looking (`watch.ambiguity`), and the
 * *refusal* to whoever is about to spend one (`watch.describeBranches`). Throwing here would
 * mean a branched fly takes the whole page down, which is a worse answer than showing it with
 * a warning — the fly is still perfectly readable, it just is not one fly any more.
 */
export async function findHead(client, { typeScript }) {
  const cells = await liveCells(client, typeScript);
  if (cells.length === 0) {
    throw new Error(
      `no live cell wears type script ${typeScript.hash()}. Either the fly has not been created yet, or its successor is not yet committed.`,
    );
  }
  return cells[0];
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
  const { typeHash, paramsStruct } = id;

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
    const state = decodeState(ccc.bytesFrom(stateHex), { full: full && isNewest });

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
      // Decoded and validated by the contract's own parser — the JavaScript mirror of it,
      // which `test/golden.test.js` pins against `flyplan decode-action` object for object,
      // so a history entry cannot describe an action the fly would have refused.
      action = actionCodec.decode(actionBytes, paramsStruct);
    }

    entries.push({
      txHash: outPoint.txHash,
      blockNumber: response.blockNumber === undefined ? null : String(response.blockNumber),
      status: response.status,
      action,
      actionBytes,
      capacity: String(output.capacity),
      // The state bytes, kept alongside the decoded form rather than inside it. A spent cell
      // cannot be asked for again, so this hex is the only copy of a past state that exists —
      // which is what makes pinning an old transition possible at all. It is also why the
      // per-neuron arrays are dropped from everything but the head: 465 numbers per entry is a
      // megabyte of JSON, and 1,213 bytes of hex is 2.4 KB that decodes back to them.
      stateHex,
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
