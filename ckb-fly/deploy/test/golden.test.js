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
  CH,
  ECON_FREE,
  ECON_TESTNET,
  N,
  PARAMS_V1,
  PARAMS_V2,
  STATE_LEN,
  SHANNONS_PER_CKB,
  WEDGES,
  WORLD_LEN,
  action,
  circuitLayout,
  decodeArgs,
  decodeState,
  economicsJson,
  encodeArgs,
  encodeEconomics,
  encodeParams,
  genesisState,
  keccak256,
  occupiedCapacity,
  paramsJson,
  paramsNamed,
  worldDecode,
} from "../src/fly.js";
import { circuitHash, circuitTable } from "../src/artifacts.js";
import {
  circuit,
  decode,
  decodeAction,
  economics,
  golden,
  params as planParams,
  worldOpen,
} from "../src/plan.js";

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

describe("the JSON a page reads agrees with the planner's", () => {
  // These shapes are what the Identity panel prints and what `oracleFor` hands to the dynamics
  // module, and the page has no `flyplan` to ask — so this is the only place a divergence between
  // the two can be caught. It would not crash: it would report one genome and simulate another.
  //
  // The whole object rather than the encoded bytes, because the interesting field is the one the
  // encoding hides. `economics` prints its three u64 values as decimal strings, and a `Number`
  // there is exact today and is not at values a step counter reaches.
  for (const set of ["v1", "v2"]) {
    it(`paramsJson("${set}") is what flyplan prints`, () => {
      assert.deepEqual(paramsJson(set), planParams(set));
    });
  }

  for (const set of ["testnet", "free"]) {
    it(`economicsJson("${set}") is what flyplan prints`, () => {
      assert.deepEqual(economicsJson(set), economics({ set }));
    });
  }

  it("names a set it does not have, rather than falling back to a default", () => {
    // A page pointed at a deployment built with a set this build does not know has to hear about
    // it. Answering "v1" is the failure mode being guarded: the numbers would look plausible and
    // every successor state the page computed would be refused by the type script.
    assert.throws(() => paramsJson("v3"), /unknown parameter set/);
    assert.throws(() => economicsJson("mainnet"), /unknown economics/);
  });
});

describe("type script args read back", () => {
  const written = encodeArgs({
    instance: "0x" + "ab".repeat(8),
    params: PARAMS_V1,
    circuitHash: circuitHash(),
    economics: ECON_TESTNET,
  });

  it("finds the four fields where encodeArgs put them", () => {
    const got = decodeArgs(written);
    assert.equal(got.version, 2);
    assert.equal(got.instance, "0x" + "ab".repeat(8));
    // The one a page checks against its own connectome before it will draw a ring. A page that
    // got this wrong would draw the animal it was built with rather than the animal on the chain,
    // and the two look identical.
    assert.equal(got.circuitHash, circuitHash());
    assert.equal(got.paramsBytes, hex(encodeParams(PARAMS_V1)));
    assert.equal(got.economicsBytes, hex(encodeEconomics(ECON_TESTNET)));
  });

  it("refuses args that are not this version's length", () => {
    assert.throws(() => decodeArgs(written.slice(0, written.length - 1)), /bytes; this build knows/);
  });

  it("refuses a version it does not know", () => {
    // Version 1 has no instance field, so reading a v1 args as v2 takes eight bytes of parameters
    // for the organism's identity — and the page spends the rest of its visit convinced it is
    // looking at a different fly than the one whose cells it is holding.
    const v1 = Uint8Array.from(written);
    v1[0] = 1;
    assert.throws(() => decodeArgs(v1), /version 1; this build knows/);
  });
});

