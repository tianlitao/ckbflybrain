//! The fly's world: a chronicle of a life, kept honest by the fly itself.
//!
//! # What upstream did, and what is wrong with it
//!
//! `FlyWorld.sol` anchors a fly whose brain is far too large to step inside a block. The
//! whole brain runs on an operator's machine, and the contract holds the operator's
//! **checkpoints**: a hash of the entire brain state, the fly's position, energy and age.
//! Its own comment says anyone holding the published snapshot can re-run the model and
//! verify the hash.
//!
//! They can. But nothing *makes* them, and nothing happens if the operator lies. The
//! checkpoint function is `operator`-only and its effect is an assignment. There is no bond
//! to lose, no window in which to object, and no way for a disagreement to reach the chain.
//! Verification that nobody can compel is a promise, not a mechanism.
//!
//! # What a world cell can do on CKB that an attestation cannot
//!
//! A CKB type script sees the whole transaction. So a chronicle does not have to be *told*
//! what a fly is doing — it can be required to **look at the fly**, which must be in the
//! same transaction, and to record exactly what it finds there.
//!
//! Every field in the cell this module encodes is derived from the fly's own state and the
//! fly's own capacities, both present in the transaction. The chronicle cannot record a
//! sighting of a fly that is not there, cannot report a death that has not happened,
//! cannot invent a generation, and cannot claim a state hash the fly does not have. The
//! worst a transaction can do is decline to update the chronicle.
//!
//! That is the same move the port makes everywhere else: authority is expressed by what the
//! chain can check, not by who is allowed to speak.
//!
//! # Where this is *not* enough
//!
//! This does not solve the whole-brain problem, and it would be dishonest to imply it does.
//! For the 155-neuron circuit the fly's state is small enough to live in a cell, so there is
//! nothing to dispute: the chain can simply be asked. For a 166,700-neuron brain the state
//! would be roughly a megabyte and a step costs millions of cycles, so the operator's claim
//! is the only thing on chain — and making *that* disputable needs a window replay, which
//! needs the connectome. That data is not in the repository this port was made from, and the
//! upstream project's own first principle is that every neuron must have a real FlyWire root
//! id, so it cannot be invented.
//!
//! What is here is the part that can be built honestly: a record that is true because it was
//! checked, for a fly whose whole state is on chain. The mechanism generalises — a challenge
//! is just another transaction that has to satisfy a type script — but the generalisation is
//! waiting on data, not on design.
//!
//! # Layout
//!
//! ```text
//! args, 33 bytes
//!   0      1  version (1)
//!   1..33  32  the type script hash of the fly this world governs
//!
//! data, 128 bytes
//! off  size  field
//!   0     1  version (1)
//!   1     1  alive
//!   2     2  pad            must be 0
//!   4     4  generation
//!   8     8  born_step      the step the current life began at
//!  16     8  died_step      0 while alive
//!  24     8  step           the fly's step at the last sighting
//!  32     8  energy
//!  40     8  life_steps
//!  48     8  total_spikes
//!  56     8  capacity       the fly's capacity at the last sighting
//!  64     8  total_released capacity that has left the fly, to whoever ticked it
//!  72     8  total_added    capacity that has gone into the fly, from whoever fed it
//!  80     8  sightings
//!  88     8  pad            must be 0
//!  96    32  state_hash     keccak256 of the fly's state at the last sighting
//! ```
//!
//! The chronicle is fixed-size on purpose. A log of every sighting would be a cell that
//! grows without bound and costs its owner capacity forever; a rolling set of lifetime
//! totals plus the latest sighting answers every question a front-end actually asks, and
//! the per-transition detail is recoverable from the chain anyway — that is what the
//! indexer does.

use crate::state::{StateError, StateHeader};

/// Version of the chronicle's args and data.
pub const WORLD_VERSION: u8 = 1;

/// Encoded length of the chronicle's args.
pub const ARGS_LEN: usize = 1 + 32;

/// Encoded length of the chronicle cell.
pub const WORLD_LEN: usize = 128;

