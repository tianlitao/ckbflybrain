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
 * @module fly
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import * as ccc from "@ckb-ccc/core";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(HERE, "..", "..");

// ---------------------------------------------------------------- constants

/** Number of compass wedges. */
export const WEDGES = 16;

/** Neuron count of the FlyWire ring attractor. */
export const N = 155;

/** Synapse count. */
export const S = 6522;

/** State cell data length: `128 + 7n`. */
export const STATE_LEN = 128 + 7 * N;

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

/** Decode a state cell for display. Mirrors the Rust layout; not used for validation. */
export function decodeState(bytes) {
  if (bytes.length !== STATE_LEN) {
    throw new Error(`state is ${bytes.length} bytes, expected ${STATE_LEN}`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hist = [];
  for (let w = 0; w < WEDGES; w++) hist.push(dv.getUint16(96 + 2 * w, true));
  const nonZero = (off, len, step, read) => {
    let n = 0;
    for (let i = 0; i < len; i += step) if (read(off + i) !== 0) n++;
    return n;
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
    step: dv.getBigUint64(24, true),
    energy: dv.getBigUint64(32, true),
    totalSpikes: dv.getBigUint64(40, true),
    lifeSteps: dv.getBigUint64(48, true),
    lifeSpikes: dv.getBigUint64(56, true),
    bornBlock: dv.getBigUint64(64, true),
    stimUntil: dv.getBigUint64(72, true),
    posX: dv.getBigInt64(80, true),
    posY: dv.getBigInt64(88, true),
    headingHist: hist,
    // Counts rather than the arrays themselves: 155 values is a lot to print.
    nonZeroV: nonZero(128, N, 2, (o) => dv.getInt16(o, true)),
    nonZeroBias: nonZero(128 + 2 * N, N, 1, (o) => dv.getInt8(o)),
    nonZeroInp: nonZero(128 + 3 * N, N, 4, (o) => dv.getInt32(o, true)),
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
};

// ---------------------------------------------------------------- artifacts

function readArtifact(rel) {
  return new Uint8Array(readFileSync(join(PROJECT_ROOT, rel)));
}

/** The `flybrain` type script binary, stripped, from `build/release/`. */
export function flybrainBinary(mode = "release") {
  return readArtifact(join("build", mode, "flybrain"));
}

/** The `flylock` lock script binary, stripped. */
export function flylockBinary(mode = "release") {
  return readArtifact(join("build", mode, "flylock"));
}

/** The `flyworld` type script binary, stripped. */
export function flyworldBinary(mode = "release") {
  return readArtifact(join("build", mode, "flyworld"));
}

/** The 15,065-byte connectome table. */
export function circuitTable() {
  return readArtifact(join("crates", "flycircuit", "data", "circuit.bin"));
}

/** keccak256 of the connectome — the value that goes in the args, and on BSC's `circuitHash()`. */
export function circuitHash() {
  return keccak256(circuitTable());
}

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
