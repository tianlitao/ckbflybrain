//! The state cell layout.
//!
//! On the EVM the brain's state was ~40 storage slots updated in place. On CKB a cell
//! is immutable: a tick consumes the state cell and creates a new one. That makes the
//! serialization format part of the protocol — an old client must be able to read a new
//! cell, so the layout is versioned and fixed-width.
//!
//! # Layout
//!
//! All integers are little-endian. Offsets after the header depend on `n`, the neuron
//! count, which is stored in the header and must equal the circuit table's `N`.
//!
//! ```text
//! off   size  field
//!   0      1  version (1)
//!   1      1  n            neuron count, == circuit.N
//!   2      1  alive        0 | 1
//!   3      1  stim_channel  0..=4
//!   4      1  stim_param
//!   5      1  pad          must be 0
//!   6      2  stim_strength
//!   8      4  generation
//!  12      4  head_x        i32
//!  16      4  head_y        i32
//!  20      4  pad          must be 0
//!  24      8  step
//!  32      8  energy
//!  40      8  total_spikes
//!  48      8  life_steps
//!  56      8  life_spikes
//!  64      8  born_block
//!  72      8  stim_until_step
//!  80      8  pos_x         i64
//!  88      8  pos_y         i64
//!  96     32  heading_hist  16 x u16
//! 128    2n  v             155 x i16   (clamped from the i64 used in flight)
//! 128+2n   n  bias          155 x i8
//! 128+3n 4n  inp           155 x i32   (truncated from the i64 used in flight)
//! ```
//!
//! Total = `128 + 7n` bytes; 1,213 bytes for the 155-neuron ring attractor.
//!
//! # Why `inp` is stored even when `persist_input` is false
//!
//! v1 dropped pending input at every tick boundary and never wrote the `_inp` storage
//! slots, so they stayed at their constructor value of zero. Writing zeros is
//! therefore byte-identical to v1's behaviour, and keeping the field means one decoder
//! serves both parameter sets.

use flycircuit::WEDGES;

use crate::params::Params;
use crate::sim::{MAX_N, Sim};

/// State cell format version.
pub const VERSION: u8 = 1;

/// Errors from decoding a state cell.
///
/// Every variant is a reason to reject the transaction rather than guess: a validator
/// that tolerates a malformed cell hands the next tick a different fly than the one the
/// previous tick left behind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateError {
    /// Cell data is shorter than the header, or shorter than `state_len(n)`.
    Truncated,
    /// Byte 0 is not [`VERSION`].
    BadVersion(u8),
    /// The cell's neuron count disagrees with the circuit table's.
    NeuronCountMismatch { state: u8, circuit: u8 },
    /// A field holds a value the simulation cannot represent (e.g. `alive` not 0/1).
    BadField(&'static str),
}

/// Fixed-size header length.
pub const HEADER: usize = 128;

/// The part of a state cell that anything other than the simulation itself needs.
///
/// A validator that only wants to know how a fly is doing should not have to decode 155
/// neurons to find out, and — more to the point — should not need the connectome to do it.
/// The connectome arrives as a 15 KB `cell_dep`, which is a fine price for the script that
/// *runs* the fly and a silly one for a script that only wants to know whether it is alive.
///
/// So this reads the header and stops. It validates everything the header can be checked
/// against on its own — the version, the two pad bytes, the neuron count against the length
/// it implies, and the stimulus channel — but it cannot check `n` against a circuit, because
/// it has none. Callers that care must make that check themselves, and `flybrain` does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StateHeader {
    /// Neuron count, as recorded in the cell.
    pub n: u8,
    /// Whether the fly is alive. Only `resurrect` clears this.
    pub alive: bool,
    /// 0 for the genesis life, +1 per resurrection.
    pub generation: u32,
    /// Simulation steps since genesis.
    pub step: u64,
    /// Steps of life remaining.
    pub energy: u64,
    /// Steps lived in the current life.
    pub life_steps: u64,
    /// Spikes fired in the current life.
    pub life_spikes: u64,
    /// Spikes fired since genesis.
    pub total_spikes: u64,
    /// Block this life began at.
    pub born_block: u64,
    /// Active stimulus channel, or 0 for none.
    pub stim_channel: u8,
}