mod off {
    pub const VERSION: usize = 0;
    pub const ALIVE: usize = 1;
    pub const PAD2: usize = 2;
    pub const GENERATION: usize = 4;
    pub const BORN_STEP: usize = 8;
    pub const DIED_STEP: usize = 16;
    pub const STEP: usize = 24;
    pub const ENERGY: usize = 32;
    pub const LIFE_STEPS: usize = 40;
    pub const TOTAL_SPIKES: usize = 48;
    pub const CAPACITY: usize = 56;
    pub const TOTAL_RELEASED: usize = 64;
    pub const TOTAL_ADDED: usize = 72;
    pub const SIGHTINGS: usize = 80;
    pub const PAD88: usize = 88;
    pub const STATE_HASH: usize = 96;
}

/// Why a chronicle was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorldError {
    /// The args are not 33 canonical bytes.
    InvalidArgs,
    /// The cell is not 128 bytes, or its version, pads or `alive` flag are wrong.
    Malformed,
}

/// The immutable half of a chronicle's identity: which fly it is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorldArgs {
    /// The type script hash of the fly this world governs.
    ///
    /// A hash rather than the script itself, because comparing hashes costs nothing and the
    /// chain already computes them: `load_cell_type_hash` is a syscall.
    pub fly_type_hash: [u8; 32],
}

impl WorldArgs {
    /// Serialize to the on-chain form.
    pub fn to_bytes(&self) -> [u8; ARGS_LEN] {
        let mut b = [0u8; ARGS_LEN];
        b[0] = WORLD_VERSION;
        b[1..].copy_from_slice(&self.fly_type_hash);
        b
    }

    /// Parse the on-chain form. `None` if the length or version is wrong.
    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() != ARGS_LEN || b[0] != WORLD_VERSION {
            return None;
        }
        let mut fly_type_hash = [0u8; 32];
        fly_type_hash.copy_from_slice(&b[1..]);
        Some(Self { fly_type_hash })
    }
}

/// A chronicle: what the world knows about one fly, and nothing it was not shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct World {
    /// Mirror of the fly's alive flag at the last sighting.
    pub alive: bool,
    /// Mirror of the fly's generation.
    pub generation: u32,
    /// The step the current life began at.
    pub born_step: u64,
    /// The step the last life ended at, or 0 while alive.
    pub died_step: u64,
    /// The fly's step at the last sighting.
    pub step: u64,
    /// The fly's remaining life at the last sighting.
    pub energy: u64,
    /// The fly's `life_steps` at the last sighting.
    pub life_steps: u64,
    /// The fly's `total_spikes` at the last sighting.
    pub total_spikes: u64,
    /// The fly's capacity at the last sighting.
    pub capacity: u64,
    /// Capacity that has left the fly over its whole life — what tickers earned.
    pub total_released: u64,
    /// Capacity that has gone into the fly over its whole life — what feeders paid.
    pub total_added: u64,
    /// How many times this chronicle has been written.
    pub sightings: u64,
    /// keccak256 of the fly's state at the last sighting.
    pub state_hash: [u8; 32],
}

fn rd_u32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

fn rd_u64(b: &[u8], o: usize) -> u64 {
    let mut w = [0u8; 8];
    w.copy_from_slice(&b[o..o + 8]);
    u64::from_le_bytes(w)
}

fn wr_u32(b: &mut [u8], o: usize, v: u32) {
    b[o..o + 4].copy_from_slice(&v.to_le_bytes());
}

fn wr_u64(b: &mut [u8], o: usize, v: u64) {
    b[o..o + 8].copy_from_slice(&v.to_le_bytes());
}

impl World {
    /// Open a chronicle for a fly that has just been born.
    ///
    /// `step` comes from the fly rather than from the block, because the fly's own clock is
    /// the only one that means anything to a simulation. A block number would be a worse
    /// answer to a question nobody asked: a transaction cannot reference the block it will
    /// be mined in, so any block number it carried would be a lower bound at best.
    pub fn open(header: &StateHeader, state_hash: [u8; 32], capacity: u64) -> Self {
        Self {
            alive: header.alive,
            generation: header.generation,
            born_step: header.step,
            died_step: if header.alive { 0 } else { header.step },
            step: header.step,
            energy: header.energy,
            life_steps: header.life_steps,
            total_spikes: header.total_spikes,
            capacity,
            total_released: 0,
            total_added: 0,
            sightings: 1,
            state_hash,
        }
    }

