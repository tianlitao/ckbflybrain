//! `flybrain` — the fruit fly, as a CKB type script.
//!
//! This script guards the fly's state cell. CKB runs a type script for the cells wearing
//! it on **both** sides of a transaction — the state cell being consumed and the state
//! cell being created — so a single run can see both and compare them. Its job is to
//! answer one question:
//!
//! > Is this output cell the exact successor of that input cell, under the action the
//! > witness declares?
//!
//! Everything else follows from taking that question literally.
//!
//! # What it checks
//!
//! 1. **One in, one out.** Exactly one input cell wears this type script, and exactly one
//!    output cell does. No input means genesis; no output is refused, so the fly can never
//!    be destroyed.
//! 2. **The lock is immutable.** `output.lock == input.lock`. Without this, whoever ticks
//!    the fly could redirect the successor to their own key and walk away with it.
//! 3. **The type script is immutable.** The output's type script must equal this one in
//!    code hash, hash type *and args*. Without this, a ticker could silently swap the
//!    dynamics parameters, point the fly at a different connectome, or reprice its life.
//! 4. **The connectome is what the args say it is.** The 15 KB circuit table arrives as a
//!    `cell_dep`; its keccak256 must equal the hash in args. The table is never taken on
//!    faith.
//! 5. **The action is legal.** The witness declares one of four actions, and
//!    `Action::decode` range-checks it against the parameters (step count, stimulus
//!    channel, strength) — the same validation the transaction builder runs, so the two
//!    cannot disagree about what is legal.
//! 6. **The state transition is exact.** Decode the input state, apply the action, encode,
//!    and compare bytes with the output. Not "the output is plausible" — identical. There
//!    is no field an operator can nudge.
//! 7. **The economics is exact.** `output.capacity == input.capacity - release`, where the
//!    release is the CKB value of the life burned plus any stimulus charge. And the output
//!    must hold at least the capacity that backs its claimed energy, so `energy` cannot be
//!    inflated for free.
//!
//! # What is deliberately absent
//!
//! * **No admin.** No owner, no pause, no upgrade path, no parameter setter. The
//!   parameters live in the args, which live in the type script hash, which is the cell's
//!   identity. To change them is to create a different fly.
//! * **No event log.** CKB has none. A rejected transaction reports one of the exit codes
//!   below; an accepted one is its own record. Off-chain history is rebuilt from the
//!   chain's cell history — which is data an indexer already has, rather than a parallel
//!   stream the contract has to emit.
//! * **No block data in the simulation.** The noise is `keccak256(step)`, so the fly's
//!   trajectory is a pure function of its state and the actions applied to it. Anyone can
//!   replay it, and `flycore`'s differential test proves the replay matches BSC mainnet.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]
#![forbid(unsafe_code)]

// `alloc` is provided by `ckb_std::entry!` in the on-chain build and by `lib.rs` in the
// host build, so it must not be declared here as well.

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use alloc::vec::Vec;

use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::*,
    high_level::{
        QueryIter, load_cell_capacity, load_cell_data, load_cell_lock, load_cell_type, load_script,
        load_witness_args,
    },
};
use flycircuit::Circuit;
use flycore::{
    action::Action,
    args::ScriptArgs,
    keccak::keccak256,
    params::Params,
    sim::Sim,
    state::{MAX_STATE_LEN, state_len},
};

/// Exit codes.
///
/// Zero means the transition is valid. CKB has no event log, so a distinct code per
/// failure is the only diagnostic a rejected transaction carries — which makes these part
/// of the contract's public interface. Keep them stable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i8)]
enum Error {
    /// The type script's args are not 89 canonical bytes.
    InvalidArgs = 1,
    /// No `cell_dep` carries a circuit table.
    MissingCircuitDep = 2,
    /// A `cell_dep` looks like a circuit table but does not hash to the declared value.
    CircuitHashMismatch = 3,
    /// A `cell_dep` hashes correctly but does not decode as a circuit table.
    CircuitMalformed = 4,
    /// Not exactly one input cell wears this type script.
    WrongInputCount = 5,
    /// Not exactly one output cell wears this type script.
    WrongOutputCount = 6,
    /// `output.lock != input.lock`.
    LockChanged = 7,
    /// The output's type script differs from this one in code hash, hash type or args.
    TypeChanged = 8,
    /// The witness paired with the state cell input is missing.
    MissingWitness = 9,
    /// The witness is not a well-formed action.
    WitnessMalformed = 10,
    /// The action is well-formed but the fly cannot perform it (dead, alive, bad steps).
    ActionRejected = 11,
    /// The input cell's data is not a decodable state.
    InputStateMalformed = 12,
    /// The state could not be re-encoded (a bug, not a caller error).
    OutputStateMalformed = 13,
    /// The output state is not the exact successor of the input state.
    TransitionMismatch = 14,
    /// `output.capacity != input.capacity - release`.
    CapacityMismatch = 15,
    /// The output cell does not hold the capacity that backs its claimed energy.
    InsufficientBacking = 16,
    /// The input cell was already under-backed, so its energy was never real.
    InputNotBacked = 17,
    /// A genesis transaction's state is not a canonical newborn fly.
    NotGenesis = 18,
}

