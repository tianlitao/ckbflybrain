/**
 * The deployer's half of the chronicle.
 *
 * `flyworld`'s type script requires the chronicle to be the *exact* record of the fly in the
 * same transaction, so the transaction builder has to be able to compute that record — and
 * if it computes it differently from the contract, every transaction it builds is refused.
 *
 * The contract's own behaviour is covered by the CKB-VM integration suite in
 * `tests/src/world.rs`, which runs the real RISC-V binary. What these tests cover is the
 * path the deployer actually takes: the planner commands it calls, and the round trip from
 * a fly's state through a sighting and back into a decodable chronicle.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ECON_TESTNET, SHANNONS_PER_CKB } from "../src/fly.js";
import {
  action as plannerAction,
  apply,
  genesis,
  worldArgs,
  worldDecode,
  worldOpen,
  worldSight,
} from "../src/plan.js";

/** Encode an action the way the planner does — the bytes a witness would carry. */
const encode = (spec) => plannerAction({ ...spec, params: "v1" }).action;

/** The step of life, in shannons, as the testnet economics prices it. */
const STEP = ECON_TESTNET.backingPerStep;
const CKB = SHANNONS_PER_CKB;

/** A fly with a million steps of life, and the capacity that backs it. */
function newborn(energy = 1_000_000n) {
  const state = genesis({ params: "v1", energy, bornBlock: 0n });
  const capacity = ECON_TESTNET.bodyCapacity + ECON_TESTNET.backingPerStep * energy;
  return { state: state.state, capacity };
}

/** Apply one action to a fly and return the successor state and capacity. */
function advance(state, capacity, actionHex) {
  const after = apply({ params: "v1", economics: "testnet", state, action: actionHex, inCapacity: capacity });
  return { state: after.state, capacity: BigInt(after.outCapacity), after };
}

describe("the chronicle's args", () => {
  it("are 33 bytes: a version and the fly it governs", () => {
    const hash = "0x" + "ab".repeat(32);
    const args = worldArgs({ flyTypeHash: hash });
    assert.equal(args.len, 33);
    assert.equal(args.args, "0x01" + "ab".repeat(32));
  });

  it("refuse a hash that is not 32 bytes", () => {
    assert.throws(() => worldArgs({ flyTypeHash: "0xab" }));
  });
});

describe("opening a chronicle", () => {
  const fly = newborn();
  const w = worldOpen({ flyState: fly.state, capacity: fly.capacity });
  const decoded = worldDecode({ world: w.data });

  it("is 128 bytes, and 235 CKB to hold", () => {
    assert.equal(w.len, 128);
    assert.equal(w.data.length, 2 + 2 * 128);
    // CKB charges 8 + data + (lock.args + 33) + (type.args + 33), and both scripts here have
    // non-empty args: the flylock lock has none, the flyworld type has 33.
    assert.equal(8 + 128 + 33 + (33 + 33), 235);
  });

  it("records the newborn, not a caller's account of one", () => {
    assert.equal(decoded.alive, true);
    assert.equal(decoded.generation, 0);
    assert.equal(decoded.bornStep, "0");
    assert.equal(decoded.diedStep, "0");
    assert.equal(decoded.step, "0");
    assert.equal(decoded.energy, "1000000");
    assert.equal(decoded.sightings, "1");
    assert.equal(decoded.totalAdded, "0");
    assert.equal(decoded.totalReleased, "0");
    assert.equal(decoded.capacity, String(fly.capacity));
  });

  it("carries the fly's own state hash", () => {
    // The contract computes `keccak256` of the fly's cell data, which is the canonical
    // encoding of the state — the same value the fly reports as its own `state_hash`.
    const again = worldDecode({ world: worldOpen({ flyState: fly.state, capacity: fly.capacity }).data });
    assert.equal(again.stateHash, decoded.stateHash);
    assert.match(decoded.stateHash, /^0x[0-9a-f]{64}$/);
  });
});

