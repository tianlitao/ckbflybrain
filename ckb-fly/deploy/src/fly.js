/**
 * The fly's identity, mirrored from the Rust crates.
 *
 * Everything here has a counterpart in `crates/flycore` — the parameter encoding, the
 * economics encoding, the script args, and the state cell layout. The Rust side is
 * authoritative; `test/golden.test.js` pins this file's output against values produced by
 * Rust, so a drift between the two shows up as a failing test rather than as a transaction
 * the contract silently refuses.
 *
 * # Who uses this, and who does not
 *
 * The deployer (`src/cli.js`) does **not** take its bytes from here. It takes them from
 * `src/plan.js`, which shells out to the `flyplan` binary — the same `flycore` the
 * validator runs. A transaction builder that reimplemented the dynamics would be a second
 * source of truth for the one thing the whole port is about.
 *
 * This module exists for the half of the project that cannot shell out to Rust: the
 * browser. A front-end has to encode a `stimulate` action and decode a state cell without
 * a server, so the encoders have to exist in JavaScript — and having them exist, they
 * have to be checked. That is the golden test's whole job.
 *
 * The filesystem half — the contract binaries and the connectome table — lives in
 * `src/artifacts.js`. Keeping it out of this file is what lets a page import the encoders
 * without dragging `node:fs` into the bundle. Nothing below touches the filesystem.
 *
 * @module fly
 */

import * as ccc from "@ckb-ccc/core";

// ---------------------------------------------------------------- constants

/** Number of compass wedges. */
export const WEDGES = 16;

/** Neuron count of the FlyWire ring attractor. */
export const N = 155;

/** Synapse count. */
export const S = 6522;

/** State cell data length: `128 + 7n`. */
export const STATE_LEN = 128 + 7 * N;

/** Chronicle cell data length — `flycore::world::WORLD_LEN`, fixed and independent of `N`. */
export const WORLD_LEN = 128;

/** Byte length of the instance nonce that makes two flies two organisms. */
export const INSTANCE_LEN = 8;

/** Script args length: version + instance + params + circuit hash + economics. */
export const ARGS_LEN = 1 + INSTANCE_LEN + 32 + 32 + 24;

/** Shannons per CKB. Cell data costs 1 CKB per byte. */
export const SHANNONS_PER_CKB = 100_000_000n;

/** Action tags, matching `flycore::action`. */
export const TAG = { TICK: 1, STIMULATE: 2, FEED: 3, RESURRECT: 4 };

/** Stimulus channels, matching `flycore::sim`. */
export const CH = { NONE: 0, CUE: 1, TURN_LEFT: 2, TURN_RIGHT: 3, SHOCK: 4 };

/**
 * `Params::V1_DEPLOYED` — the parameter set the BSC mainnet differential fixture was
 * generated with. Using it on CKB means the on-chain trajectory is directly comparable
 * with the chain that came before.
 */
export const PARAMS_V1 = {
  leak: 95,
  thresh: 1000,
  reset: -500,
  vMin: -4000,
  gains: [190, 114, 5, 108, 7, -297],
  gBias: 4,
  noise: 35,
  stimGain: 157,
  stimTTL: 64,
  walkThreshold: 100,
  maxSteps: 64,
  persistInput: false,
};

/** `Params::V2` — the recalibrated live parameter set. */
export const PARAMS_V2 = {
  leak: 69,
  thresh: 1000,
  reset: -200,
  vMin: -4000,
  gains: [130, 28, 447, 56, 40, -372],
  gBias: 4,
  noise: 67,
  stimGain: 161,
  stimTTL: 64,
  walkThreshold: 100,
  maxSteps: 64,
  persistInput: true,
};

/**
 * The parameter sets by the name a deployment record uses.
 *
 * Kept next to the two sets rather than at the lookup that needs it, so that adding a third
 * to Rust means adding a line to the same place the other two are described.
 */
export const PARAMS_SETS = { v1: PARAMS_V1, v2: PARAMS_V2 };

