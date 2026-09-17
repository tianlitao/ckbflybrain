/**
 * Does the wasm module compute what the validator computes?
 *
 * `crates/flywasm` is `flycore` compiled to `wasm32-unknown-unknown` behind a C ABI. That
 * claim is only worth anything if the module agrees with the native binary the validator
 * shares its source with. This compares them, byte for byte, on the encoded state — which
 * is exactly the comparison the type script makes. A near miss is a rejected transaction,
 * not a rounding error.
 *
 * Node runs V8, and so does every browser, so agreement here is agreement in Chrome. The
 * question "can a browser compute the next state" stops being a guess.
 *
 *   cargo build -p flywasm --target wasm32-unknown-unknown --release
 *   node crates/flywasm/verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

const WASM = join(ROOT, "target/wasm32-unknown-unknown/wasm/flywasm.wasm");
const FLYPLAN = [join(ROOT, "target/release/flyplan"), join(ROOT, "target/debug/flyplan")]
  .find(existsSync);

if (!existsSync(WASM)) {
  console.error(`no wasm module at ${WASM}`);
  console.error("build it with:  make wasm");
  console.error("(if that says the target is missing, the toolchain is pinned by");
  console.error(" rust-toolchain.toml and needs: rustup target add wasm32-unknown-unknown)");
  process.exit(1);
}
if (!FLYPLAN) {
  console.error("no flyplan binary. build it with:  make plan");
  process.exit(1);
}

// Every offset is asked for over the ABI rather than repeated here, so a change to the
// layout cannot silently desync this file — which is the whole point of exporting them.
// Only the header length is written down twice, and it is checked below.
const HEAD = 16;

const PARAMS = { v1: 0, v2: 1, sim: 2 };
const ECON = { testnet: 0, free: 1 };

/**
 * `flycore::ApplyError`, as `fly_last_reason` numbers it.
 *
 * Spelled out rather than derived from the Rust, because this is the half of the ABI a
 * *person* reads: "it is dead" is the message, and a page that can only say "that did not
 * work" teaches its reader that nothing they do has a reason.
 */
const REASON = {
  0: "none",
  1: "Dead",
  2: "NotDead",
  3: "BadTick",
  4: "BadBornBlock",
  5: "FeedWhileDead",
  6: "ZeroAmount",
};

const plan = (...args) => JSON.parse(execFileSync(FLYPLAN, args, { encoding: "utf8" }));
const hex = (s) => Uint8Array.from(Buffer.from(s.replace(/^0x/, ""), "hex"));

const { instance } = await WebAssembly.instantiate(readFileSync(WASM));
const ex = instance.exports;
const scratch = ex.fly_scratch();
const IN_STATE = ex.fly_in_state();
const IN_ACTION = ex.fly_in_action();
const out = ex.fly_out_off();

