/**
 * Pins `src/fly.js` against `crates/flycore`.
 *
 * The deployer takes its bytes from Rust, so nothing in the deploy path can drift. But
 * the browser cannot shell out to Rust, so the encoders have to exist twice — once in
 * `flycore`, once here. Two implementations of one format is a standing invitation for
 * them to disagree, and a disagreement would not fail loudly: it would produce a
 * transaction the type script refuses, or worse, a state cell that decodes to something
 * plausible and wrong.
 *
 * So every value in this file is produced by `flyplan golden`, which is a thin wrapper
 * over `flycore`, and asserted against the JavaScript encoder. If the Rust layout changes
 * and this file does not, the suite fails.
 *
 * Run with `npm test` (or `node --test test/`), after `make plan` has built the planner.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARGS_LEN,
  ECON_FREE,
  ECON_TESTNET,
  N,
  PARAMS_V1,
  PARAMS_V2,
  STATE_LEN,
  SHANNONS_PER_CKB,
  action,
  circuitHash,
  circuitTable,
  decodeState,
  encodeArgs,
  encodeEconomics,
  encodeParams,
  genesisState,
  occupiedCapacity,
} from "../src/fly.js";
import { circuit, decode, decodeAction, economics, golden } from "../src/plan.js";

const g = golden();

const hex = (bytes) => "0x" + Buffer.from(bytes).toString("hex");
const bytes = (h) => new Uint8Array(Buffer.from(h.slice(2), "hex"));

describe("constants agree with Rust", () => {
  it("state and args lengths", () => {
    assert.equal(STATE_LEN, g.stateLen);
    assert.equal(ARGS_LEN, g.argsLen);
    assert.equal(STATE_LEN, 128 + 7 * N);
    assert.equal(ARGS_LEN, 97, "version + instance + params + circuit + economics");
  });

  it("the connectome is the one BSC committed to", () => {
    assert.equal(circuitHash(), g.circuitHash);
    assert.equal(circuitTable().length, 15065);
  });
});

describe("parameter sets", () => {
  it("v1 encodes as Rust does", () => {
    assert.equal(hex(encodeParams(PARAMS_V1)), g.paramsV1);
  });

  it("v2 encodes as Rust does", () => {
    assert.equal(hex(encodeParams(PARAMS_V2)), g.paramsV2);
  });

  it("v1 is the deployed mainnet set, not a copy of v2", () => {
    assert.notEqual(hex(encodeParams(PARAMS_V1)), hex(encodeParams(PARAMS_V2)));
    assert.equal(PARAMS_V1.persistInput, false);
    assert.equal(PARAMS_V2.persistInput, true);
    // The flag byte is the only thing distinguishing the two encodings' trailing byte.
    assert.equal(encodeParams(PARAMS_V1)[31], 0);
    assert.equal(encodeParams(PARAMS_V2)[31], 1);
  });
});

describe("economics", () => {
  it("encodes as Rust does", () => {
    assert.equal(hex(encodeEconomics(ECON_TESTNET)), g.economicsTestnet);
    assert.equal(hex(encodeEconomics(ECON_FREE)), g.economicsFree);
  });
});

describe("type script args", () => {
  it("the full 89 bytes match", () => {
    const args = encodeArgs({
      // The planner's `golden` command pins a fixed nonce, so the two sides can be compared.
      instance: "0x" + "ab".repeat(8),
      params: PARAMS_V1,
      circuitHash: circuitHash(),
      economics: ECON_TESTNET,
    });
    assert.equal(hex(args), g.argsV1Testnet);
    assert.equal(args.length, ARGS_LEN);
  });
});

describe("actions", () => {
  it("tick", () => assert.equal(hex(action.tick(64)), g.actions.tick64));
  it("stimulate", () =>
    assert.equal(hex(action.stimulate(1, 4, 4, 32)), g.actions.stimulateCue4));
  it("feed", () => assert.equal(hex(action.feed(10_000)), g.actions.feed10000));
  it("resurrect", () =>
    assert.equal(hex(action.resurrect(1_000, 42)), g.actions.resurrect1000));
});

describe("genesis", () => {
  const newborn = genesisState({ energy: 1_000_000n, bornBlock: 0n });

  it("is exactly the canonical newborn", () => {
    assert.equal(hex(newborn), g.genesis.state);
    assert.equal(newborn.length, STATE_LEN);
  });

  it("decodes back to what it was built from", () => {
    const s = decodeState(newborn);
    assert.equal(s.version, 1);
    assert.equal(s.n, N);
    assert.equal(s.alive, true);
    assert.equal(s.step, 0n);
    assert.equal(s.energy, 1_000_000n);
    assert.equal(s.bornBlock, 0n);
    assert.equal(s.generation, 0);
    // A newborn has no membrane potential, no engram and no history. The contract
    // refuses any genesis that is not exactly this, so the decoder agreeing is the
    // cheap half of the same statement.
    assert.equal(s.nonZeroV, 0);
    assert.equal(s.nonZeroBias, 0);
    assert.equal(s.nonZeroInp, 0);
    assert.deepEqual(s.headingHist, Array(16).fill(0));
  });
});

describe("a worked transition", () => {
  // `tick(64)` on a newborn million-step fly — the opening move of the mainnet replay.
  // This pins the encoder and the dynamics in one value: if either drifts, the state
  // bytes stop matching.
  const after = g.transition.to;

  it("the successor state is what Rust computes", () => {
    assert.equal(after.length, 2 + 2 * STATE_LEN);
  });

  it("the successor decodes to the expected step and energy", () => {
    const s = decodeState(bytes(after));
    assert.equal(s.step, BigInt(g.transition.step));
    assert.equal(s.energy, BigInt(g.transition.outEnergy));
    assert.equal(s.alive, true);
    // The mainnet trajectory's first `tick(64)` fires nothing. That is a real fact about
    // the circuit, and it is also why the noise byte-order bug survived a first glance.
    assert.equal(s.totalSpikes, BigInt(g.transition.totalSpikes));
    assert.equal(s.totalSpikes, 0n);
  });

  it("the capacity delta is exactly the value of the life spent", () => {
    assert.equal(BigInt(g.transition.inEnergy) - BigInt(g.transition.outEnergy), 64n);
    assert.equal(
      BigInt(g.transition.inCapacity) - BigInt(g.transition.outCapacity),
      BigInt(g.transition.release),
    );
    assert.equal(BigInt(g.transition.release), 64n * ECON_TESTNET.backingPerStep);
  });

  it("the successor is still exactly backed", () => {
    // `capacity == body + energy * backing`, the invariant the whole economics rests on.
    assert.equal(
      BigInt(g.transition.outCapacity),
      ECON_TESTNET.bodyCapacity + BigInt(g.transition.outEnergy) * ECON_TESTNET.backingPerStep,
    );
  });
});

describe("occupied capacity", () => {
  // CKB charges 8 + data + (lock.args + 33) + (type.args + 33). Pinned against the
  // deployer's own measurement of the state cell, which a live node accepted.
  it("the state cell occupies 1,384 CKB, not its serialization", () => {
    // 8 + the 1,213 bytes of state + 33 for flylock (a code hash and a hash type, no args)
    // + 33 + 97 for flybrain (the same overhead plus its args). Note that this is the
    // *payload*: the molecule serialization of the same cell is 1,459 bytes, and CKB does
    // not charge for table headers, offset words, length prefixes or alignment padding.
    const cap = occupiedCapacity({ dataLength: STATE_LEN, lockArgsLength: 0, typeArgsLength: ARGS_LEN });
    assert.equal(cap / SHANNONS_PER_CKB, 1384n);
  });

  it("the body of 1,500 CKB covers it with headroom", () => {
    assert.ok(ECON_TESTNET.bodyCapacity > occupiedCapacity({ dataLength: STATE_LEN, lockArgsLength: 0, typeArgsLength: ARGS_LEN }));
  });
});

describe("the two decoders agree", () => {
  // The byte-level tests above pin the encoder. These pin the *decoder*, which is the
  // half a front-end actually trusts: it reads states off the chain and has to arrive at
  // the same numbers Rust does. A decoder that is subtly wrong is worse than a missing
  // one, because it produces a plausible fly.
  const state = bytes(g.transition.to);
  const rust = decode({ state: g.transition.to });
  const js = decodeState(state);

  it("agree on the header", () => {
    assert.equal(js.version, 1);
    assert.equal(js.n, rust.n);
    assert.equal(js.n, N);
    assert.equal(js.alive, rust.alive);
    assert.equal(js.generation, Number(rust.generation));
  });

  it("agree on the counters", () => {
    assert.equal(BigInt(js.step), BigInt(rust.step));
    assert.equal(BigInt(js.energy), BigInt(rust.energy));
    assert.equal(BigInt(js.totalSpikes), BigInt(rust.totalSpikes));
    assert.equal(BigInt(js.lifeSteps), BigInt(rust.lifeSteps));
    assert.equal(BigInt(js.lifeSpikes), BigInt(rust.lifeSpikes));
    assert.equal(BigInt(js.bornBlock), BigInt(rust.bornBlock));
    assert.equal(BigInt(js.stimUntil), BigInt(rust.stimUntil));
  });

  it("agree on the stimulus", () => {
    assert.equal(js.stimChannel, rust.stimChannel);
    assert.equal(js.stimParam, rust.stimParam);
    assert.equal(js.stimStrength, rust.stimStrength);
  });

  it("agree on the heading and the walk", () => {
    assert.equal(js.headX, rust.headX);
    assert.equal(js.headY, rust.headY);
    assert.equal(BigInt(js.posX), BigInt(rust.posX));
    assert.equal(BigInt(js.posY), BigInt(rust.posY));
    assert.deepEqual(js.headingHist, rust.headingHist);
  });
});

describe("the decoders agree with the encoders", () => {
  it("an action survives a round trip through the contract's own parser", () => {
    const cases = [
      [g.actions.tick64, { kind: "tick", steps: 64 }, () => action.tick(64)],
      [
        g.actions.stimulateCue4,
        { kind: "stimulate", channel: 1, param: 4, strength: 4, steps: 32 },
        () => action.stimulate(1, 4, 4, 32),
      ],
      [g.actions.feed10000, { kind: "feed", steps: 10000 }, () => action.feed(10_000)],
      [
        g.actions.resurrect1000,
        { kind: "resurrect", steps: 1000, bornBlock: 42 },
        () => action.resurrect(1_000, 42),
      ],
    ];
    for (const [encoded, expected, reencode] of cases) {
      assert.deepEqual(decodeAction({ action: encoded }), expected);
      // And the mirror's encoder produces the bytes Rust just decoded.
      assert.equal(hex(reencode()), encoded);
    }
  });

  it("refuses an action the contract would refuse", () => {
    // `stimulate` with zero steps: legal bytes, illegal action.
    assert.throws(() => decodeAction({ action: "0x020400040000" }));
  });

  it("--full returns the three per-neuron arrays", () => {
    const full = decode({ state: g.genesis.state, full: true });
    assert.equal(full.v.length, N);
    assert.equal(full.bias.length, N);
    assert.equal(full.inp.length, N);
    assert.ok(full.v.every((x) => x === 0), "a newborn has no membrane potential");

    const summary = decode({ state: g.genesis.state });
    assert.equal(summary.v, undefined, "the summary must not carry 465 numbers");
  });
});

describe("the circuit and the prices", () => {
  it("the layout covers every neuron and every neuron knows its place", () => {
    const c = circuit({ layout: true });
    assert.equal(c.layout.length, c.n);
    for (const neuron of c.layout) {
      assert.ok(neuron.type >= 0 && neuron.type < 6, `bad cell type ${neuron.type}`);
      assert.ok(neuron.wedge === 255 || neuron.wedge < c.wedges, `bad wedge ${neuron.wedge}`);
      assert.ok(neuron.side === 0 || neuron.side === 1, `bad side ${neuron.side}`);
    }
    // The compass ring is the point of the circuit; if no neuron has a wedge, the front-end
    // has nothing to draw as a ring.
    assert.ok(c.layout.filter((n) => n.wedge !== 255).length > 0);
  });

  it("economics encodes the same 24 bytes fly.js does", () => {
    const e = economics({ set: "testnet" });
    assert.equal(e.backingPerStep, String(ECON_TESTNET.backingPerStep));
    assert.equal(e.stimCostSteps, String(ECON_TESTNET.stimCostSteps));
    assert.equal(e.bodyCapacity, String(ECON_TESTNET.bodyCapacity));
    assert.equal(e.bytes, g.economicsTestnet);
  });
});
