//! The organism, compiled to wasm.
//!
//! # Why this exists
//!
//! A CKB transaction has to carry the *exact* successor state, and the type script checks
//! it by recomputing it: `output.data == simulate(input.data, action)`. So whoever builds
//! the transaction must be able to run the dynamics. Until now that meant a native
//! process — `flyplan` shells out to `flycore`, and `deploy/` shells out to `flyplan` —
//! which is the whole reason the public page needs a server rather than a bucket.
//!
//! It does not have to. `flycore` is `no_std`, allocation-free and has no `f64`, so it
//! compiles to `wasm32-unknown-unknown` unchanged. This crate is the C ABI around it: a
//! scratch pad the caller writes into, one function that takes a state and an action and
//! writes the successor state, and one that says why it refused.
//!
//! **It is the same `flycore`.** Nothing is reimplemented, so this does not become a
//! second source of truth — which is the one thing the whole port is organised to avoid.
//! `crates/flycore` is already built for two targets (riscv64imac for the validator,
//! aarch64 for the host tools); this is a third.
//!
//! # Building
//!
//! ```text
//! make wasm                      # cargo build -p flywasm --target wasm32-unknown-unknown --profile wasm
//! node crates/flywasm/verify.mjs
//! ```
//!
//! The result is 36 KB — about 1% of the 2.9 MB `deploy/public/app.js` the page already
//! ships. The `wasm` profile exists only to drop the release profile's debug info, which
//! the contracts want and a browser does not: with it the same module is 777 KB. Same
//! optimisation level, same `overflow-checks`.
//!
//! # Checking it
//!
//! `verify.mjs` in this directory loads the module in Node and compares its output to
//! `flyplan`'s, byte for byte, on both accepting and refusing inputs.
//!
//! Node runs V8 and so does every browser, so agreement there is agreement in Chrome.
//!
//! # Why the panic handler is gated on `target_arch`
//!
//! A `no_std` build needs a `#[panic_handler]`; a `std` build must not have one, because
//! `std` already provides it. Gating on the target rather than on a feature keeps this
//! crate a normal workspace member, which is what makes it inherit
//! `[profile.release] overflow-checks = true` from the workspace root. That setting is
//! load-bearing: it is the difference between a panic and a silent wraparound, and a
//! panic in a CKB validator is a rejected transaction. A wasm build that wrapped where
//! the chain panicked would agree on every state except the ones that matter.

#![cfg_attr(target_arch = "wasm32", no_std)]

use core::cell::UnsafeCell;

use flycircuit::embedded;
use flycore::action::Action;
use flycore::economics::Economics;
use flycore::params::Params;
use flycore::sim::Sim;
use flycore::state::{MAX_STATE_LEN, state_len};

/// A panic in a wasm module can only be a trap. There is nothing to unwind to, nowhere to
/// print, and no way to hand back a half-updated state. On the host `std` owns this.
#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// ------------------------------------------------------------------ the scratch pad

const SCRATCH_LEN: usize = 8192;
const IN_STATE: usize = 0;
const IN_ACTION: usize = 2048;
const OUT: usize = 4096;

/// One static buffer for both directions, so the caller never has to guess where the
/// module's data segment ends. Growing the memory to find room is not safe here: the Rust
/// stack lives at the top of linear memory, so freshly grown pages land inside it.
struct Scratch(UnsafeCell<[u8; SCRATCH_LEN]>);
// SAFETY: wasm is single-threaded and one call is in flight at a time. The aliasing the
// compiler has to be told about is real but confined to `fly_apply`'s unsafe blocks.
unsafe impl Sync for Scratch {}

static SCRATCH: Scratch = Scratch(UnsafeCell::new([0u8; SCRATCH_LEN]));

/// Where the caller writes the state and the action, and reads the answer.
#[unsafe(no_mangle)]
pub extern "C" fn fly_scratch() -> *mut u8 {
    SCRATCH.0.get() as *mut u8
}

#[unsafe(no_mangle)]
pub extern "C" fn fly_scratch_len() -> u32 {
    SCRATCH_LEN as u32
}

/// Where the state goes, **relative to the pointer `fly_scratch` returns**.
#[unsafe(no_mangle)]
pub extern "C" fn fly_in_state() -> u32 {
    IN_STATE as u32
}

/// Where the action goes, on the same convention.
#[unsafe(no_mangle)]
pub extern "C" fn fly_in_action() -> u32 {
    IN_ACTION as u32
}

/// Where the answer starts, **relative to the pointer `fly_scratch` returns** — the same
/// convention as the two input offsets. The caller reads the header at `scratch + this` and
/// the state at `scratch + this + 16`. Asking over the ABI keeps the output layout owned by
/// this file rather than duplicated in every caller.
#[unsafe(no_mangle)]
pub extern "C" fn fly_out_off() -> u32 {
    OUT as u32
}

// ------------------------------------------------------------------ why it refused

/// The reason the last `fly_apply` refused, as a code from [`apply_reason`].
///
/// `fly_apply` reports *that* the fly refused; this reports *why*, and they are separate
/// because they are separate jobs. One is an error the caller has to handle, the other is a
/// sentence a reader has to be shown: "it is dead" and "that did not work" are not the same
/// message, and a page that can only say the second one teaches its reader that nothing they
/// do has a reason. That is the opposite of what this project is about — the fly is a real
/// organism with real refusals, and they are all named in `flycore::ApplyError`.
///
/// Read it immediately after a `fly_apply` that returned `ERR_APPLY`. Any other call
/// overwrites it, including a successful one, so it is a return value in two halves rather
/// than a piece of state.
struct LastReason(UnsafeCell<u32>);
// SAFETY: as `Scratch` — wasm is single-threaded and one call is in flight at a time.
unsafe impl Sync for LastReason {}

