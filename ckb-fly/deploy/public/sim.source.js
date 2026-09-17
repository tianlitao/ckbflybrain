/**
 * The dynamics, running in the page.
 *
 * # Why a page can do this at all
 *
 * A CKB transaction has to carry the *exact* successor state, because the type script checks
 * it by recomputing it: `output.data == simulate(input.data, action)`. So whoever builds the
 * transaction must be able to run the organism. That used to mean a native process —
 * `flyplan` shells out to `flycore` and `deploy/` shells out to `flyplan` — and that is the
 * entire reason this project needed a server.
 *
 * It does not. `flycore` is `no_std`, allocation-free and has no `f64`, so it compiles to
 * `wasm32-unknown-unknown` unchanged; `crates/flywasm` is the C ABI around it, and
 * `crates/flywasm/verify.mjs` compares its output to `flyplan`'s byte for byte. Node runs V8
 * and so does every browser, so that agreement is agreement here.
 *
 * **It is the same `flycore`.** Nothing is reimplemented in JavaScript. The one thing this
 * project is organised to prevent is a second implementation of the dynamics, and the rule
 * forbids a second *implementation* — not a second *target*.
 *
 * # The ABI, and the one mistake it invites
 *
 * The module owns a static scratch pad. The caller asks where it is (`fly_scratch`), writes
 * the state and the action into it at the offsets the module also reports
 * (`fly_in_state`, `fly_in_action`), calls `fly_apply`, and reads the answer at
 * `fly_scratch + fly_out_off()`.
 *
 * Every one of those offsets is **relative to the scratch pointer**, not to the start of
 * linear memory. Reading the output at `fly_out_off()` instead of `scratch + fly_out_off()`
 * does not fail — it reads zeros and reports a state that is 1,213 bytes of nothing. That
 * mistake was made once, in `verify.mjs`, and the first version of that file was 18 failures
 * red with a wasm module that was completely correct. Hence: the offsets are asked for over
 * the ABI rather than written down here, and they are added to `scratch` in exactly one place.
 *
 * # Why a refusal is a return value and not a trap
 *
 * A trap would collapse "the fly refused this action" into "you called me wrong". Those are
 * different facts and the page has to tell them apart: the first is the organism saying no
 * and belongs on screen with its reason, the second is a bug in this file. `fly_apply`
 * returns a negative code, and `fly_last_reason` — read immediately, before anything else can
 * call in — names the refusal in the contract's own vocabulary.
 *
 * @module sim
 */

/**
 * `Params` variants, as `flywasm::params_of` numbers them.
 *
 * `v1` is the deployed mainnet set — the one the BSC differential fixture was generated with,
 * so an on-chain trajectory is directly comparable with the chain that came before. `v2` is
 * the recalibrated live set. `sim` is neither and exists for the tests.
 */
const PARAMS_KIND = { v1: 0, v2: 1, sim: 2 };

/** `Economics` variants, as `flywasm::econ_of` numbers them. */
const ECON_KIND = { testnet: 0, free: 1 };

/**
 * `flycore::ApplyError`, as `fly_last_reason` numbers it.
 *
 * These are the sentences the page shows. "The fly refused" is not one of them: an organism
 * that says no always says why, and a UI that cannot repeat the reason teaches its reader
 * that nothing they do has one.
 */
const REASON = {
  0: null,
  1: "the fly is dead",
  2: "the fly is alive, so it cannot be resurrected",
  3: "the tick was refused — either it asked for zero steps or it could not run one",
  4: "that born block is earlier than the previous life's",
  5: "the fly is dead, and feeding a corpse would burn the coins for energy it can never spend",
  6: "that asked for zero",
};

/** `flywasm`'s negative return codes, as sentences. */
const ERR = {
  [-1]: "the parameter set or the economics is not one this module knows",
  [-2]: "the state cell is not decodable — it is not a state, or not this connectome's",
  [-3]: "the action is not one the contract would accept",
  [-4]: "the fly refused the action",
  [-5]: "the successor state could not be encoded",
  [-6]: "the state or the action does not fit in the module's scratch buffer",
};

/** The header `fly_apply` writes before the state: length, reserved, then the release. */
const HEAD = 16;

/** Where a resolved name or a raw number lands. */
function kindOf(table, value, what) {
  if (typeof value === "number") {
    return value;
  }
  const kind = table[value];
  if (kind === undefined) {
    throw new Error(`unknown ${what} ${JSON.stringify(value)}; this build knows ${Object.keys(table).join(", ")}`);
  }
  return kind;
}

