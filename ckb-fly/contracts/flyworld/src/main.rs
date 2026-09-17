//! `flyworld` — the chronicle of one fly, kept honest by the fly itself.
//!
//! # The problem with an attestation
//!
//! `FlyWorld.sol` anchors a fly whose brain is too large to step inside a block. The brain
//! runs on an operator's machine and the contract holds the operator's **checkpoints** — a
//! hash of the whole brain state, the position, the energy, the age. Its own comment says
//! that anyone holding the published snapshot can re-run the model and verify the hash.
//!
//! They can. But the checkpoint function is `operator`-only and its body is a series of
//! assignments. There is no bond to lose, no window in which to object, and no way for a
//! disagreement to reach the chain at all. A verification nobody can compel is a promise.
//!
//! # What a type script can do that a function cannot
//!
//! A CKB type script sees the entire transaction, so a chronicle does not have to be *told*
//! what a fly is doing. It can require the fly to be **in the same transaction** and record
//! what it finds there.
//!
//! Every field of this cell is derived from the fly's own state header, the fly's own state
//! hash and the fly's own capacities on both sides of the transition — all of them present,
//! all of them already validated by `flybrain`'s type script in the same transaction. So
//! the chronicle cannot record a sighting of a fly that is not there, cannot report a death
//! that has not happened, cannot invent a generation, and cannot claim a state hash the fly
//! does not have. The worst a transaction can do is decline to update it.
//!
//! # What it deliberately does not do
//!
//! * **It holds no value.** The world cell's capacity must be identical on both sides. A
//!   chronicle is a record, not a bank, and a rule that says so is cheaper than a rule that
//!   has to reason about what happens when a record accumulates money.
//! * **It has no action in the witness.** Whether this is an opening or a sighting is
//!   structural: no input in the group means the chronicle is being opened, exactly as in
//!   `flybrain` no input means genesis. A declared action would be one more thing to get
//!   wrong without making anything checkable.
//! * **It cannot be opened late.** `open` requires the fly to be an *output* and not an
//!   input, so a chronicle can only begin in the transaction that created the fly. Its
//!   `born_step` is a claim about a birth, and the only transaction in which the chain can
//!   witness a birth is the one that performs it.
//! * **It does not solve the whole-brain problem.** See `flycore::world` for why, and for
//!   what the missing piece is.
//!
//! # The checks
//!
//! 1. **One in, one out.** Exactly one input cell wears this type script, and exactly one
//!    output does. No input means the chronicle is being opened; no output is refused, so a
//!    chronicle cannot be deleted.
//! 2. **The lock and the type script are immutable.** As in `flybrain`: without the first,
//!    whoever updates the chronicle could redirect it; without the second, they could
//!    repoint it at a different fly.
//! 3. **The chronicle is not a bank.** Its capacity does not change.
//! 4. **The fly is there.** Exactly one cell wearing the fly's type script on each side the
//!    transition needs it — both sides for a sighting, the output side only for an opening.
//! 5. **The fly's state is a state.** Its header is read strictly; a malformed cell is
//!    refused rather than recorded.
//! 6. **The record is exact.** The output chronicle must be byte-for-byte what the sighting
//!    produces. Not plausible — identical.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]
#![forbid(unsafe_code)]

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::*,
    high_level::{
        QueryIter, load_cell_capacity, load_cell_data, load_cell_lock, load_cell_type,
        load_cell_type_hash, load_script,
    },
};
use flycore::{
    keccak::keccak256,
    world::{WORLD_LEN, World, WorldArgs, read_fly},
};

/// Exit codes. Zero means the record is valid.
///
/// A rejected transaction's code is the only diagnostic CKB gives it, so these are part of
/// the contract's interface. Keep them stable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i8)]
enum Error {
    /// The type script's args are not 33 canonical bytes.
    InvalidArgs = 1,
    /// Not exactly one input cell wears this type script.
    WrongInputCount = 2,
    /// Not exactly one output cell wears this type script.
    WrongOutputCount = 3,
    /// `output.lock != input.lock`.
    LockChanged = 4,
    /// The output's type script differs from this one.
    TypeChanged = 5,
    /// The input cell's data is not a decodable chronicle.
    InputWorldMalformed = 6,
    /// The output cell's data is not a decodable chronicle.
    OutputWorldMalformed = 7,
    /// More than one cell wears the fly's type script, on a side that must have at most one.
    WrongFlyCount = 8,
    /// The fly is not present in the shape this transition requires.
    FlyMissing = 9,
    /// The fly's data is not a decodable state header.
    FlyStateMalformed = 10,
    /// The output chronicle is not the exact record of the fly in this transaction.
    SightingMismatch = 11,
    /// The chronicle's capacity changed; it is a record, not a bank.
    CapacityChanged = 12,
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
    // `raw_data()`, not `as_slice()`: the latter returns the molecule encoding, which for a
    // byte vector carries a four-byte length prefix. Reading the prefix as a version byte
    // makes every transaction fail with `InvalidArgs`.
    let args =
        WorldArgs::from_bytes(script.args().raw_data().as_ref()).ok_or(Error::InvalidArgs)?;

    // ---------------------------------------------------------------- the pair
    //
    // These indices are positions *within the group*, so every read of the chronicle itself
    // uses a group source. The fly is different: it is found by scanning all inputs or all
    // outputs, so those reads are absolute and use `Source::Input` / `Source::Output`.
    // Mixing the two is the bug that made this contract's first test fail — with the
    // chronicle at output 1 and one member in its group, `load_cell_type(0, Source::Output)`
    // read the *fly's* type script and reported `TypeChanged` about a cell that was correct.
    let input_index = group_cell(load_cell_data, Source::GroupInput, Error::WrongInputCount)?;
    let output_index = group_cell(load_cell_data, Source::GroupOutput, Error::WrongOutputCount)?
        .ok_or(Error::WrongOutputCount)?;