describe("action decoding agrees with Rust", () => {
  // `flyplan golden` encodes these four with Rust's `Action::encode`. Decoding them here and
  // re-encoding has to land on the same bytes. The browser reads actions out of witnesses —
  // that is how it knows what a history entry was — and it has no `flyplan` to ask, so this
  // decoder is the only thing standing between a page and a history it made up.
  const expected = {
    tick64: { kind: "tick", steps: 64 },
    stimulateCue4: { kind: "stimulate", channel: 1, param: 4, strength: 4, steps: 32 },
    feed10000: { kind: "feed", steps: 10000 },
    resurrect1000: { kind: "resurrect", steps: 1000, bornBlock: 42 },
  };

  const reencode = (d) =>
    d.kind === "tick"
      ? action.tick(d.steps)
      : d.kind === "stimulate"
        ? action.stimulate(d.channel, d.param, d.strength, d.steps)
        : d.kind === "feed"
          ? action.feed(d.steps)
          : action.resurrect(d.steps, d.bornBlock);

  for (const [name, want] of Object.entries(expected)) {
    it(`${name} decodes to exactly what Rust decodes it to`, () => {
      const raw = bytes(g.actions[name]);
      const got = action.decode(raw, PARAMS_V1);
      // The whole object, not field by field: an extra key would be as much of a divergence
      // as a wrong value, and this is the decoder a page has to be able to trust.
      assert.deepEqual(got, want);
      // And the same object `flyplan decode-action` prints, so the indexer can swap one for
      // the other without changing the JSON it serves.
      assert.deepEqual(got, decodeAction({ action: g.actions[name] }));
      assert.equal(hex(reencode(got)), g.actions[name], "round-trips to the same bytes");
    });
  }

  it("refuses exactly what the contract refuses", () => {
    const refused = [
      ["empty", "0x", /Truncated/],
      ["an unknown tag", "0x05", /UnknownTag/],
      ["trailing bytes", g.actions.tick64 + "ff", /TrailingBytes/],
      ["zero steps", "0x010000", /BadSteps/],
      ["more steps than maxSteps", "0x014100", /BadSteps/],
      ["channel 0", "0x020000010100", /BadStimulus/],
      ["channel 5", "0x020500010100", /BadStimulus/],
      ["strength 0", "0x020100000100", /BadStimulus/],
      ["a cue past the last wedge", "0x020110010100", /BadStimulus/],
      ["a truncated feed", "0x0301", /Truncated/],
      ["feeding zero", "0x030000000000000000", /ZeroAmount/],
      ["resurrecting zero", "0x040000000000000000" + "0000000000000000", /ZeroAmount/],
    ];
    for (const [label, h, pattern] of refused) {
      assert.throws(() => action.decode(bytes(h), PARAMS_V1), pattern, label);
    }
  });

  it("accepts a cue at the last wedge, which is the boundary the check is about", () => {
    const last = action.stimulate(CH.CUE, WEDGES - 1, 1, 1);
    assert.equal(action.decode(last, PARAMS_V1).param, WEDGES - 1);
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
    // Strings, because `flyplan decode` prints a u64 as a decimal string and this is its
    // mirror. The distinction is the point: `Number("1000000")` is exact, and `Number` of a
    // step counter that has passed 2^53 would not be.
    assert.equal(s.step, "0");
    assert.equal(s.energy, "1000000");
    assert.equal(s.bornBlock, "0");
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
    assert.equal(s.step, String(g.transition.step));
    assert.equal(s.energy, String(g.transition.outEnergy));
    assert.equal(s.alive, true);
    // The mainnet trajectory's first `tick(64)` fires nothing. That is a real fact about
    // the circuit, and it is also why the noise byte-order bug survived a first glance.
    assert.equal(s.totalSpikes, String(g.transition.totalSpikes));
    assert.equal(s.totalSpikes, "0");
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
  //
  // `plan.decode` shells out to `flyplan`; `decodeState` is the JavaScript mirror the
  // browser uses instead. The two are deliberately not the same object — `flyplan` reports
  // the encoding of the state it was handed, and this one reports what the state contains —
  // so the difference is pinned as well as the agreement. A field that appears on one side
  // and not the other is drift, and drift here is what the whole file exists to catch.
  const state = bytes(g.transition.to);
  const rust = decode({ state: g.transition.to });
  const js = decodeState(state);

  it("agree on every field they both carry", () => {
    const shared = Object.keys(js).filter((key) => key in rust);
    assert.deepEqual(
      shared.sort(),
      [
        "alive",
        "bornBlock",
        "energy",
        "generation",
        "headX",
        "headY",
        "headingHist",
        "lifeSpikes",
        "lifeSteps",
        "n",
        "posX",
        "posY",
        "step",
        "stimChannel",
        "stimParam",
        "stimStrength",
        "stimUntil",
        "totalSpikes",
      ],
      "the shared field list changed",
    );
    for (const key of shared) {
      // Value *and* type. A u64 that arrives as a number on one side and a string on the
      // other is exactly the kind of difference that never fails anything downstream.
      assert.deepEqual(js[key], rust[key], key);
    }
  });

  it("differ only in what each one is for", () => {
    // `flyplan` describes the bytes: the hex it read, its length, its keccak256. This one
    // describes the fly: which format version the header is, and how many of the 155
    // neurons carry a non-zero value — counts rather than the arrays, because a summary
    // that carried 465 numbers would not be a summary.
    assert.deepEqual(Object.keys(js).filter((key) => !(key in rust)).sort(), [
      "nonZeroBias",
      "nonZeroInp",
      "nonZeroV",
      "version",
    ]);
    assert.deepEqual(Object.keys(rust).filter((key) => !(key in js)).sort(), [
      "len",
      "state",
      "stateHash",
    ]);
  });

  it("agree on the parts a test failure is easiest to read", () => {
    assert.equal(js.version, 1);
    assert.equal(js.n, N);
    assert.equal(js.alive, true);
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

describe("the connectome layout agrees with Rust", () => {
  // The page draws the ring from this, and it has no `flyplan` to ask. A layout that is
  // subtly wrong does not fail — it draws a fly whose neurons are in the wrong wedges,
  // which looks entirely plausible. So every neuron is compared, not a sample.
  const rust = circuit({ layout: true });
  const js = circuitLayout(circuitTable());

  it("agrees on the header", () => {
    assert.equal(js.hash, rust.hash);
    assert.equal(js.hash, circuitHash());
    assert.equal(js.bytes, rust.bytes);
    assert.equal(js.n, rust.n);
    assert.equal(js.n, N);
    assert.equal(js.wedges, rust.wedges);
    assert.equal(js.wedges, WEDGES);
  });

  it("places every neuron exactly where Rust places it", () => {
    assert.equal(js.layout.length, rust.layout.length);
    for (let i = 0; i < rust.layout.length; i++) {
      assert.deepEqual(js.layout[i], rust.layout[i], `neuron ${i}`);
    }
  });

  it("refuses a table whose header lies about its own length", () => {
    const truncated = circuitTable().slice(0, 100);
    assert.throws(() => circuitLayout(truncated), /its header implies/);
  });
});

describe("the chronicle decodes as Rust decodes it", () => {
  // A chronicle is the fly's biography written by the contract in the same transaction that
  // moved it, so a page showing "sightings: 3" is showing a number the chain produced. It
  // has to read the bytes the same way `flyworld` wrote them.
  const newborn = genesisState({ energy: 1_000_000n, bornBlock: 0n });
  const opened = worldOpen({ flyState: hex(newborn), capacity: "150000000000" });
  const js = worldDecode(bytes(opened.data));
  const rust = opened;

  it("agrees on every field", () => {
    assert.equal(WORLD_LEN, rust.len);
    // Whole objects: the chronicle JSON minus the two fields that describe the encoding
    // rather than the fly. A missing field and a mis-typed one both fail here.
    const { data, len, ...fields } = rust;
    assert.deepEqual(js, fields);
  });

  it("derives net capacity the way Rust does", () => {
    assert.equal(js.netCapacity, rust.netCapacity);
    assert.equal(js.netCapacity, "0", "a chronicle that has seen nothing has gained nothing");
  });

  it("opens with one sighting and the fly's own state hash", () => {
    // Not an arbitrary number: `World::open` records the fly it was opened for, and a
    // chronicle whose first entry is not the newborn is one the contract would refuse. The
    // hash is keccak256 of the state bytes — not CKB's own blake2b, which is what names a
    // cell on chain; this one names the fly *inside* the record, and the two are different
    // questions.
    assert.equal(js.sightings, "1");
    assert.equal(js.stateHash, keccak256(newborn));
    assert.equal(js.stateHash, rust.stateHash);
    assert.equal(js.generation, 0);
    assert.equal(js.alive, true);
  });

  it("refuses bytes that are not a chronicle", () => {
    assert.throws(() => worldDecode(bytes(opened.data).slice(0, 127)), /not decodable/);
    // Byte 1 is `alive`, and it is an option, not a flag: `World::decode` refuses anything
    // but 0 and 1, so a 2 here is a cell the contract would have refused to create.
    const bad = bytes(opened.data);
    bad[1] = 2;
    assert.throws(() => worldDecode(bad), /not decodable/);
    // Byte 2 is padding, and a non-zero pad means the bytes are not what they claim.
    const padded = bytes(opened.data);
    padded[2] = 1;
    assert.throws(() => worldDecode(padded), /not decodable/);
  });
});

describe("parameter sets resolve by name", () => {
  it("gives back the struct the action parser range-checks against", () => {
    assert.equal(paramsNamed("v1"), PARAMS_V1);
    assert.equal(paramsNamed("v2"), PARAMS_V2);
    // A record that inlined the numbers rather than naming a set still works.
    assert.equal(paramsNamed(PARAMS_V1), PARAMS_V1);
  });

  it("refuses a name it does not know rather than guessing", () => {
    assert.throws(() => paramsNamed("v3"), /unknown parameter set/);
  });
});