/**
 * `Economics::TESTNET` — 0.0001 CKB per step of life, 128 steps per unit of stimulus
 * strength, a 1,500 CKB body.
 */
export const ECON_TESTNET = {
  backingPerStep: 10_000n,
  stimCostSteps: 128n,
  bodyCapacity: 1_500n * SHANNONS_PER_CKB,
};

/** `Economics::FREE` — for a throwaway chain where the economics is not the point. */
export const ECON_FREE = {
  backingPerStep: 0n,
  stimCostSteps: 0n,
  bodyCapacity: 0n,
};

/** The economics sets by the name a deployment record uses, next to the sets themselves. */
export const ECON_SETS = { testnet: ECON_TESTNET, free: ECON_FREE };

// ---------------------------------------------------------------- hashing

/** blake2b-256, as CKB uses for code and data hashes. */
export function blake2b(bytes) {
  return ccc.hashCkb(bytes);
}

/** keccak-256, as the contract uses for the noise source and the circuit commitment. */
export function keccak256(bytes) {
  const h = new ccc.HasherKeecak256();
  h.update(bytes);
  return h.digest();
}

// ---------------------------------------------------------------- encoding

function view(size) {
  const buf = new Uint8Array(size);
  return { buf, dv: new DataView(buf.buffer) };
}

/**
 * `Params::to_bytes` — 32 bytes, little-endian.
 *
 * `flags` bit 0 is `persist_input`; every other bit is reserved and must be zero, so the
 * encoding is canonical and two equal parameter sets always produce identical args.
 */
export function encodeParams(p) {
  const { buf, dv } = view(32);
  dv.setUint16(0, p.leak, true);
  dv.setInt16(2, p.thresh, true);
  dv.setInt16(4, p.reset, true);
  dv.setInt16(6, p.vMin, true);
  for (let k = 0; k < 6; k++) dv.setInt16(8 + 2 * k, p.gains[k], true);
  dv.setUint16(20, p.gBias, true);
  dv.setUint16(22, p.noise, true);
  dv.setUint16(24, p.stimGain, true);
  dv.setUint16(26, p.stimTTL, true);
  dv.setUint16(28, p.walkThreshold, true);
  dv.setUint8(30, p.maxSteps);
  dv.setUint8(31, p.persistInput ? 1 : 0);
  return buf;
}

/** `Economics::to_bytes` — 24 bytes, little-endian. */
export function encodeEconomics(e) {
  const { buf, dv } = view(24);
  dv.setBigUint64(0, e.backingPerStep, true);
  dv.setBigUint64(8, e.stimCostSteps, true);
  dv.setBigUint64(16, e.bodyCapacity, true);
  return buf;
}

/**
 * `ScriptArgs::to_bytes` — 89 bytes.
 *
 * CKB treats a script's args as part of its identity, so this is the fly's genome: the
 * dynamics, the connectome and the prices, all pinned by the type script hash.
 */
export function encodeArgs({ instance, params, circuitHash, economics }) {
  const out = new Uint8Array(ARGS_LEN);
  out[0] = 2; // args version 2: version 1 had no instance field
  out.set(bytes(instance, INSTANCE_LEN, "instance"), 1);
  out.set(encodeParams(params), 1 + INSTANCE_LEN);
  // `circuitHash()` returns the hash as hex, because that is how it is written down
  // everywhere else — in the args, in the README, in the BSC contract's `circuitHash()`.
  // `Uint8Array.set` would happily accept the *string* and write one zero byte per
  // character, running off the end of the buffer; the conversion is not optional.
  out.set(bytes(circuitHash, 32, "circuitHash"), 1 + INSTANCE_LEN + 32);
  out.set(encodeEconomics(economics), 1 + INSTANCE_LEN + 64);
  return out;
}

/** Normalize a `Uint8Array` or `0x…` string into exactly `size` bytes. */
function bytes(value, size, what) {
  const b = value instanceof Uint8Array ? value : ccc.bytesFrom(value);
  if (b.length !== size) {
    throw new Error(`${what} must be ${size} bytes, got ${b.length}`);
  }
  return b;
}