    /// Record a sighting, returning the successor chronicle.
    ///
    /// Everything here is read out of the fly that was in the transaction: the caller
    /// supplies the fly's header, its state hash and the capacities on both sides of the
    /// transition, and nothing else. There is no field a caller can choose.
    ///
    /// The capacity accounting is the one place a judgement is made, and it is deliberately
    /// a sign test rather than a subtraction of two independent counters: whichever way the
    /// value moved, it moved by exactly the difference, so `added - released` is the fly's
    /// capacity change over its whole life, by construction.
    pub fn sight(
        &self,
        header: &StateHeader,
        state_hash: [u8; 32],
        in_capacity: u64,
        out_capacity: u64,
    ) -> Self {
        let mut next = *self;

        // A new life began if the generation moved. Otherwise, a fly that was alive and is
        // not any more has just died.
        if header.generation != self.generation {
            next.born_step = header.step;
            next.died_step = 0;
        } else if self.alive && !header.alive {
            next.died_step = header.step;
        }

        next.alive = header.alive;
        next.generation = header.generation;
        next.step = header.step;
        next.energy = header.energy;
        next.life_steps = header.life_steps;
        next.total_spikes = header.total_spikes;
        next.capacity = out_capacity;
        next.total_released = self
            .total_released
            .saturating_add(in_capacity.saturating_sub(out_capacity));
        next.total_added = self
            .total_added
            .saturating_add(out_capacity.saturating_sub(in_capacity));
        next.sightings = self.sightings.saturating_add(1);
        next.state_hash = state_hash;
        next
    }

    /// Serialize to the on-chain form.
    pub fn encode(&self, out: &mut [u8]) -> Result<(), WorldError> {
        if out.len() != WORLD_LEN {
            return Err(WorldError::Malformed);
        }
        out.fill(0);
        out[off::VERSION] = WORLD_VERSION;
        out[off::ALIVE] = u8::from(self.alive);
        wr_u32(out, off::GENERATION, self.generation);
        wr_u64(out, off::BORN_STEP, self.born_step);
        wr_u64(out, off::DIED_STEP, self.died_step);
        wr_u64(out, off::STEP, self.step);
        wr_u64(out, off::ENERGY, self.energy);
        wr_u64(out, off::LIFE_STEPS, self.life_steps);
        wr_u64(out, off::TOTAL_SPIKES, self.total_spikes);
        wr_u64(out, off::CAPACITY, self.capacity);
        wr_u64(out, off::TOTAL_RELEASED, self.total_released);
        wr_u64(out, off::TOTAL_ADDED, self.total_added);
        wr_u64(out, off::SIGHTINGS, self.sightings);
        out[off::STATE_HASH..off::STATE_HASH + 32].copy_from_slice(&self.state_hash);
        Ok(())
    }

    /// Parse the on-chain form. Strict about the version, the pads and the `alive` flag, so
    /// two byte strings cannot both claim to be the same chronicle.
    pub fn decode(b: &[u8]) -> Result<Self, WorldError> {
        if b.len() != WORLD_LEN {
            return Err(WorldError::Malformed);
        }
        if b[off::VERSION] != WORLD_VERSION {
            return Err(WorldError::Malformed);
        }
        let alive = match b[off::ALIVE] {
            0 => false,
            1 => true,
            _ => return Err(WorldError::Malformed),
        };
        if b[off::PAD2] != 0 || b[off::PAD2 + 1] != 0 || b[off::PAD88] != 0 {
            return Err(WorldError::Malformed);
        }
        let mut state_hash = [0u8; 32];
        state_hash.copy_from_slice(&b[off::STATE_HASH..off::STATE_HASH + 32]);
        Ok(Self {
            alive,
            generation: rd_u32(b, off::GENERATION),
            born_step: rd_u64(b, off::BORN_STEP),
            died_step: rd_u64(b, off::DIED_STEP),
            step: rd_u64(b, off::STEP),
            energy: rd_u64(b, off::ENERGY),
            life_steps: rd_u64(b, off::LIFE_STEPS),
            total_spikes: rd_u64(b, off::TOTAL_SPIKES),
            capacity: rd_u64(b, off::CAPACITY),
            total_released: rd_u64(b, off::TOTAL_RELEASED),
            total_added: rd_u64(b, off::TOTAL_ADDED),
            sightings: rd_u64(b, off::SIGHTINGS),
            state_hash,
        })
    }

