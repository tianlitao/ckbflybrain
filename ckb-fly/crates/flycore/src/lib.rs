//! `flycore` — the organism.
//!
//! A `no_std`, allocation-free, bit-exact port of `FlyBrain.sol`'s spiking simulation:
//! the *Drosophila* head-direction ring attractor (155 neurons, 6,522 connections,
//! 45,961 synapses from FlyWire release 783) run as integer leaky-integrate-and-fire
//! neurons with a per-neuron engram.
//!
//! # Layout
//!
//! | module | responsibility |
//! |---|---|
//! | [`keccak`] | Keccak-256, the noise source and the circuit commitment |
//! | [`params`] | the 12 numbers that determine the dynamics, and their encoding |
//! | [`sim`] | the simulation itself: `step`, `tick`, plasticity, walking |
//! | [`state`] | the state cell byte layout, and how wide values narrow on write |
//! | [`action`] | what a transaction asks the fly to do, and how it is witnessed |
//! | [`apply`] | applying an action — the function the on-chain validator runs |
//! | [`economics`] | what a step of life costs, in CKB, and why there is no token |
//! | [`args`] | what lives in the type script's args |
//!
//! # Design constraints
//!
//! * **`no_std`, no allocator.** The hot loop runs 155 neurons x up to 64 steps per
//!   transaction, so the neuron arrays are fixed-size ([`sim::MAX_N`]) and live on the
//!   stack. Nothing in the tick path allocates.
//! * **Overflow checks stay on.** The release profile sets `overflow-checks = true`.
//!   In a CKB validator a panic is a failed transaction, so silent wraparound would be
//!   strictly worse than a loud failure. Every product is widened rather than wrapped.
//! * **No `f64`.** All arithmetic is integer, so host and chain agree exactly.
//!
//! # Validation
//!
//! `tests/differential.rs` replays the exact sequence that ran on BSC mainnet through
//! FlyBrain v1 (`0x32D28e97b50f5978eb51d7608492CC7221b01f63`) and asserts the spike
//! counts, head vectors and — neuron by neuron — the whole final state that the chain
//! recorded. If the port ever drifts, that test fails before anything reaches a network.

#![cfg_attr(not(test), no_std)]
#![forbid(unsafe_code)]

pub mod action;
pub mod apply;
pub mod args;
pub mod economics;
pub mod keccak;
pub mod params;
pub mod sim;
pub mod state;
pub mod world;

pub use action::{Action, ActionError, MAX_ACTION_LEN, MIN_ACTION_LEN};
pub use apply::ApplyError;
pub use args::{ARGS_LEN, ScriptArgs};
pub use economics::{ECONOMICS_LEN, Economics, SHANNONS_PER_CKB};
pub use params::{PARAMS_LEN, Params};
pub use sim::{
    BIAS_MAX, CH_CUE, CH_NONE, CH_SHOCK, CH_TURN_LEFT, CH_TURN_RIGHT, COS16, MAX_N, SIN16, STRIDE,
    Sim, TickResult, div_trunc, isqrt,
};
pub use state::{
    HEADER as STATE_HEADER, MAX_STATE_LEN, StateError, StateHeader, VERSION as STATE_VERSION,
    state_len,
};
pub use world::{World, WorldArgs, WorldError};

/// The connectome decoder, re-exported so downstream crates need only one dependency.
pub use flycircuit;