impl StateHeader {
    /// Read the header, rejecting anything that is not a canonical state.
    ///
    /// Strictness here matters more than it looks: the world cell records what it reads,
    /// so a header that two different byte strings could both claim to be would let a
    /// chronicle record a sighting of a fly that does not exist.
    pub fn read(data: &[u8]) -> Result<Self, StateError> {
        if data.len() < HEADER {
            return Err(StateError::Truncated);
        }
        if data[off::VERSION] != VERSION {
            return Err(StateError::BadVersion(data[off::VERSION]));
        }
        let n = data[off::N];
        if n == 0 {
            return Err(StateError::BadField("n"));
        }
        if data.len() != state_len(n as usize) {
            return Err(StateError::Truncated);
        }
        match data[off::ALIVE] {
            0 | 1 => {}
            _ => return Err(StateError::BadField("alive")),
        }
        if data[off::PAD5] != 0 || data[off::PAD20] != 0 {
            return Err(StateError::BadField("pad"));
        }
        if data[off::STIM_CHANNEL] > crate::sim::CH_SHOCK {
            return Err(StateError::BadField("stim_channel"));
        }
        Ok(Self {
            n,
            alive: data[off::ALIVE] == 1,
            generation: rd_u32(data, off::GENERATION),
            step: rd_u64(data, off::STEP),
            energy: rd_u64(data, off::ENERGY),
            life_steps: rd_u64(data, off::LIFE_STEPS),
            life_spikes: rd_u64(data, off::LIFE_SPIKES),
            total_spikes: rd_u64(data, off::TOTAL_SPIKES),
            born_block: rd_u64(data, off::BORN_BLOCK),
            stim_channel: data[off::STIM_CHANNEL],
        })
    }
}

/// Byte length of the state cell data for `n` neurons.
#[inline]
pub const fn state_len(n: usize) -> usize {
    HEADER + 7 * n
}

/// Byte length of the state cell data for the largest supported circuit.
pub const MAX_STATE_LEN: usize = state_len(MAX_N);

mod off {
    pub const VERSION: usize = 0;
    pub const N: usize = 1;
    pub const ALIVE: usize = 2;
    pub const STIM_CHANNEL: usize = 3;
    pub const STIM_PARAM: usize = 4;
    pub const PAD5: usize = 5;
    pub const STIM_STRENGTH: usize = 6;
    pub const GENERATION: usize = 8;
    pub const HEAD_X: usize = 12;
    pub const HEAD_Y: usize = 16;
    pub const PAD20: usize = 20;
    pub const STEP: usize = 24;
    pub const ENERGY: usize = 32;
    pub const TOTAL_SPIKES: usize = 40;
    pub const LIFE_STEPS: usize = 48;
    pub const LIFE_SPIKES: usize = 56;
    pub const BORN_BLOCK: usize = 64;
    pub const STIM_UNTIL: usize = 72;
    pub const POS_X: usize = 80;
    pub const POS_Y: usize = 88;
    pub const HEADING_HIST: usize = 96;
    pub const V: usize = 128;
}

/// Byte offset of `v` for a circuit with `n` neurons.
#[inline]
pub const fn off_v(_n: usize) -> usize {
    off::V
}

/// Byte offset of `bias` for a circuit with `n` neurons.
#[inline]
pub const fn off_bias(n: usize) -> usize {
    off_v(n) + 2 * n
}

/// Byte offset of `inp` for a circuit with `n` neurons.
#[inline]
pub const fn off_inp(n: usize) -> usize {
    off_bias(n) + n
}