    /// The net capacity the fly has gained over its whole life.
    ///
    /// Positive means people have fed it more than tickers have taken; negative means the
    /// opposite. Either is meaningful, which is why it is a derived accessor rather than a
    /// stored field.
    pub fn net_capacity(&self) -> i128 {
        self.total_added as i128 - self.total_released as i128
    }
}

/// Read a fly's header out of a state cell, for a caller that has no connectome.
pub fn read_fly(data: &[u8]) -> Result<StateHeader, StateError> {
    StateHeader::read(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::Params;
    use crate::sim::Sim;
    use crate::state::state_len;
    use flycircuit::embedded;

    fn header(step: u64, energy: u64, alive: bool, generation: u32) -> StateHeader {
        let mut sim = Sim::genesis(embedded(), Params::V1_DEPLOYED, energy, 0);
        sim.step = step;
        sim.generation = generation;
        sim.alive = alive;
        sim.life_steps = step;
        let mut buf = vec![0u8; state_len(155)];
        sim.encode(&mut buf).unwrap();
        StateHeader::read(&buf).unwrap()
    }

    #[test]
    fn args_round_trip_and_are_33_bytes() {
        let a = WorldArgs {
            fly_type_hash: [7u8; 32],
        };
        let b = a.to_bytes();
        assert_eq!(b.len(), ARGS_LEN);
        assert_eq!(ARGS_LEN, 33);
        assert_eq!(WorldArgs::from_bytes(&b), Some(a));
        assert_eq!(WorldArgs::from_bytes(&b[..32]), None, "short");
        let mut long = b.to_vec();
        long.push(0);
        assert_eq!(WorldArgs::from_bytes(&long), None, "long");
        let mut wrong_version = b;
        wrong_version[0] = 2;
        assert_eq!(WorldArgs::from_bytes(&wrong_version), None, "version");
    }

    #[test]
    fn chronicle_round_trips_and_is_canonical() {
        let w = World::open(
            &header(0, 1_000_000, true, 0),
            [9u8; 32],
            1_600 * 100_000_000,
        );
        let mut a = vec![0xAAu8; WORLD_LEN];
        let mut b = vec![0u8; WORLD_LEN];
        w.encode(&mut a).unwrap();
        w.encode(&mut b).unwrap();
        assert_eq!(a, b);
        assert_eq!(a[2], 0, "pad");
        assert_eq!(a[3], 0, "pad");
        assert_eq!(a[88], 0, "pad");
        assert_eq!(World::decode(&a).unwrap(), w);
    }

    #[test]
    fn a_chronicle_rejects_malformed_bytes() {
        let good = {
            let w = World::open(&header(0, 10, true, 0), [0u8; 32], 100);
            let mut b = vec![0u8; WORLD_LEN];
            w.encode(&mut b).unwrap();
            b
        };
        assert_eq!(
            World::decode(&good[..127]),
            Err(WorldError::Malformed),
            "short"
        );
        let mut long = good.clone();
        long.push(0);
        assert_eq!(World::decode(&long), Err(WorldError::Malformed), "long");
        let mut v = good.clone();
        v[0] = 9;
        assert_eq!(World::decode(&v), Err(WorldError::Malformed), "version");
        let mut alive = good.clone();
        alive[1] = 7;
        assert_eq!(World::decode(&alive), Err(WorldError::Malformed), "alive");
        for pad in [2, 3, 88] {
            let mut p = good.clone();
            p[pad] = 1;
            assert_eq!(World::decode(&p), Err(WorldError::Malformed), "pad {pad}");
        }
    }

    #[test]
    fn opening_records_the_newborn() {
        let h = header(0, 1_000_000, true, 0);
        let w = World::open(&h, [3u8; 32], 1_600);
        assert!(w.alive);
        assert_eq!(w.generation, 0);
        assert_eq!(w.born_step, 0);
        assert_eq!(w.died_step, 0);
        assert_eq!(w.energy, 1_000_000);
        assert_eq!(w.capacity, 1_600);
        assert_eq!(w.sightings, 1);
        assert_eq!(w.total_added, 0);
        assert_eq!(w.total_released, 0);
    }

    #[test]
    fn ticking_moves_value_out_and_feeding_moves_it_in() {
        let mut w = World::open(&header(0, 1_000, true, 0), [0u8; 32], 1_000_000);

        // A tick releases capacity: 64 steps at 10,000 shannons.
        w = w.sight(
            &header(64, 936, true, 0),
            [1u8; 32],
            1_000_000,
            1_000_000 - 640_000,
        );
        assert_eq!(w.total_released, 640_000);
        assert_eq!(w.total_added, 0);
        assert_eq!(w.capacity, 360_000);
        assert_eq!(w.sightings, 2);
        assert_eq!(w.net_capacity(), -640_000);

        // A feed adds capacity.
        w = w.sight(
            &header(64, 10_936, true, 0),
            [2u8; 32],
            360_000,
            360_000 + 100_000_000,
        );
        assert_eq!(w.total_added, 100_000_000);
        assert_eq!(w.total_released, 640_000);
        assert_eq!(w.net_capacity(), 100_000_000 - 640_000);
    }

    #[test]
    fn dying_and_resurrecting_moves_the_marks() {
        let mut w = World::open(&header(0, 10, true, 0), [0u8; 32], 100);

        // It dies at step 10.
        w = w.sight(&header(10, 0, false, 0), [1u8; 32], 100, 0);
        assert!(!w.alive);
        assert_eq!(w.died_step, 10, "the step the life ended at");
        assert_eq!(w.born_step, 0, "the birth of the life that ended");

        // Nothing happens while it is dead: a second sighting must not move died_step.
        w = w.sight(&header(10, 0, false, 0), [2u8; 32], 0, 0);
        assert_eq!(w.died_step, 10);
        assert_eq!(w.born_step, 0);

        // A resurrection is a new life: generation moves, so the marks reset.
        w = w.sight(&header(10, 5_000, true, 1), [3u8; 32], 0, 50_000_000);
        assert!(w.alive);
        assert_eq!(w.generation, 1);
        assert_eq!(
            w.born_step, 10,
            "this life began where the last one stopped"
        );
        assert_eq!(w.died_step, 0, "and it has not died yet");
        assert_eq!(w.total_added, 50_000_000, "the resurrection was paid for");
    }

    #[test]
    fn a_sighting_is_monotone_in_the_things_that_cannot_go_backwards() {
        // Sightings, spikes and steps only ever move forward in a fly's life, so the
        // chronicle inherits that. Not a check the contract makes — a property of the
        // state machine that the chronicle faithfully records.
        let mut w = World::open(&header(0, 1_000, true, 0), [0u8; 32], 1);
        for step in [16u64, 32, 48, 64] {
            w = w.sight(&header(step, 1_000 - step, true, 0), [0u8; 32], 1, 1);
        }
        assert_eq!(w.step, 64);
        assert_eq!(w.sightings, 5);
    }

    #[test]
    fn a_header_is_read_without_a_connectome() {
        let mut sim = Sim::genesis(embedded(), Params::V2, 777, 42);
        sim.step = 123;
        sim.total_spikes = 9_999;
        sim.life_steps = 100;
        sim.life_spikes = 55;
        let mut buf = vec![0u8; state_len(155)];
        sim.encode(&mut buf).unwrap();

        let h = read_fly(&buf).unwrap();
        assert_eq!(h.n, 155);
        assert!(h.alive);
        assert_eq!(h.step, 123);
        assert_eq!(h.energy, 777);
        assert_eq!(h.total_spikes, 9_999);
        assert_eq!(h.life_steps, 100);
        assert_eq!(h.life_spikes, 55);
        assert_eq!(h.born_block, 42);
    }

    #[test]
    fn a_header_rejects_a_cell_that_is_not_a_state() {
        let good = {
            let sim = Sim::genesis(embedded(), Params::V1_DEPLOYED, 10, 0);
            let mut b = vec![0u8; state_len(155)];
            sim.encode(&mut b).unwrap();
            b
        };
        assert_eq!(read_fly(&[]), Err(StateError::Truncated));
        let mut v = good.clone();
        v[0] = 9;
        assert_eq!(read_fly(&v), Err(StateError::BadVersion(9)));
        let mut pad = good.clone();
        pad[5] = 1;
        assert_eq!(read_fly(&pad), Err(StateError::BadField("pad")));
        let mut n = good.clone();
        n[1] = 154; // a length that disagrees with the count it claims
        assert_eq!(read_fly(&n), Err(StateError::Truncated));
        let mut zero = good;
        zero[1] = 0;
        assert_eq!(read_fly(&zero), Err(StateError::BadField("n")));
    }
}