/**
 * The loaded module.
 *
 * One instance is enough for a page: it is stateless between calls except for the scratch pad
 * and the last reason, and a browser is single-threaded.
 */
class Sim {
  constructor(exports) {
    this.exports = exports;
    this.scratch = exports.fly_scratch();
    this.inState = exports.fly_in_state();
    this.inAction = exports.fly_in_action();
    this.out = exports.fly_out_off();
    this.scratchLen = exports.fly_scratch_len();
  }

  /**
   * Run one action and return the state the output cell must hold.
   *
   * @param {object} request
   * @param {string|number} request.params a set name (`"v1"`) or a raw kind
   * @param {string|number} request.economics likewise (`"testnet"`)
   * @param {Uint8Array} request.state the 1,213 bytes of the input cell
   * @param {Uint8Array} request.action the witness action
   * @returns {{state: Uint8Array, release: bigint}} `release` is the capacity that must leave
   *   the body, derived from the energy delta rather than from the steps requested — the same
   *   number `flyplan apply --in-capacity` reports, and the one a valid transaction has to get
   *   right.
   * @throws {Error} with a `.reason` when the fly refused, and without one when the caller did
   */
  apply({ params, economics, state, action }) {
    const paramsKind = kindOf(PARAMS_KIND, params, "parameter set");
    const econKind = kindOf(ECON_KIND, economics, "economics");
    const ex = this.exports;

    if (state.length + this.inState > this.scratchLen) {
      throw new Error(`the state is ${state.length} bytes, which does not fit in the scratch buffer`);
    }
    if (action.length + this.inAction > this.scratchLen) {
      throw new Error(`the action is ${action.length} bytes, which does not fit in the scratch buffer`);
    }

    // A fresh view every call. The buffer is only replaced if the module grows its memory,
    // which this one never does — but a cached view that has been detached reads as a
    // `TypeError` at the point of use rather than here, and this is cheaper than the comment
    // that would have to explain why the cache is safe.
    const mem = new Uint8Array(ex.memory.buffer);
    mem.set(state, this.scratch + this.inState);
    mem.set(action, this.scratch + this.inAction);

    const written = ex.fly_apply(paramsKind, econKind, state.length, action.length);
    // Read straight away. `fly_last_reason` is the second half of this one return value, not
    // a piece of state that survives the next call.
    const reason = ex.fly_last_reason();
    if (written < 0) {
      const detail = REASON[reason] ?? ERR[written] ?? `unknown code ${written}`;
      const err = new Error(
        written === -4 ? `the fly refused: ${detail}` : (ERR[written] ?? `the module returned ${written}`),
      );
      // The distinction the caller needs: `reason` is set only when the organism said no.
      err.code = written;
      err.reason = REASON[reason] ? detail : null;
      throw err;
    }

    const dv = new DataView(ex.memory.buffer);
    const stateLen = dv.getUint32(this.scratch + this.out, true);
    const release = dv.getBigInt64(this.scratch + this.out + 8, true);
    return {
      state: mem.slice(this.scratch + this.out + HEAD, this.scratch + this.out + HEAD + stateLen),
      release,
    };
  }
}

let pending = null;

/**
 * Fetch and instantiate the module. Idempotent: the page calls this from several places and
 * there is no reason to download 36 KB twice.
 *
 * @param {{url?: string|URL}} [options]
 * @returns {Promise<Sim>}
 */
export function loadSim({ url = new URL("./flywasm.wasm", import.meta.url) } = {}) {
  if (!pending) {
    pending = instantiate(url).catch((err) => {
      // Not cached: a page that failed to load the module should be able to retry, and a
      // rejected promise held forever would make every later attempt return the same failure.
      pending = null;
      throw err;
    });
  }
  return pending;
}

async function instantiate(url) {
  // `instantiateStreaming` needs the response to be `application/wasm`, and a static host that
  // does not know the type will send `application/octet-stream` and make this throw. The
  // fallback is one line and saves the page from a server configuration it cannot control.
  if (typeof WebAssembly.instantiateStreaming === "function") {
    try {
      const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
      return new Sim(instance.exports);
    } catch {
      // fall through to the buffered path
    }
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`cannot load the dynamics module: ${res.status} ${res.statusText} from ${url}`);
  }
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  return new Sim(instance.exports);
}
