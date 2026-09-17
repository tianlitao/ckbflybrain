/**
 * The shape of a transaction that moves a fly.
 *
 * # Why this is separate from who computes the successor
 *
 * A CKB transaction that advances a fly has to satisfy a type script that recomputes the
 * result: `output.data == simulate(input.data, action)`, and the action itself has to be in
 * the witness of the fly's input. So the builder needs two different things:
 *
 * 1. **An oracle** — something that can turn a state and an action into the successor state,
 *    the capacity that must leave the body, and the chronicle's next record. There is exactly
 *    one implementation of that and it is `flycore`; the two ways to reach it (`flyplan`, a
 *    native binary, and `flywasm`, the same crate compiled for the browser) are proven
 *    byte-identical by `crates/flywasm/verify.mjs`, which is why there can be two of them
 *    without there being two answers.
 * 2. **A transaction** — which cells go in, in what order, which outputs come out, what the
 *    witness carries, and which of the outputs wears which script. This is where the
 *    expensive mistakes live: the witness has to be on *the fly's* input rather than input 0,
 *    completing a fee can rewrite the witness list, and the output capacities are compared for
 *    equality rather than bounded.
 *
 * This module is (2). The oracle arrives as an argument, so the CLI and the page build the
 * same transaction without either of them owning the shape.
 *
 * # The one thing the caller has to do afterwards
 *
 * {@link buildAction} stops with the transaction complete except for its fee. Whoever pays
 * has to run {@link settle} — which is not a formality. `completeFeeBy` adds the payer's
 * inputs and **rebuilds the witness list**, so the action witness set before it is gone, and
 * a transaction that reaches the chain without it is refused with `MissingWitness` by a
 * validator that gives no clue which witness it wanted. That bug was found by driving a real
 * testnet fly with a wallet, not by a unit test.
 *
 * @module tx
 */

import * as ccc from "@ckb-ccc/core";

import { SHANNONS_PER_CKB, decodeState } from "./fly.js";
import { signableLock } from "./watch.js";

/**
 * The fee rate every transaction here is built with, in shannons per kilobyte.
 *
 * A constant rather than a setting: the amounts involved are a few thousand shannons, and a
 * page that let a reader raise it would be offering them a way to pay more for nothing. A
 * wallet that has its own opinion passes it to {@link settle} instead.
 */
export const FEE_RATE = 1_000n;

/**
 * What a chronicle cell holds. Fixed, and its type script refuses a transaction that tries to
 * change it — so this is the output capacity, not a starting point for one.
 */
export const WORLD_CAPACITY = 1_000n * SHANNONS_PER_CKB;

/**
 * The minimum capacity a cell with these scripts and this much data can hold.
 *
 * Not the serialized length: the occupied size is `8 + data + (lock args + 33)` plus the same
 * for the type script when there is one. `ccc.CellOutput.occupiedSize` computes exactly that,
 * which is why the data length is added separately rather than modelled as padded bytes.
 */
export function capacityFor({ lock, type, data }) {
  const probe = ccc.CellOutput.from({ capacity: 0n, lock, ...(type ? { type } : {}) });
  return (BigInt(probe.occupiedSize) + BigInt(data.length)) * SHANNONS_PER_CKB;
}

/** A cell output and the hex of its data, which is the pair every `addOutput` wants. */
export function makeOutput({ lock, type, data, capacity }) {
  const hex = ccc.hexFrom(data);
  const out = ccc.CellOutput.from(
    { capacity: capacity ?? capacityFor({ lock, type, data }), lock, ...(type ? { type } : {}) },
    hex,
  );
  return [out, hex];
}

/** A code cell dependency. `code` rather than `depGroup`: these are four separate binaries. */
export function dep(outPoint) {
  return { outPoint, depType: "code" };
}

/**
 * The fly's own type script, as a script object.
 *
 * A fly's identity is this script, so every caller that has a record and a reason to spend a
 * fly needs it in the same form. Exported because the page compares locks against it.
 */
export function flyScripts(deployment) {
  return {
    lock: ccc.Script.from(deployment.fly.lockScript),
    type: ccc.Script.from(deployment.fly.typeScript),
  };
}

/**
 * Build the transaction for an action — unsigned, and with no fee paid.
 *
 * @param {object} spec `{kind, ...}` as the oracle's `action` expects
 * @param {object} options
 * @param {object} options.deployment `params`, `economics`, `codeCells`, `fly`, and `world`
 *   when this fly has a chronicle
 * @param {object} options.signerLock the lock that is going to sign — required, so that a
 *   builder cannot be reached without one. A fly's lock is chosen at genesis and cannot be
 *   changed, so a key that cannot satisfy it is not a problem to work around: it is a
 *   different key.
 * @param {object} options.oracle `{action, apply, worldSight}` — see the module comment
 * @param {object} options.flyCell the live cell to spend
 * @param {object|null} [options.worldCell] the chronicle to carry forward, if there is one
 * @returns {Promise<{action: object, tx: object, before: object, after: object, prev: object,
 *   flyInputIndex: number, chronicle: object|null, flyCell: object, worldCell: object|null}>}
 *   `before` is the spent cell's state, decoded; `after` is the oracle's answer, whose `state`
 *   is hex. The two cells are returned so a caller can report what it spent without looking
 *   them up again.
 */