/**
 * The genome a type script's args carry: instance, parameters, connectome hash, prices.
 *
 * The page needs this for one reason. It draws a ring, and the ring is a picture of a
 * *particular* connectome — the one this organism's dynamics run on. The table comes from
 * `flywasm` (`flycircuit::TABLE`, the bytes the validator itself uses), and this is the other
 * end of that comparison: the chain's own statement of which connectome this fly was built
 * from. If they disagree the page must draw nothing rather than a plausible picture of a
 * different animal.
 *
 * Strict about the version and the length, because the two were different things: version 1
 * had no instance field, so a v1 args string decoded as v2 would report eight bytes of
 * parameters as the organism's identity.
 */
export function decodeArgs(args) {
  const b = args instanceof Uint8Array ? args : ccc.bytesFrom(args);
  if (b.length !== ARGS_LEN) {
    throw new Error(
      `the type script's args are ${b.length} bytes; this build knows version 2, which is ${ARGS_LEN}`,
    );
  }
  if (b[0] !== 2) {
    throw new Error(`the type script's args are version ${b[0]}; this build knows version 2`);
  }
  return {
    version: b[0],
    instance: ccc.hexFrom(b.subarray(1, 1 + INSTANCE_LEN)),
    paramsBytes: ccc.hexFrom(b.subarray(1 + INSTANCE_LEN, 1 + INSTANCE_LEN + 32)),
    circuitHash: ccc.hexFrom(b.subarray(1 + INSTANCE_LEN + 32, 1 + INSTANCE_LEN + 64)),
    economicsBytes: ccc.hexFrom(b.subarray(1 + INSTANCE_LEN + 64)),
  };
}

/**
 * `Sim::genesis(...).encode()` — the canonical newborn state, 1,213 bytes.
 *
 * Almost entirely zeros: a newborn has no membrane potential, no engram, no spike history
 * and no pending input. The contract refuses any genesis whose state is not *exactly*
 * this, so a deployer cannot hand themselves a fly that has already lived.
 */
export function genesisState({ energy, bornBlock = 0n }) {
  const { buf, dv } = view(STATE_LEN);
  buf[0] = 1; // version
  buf[1] = N; // neuron count
  buf[2] = 1; // alive
  dv.setBigUint64(32, BigInt(energy), true); // energy
  dv.setBigUint64(64, BigInt(bornBlock), true); // born_block
  return buf;
}

/**
 * Decode a state cell for display. Mirrors the Rust layout; not used for validation.
 *
 * The output is `flyplan decode`'s JSON, field for field and **type for type**, which is
 * worth being explicit about because the two conventions in this project are not the same
 * one: a u64 is a decimal string here, and everything narrower is a number. That is not a
 * choice made here — it is what the Rust side already prints, and matching it is what lets
 * the indexer swap `flyplan decode` for this function without a single byte of the JSON it
 * serves changing.
 *
 * `full` adds the three per-neuron arrays. They are opt-in because they are 465 numbers
 * and most callers only print a summary — but the ring attractor cannot be drawn without
 * them, and a browser that is drawing a fly has no `flyplan decode --full` to ask. The
 * counts below are always present: they cost one pass and answer "did anything happen".
 *
 * @param {Uint8Array} bytes
 * @param {{full?: boolean}} [options]
 */