    // The successor must wear the same lock, or whoever updates the chronicle could walk
    // off with it.
    if let Some(i) = input_index {
        let in_lock = load_cell_lock(i, Source::GroupInput).map_err(|_| Error::LockChanged)?;
        let out_lock =
            load_cell_lock(output_index, Source::GroupOutput).map_err(|_| Error::LockChanged)?;
        if in_lock.as_slice() != out_lock.as_slice() {
            return Err(Error::LockChanged);
        }
    }

    // ...and the same type script, which pins the fly it is about.
    let out_type = load_cell_type(output_index, Source::GroupOutput)
        .map_err(|_| Error::TypeChanged)?
        .ok_or(Error::TypeChanged)?;
    if out_type.as_slice() != script.as_slice() {
        return Err(Error::TypeChanged);
    }

    // ---------------------------------------------------------------- the fly
    let out_fly = find_fly(&args.fly_type_hash, Source::Output)?;
    let out_fly_index = out_fly.ok_or(Error::FlyMissing)?;

    let fly_data =
        load_cell_data(out_fly_index, Source::Output).map_err(|_| Error::FlyStateMalformed)?;
    let fly_header = read_fly(&fly_data).map_err(|_| Error::FlyStateMalformed)?;
    let fly_capacity =
        load_cell_capacity(out_fly_index, Source::Output).map_err(|_| Error::FlyStateMalformed)?;

    // `flybrain` hashes the canonical encoding of the state, and the output cell's data *is*
    // that encoding — its type script requires it to be. So hashing the bytes here is the
    // same value the fly reports as its own `state_hash`, without decoding a single neuron.
    let fly_state_hash = keccak256(&fly_data);

    let out_data = load_cell_data(output_index, Source::GroupOutput)
        .map_err(|_| Error::OutputWorldMalformed)?;

    // ---------------------------------------------------------------- the record
    let expected = match input_index {
        // A sighting: the fly was here before and is here now, and the chronicle is the
        // exact record of the difference.
        Some(i) => {
            let in_fly_index =
                find_fly(&args.fly_type_hash, Source::Input)?.ok_or(Error::FlyMissing)?;
            let in_fly_capacity = load_cell_capacity(in_fly_index, Source::Input)
                .map_err(|_| Error::FlyStateMalformed)?;

            let in_data =
                load_cell_data(i, Source::GroupInput).map_err(|_| Error::InputWorldMalformed)?;
            let previous = World::decode(&in_data).map_err(|_| Error::InputWorldMalformed)?;

            previous.sight(&fly_header, fly_state_hash, in_fly_capacity, fly_capacity)
        }

        // An opening: the fly is being born in this transaction and nothing else may claim
        // to have known it earlier.
        None => {
            if find_fly(&args.fly_type_hash, Source::Input)?.is_some() {
                // The fly already existed. Its birth is not in this transaction, so a
                // chronicle opened here could not honestly say when it happened.
                return Err(Error::FlyMissing);
            }
            World::open(&fly_header, fly_state_hash, fly_capacity)
        }
    };

    // The chronicle must not be a bank. Checked before the record so that a transaction
    // which both moves value and lies about the fly is reported for the simpler fault.
    if let Some(i) = input_index {
        let in_capacity =
            load_cell_capacity(i, Source::GroupInput).map_err(|_| Error::CapacityChanged)?;
        let out_capacity = load_cell_capacity(output_index, Source::GroupOutput)
            .map_err(|_| Error::CapacityChanged)?;
        if in_capacity != out_capacity {
            return Err(Error::CapacityChanged);
        }
    }

    let mut buf = [0u8; WORLD_LEN];
    expected
        .encode(&mut buf)
        .map_err(|_| Error::OutputWorldMalformed)?;
    if buf[..] != out_data[..] {
        return Err(Error::SightingMismatch);
    }

    Ok(())
}

/// The cell in `source` that wears the fly's type script, if any.
///
/// The fly is identified by its **type script hash**, not by its code hash: two flies share
/// the flybrain code and differ in their args — parameters, connectome, prices — and it is
/// the args that make an organism. A code hash would let a chronicle be updated by a
/// different fly that happened to run the same code.
///
/// More than one match is an error rather than a first-match: a transaction that presents
/// two candidates is asking the chronicle to choose, and a record that has to choose is a
/// record that can be made to say the wrong thing.
fn find_fly(script_hash: &[u8; 32], source: Source) -> Result<Option<usize>, Error> {
    let mut found = None;
    // `load_cell_type_hash` already answers `Option<[u8; 32]>` — `None` for a cell with no
    // type script — so the iteration yields the answer rather than a result to unwrap.
    for (i, hash) in QueryIter::new(load_cell_type_hash, source).enumerate() {
        if hash == Some(*script_hash) {
            if found.is_some() {
                return Err(Error::WrongFlyCount);
            }
            found = Some(i);
        }
    }
    Ok(found)
}

/// The cell in `source` that wears the running script, if any.
///
/// The group is formed by CKB itself, so this really is "the cells wearing *this* type
/// script" — not a filter applied here that could be fooled. `Ok(None)` for an empty group,
/// an error for more than one member.
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