export async function buildAction(
  spec,
  { deployment, signerLock, oracle, flyCell, worldCell = null },
) {
  if (!signerLock) {
    throw new Error(
      "buildAction needs the lock that will sign the transaction, so it can refuse a fly that " +
        "lock cannot move",
    );
  }
  const refusal = signableLock(deployment.fly.lockScript, {
    myLock: signerLock,
    alwaysLockCodeHash: deployment.codeCells.flylock.codeHash,
  });
  if (refusal) {
    throw new Error(refusal);
  }

  const action = oracle.action({ ...spec, params: deployment.params });
  const prev = { txHash: flyCell.outPoint.txHash, index: flyCell.outPoint.index };
  const before = decodeState(ccc.bytesFrom(flyCell.outputData));

  const after = oracle.apply({
    params: deployment.params,
    economics: deployment.economics,
    state: ccc.hexFrom(flyCell.outputData),
    action: action.action,
    inCapacity: String(flyCell.cellOutput.capacity),
  });

  const { lock: flyLock, type: flyType } = flyScripts(deployment);

  const tx = ccc.Transaction.default();
  tx.addCellDeps(
    dep(deployment.codeCells.flybrain.outPoint),
    dep(deployment.codeCells.flylock.outPoint),
    dep(deployment.codeCells.flyworld.outPoint),
    dep(deployment.codeCells.circuit.outPoint),
  );

  // The fly goes in first and comes out first, so its witness is witness 0 — which is where
  // the type script looks for the action. `flyInputIndex` is returned rather than assumed,
  // because `settle` has to put the witness back after the fee is completed.
  tx.addInput({ previousOutput: prev, since: 0n });
  const [out, hex] = makeOutput({
    lock: flyLock,
    type: flyType,
    data: after.state,
    // Not computed here. It comes back from the oracle as `outCapacity`, which is
    // `input.capacity - capacity_release(in.energy, out.energy)`. The type script compares it
    // for equality, so a value derived any other way would be refused.
    capacity: BigInt(after.outCapacity),
  });
  tx.addOutput(out, hex);

  // The chronicle is updated in the *same* transaction as the transition it records. That is
  // the whole design: the world cell is not told what the fly did, it is required to look, and
  // the only moment the fly is there to look at is the moment it moves.
  let chronicle = null;
  if (deployment.world) {
    if (!worldCell) {
      throw new Error(
        "this deployment has a chronicle but none was supplied, and a transition that leaves " +
          "it behind is a transition the world cell will refuse",
      );
    }
    chronicle = oracle.worldSight({
      world: ccc.hexFrom(worldCell.outputData),
      flyState: after.state,
      // The fly's capacities, not the chronicle's: the chronicle's own capacity never
      // changes, and its type script refuses a transaction that tries to change it.
      inCapacity: String(flyCell.cellOutput.capacity),
      outCapacity: after.outCapacity,
    });
    tx.addInput({ previousOutput: worldCell.outPoint, since: 0n });
    const [worldOut, worldHex] = makeOutput({
      lock: flyLock,
      type: ccc.Script.from(deployment.world.typeScript),
      data: chronicle.data,
      capacity: worldCell.cellOutput.capacity,
    });
    tx.addOutput(worldOut, worldHex);
  }

  // Set here so that whoever completes the fee is estimating the size of a transaction that
  // already contains the action. They must set it again afterwards; see `settle`.
  tx.setWitnessArgsAt(0, { inputType: action.action });

  return { action, tx, before, after, prev, flyInputIndex: 0, chronicle, flyCell, worldCell };
}

/**
 * Complete the fee, put the action back, and hand back a transaction ready to sign.
 *
 * The three steps are the whole of what a payer has to do, and they are in this order for a
 * reason each:
 *
 * 1. `completeFeeBy(signer, feeRate)` — the payer's own coins pay and the change comes back to
 *    them. Nothing about the fly changes.
 * 2. **`setWitnessArgsAt` again.** Completion adds inputs and *rebuilds the witness list*, so
 *    the action set by {@link buildAction} is no longer there. This is the step that fails
 *    silently in the worst way: the transaction is well-formed, the node accepts it, and the
 *    type script refuses it with `MissingWitness`.
 * 3. Check the fly is still input 0. The contract reads the action from witness 0 of the type
 *    script's input group and that group must have exactly one member, so if completion ever
 *    moved the fly the transaction would be refused for a reason that points at the witness
 *    rather than at the fee.
 *
 * @param {object} built the result of {@link buildAction}
 * @param {object} options
 * @param {object} options.signer anything with `completeFeeBy` — a wallet or a private key
 * @param {bigint} [options.feeRate] shannons per kilobyte; the payer's opinion wins
 * @returns {Promise<object>} the same transaction object, now ready to sign
 */
export async function settle({ tx, action, prev, flyInputIndex }, { signer, feeRate = FEE_RATE }) {
  await tx.completeFeeBy(signer, feeRate);

  if (!tx.inputs[flyInputIndex].previousOutput.eq(prev)) {
    throw new Error(
      `the fly is no longer input ${flyInputIndex} after completing the fee; refusing to send`,
    );
  }
  tx.setWitnessArgsAt(flyInputIndex, { inputType: action.action });
  return tx;
}