export function decodeState(bytes, { full = false } = {}) {
  if (bytes.length !== STATE_LEN) {
    throw new Error(`state is ${bytes.length} bytes, expected ${STATE_LEN}`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // A u64 read as a BigInt and rendered as a decimal string — never through a Number, which
  // would round past 2^53 and turn a step counter into a plausible lie.
  const u64 = (o) => dv.getBigUint64(o, true).toString();
  const i64 = (o) => dv.getBigInt64(o, true).toString();
  const hist = [];
  for (let w = 0; w < WEDGES; w++) hist.push(dv.getUint16(96 + 2 * w, true));
  const nonZero = (off, len, step, read) => {
    let n = 0;
    for (let i = 0; i < len; i += step) if (read(off + i) !== 0) n++;
    return n;
  };
  const array = (off, step, read) => {
    const out = new Array(N);
    for (let i = 0; i < N; i++) out[i] = read(off + i * step);
    return out;
  };
  return {
    version: bytes[0],
    n: bytes[1],
    alive: bytes[2] === 1,
    stimChannel: bytes[3],
    stimParam: bytes[4],
    stimStrength: dv.getUint16(6, true),
    generation: dv.getUint32(8, true),
    headX: dv.getInt32(12, true),
    headY: dv.getInt32(16, true),
    step: u64(24),
    energy: u64(32),
    totalSpikes: u64(40),
    lifeSteps: u64(48),
    lifeSpikes: u64(56),
    bornBlock: u64(64),
    stimUntil: u64(72),
    posX: i64(80),
    posY: i64(88),
    headingHist: hist,
    // Counts rather than the arrays themselves: 155 values is a lot to print.
    nonZeroV: nonZero(128, N, 2, (o) => dv.getInt16(o, true)),
    nonZeroBias: nonZero(128 + 2 * N, N, 1, (o) => dv.getInt8(o)),
    nonZeroInp: nonZero(128 + 3 * N, N, 4, (o) => dv.getInt32(o, true)),
    // Present only on request, so a summary stays a summary. The keys are absent rather
    // than empty, because a caller that draws the ring asks for them and a caller that
    // does not should not be able to draw 155 zeros by accident.
    ...(full
      ? {
          v: array(128, 2, (o) => dv.getInt16(o, true)),
          bias: array(128 + 2 * N, 1, (o) => dv.getInt8(o)),
          inp: array(128 + 3 * N, 4, (o) => dv.getInt32(o, true)),
        }
      : {}),
  };
}

/**
 * The parameter set a deployment record names.
 *
 * A record stores `"v1"`, not the numbers, because the numbers live in Rust and a record
 * that copied them would be a second copy to drift. Everything that reads a record — the
 * Node indexer and the browser both — has to turn that name back into the struct the action
 * parser range-checks against, so the lookup lives here rather than in each caller.
 *
 * An object passes through unchanged, so a record that inlined the numbers still works.
 */
export function paramsNamed(set) {
  if (set && typeof set === "object") {
    return set;
  }
  const found = PARAMS_SETS[set];
  if (!found) {
    throw new Error(
      `unknown parameter set ${JSON.stringify(set)}; this build knows ${Object.keys(PARAMS_SETS).join(", ")}`,
    );
  }
  return found;
}

/**
 * The economics by the name a deployment record uses.
 *
 * The same bargain as {@link paramsNamed}: a record stores `"testnet"`, and everything that
 * needs the three numbers has to resolve it the same way.
 */
export function economicsNamed(set) {
  if (set && typeof set === "object") {
    return set;
  }
  const found = ECON_SETS[set];
  if (!found) {
    throw new Error(
      `unknown economics ${JSON.stringify(set)}; this build knows ${Object.keys(ECON_SETS).join(", ")}`,
    );
  }
  return found;
}

/**
 * The parameter set as `flyplan params` prints it.
 *
 * The page builds its own snapshot now, and a snapshot's `params` field used to come from
 * `flyplan params` as JSON. Mirroring the shape rather than inventing a better one is the same
 * rule the state decoders follow: the two answers have to be the same object, or a reader
 * looking at one of them is looking at something nobody else sees. `bytes` is included for
 * that reason even though no renderer reads it.
 */
export function paramsJson(set = "v1") {
  const p = paramsNamed(set);
  return {
    set: typeof set === "string" ? set : "v1",
    ...p,
    bytes: ccc.hexFrom(encodeParams(p)),
  };
}

/**
 * The economics as `flyplan economics` prints it — u64 fields as **strings**, because that is
 * what the planner does with them.
 */
export function economicsJson(set = "testnet") {
  const e = economicsNamed(set);
  return {
    set: typeof set === "string" ? set : "testnet",
    backingPerStep: String(e.backingPerStep),
    stimCostSteps: String(e.stimCostSteps),
    bodyCapacity: String(e.bodyCapacity),
    bytes: ccc.hexFrom(encodeEconomics(e)),
  };
}

/**
 * Decode a `WitnessArgs`.
 *
 * The layout is a molecule table of three `BytesOpt` fields — lock, inputType, outputType —
 * and a `BytesOpt` is an option of a byte vector, which molecule encodes as a bare `Bytes`
 * whose length of zero means `None`. So each field is either empty or a four-byte length
 * followed by that many bytes.
 *
 * This is written out rather than taken from CCC's `WitnessArgs.from`, which returns
 * `undefined` for every field of a witness this shape — including one that demonstrably
 * carries a six-byte action. The format is a dozen lines of code and does not need a wrapper
 * that has to be debugged first.
 *
 * It lives here, in the encoding core, rather than in the chain reader that first needed it:
 * a browser recovering a history decodes the same witnesses a Node indexer does, and two
 * implementations of one format is how they come to disagree.
 *
 * @param {string} hex
 * @returns {{lock: string|null, inputType: string|null, outputType: string|null}}
 */
export function readWitnessArgs(hex) {
  const b = ccc.bytesFrom(hex);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const total = dv.getUint32(0, true);
  if (total !== b.length) {
    throw new Error(`WitnessArgs says ${total} bytes, the witness is ${b.length}`);
  }
  const offsets = [dv.getUint32(4, true), dv.getUint32(8, true), dv.getUint32(12, true)];
  const field = (from, to) => {
    if (from === to) {
      return null;
    }
    const len = dv.getUint32(from, true);
    const start = from + 4;
    if (start + len > to) {
      throw new Error("a WitnessArgs field overruns its own table");
    }
    return ccc.hexFrom(b.subarray(start, start + len));
  };
  return {
    lock: field(offsets[0], offsets[1]),
    inputType: field(offsets[1], offsets[2]),
    outputType: field(offsets[2], total),
  };
}

/** Action encodings, matching `Action::encode`. */
export const action = {
  tick: (steps) => {
    const { buf, dv } = view(3);
    buf[0] = TAG.TICK;
    dv.setUint16(1, steps, true);
    return buf;
  },
  stimulate: (channel, param, strength, steps) => {
    const { buf, dv } = view(6);
    buf[0] = TAG.STIMULATE;
    buf[1] = channel;
    buf[2] = param;
    buf[3] = strength;
    dv.setUint16(4, steps, true);
    return buf;
  },
  feed: (steps) => {
    const { buf, dv } = view(9);
    buf[0] = TAG.FEED;
    dv.setBigUint64(1, BigInt(steps), true);
    return buf;
  },
  resurrect: (steps, bornBlock) => {
    const { buf, dv } = view(17);
    buf[0] = TAG.RESURRECT;
    dv.setBigUint64(1, BigInt(steps), true);
    dv.setBigUint64(9, BigInt(bornBlock), true);
    return buf;
  },

  /**
   * Encode an action described as a spec, in the shape `tx.js` asks an oracle for.
   *
   * `plan.action` — the CLI's oracle — hands the spec to `flyplan action`, which encodes it and
   * range-checks it with the contract's own parser before returning. The page has no `flyplan`,
   * so this is the browser's answer to the same question, and it has to keep both halves of
   * that promise:
   *
   * * it **dispatches on `kind`**, because a page builds an action from a button and a number,
   *   not by calling `tick` by name; and
   * * it **decodes what it just encoded**, so an impossible click fails in the builder with the
   *   contract's own reason (`BadSteps`, `BadStimulus`, `ZeroAmount`) instead of becoming a
   *   transaction the type script rejects on chain — which a reader would experience as a
   *   wallet that took their money and did nothing.
   *
   * The four encoders above are pinned against `flyplan` by `test/golden.test.js`; this
   * dispatcher is pinned against all four of them at once, and there is no second copy of the
   * encoding for the two to disagree about.
   *
   * @param {{kind: string, steps?: number, channel?: number, param?: number,
   *          strength?: number, bornBlock?: number}} spec
   * @param {{maxSteps: number}} params
   * @returns {{action: string}} the encoded action, as hex
   */
  encode(spec, params) {
    const raw =
      spec.kind === "tick"
        ? action.tick(spec.steps)
        : spec.kind === "stimulate"
          ? action.stimulate(spec.channel, spec.param, spec.strength, spec.steps)
          : spec.kind === "feed"
            ? action.feed(spec.steps)
            : spec.kind === "resurrect"
              ? action.resurrect(spec.steps, spec.bornBlock)
              : null;
    if (!raw) {
      throw new Error(`action: no encoding for kind ${JSON.stringify(spec.kind)}`);
    }
    action.decode(raw, params); // refuses exactly what the contract refuses
    return { action: ccc.hexFrom(raw) };
  },

  /**
   * Parse and validate a witness action, mirroring `flycore::Action::decode`.
   *
   * A history entry that shows an action is showing one the fly accepted: the action in the
   * witness is not a claim about what happened, it is the input the type script validated
   * before it agreed to the transition. Decoding it here with the same rules — and refusing
   * with the same reason — is what keeps the browser's history from describing a move that
   * never happened. It is also why the browser needs this at all: it cannot shell out to
   * `flyplan decode-action`.
   *
   * Refused exactly as the contract refuses, so a decode that succeeds here is a decode the
   * contract would have accepted:
   *
   * | reason | when |
   * |---|---|
   * | `Truncated` | shorter than the tag's payload |
   * | `UnknownTag` | the tag is not one of the four |
   * | `TrailingBytes` | longer than the tag's payload — one action, one encoding |
   * | `BadSteps` | a ticking action asked for 0, or more than `params.maxSteps` |
   * | `BadStimulus` | channel outside 1..=4, strength 0, or a cue past the last wedge |
   * | `ZeroAmount` | `feed` or `resurrect` asked for zero |
   *
   * @param {Uint8Array|string} bytes
   * @param {{maxSteps: number}} params
   * @returns {{kind: string, steps: number, channel?: number, param?: number,
   *            strength?: number, bornBlock?: number}}
   */
  decode(bytes, params) {
    const b = typeof bytes === "string" ? ccc.bytesFrom(bytes) : bytes;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const fail = (reason) => {
      throw new Error(`action: ${reason}`);
    };

    if (b.length < 1) {
      fail("Truncated");
    }
    const tag = b[0];
    const u16 = (o) => {
      if (o + 2 > b.length) fail("Truncated");
      return dv.getUint16(o, true);
    };
    const u64 = (o) => {
      if (o + 8 > b.length) fail("Truncated");
      return dv.getBigUint64(o, true);
    };
    const ticking = (v) => {
      if (v === 0 || v > params.maxSteps) fail("BadSteps");
      return v;
    };
    // `flyplan decode-action` prints a u64 as a JSON number, and this matches it — but only
    // after checking the value fits. This is a JavaScript limit, not a contract rule, so it
    // gets its own kind of error rather than borrowing one of the contract's names. It should
    // never fire: `feed` and `resurrect` steps are bounded by the fly's energy, energy is
    // bounded by the capacity backing it, and CKB's whole supply is about 2^62 shannons — so
    // a step count that needs 54 bits is one the economics cannot produce. If it does fire,
    // refusing beats printing a number that is nearly right.
    const counted = (v, what) => {
      if (v > 9_007_199_254_740_991n) {
        throw new Error(`${what} is ${v}, which JavaScript cannot represent exactly`);
      }
      return Number(v);
    };

    let decoded;
    let want;
    if (tag === TAG.TICK) {
      decoded = { kind: "tick", steps: ticking(u16(1)) };
      want = 3;
    } else if (tag === TAG.STIMULATE) {
      if (b.length < 5) {
        fail("Truncated");
      }
      const channel = b[1];
      const param = b[2];
      const strength = b[3];
      if (channel === 0 || channel > CH.SHOCK || strength === 0) {
        fail("BadStimulus");
      }
      if (channel === CH.CUE && param >= WEDGES) {
        fail("BadStimulus");
      }
      decoded = { kind: "stimulate", channel, param, strength, steps: ticking(u16(4)) };
      want = 6;
    } else if (tag === TAG.FEED) {
      const steps = u64(1);
      if (steps === 0n) {
        fail("ZeroAmount");
      }
      decoded = { kind: "feed", steps: counted(steps, "a feed of") };
      want = 9;
    } else if (tag === TAG.RESURRECT) {
      const steps = u64(1);
      if (steps === 0n) {
        fail("ZeroAmount");
      }
      decoded = {
        kind: "resurrect",
        steps: counted(steps, "a resurrection of"),
        bornBlock: counted(u64(9), "a born block of"),
      };
      want = 17;
    } else {
      fail(`UnknownTag(${tag})`);
    }

    if (b.length !== want) {
      fail("TrailingBytes");
    }
    return decoded;
  },
};

/**
 * Occupied capacity of a cell, in shannons: 1 byte = 1 CKB.
 *
 * This is CKB's own accounting rule, from `util/gen-types/src/extension/capacity.rs`:
 *
 * ```text
 * occupied = 8                        // the capacity field itself
 *          + dataLength
 *          + (lockArgsLength + 33)   // code hash (32) + hash type (1)
 *          + (typeArgsLength + 33)   // only when the cell wears a type script
 * ```
 *
 * Note what is *not* in the sum: molecule's table headers, its per-field offset words,
 * its four-byte length prefixes, or the padding that aligns `Bytes` to four bytes. The
 * node charges for the payload, not for the encoding around it. A cell whose molecule
 * serialization is 1,451 bytes therefore occupies 1,376 — and an earlier version of this
 * module, which modelled the padded serialization instead, would have asked for capacity
 * the fly does not need.
 *
 * @param {{dataLength: number, lockArgsLength?: number, typeArgsLength?: number|null}} cell
 */
export function occupiedCapacity({ dataLength, lockArgsLength = 0, typeArgsLength = null }) {
  const bytes =
    8n +
    BigInt(dataLength) +
    BigInt(lockArgsLength + 33) +
    (typeArgsLength === null ? 0n : BigInt(typeArgsLength + 33));
  return bytes * SHANNONS_PER_CKB;
}

/** Minimum capacity the state cell must hold to claim `energy` steps of life. */
export function requiredCapacity(economics, energy) {
  return economics.bodyCapacity + economics.backingPerStep * BigInt(energy);
}

/**
 * Steps of life a stimulus of `strength` costs, on top of the steps it advances.
 *
 * Charged in life rather than in capacity: a capacity-denominated charge would have to come
 * out of the very capacity backing the remaining energy, so an exactly-backed fly could
 * never afford one.
 */
export function stimCost(economics, strength) {
  return economics.stimCostSteps * BigInt(strength);
}

// ---------------------------------------------------------------- the connectome

/**
 * The connectome's header and per-neuron layout, read out of the packed table.
 *
 * `flyplan circuit --layout` exposes the same thing, and this is the mirror of it. A page
 * has the table (it is 15 KB, shipped next to `index.html`) but cannot ask Rust where each
 * neuron sits — and it needs to know, because a ring attractor drawn as 155 anonymous
 * numbers is not a ring attractor. `wedge` is the compass wedge a neuron belongs to, or
 * `255` for the cells that are not part of the ring at all.
 *
 * The table is big-endian in its header and unpadded everywhere, which is worth stating
 * because every other format in this project is little-endian:
 *
 * ```text
 * [0]     u8        version
 * [1]     u8        n
 * [2..4]  u16be     synapse count
 * type    n x u8
 * wedge   n x u8
 * side    n x u8
 * offsets (n+1) x u16be
 * syn     s x (u8 post, u8 weight)
 * root    n x u64be
 * ```
 *
 * The three per-neuron arrays are contiguous from byte 4, which is why this is a slice
 * rather than a loop over a decoder.
 *
 * @param {Uint8Array} table the bytes of `crates/flycircuit/data/circuit.bin`
 */
export function circuitLayout(table) {
  if (table.length < 4) {
    throw new Error(`circuit table is ${table.length} bytes, too short to have a header`);
  }
  const [version, n, hi, lo] = table;
  if (version !== 1) {
    throw new Error(`circuit table version ${version}, this decoder understands 1`);
  }
  if (n === 0) {
    throw new Error("circuit table claims zero neurons");
  }
  const s = (hi << 8) | lo;
  const want = 13 * n + 2 * s + 6;
  if (table.length !== want) {
    throw new Error(`circuit table is ${table.length} bytes, its header implies ${want}`);
  }
  const layout = new Array(n);
  for (let i = 0; i < n; i++) {
    layout[i] = { type: table[4 + i], wedge: table[4 + n + i], side: table[4 + 2 * n + i] };
  }
  return { hash: ccc.hexFrom(keccak256(table)), bytes: table.length, n, wedges: WEDGES, layout };
}

// ---------------------------------------------------------------- the chronicle

/**
 * Decode a chronicle cell — `flyworld`'s state, mirrored from `flycore::world`.
 *
 * The chronicle is the fly's biography written by the same transaction that moved it: the
 * type script refuses any chronicle that is not the exact record of the fly beside it. So
 * decoding it is the same kind of act as decoding a state, and it belongs in the same file
 * for the same reason — a page that shows a fly's sightings is showing chain data, and it
 * should be reading the format rather than a summary of it.
 *
 * Every field is a fixed offset. `alive` is one byte, `generation` a u32, the rest u64, and
 * the padding bytes are checked because `World::decode` checks them: a chronicle with a
 * non-zero pad is not a chronicle, and accepting one here would mean the page could draw a
 * cell the contract would have refused.
 *
 * Like `decodeState`, the output is `flyplan world-decode`'s JSON exactly: a u64 is a decimal
 * string, a u32 is a number. A reader can compare the two without knowing which one it is
 * holding, which is the only property that makes a mirror worth having.
 *
 * @param {Uint8Array} bytes 128 bytes
 */
export function worldDecode(bytes) {
  const malformed = () => new Error(`the chronicle is not decodable: ${bytes.length} bytes`);
  if (bytes.length !== WORLD_LEN) {
    throw malformed();
  }
  if (bytes[0] !== 1) {
    throw malformed();
  }
  if (bytes[1] > 1 || bytes[2] !== 0 || bytes[3] !== 0 || bytes[88] !== 0) {
    throw malformed();
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u64 = (o) => dv.getBigUint64(o, true).toString();
  const totalAdded = dv.getBigUint64(72, true);
  const totalReleased = dv.getBigUint64(64, true);
  return {
    alive: bytes[1] === 1,
    generation: dv.getUint32(4, true),
    bornStep: u64(8),
    diedStep: u64(16),
    step: u64(24),
    energy: u64(32),
    lifeSteps: u64(40),
    totalSpikes: u64(48),
    capacity: u64(56),
    totalReleased: u64(64),
    totalAdded: u64(72),
    // Derived rather than stored, exactly as `World::net_capacity` derives it. Signed, so the
    // subtraction happens in BigInt and only the result is rendered: a fly its tickers have
    // cost more than its feeders gave it is a fact worth being able to display rather than a
    // reason to clamp.
    netCapacity: (totalAdded - totalReleased).toString(),
    sightings: u64(80),
    stateHash: ccc.hexFrom(bytes.subarray(96, 128)),
  };
}