/// The script's entry point. Returns 0 to accept, a non-zero [`Error`] to reject.
pub fn program_entry() -> i8 {
    match run() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

fn run() -> Result<(), Error> {
    // ---------------------------------------------------------------- identity
    let script = load_script().map_err(|_| Error::InvalidArgs)?;
    // `raw_data()` rather than `as_slice()`: `as_slice()` returns the molecule *encoding*
    // of the args, which for a byte vector carries a four-byte length prefix. Reading the
    // prefix as a version byte makes every transaction fail with `InvalidArgs` — a
    // mistake that costs nothing to make and is invisible until something actually runs.
    let args =
        ScriptArgs::from_bytes(script.args().raw_data().as_ref()).ok_or(Error::InvalidArgs)?;

    // ---------------------------------------------------------------- connectome
    let table: Vec<u8> = find_circuit_table(&args.circuit_hash)?;
    let circuit = Circuit::new(&table).map_err(|_| Error::CircuitMalformed)?;

    // ---------------------------------------------------------------- the pair
    //
    // These indices are positions *within the group*, not within the transaction, and every
    // later read has to use a group source to match. Mixing the two is a bug that hides
    // itself: with the fly at input 0 and output 0 the group index and the absolute index
    // are the same number, so `load_cell_lock(input_index, Source::Input)` reads the right
    // cell by accident. Put anything else first and the script starts reading the wrong
    // cell — comparing a stranger's lock, decoding a stranger's state.
    let input_index = group_cell(load_cell_data, Source::GroupInput, Error::WrongInputCount)?;
    let output_index = group_cell(load_cell_data, Source::GroupOutput, Error::WrongOutputCount)?
        .ok_or(Error::WrongOutputCount)?;

    match input_index {
        Some(i) => transition(circuit, &args, &script, i, output_index),
        None => genesis(circuit, &args, output_index),
    }
}

/// A transaction that consumes the fly and creates its successor.
fn transition(
    circuit: Circuit<'_>,
    args: &ScriptArgs,
    script: &ckb_std::ckb_types::packed::Script,
    input_index: usize,
    output_index: usize,
) -> Result<(), Error> {
    // The successor must wear the same lock, or a ticker could walk off with the fly.
    let in_lock =
        load_cell_lock(input_index, Source::GroupInput).map_err(|_| Error::LockChanged)?;
    let out_lock =
        load_cell_lock(output_index, Source::GroupOutput).map_err(|_| Error::LockChanged)?;
    if in_lock.as_slice() != out_lock.as_slice() {
        return Err(Error::LockChanged);
    }

    // ...and the same type script, which pins the dynamics, the connectome and the prices.
    let out_type = load_cell_type(output_index, Source::GroupOutput)
        .map_err(|_| Error::TypeChanged)?
        .ok_or(Error::TypeChanged)?;
    if out_type.as_slice() != script.as_slice() {
        return Err(Error::TypeChanged);
    }

    // ---------------------------------------------------------------- the state
    let in_data =
        load_cell_data(input_index, Source::GroupInput).map_err(|_| Error::InputStateMalformed)?;
    let out_data = load_cell_data(output_index, Source::GroupOutput)
        .map_err(|_| Error::OutputStateMalformed)?;

    let n = circuit.n();
    let len = state_len(n);
    if out_data.len() != len {
        return Err(Error::OutputStateMalformed);
    }

    let mut sim =
        Sim::decode(circuit, args.params, &in_data).map_err(|_| Error::InputStateMalformed)?;
    let in_energy = sim.energy;

    // Read the action before applying anything, so a malformed witness cannot leave the
    // simulation half-advanced.
    let action = read_action(&args.params)?;
    sim.apply(action, &args.economics)
        .map_err(|_| Error::ActionRejected)?;

    // The output must be *identical* to what the action produces — not merely plausible.
    let mut expected = [0u8; MAX_STATE_LEN];
    sim.encode(&mut expected[..len])
        .map_err(|_| Error::OutputStateMalformed)?;
    if expected[..len] != out_data[..] {
        return Err(Error::TransitionMismatch);
    }

    // ---------------------------------------------------------------- the economics
    let in_cap =
        load_cell_capacity(input_index, Source::GroupInput).map_err(|_| Error::CapacityMismatch)?;
    let out_cap = load_cell_capacity(output_index, Source::GroupOutput)
        .map_err(|_| Error::CapacityMismatch)?;

    // Exact, so the ticker takes precisely the value of the life it burned — no more and
    // no less — and a feeding cannot be under-paid.
    let release = args.economics.capacity_release(in_energy, sim.energy);
    let expected_cap = in_cap as i128 - release;
    if expected_cap < 0 || out_cap as i128 != expected_cap {
        return Err(Error::CapacityMismatch);
    }

    // Energy is only meaningful if it is backed. Checking the input as well as the output
    // makes the invariant local rather than inductive: a cell that lies about its energy
    // is refused the moment anyone tries to spend it.
    if out_cap < args.economics.required_capacity(sim.energy) {
        return Err(Error::InsufficientBacking);
    }
    if in_cap < args.economics.required_capacity(in_energy) {
        return Err(Error::InputNotBacked);
    }

    Ok(())
}

/// A transaction that creates a fly without consuming one: genesis.
///
/// Anyone may do this — it creates a new organism, it does not touch an existing one. The
/// state must be *exactly* a newborn: `Sim::genesis` with the energy and birth block the
/// cell claims. Nothing may be pre-baked, so a deployer cannot hand themselves a fly that
/// has already been fed, stimulated or plasticised.
fn genesis(circuit: Circuit<'_>, args: &ScriptArgs, output_index: usize) -> Result<(), Error> {
    let out_data = load_cell_data(output_index, Source::GroupOutput)
        .map_err(|_| Error::OutputStateMalformed)?;

    let n = circuit.n();
    let len = state_len(n);
    if out_data.len() != len {
        return Err(Error::OutputStateMalformed);
    }

    let claimed = Sim::decode(circuit, args.params, &out_data).map_err(|_| Error::NotGenesis)?;
    let canonical = Sim::genesis(circuit, args.params, claimed.energy, claimed.born_block);

    let mut expected = [0u8; MAX_STATE_LEN];
    canonical
        .encode(&mut expected[..len])
        .map_err(|_| Error::OutputStateMalformed)?;
    if expected[..len] != out_data[..] {
        return Err(Error::NotGenesis);
    }

    let out_cap = load_cell_capacity(output_index, Source::GroupOutput)
        .map_err(|_| Error::CapacityMismatch)?;
    if out_cap < args.economics.required_capacity(claimed.energy) {
        return Err(Error::InsufficientBacking);
    }
    Ok(())
}

/// Find the circuit table among the transaction's cell dependencies.
///
/// The search is ordered so that junk is cheap to reject: `Circuit::new` fails in O(1) on
/// a blob whose length disagrees with its own header, and the first blob that *does* look
/// like a table must be the right one — otherwise the transaction is refused rather than
/// scanning further. So a transaction cannot make this loop hash an unbounded amount of
/// data by padding its `cell_deps`.
fn find_circuit_table(declared_hash: &[u8; 32]) -> Result<Vec<u8>, Error> {
    for data in QueryIter::new(load_cell_data, Source::CellDep) {
        if Circuit::new(&data).is_err() {
            continue;
        }
        if keccak256(&data) != *declared_hash {
            return Err(Error::CircuitHashMismatch);
        }
        return Ok(data);
    }
    Err(Error::MissingCircuitDep)
}

/// The cell in `source` that wears the running script, if any.
///
/// The group is formed by CKB itself, so this really is "the cells wearing *this* type
/// script" — not a filter applied here that could be fooled. Returns `Ok(None)` for an
/// empty group and an error for more than one member.
fn group_cell<F, T>(loader: F, source: Source, err: Error) -> Result<Option<usize>, Error>
where
    F: Fn(usize, Source) -> Result<T, ckb_std::error::SysError>,
{
    let mut found = None;
    for (i, _) in QueryIter::new(loader, source).enumerate() {
        if found.is_some() {
            return Err(err);
        }
        found = Some(i);
    }
    Ok(found)
}

/// Read the action from the witness paired with the state cell input.
///
/// The action lives in `WitnessArgs.input_type`, the field CKB reserves for an input type
/// script's witness. Because the fly's lock needs no signature that field is free; a
/// transaction that also carries a signature for the state cell input puts it in the
/// sibling `lock` field of the same `WitnessArgs`, and the two coexist.
fn read_action(params: &Params) -> Result<Action, Error> {
    let witness = load_witness_args(0, Source::GroupInput).map_err(|_| Error::MissingWitness)?;
    let payload = witness.input_type().to_opt().ok_or(Error::MissingWitness)?;
    // `raw_data()`, not `as_slice()` — see the note in `run`.
    Action::decode(payload.raw_data().as_ref(), params).map_err(|_| Error::WitnessMalformed)
}