describe("a sighting follows the fly", () => {
  it("a tick releases exactly the value of the life it burned", () => {
    const fly = newborn();
    const opened = worldOpen({ flyState: fly.state, capacity: fly.capacity });
    const next = advance(fly.state, fly.capacity, encode({ kind: "tick", steps: 64 }));
    const w = worldSight({
      world: opened.data,
      flyState: next.state,
      inCapacity: fly.capacity,
      outCapacity: next.capacity,
    });
    const d = worldDecode({ world: w.data });

    assert.equal(d.step, "64");
    assert.equal(d.energy, "999936");
    assert.equal(d.sightings, "2");
    assert.equal(BigInt(d.totalReleased), 64n * BigInt(STEP));
    assert.equal(d.totalAdded, "0");
    assert.equal(BigInt(d.netCapacity), -(64n * BigInt(STEP)));
    assert.equal(BigInt(d.capacity), next.capacity);
    assert.equal(w.released, String(64n * BigInt(STEP)), "the sighting reports the delta too");
    assert.equal(w.added, "0");
    assert.equal(w.newLife, false);
  });

  it("feeding moves value the other way, by exactly what was added", () => {
    const fly = newborn();
    let opened = worldOpen({ flyState: fly.state, capacity: fly.capacity });
    let state = fly.state;
    let capacity = BigInt(fly.capacity);

    // Tick once, then feed.
    const ticked = advance(state, capacity, encode({ kind: "tick", steps: 64 }));
    opened = worldSight({
      world: opened.data,
      flyState: ticked.state,
      inCapacity: capacity,
      outCapacity: ticked.capacity,
    });
    state = ticked.state;
    capacity = ticked.capacity;

    const fed = advance(state, capacity, encode({ kind: "feed", steps: 10_000 }));
    const w = worldSight({
      world: opened.data,
      flyState: fed.state,
      inCapacity: capacity,
      outCapacity: fed.capacity,
    });
    const d = worldDecode({ world: w.data });

    assert.equal(BigInt(w.added), fed.capacity - capacity);
    assert.equal(BigInt(w.added), 10_000n * BigInt(STEP), "10,000 steps of life is 1 CKB");
    assert.equal(BigInt(w.added), CKB);
    assert.equal(w.released, "0", "a feed does not tick");
    assert.equal(BigInt(d.totalReleased), 64n * BigInt(STEP), "the earlier tick is still on the books");
    assert.equal(BigInt(d.netCapacity), CKB - 64n * BigInt(STEP));
    assert.equal(d.energy, "1009936");
  });

  it("a death is recorded at the step it happened, and a resurrection starts a new life", () => {
    const fly = newborn(8n);
    let opened = worldOpen({ flyState: fly.state, capacity: fly.capacity });
    let state = fly.state;
    let capacity = BigInt(fly.capacity);

    // The tick that kills it.
    const died = advance(state, capacity, encode({ kind: "tick", steps: 8 }));
    let w = worldSight({
      world: opened.data,
      flyState: died.state,
      inCapacity: capacity,
      outCapacity: died.capacity,
    });
    let d = worldDecode({ world: w.data });
    assert.equal(d.alive, false);
    assert.equal(d.diedStep, "8");
    assert.equal(d.bornStep, "0");
    assert.equal(d.energy, "0");

    // A resurrection is a new life: the generation moves, so the marks reset.
    const alive = advance(died.state, died.capacity, encode({ kind: "resurrect", steps: 10_000, bornBlock: 0 }));
    w = worldSight({
      world: w.data,
      flyState: alive.state,
      inCapacity: died.capacity,
      outCapacity: alive.capacity,
    });
    d = worldDecode({ world: w.data });
    assert.equal(w.newLife, true);
    assert.equal(d.alive, true);
    assert.equal(d.generation, 1);
    assert.equal(d.bornStep, "8", "this life began where the last one stopped");
    assert.equal(d.diedStep, "0", "and it has not died yet");
    assert.equal(BigInt(w.added), 10_000n * BigInt(STEP), "the resurrection was paid for");
  });

  it("refuses a chronicle that is not a chronicle", () => {
    const fly = newborn();
    assert.throws(() => worldSight({ world: "0x00", flyState: fly.state, inCapacity: 1n, outCapacity: 1n }));
    assert.throws(() => worldDecode({ world: "0x00" }));
  });

  it("refuses a fly state that is not a state", () => {
    const fly = newborn();
    const opened = worldOpen({ flyState: fly.state, capacity: fly.capacity });
    assert.throws(() =>
      worldSight({ world: opened.data, flyState: "0x00", inCapacity: fly.capacity, outCapacity: fly.capacity }),
    );
  });
});