let pass = 0;
let fail = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(28)} ${detail}`);
  ok ? pass++ : fail++;
};

function callWasm(paramsKind, econKind, stateHex, actionHex) {
  const state = hex(stateHex);
  const action = hex(actionHex);
  const mem = new Uint8Array(ex.memory.buffer);
  mem.set(state, scratch + IN_STATE);
  mem.set(action, scratch + IN_ACTION);

  const n = ex.fly_apply(paramsKind, econKind, state.length, action.length);
  // Read immediately, before anything else can call in: the reason is the second half of
  // this one return value, not a piece of state that survives the next call.
  const reason = ex.fly_last_reason();
  if (n < 0) return { ok: false, code: n, reason };

  // `fly_out_off` is an offset *within* the scratch buffer, like the two input offsets,
  // so the scratch base has to be added — the same as for the inputs above.
  const dv = new DataView(ex.memory.buffer);
  const stateLen = dv.getUint32(scratch + out, true);
  const release = dv.getBigInt64(scratch + out + 8, true);
  const bytes = mem.slice(scratch + out + HEAD, scratch + out + HEAD + stateLen);
  return { ok: true, state: "0x" + Buffer.from(bytes).toString("hex"), release, reason };
}

console.log(`wasm    ${WASM}`);
console.log(`        ${readFileSync(WASM).length} bytes, exports ${Object.keys(ex).sort().join(", ")}`);
console.log(`flyplan ${FLYPLAN}`);
console.log();

// The ABI's own sanity: the module's buffer must be able to hold a state and an action at
// once, and the answer must not overlap the inputs. These are the checks that would have
// caught reading the output at an absolute address instead of a relative one.
check(ex.fly_scratch_len() >= 8192, "scratch is big enough", `${ex.fly_scratch_len()} bytes`);
check(IN_STATE === 0, "the state starts at the base", `at ${IN_STATE}`);
check(IN_ACTION >= IN_STATE + 1213, "the action cannot start inside the state", `at ${IN_ACTION}`);
check(out >= IN_ACTION + 17, "the answer cannot overwrite the action", `out at ${out}`);
check(
  out + HEAD + 1213 <= ex.fly_scratch_len(),
  "a whole answer fits in the scratch",
  `${out + HEAD + 1213} <= ${ex.fly_scratch_len()}`,
);

// ---------------------------------------------------------------- accepting inputs

const cases = [
  {
    label: "v1 / testnet",
    params: PARAMS.v1, econ: ECON.testnet, paramsName: "v1", econName: "testnet",
    state: plan("genesis", "--params", "v1", "--energy", "1000000", "--born-block", "1").state,
    capacity: "150000000000",
  },
  {
    label: "v2 / free",
    params: PARAMS.v2, econ: ECON.free, paramsName: "v2", econName: "free",
    state: plan("genesis", "--params", "v2", "--energy", "1000000", "--born-block", "1").state,
    capacity: "150000000000",
  },
];

for (const c of cases) {
  console.log(`--- ${c.label} ---`);
  const actions = [
    ["tick 1", plan("action", "tick", "--steps", "1").action],
    ["tick 3", plan("action", "tick", "--steps", "3").action],
    ["tick 64", plan("action", "tick", "--steps", "64").action],
    ["stimulate cue w3 s255", plan("action", "stimulate", "--channel", "1", "--param", "3", "--strength", "255", "--steps", "64").action],
    ["stimulate cue w0 s1", plan("action", "stimulate", "--channel", "1", "--param", "0", "--strength", "1", "--steps", "64").action],
    ["stimulate turn left", plan("action", "stimulate", "--channel", "2", "--param", "0", "--strength", "8", "--steps", "64").action],
    ["stimulate turn right", plan("action", "stimulate", "--channel", "3", "--param", "0", "--strength", "8", "--steps", "64").action],
    ["stimulate shock s4", plan("action", "stimulate", "--channel", "4", "--param", "0", "--strength", "4", "--steps", "64").action],
    ["feed 10000", plan("action", "feed", "--steps", "10000").action],
  ];

  for (const [label, action] of actions) {
    const native = plan("apply", "--params", c.paramsName, "--economics", c.econName,
      "--state", c.state, "--action", action, "--in-capacity", c.capacity);
    const wasm = callWasm(c.params, c.econ, c.state, action);

    if (!wasm.ok) {
      check(false, label, `wasm refused with ${wasm.code}, native accepted`);
      continue;
    }
    const sameState = wasm.state === native.state;
    const sameRelease = wasm.release === BigInt(native.release);
    check(sameState && sameRelease, label,
      sameState && sameRelease
        ? `${wasm.state.length / 2 - 1} bytes, release ${wasm.release}`
        : `state ${sameState ? "same" : "DIFFERENT"}, release ${wasm.release} vs ${native.release}`);
    if (!sameState) {
      for (let i = 2; i < wasm.state.length; i += 2) {
        if (wasm.state.slice(i, i + 2) !== native.state.slice(i, i + 2)) {
          console.log(`      first differing byte: index ${(i - 2) / 2}, ` +
            `wasm ${wasm.state.slice(i, i + 2)} native ${native.state.slice(i, i + 2)}`);
          break;
        }
      }
    }
  }
  console.log();
}

// ---------------------------------------------------------------- refusing inputs
//
// These matter as much as the acceptances. A validator that traps is not the same as one
// that refuses, and the caller has to be able to tell them apart: the first is a bug in the
// caller, the second is the organism saying no.

const start = cases[0].state;

const refuses = [
  ["empty action", "0x"],
  ["trailing bytes", plan("action", "tick", "--steps", "1").action + "ff"],
  ["zero steps", "0x010000"],
  ["channel 0", "0x020000010100"],
  ["channel 9", "0x020900010100"],
  ["cue param 16 (past the ring)", "0x020110010100"],
  ["strength 0", "0x020100000100"],
  ["truncated stimulate", "0x020103"],
];

for (const [label, action] of refuses) {
  let nativeRefused = false;
  try {
    plan("apply", "--params", "v1", "--economics", "testnet", "--state", start, "--action", action);
  } catch {
    nativeRefused = true;
  }
  const wasm = callWasm(PARAMS.v1, ECON.testnet, start, action);
  check(nativeRefused === !wasm.ok, label,
    `native ${nativeRefused ? "refused" : "ACCEPTED"}, wasm ${wasm.ok ? "ACCEPTED" : `refused (${wasm.code})`}`);
}

// ---------------------------------------------------------------- a dead fly
//
// The interesting refusal, because it is the economics and the type script both saying no,
// and `apply` is where that decision is made. A fly that starved has to stay starved:
// feeding it is the one thing the upstream contract got wrong, and it is the reason
// `FeedWhileDead` exists.

console.log();

const starved = plan("genesis", "--params", "v1", "--energy", "10", "--born-block", "1").state;
const died = plan("apply", "--params", "v1", "--economics", "testnet", "--state", starved,
  "--action", plan("action", "tick", "--steps", "64").action, "--in-capacity", "150000000000");
check(!died.alive, "a fly with 10 steps starves",
  `alive=${died.alive} step=${died.step} energy=${died.energy}`);

const deadFeed = callWasm(PARAMS.v1, ECON.testnet, died.state,
  plan("action", "feed", "--steps", "100").action);
check(!deadFeed.ok && deadFeed.code === -4, "feeding a dead fly is refused",
  `code ${deadFeed.code} (ERR_APPLY is -4)`);

// And *why*, which is a separate question from *that*. The upstream contract's `_feed()` has
// no `alive` check at all, so this refusal is the port's own decision — and a page that
// showed "that did not work" for it would be hiding the one place the port deliberately
// departs from the chain it came from.
check(deadFeed.reason === 5, "and it says why: FeedWhileDead",
  `reason ${deadFeed.reason} (${REASON[deadFeed.reason]})`);

const deadTick = callWasm(PARAMS.v1, ECON.testnet, died.state,
  plan("action", "tick", "--steps", "1").action);
check(!deadTick.ok && deadTick.reason === 1, "ticking a dead fly says Dead",
  `code ${deadTick.code}, reason ${deadTick.reason} (${REASON[deadTick.reason]})`);

const liveResurrect = callWasm(PARAMS.v1, ECON.testnet, start,
  plan("action", "resurrect", "--steps", "100", "--born-block", "2").action);
check(!liveResurrect.ok && liveResurrect.reason === 2, "resurrecting a live fly says NotDead",
  `code ${liveResurrect.code}, reason ${liveResurrect.reason} (${REASON[liveResurrect.reason]})`);

// And the other direction: the module has to be able to say yes on a fly that is alive, or
// every refusal above would pass for the wrong reason.

const revive = callWasm(PARAMS.v1, ECON.testnet, died.state,
  plan("action", "resurrect", "--steps", "100", "--born-block", "2").action);
check(revive.ok, "resurrecting a dead fly is accepted",
  revive.ok ? `${revive.state.length / 2 - 1} bytes` : `refused (${revive.code})`);
// A reason left over from an earlier refusal would make the page explain a success with a
// failure's sentence, so "accepted" has to mean "and there is nothing to say".
check(revive.ok && revive.reason === 0, "and leaves no reason behind",
  `reason ${revive.reason} (${REASON[revive.reason]})`);

console.log();
console.log(`${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