static LAST_REASON: LastReason = LastReason(UnsafeCell::new(0));

/// The `ApplyError` variant from the last refusal, or 0 if nothing was refused.
///
/// The numbers are written out rather than derived from the enum's order. An ABI that moves
/// when someone reorders a match arm is an ABI that breaks silently, and this one is read by
/// a browser that has no way to notice.
fn apply_reason(err: flycore::ApplyError) -> u32 {
    match err {
        flycore::ApplyError::Dead => 1,
        flycore::ApplyError::NotDead => 2,
        flycore::ApplyError::BadTick => 3,
        flycore::ApplyError::BadBornBlock => 4,
        flycore::ApplyError::FeedWhileDead => 5,
        flycore::ApplyError::ZeroAmount => 6,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn fly_last_reason() -> u32 {
    // SAFETY: single-threaded, and this is a plain read of a static the module owns.
    unsafe { *LAST_REASON.0.get() }
}

// ------------------------------------------------------------------ the one function

const ERR_PARAMS: i32 = -1;
const ERR_STATE: i32 = -2;
const ERR_ACTION: i32 = -3;
const ERR_APPLY: i32 = -4;
const ERR_ENCODE: i32 = -5;
const ERR_TOO_LONG: i32 = -6;

/// Layout of the answer, written at `OUT`:
///
/// | offset | meaning |
/// |---|---|
/// | 0..4   | state length, u32 little-endian |
/// | 4..8   | reserved, zero |
/// | 8..16  | capacity release, i64 little-endian |
/// | 16..   | the successor state |
const HEAD: usize = 16;

fn params_of(kind: u32) -> Option<Params> {
    match kind {
        0 => Some(Params::V1_DEPLOYED),
        1 => Some(Params::V2),
        2 => Some(Params::SIM_DEFAULTS),
        _ => None,
    }
}

fn econ_of(kind: u32) -> Option<Economics> {
    match kind {
        0 => Some(Economics::TESTNET),
        1 => Some(Economics::FREE),
        _ => None,
    }
}

/// Compute the successor state.
///
/// Returns the number of bytes written at `OUT`, or a negative error code. The caller
/// must have written `state_len_in` bytes at `IN_STATE` and `action_len` bytes at
/// `IN_ACTION`.
///
/// A refusal is a negative return, never a trap: the caller has to be able to tell "the
/// fly refused this action" (`ERR_ACTION`, `ERR_APPLY`) from "you called me wrong"
/// (`ERR_PARAMS`, `ERR_STATE`, `ERR_TOO_LONG`). A trap would collapse the two.
#[unsafe(no_mangle)]
pub extern "C" fn fly_apply(
    params_kind: u32,
    econ_kind: u32,
    state_len_in: u32,
    action_len: u32,
) -> i32 {
    let (Some(params), Some(econ)) = (params_of(params_kind), econ_of(econ_kind)) else {
        return ERR_PARAMS;
    };
    if state_len_in as usize > IN_ACTION || action_len as usize > OUT - IN_ACTION {
        return ERR_TOO_LONG;
    }
    // Cleared up front so that a caller which reads the reason after a *successful* call gets
    // "nothing", rather than the reason from whichever call happened to fail last.
    // SAFETY: single-threaded; see `LastReason`.
    unsafe { *LAST_REASON.0.get() = 0 };

    let scratch = SCRATCH.0.get() as *mut u8;
    // SAFETY: single-threaded, one call at a time, and the caller wrote the two inputs
    // into the region it was handed by `fly_scratch`. Nothing else aliases them.
    let (state, action_bytes) = unsafe {
        (
            core::slice::from_raw_parts(scratch.add(IN_STATE) as *const u8, state_len_in as usize),
            core::slice::from_raw_parts(scratch.add(IN_ACTION) as *const u8, action_len as usize),
        )
    };

    let Ok(mut sim) = Sim::decode(embedded(), params, state) else {
        return ERR_STATE;
    };
    let in_energy = sim.energy;

    let Ok(action) = Action::decode(action_bytes, &params) else {
        return ERR_ACTION;
    };
    if let Err(err) = sim.apply(action, &econ) {
        // SAFETY: single-threaded; see `LastReason`.
        unsafe { *LAST_REASON.0.get() = apply_reason(err) };
        return ERR_APPLY;
    }

    let n = state_len(sim.circuit.n());
    if HEAD + n > SCRATCH_LEN - OUT {
        return ERR_TOO_LONG;
    }

    let mut buf = [0u8; MAX_STATE_LEN];
    if sim.encode(&mut buf[..n]).is_err() {
        return ERR_ENCODE;
    }

    // Derived from the energy delta, not from the steps requested — the same way
    // `flyplan apply --in-capacity` reports it.
    let release = econ.capacity_release(in_energy, sim.energy);

    // SAFETY: as above. `OUT` is a distinct region of the same static buffer, and
    // `HEAD + n <= OUT - IN_ACTION` was checked.
    let out = unsafe { core::slice::from_raw_parts_mut(scratch.add(OUT) as *mut u8, HEAD + n) };
    out[0..4].copy_from_slice(&(n as u32).to_le_bytes());
    out[4..8].copy_from_slice(&0u32.to_le_bytes());
    out[8..16].copy_from_slice(&(release as i64).to_le_bytes());
    out[HEAD..].copy_from_slice(&buf[..n]);

    (HEAD + n) as i32
}