#[inline]
fn rd_u16(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}

#[inline]
fn rd_i16(b: &[u8], o: usize) -> i16 {
    i16::from_le_bytes([b[o], b[o + 1]])
}

#[inline]
fn rd_u32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

#[inline]
fn rd_i32(b: &[u8], o: usize) -> i32 {
    i32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

#[inline]
fn rd_u64(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes([
        b[o],
        b[o + 1],
        b[o + 2],
        b[o + 3],
        b[o + 4],
        b[o + 5],
        b[o + 6],
        b[o + 7],
    ])
}

#[inline]
fn rd_i64(b: &[u8], o: usize) -> i64 {
    i64::from_le_bytes([
        b[o],
        b[o + 1],
        b[o + 2],
        b[o + 3],
        b[o + 4],
        b[o + 5],
        b[o + 6],
        b[o + 7],
    ])
}

#[inline]
fn wr_u16(b: &mut [u8], o: usize, v: u16) {
    b[o..o + 2].copy_from_slice(&v.to_le_bytes());
}

#[inline]
fn wr_i16(b: &mut [u8], o: usize, v: i16) {
    b[o..o + 2].copy_from_slice(&v.to_le_bytes());
}

#[inline]
fn wr_u32(b: &mut [u8], o: usize, v: u32) {
    b[o..o + 4].copy_from_slice(&v.to_le_bytes());
}

#[inline]
fn wr_i32(b: &mut [u8], o: usize, v: i32) {
    b[o..o + 4].copy_from_slice(&v.to_le_bytes());
}

#[inline]
fn wr_u64(b: &mut [u8], o: usize, v: u64) {
    b[o..o + 8].copy_from_slice(&v.to_le_bytes());
}

#[inline]
fn wr_i64(b: &mut [u8], o: usize, v: i64) {
    b[o..o + 8].copy_from_slice(&v.to_le_bytes());
}

impl<'a> Sim<'a> {
    /// Decode a state cell into a runnable simulation.
    ///
    /// The decoder is strict about the fields the validator will later depend on:
    /// `version`, `n`, and the two pad bytes. A non-canonical cell would otherwise let
    /// two different byte strings represent the same state, which breaks the "the
    /// output cell is the only successor" argument the type script relies on.
    pub fn decode(
        circuit: flycircuit::Circuit<'a>,
        params: Params,
        data: &[u8],
    ) -> Result<Self, StateError> {
        if data.len() < HEADER {
            return Err(StateError::Truncated);
        }
        if data[off::VERSION] != VERSION {
            return Err(StateError::BadVersion(data[off::VERSION]));
        }
        let n = data[off::N] as usize;
        if n == 0 || n > MAX_N {
            return Err(StateError::BadField("n"));
        }
        if data.len() != state_len(n) {
            return Err(StateError::Truncated);
        }
        if n != circuit.n() {
            return Err(StateError::NeuronCountMismatch {
                state: data[off::N],
                circuit: circuit.n() as u8,
            });
        }
        match data[off::ALIVE] {
            0 | 1 => {}
            _ => return Err(StateError::BadField("alive")),
        }
        if data[off::PAD5] != 0 || data[off::PAD20] != 0 {
            return Err(StateError::BadField("pad"));
        }
        if data[off::STIM_CHANNEL] > crate::sim::CH_SHOCK {
            return Err(StateError::BadField("stim_channel"));
        }

        let mut sim = Sim::genesis(circuit, params, 0, 0);
        sim.alive = data[off::ALIVE] == 1;
        sim.stim_channel = data[off::STIM_CHANNEL];
        sim.stim_param = data[off::STIM_PARAM];
        sim.stim_strength = rd_u16(data, off::STIM_STRENGTH);
        sim.generation = rd_u32(data, off::GENERATION);
        sim.head_x = rd_i32(data, off::HEAD_X);
        sim.head_y = rd_i32(data, off::HEAD_Y);
        sim.step = rd_u64(data, off::STEP);
        sim.energy = rd_u64(data, off::ENERGY);
        sim.total_spikes = rd_u64(data, off::TOTAL_SPIKES);
        sim.life_steps = rd_u64(data, off::LIFE_STEPS);
        sim.life_spikes = rd_u64(data, off::LIFE_SPIKES);
        sim.born_block = rd_u64(data, off::BORN_BLOCK);
        sim.stim_until = rd_u64(data, off::STIM_UNTIL);
        sim.pos_x = rd_i64(data, off::POS_X);
        sim.pos_y = rd_i64(data, off::POS_Y);
        for w in 0..WEDGES {
            sim.hist[w] = rd_u16(data, off::HEADING_HIST + 2 * w);
        }
        let ov = off_v(n);
        let ob = off_bias(n);
        let oi = off_inp(n);
        for i in 0..n {
            sim.v[i] = rd_i16(data, ov + 2 * i) as i64;
            sim.bias[i] = data[ob + i] as i8 as i32;
            sim.inp[i] = rd_i32(data, oi + 4 * i) as i64;
        }
        Ok(sim)
    }

    /// Encode the simulation into `out`, which must be exactly [`state_len`] long.
    ///
    /// This is where the wide in-flight values are narrowed, exactly as `_storeV`,
    /// `_storeBias` and `_storeInp` do upstream: `v` is clamped to `i16`, `bias` is
    /// already bounded to ±[`crate::sim::BIAS_MAX`] so it fits `i8` by construction, and
    /// `inp` is truncated to `i32`.
    pub fn encode(&self, out: &mut [u8]) -> Result<(), StateError> {
        let n = self.circuit.n();
        if out.len() != state_len(n) {
            return Err(StateError::Truncated);
        }
        out.fill(0);
        out[off::VERSION] = VERSION;
        out[off::N] = n as u8;
        out[off::ALIVE] = u8::from(self.alive);
        out[off::STIM_CHANNEL] = self.stim_channel;
        out[off::STIM_PARAM] = self.stim_param;
        wr_u16(out, off::STIM_STRENGTH, self.stim_strength);
        wr_u32(out, off::GENERATION, self.generation);
        wr_i32(out, off::HEAD_X, self.head_x);
        wr_i32(out, off::HEAD_Y, self.head_y);
        wr_u64(out, off::STEP, self.step);
        wr_u64(out, off::ENERGY, self.energy);
        wr_u64(out, off::TOTAL_SPIKES, self.total_spikes);
        wr_u64(out, off::LIFE_STEPS, self.life_steps);
        wr_u64(out, off::LIFE_SPIKES, self.life_spikes);
        wr_u64(out, off::BORN_BLOCK, self.born_block);
        wr_u64(out, off::STIM_UNTIL, self.stim_until);
        wr_i64(out, off::POS_X, self.pos_x);
        wr_i64(out, off::POS_Y, self.pos_y);
        for w in 0..WEDGES {
            wr_u16(out, off::HEADING_HIST + 2 * w, self.hist[w]);
        }
        let ov = off_v(n);
        let ob = off_bias(n);
        let oi = off_inp(n);
        for i in 0..n {
            // _storeV clamps; values can exceed i16 only if a caller sets `leak` and
            // `noise` wide enough to drive a neuron past the threshold in one step.
            let x = self.v[i].clamp(i16::MIN as i64, i16::MAX as i64);
            wr_i16(out, ov + 2 * i, x as i16);
            out[ob + i] = self.bias[i].clamp(-128, 127) as i8 as u8;
        }
        // `_storeInp` truncates to u32, and v1 never calls it at all: its `_inp` slots
        // keep the constructor value of zero forever. Writing the in-flight input there
        // would make a v1 cell differ from the chain's, so the region stays zeroed
        // (`out` was filled above) unless the organism persists its input.
        if self.params.persist_input {
            for i in 0..n {
                wr_i32(out, oi + 4 * i, self.inp[i] as i32);
            }
        }
        Ok(())
    }

    /// keccak256 over the canonical encoding of the state.
    ///
    /// Upstream `brainStateHash()` hashes only the neuron arrays plus `step` and
    /// `generation`. Hashing the whole cell is a strict superset: it also commits to
    /// energy, position, the heading history and the active stimulus, so two organisms
    /// that differ in any observable way cannot share a hash. This is what the death
    /// record stores and what the type script can use to prove "the output is a
    /// successor of the input".
    pub fn state_hash(&self) -> [u8; 32] {
        let mut buf = [0u8; MAX_STATE_LEN];
        let n = state_len(self.circuit.n());
        self.encode(&mut buf[..n])
            .expect("buffer is sized to state_len(n)");
        crate::keccak::keccak256(&buf[..n])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flycircuit::embedded;

    #[test]
    fn state_len_for_ring_attractor() {
        assert_eq!(state_len(155), 1_213);
        assert_eq!(off_v(155), 128);
        assert_eq!(off_bias(155), 438);
        assert_eq!(off_inp(155), 593);
        assert_eq!(off_inp(155) + 4 * 155, 1_213);
    }

    #[test]
    fn round_trips_through_bytes() {
        let c = embedded();
        let p = Params::V2;
        let mut sim = Sim::genesis(c, p, 1_000_000, 42);
        sim.v[0] = -1234;
        sim.v[154] = 999;
        sim.bias[7] = -24;
        sim.inp[100] = -123_456;
        sim.hist[3] = 77;
        sim.step = 12_345;
        sim.pos_x = -103;
        sim.pos_y = 501;
        sim.stim_channel = crate::sim::CH_CUE;
        sim.stim_param = 4;
        sim.stim_strength = 4;

        let mut buf = vec![0u8; state_len(155)];
        sim.encode(&mut buf).unwrap();
        let back = Sim::decode(c, p, &buf).unwrap();

        assert_eq!(back.v[0], -1234);
        assert_eq!(back.v[154], 999);
        assert_eq!(back.bias[7], -24);
        assert_eq!(back.inp[100], -123_456);
        assert_eq!(back.hist[3], 77);
        assert_eq!(back.step, 12_345);
        assert_eq!(back.pos_x, -103);
        assert_eq!(back.pos_y, 501);
        assert_eq!(back.stim_channel, crate::sim::CH_CUE);
        assert_eq!(back.stim_strength, 4);
        assert_eq!(back.born_block, 42);
    }

    #[test]
    fn encode_is_canonical() {
        // Two encodes of the same state must be byte-identical, pads included.
        let c = embedded();
        let sim = Sim::genesis(c, Params::V1_DEPLOYED, 10, 1);
        let mut a = vec![0xAAu8; state_len(155)];
        let mut b = vec![0u8; state_len(155)];
        sim.encode(&mut a).unwrap();
        sim.encode(&mut b).unwrap();
        assert_eq!(a, b);
        assert_eq!(a[5], 0, "pad byte 5");
        assert_eq!(a[20], 0, "pad byte 20");
    }

    #[test]
    fn rejects_malformed_cells() {
        let c = embedded();
        let good = {
            let sim = Sim::genesis(c, Params::V2, 100, 0);
            let mut b = vec![0u8; state_len(155)];
            sim.encode(&mut b).unwrap();
            b
        };

        assert_eq!(
            Sim::decode(c, Params::V2, &[]).unwrap_err(),
            StateError::Truncated
        );

        let mut b = good.clone();
        b[0] = 9;
        assert_eq!(
            Sim::decode(c, Params::V2, &b).unwrap_err(),
            StateError::BadVersion(9)
        );

        let mut b = good.clone();
        b[1] = 154;
        assert_eq!(
            Sim::decode(c, Params::V2, &b).unwrap_err(),
            StateError::Truncated
        );

        // A well-formed cell for a 100-neuron circuit must be refused by the
        // 155-neuron circuit: the two would otherwise share a state encoding.
        let mut b = vec![0u8; state_len(100)];
        b[0] = VERSION;
        b[1] = 100;
        b[2] = 1;
        assert!(matches!(
            Sim::decode(c, Params::V2, &b).unwrap_err(),
            StateError::NeuronCountMismatch {
                state: 100,
                circuit: 155
            }
        ));

        let mut b = good.clone();
        b[2] = 7;
        assert_eq!(
            Sim::decode(c, Params::V2, &b).unwrap_err(),
            StateError::BadField("alive")
        );

        let mut b = good.clone();
        b[5] = 1;
        assert_eq!(
            Sim::decode(c, Params::V2, &b).unwrap_err(),
            StateError::BadField("pad")
        );

        let mut b = good.clone();
        b[20] = 1;
        assert_eq!(
            Sim::decode(c, Params::V2, &b).unwrap_err(),
            StateError::BadField("pad")
        );

        let mut b = good.clone();
        b[3] = 5;
        assert_eq!(
            Sim::decode(c, Params::V2, &b).unwrap_err(),
            StateError::BadField("stim_channel")
        );

        let mut b = good;
        b.push(0);
        assert_eq!(
            Sim::decode(c, Params::V2, &b).unwrap_err(),
            StateError::Truncated
        );
    }

    #[test]
    fn inp_truncates_like_the_evm() {
        // 2^31 fits i32; 2^31 + 1 truncates to -2^31.
        let c = embedded();
        let mut sim = Sim::genesis(c, Params::V2, 0, 0);
        sim.inp[0] = 1i64 << 31;
        sim.inp[1] = (1i64 << 31) + 1;
        let mut buf = vec![0u8; state_len(155)];
        sim.encode(&mut buf).unwrap();
        let back = Sim::decode(c, Params::V2, &buf).unwrap();
        assert_eq!(back.inp[0], -(1i64 << 31));
        assert_eq!(back.inp[1], -(1i64 << 31) + 1);
    }

    #[test]
    fn v1_never_writes_the_input_region() {
        // Upstream v1 guards both `_loadInp` and `_storeInp` behind `PERSIST_INPUT`, so
        // its `_inp` slots keep the constructor value of zero for the organism's whole
        // life. Writing the in-flight accumulator there would make a v1 cell differ from
        // the one BSC holds, and the difference would be invisible until someone
        // compared cells byte for byte.
        let c = embedded();
        let mut v1 = Params::V1_DEPLOYED;
        v1.persist_input = false;
        let mut v2 = Params::V1_DEPLOYED;
        v2.persist_input = true;

        let run = |p: Params| {
            let mut sim = Sim::genesis(c, p, 1_000_000, 0);
            sim.stimulate(crate::sim::CH_CUE, 4, 4);
            sim.tick(8).unwrap();
            let in_flight = sim.inp.iter().filter(|&&x| x != 0).count();
            let mut buf = vec![0u8; state_len(155)];
            sim.encode(&mut buf).unwrap();
            (in_flight, buf)
        };

        let (v1_in_flight, v1_bytes) = run(v1);
        let (v2_in_flight, v2_bytes) = run(v2);

        assert!(
            v1_in_flight > 0,
            "both variants hold input destined for the next step"
        );
        assert_eq!(
            v2_in_flight, v1_in_flight,
            "same dynamics, same in-flight input"
        );
        let oi = off_inp(155);
        assert!(
            v1_bytes[oi..].iter().all(|&b| b == 0),
            "v1 must leave the input region zeroed"
        );
        assert!(
            v2_bytes[oi..].iter().any(|&b| b != 0),
            "v2 must persist the input that is in flight"
        );
    }
}
