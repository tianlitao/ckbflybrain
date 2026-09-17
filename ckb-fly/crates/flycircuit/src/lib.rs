//! Decoder for the packed FlyWire circuit table.
//!
//! The table is the exact byte string that `FlyBrain.sol` stores via SSTORE2 on
//! BNB Smart Chain. Its keccak256 is
//! `0xffbe0e7f28e1f0dd2cfaa01d1d221c502bf41c1fd519ebfe8d9b8203e7cedfc2`, which is
//! published in the upstream README and is also the value the deployed contract
//! reports from `circuitHash()`. Keeping the identical byte string on CKB means the
//! two chains provably run the same connectome.
//!
//! # Layout (big-endian, no padding)
//!
//! ```text
//! [0]        u8        version = 1
//! [1]        u8        N   neuron count (155)
//! [2..4]     u16       S   synapse count (6522)
//! type       N x u8    cell type (T_*)
//! wedge      N x u8    ellipsoid-body wedge 0..15, or NO_WEDGE (0xFF)
//! side       N x u8    0 = left hemisphere, 1 = right
//! offsets    (N+1) x u16   cumulative out-synapse offsets
//! syn        S x (u8 post, u8 weight)
//! root       N x u64   FlyWire root id
//! ```
//!
//! Total size = 4 + 3N + 2(N+1) + 2S + 8N = 13N + 2S + 6. For N=155, S=6522 that is
//! 2015 + 13044 + 6 = 15,065 bytes, matching `data/circuit.bin`.

#![cfg_attr(not(test), no_std)]

/// Table format version this decoder understands.
pub const VERSION: u8 = 1;

/// Sentinel wedge for neurons that are not part of the ellipsoid-body compass ring.
pub const NO_WEDGE: u8 = 0xFF;

/// Number of compass wedges.
pub const WEDGES: usize = 16;

/// Neuron cell types, in the order used by the `gains` parameter vector.
pub const T_EPG: u8 = 0;
pub const T_EPGT: u8 = 1;
pub const T_PEG: u8 = 2;
pub const T_PEN_A: u8 = 3;
pub const T_PEN_B: u8 = 4;
pub const T_DELTA7: u8 = 5;

/// Number of distinct cell types.
pub const NUM_TYPES: usize = 6;

/// Byte length of a table with `n` neurons and `s` synapses.
#[inline]
pub const fn table_len(n: usize, s: usize) -> usize {
    13 * n + 2 * s + 6
}

/// Errors that `Circuit::new` can report. Kept as a plain enum (no `Display`) so the
/// type stays usable in `no_std` scripts without pulling in `core::fmt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitError {
    /// The table is shorter than its own header claims.
    Truncated,
    /// Byte 0 is not `VERSION`.
    BadVersion(u8),
    /// Byte 1 is zero (a circuit needs at least one neuron).
    EmptyCircuit,
    /// The declared length does not equal `table_len(N, S)`.
    LengthMismatch,
    /// An out-synapse offset is not monotonic, or points past `S`.
    BadOffsets,
    /// A synapse targets a neuron index >= N.
    BadSynapseTarget,
}

/// Zero-copy view over a packed circuit table.
#[derive(Debug, Clone, Copy)]
pub struct Circuit<'a> {
    d: &'a [u8],
    n: usize,
    s: usize,
    off_type: usize,
    off_wedge: usize,
    off_side: usize,
    off_offsets: usize,
    off_syn: usize,
    off_root: usize,
}

impl<'a> Circuit<'a> {
    /// Parse and validate a table.
    ///
    /// Validation is deliberately strict: the on-chain type script must be able to
    /// trust every index it derives from the table, because a malformed table would
    /// otherwise let a caller drive the neuron loop out of bounds.
    pub fn new(d: &'a [u8]) -> Result<Self, CircuitError> {
        if d.len() < 4 {
            return Err(CircuitError::Truncated);
        }
        if d[0] != VERSION {
            return Err(CircuitError::BadVersion(d[0]));
        }
        let n = d[1] as usize;
        if n == 0 {
            return Err(CircuitError::EmptyCircuit);
        }
        let s = u16::from_be_bytes([d[2], d[3]]) as usize;
        if d.len() != table_len(n, s) {
            return Err(CircuitError::LengthMismatch);
        }

        let off_type = 4;
        let off_wedge = off_type + n;
        let off_side = off_wedge + n;
        let off_offsets = off_side + n;
        let off_syn = off_offsets + 2 * (n + 1);
        let off_root = off_syn + 2 * s;

        let c = Self {
            d,
            n,
            s,
            off_type,
            off_wedge,
            off_side,
            off_offsets,
            off_syn,
            off_root,
        };
        c.validate()?;
        Ok(c)
    }

    fn validate(&self) -> Result<(), CircuitError> {
        let mut prev = 0usize;
        for i in 0..=self.n {
            let cur = self.raw_offset(i) as usize;
            if cur < prev || cur > self.s {
                return Err(CircuitError::BadOffsets);
            }
            prev = cur;
        }
        // Every offset is now known to be in range, so this cannot index out of bounds.
        for j in 0..self.s {
            if self.synapse(j).0 as usize >= self.n {
                return Err(CircuitError::BadSynapseTarget);
            }
        }
        Ok(())
    }

    #[inline]
    fn raw_offset(&self, i: usize) -> u16 {
        let o = self.off_offsets + 2 * i;
        u16::from_be_bytes([self.d[o], self.d[o + 1]])
    }

    /// Neuron count.
    #[inline]
    pub const fn n(&self) -> usize {
        self.n
    }

    /// Synapse count.
    #[inline]
    pub const fn s(&self) -> usize {
        self.s
    }

    /// Raw table bytes.
    #[inline]
    pub const fn table(&self) -> &'a [u8] {
        self.d
    }

    /// Cell type of neuron `i` (`T_*`).
    #[inline]
    pub fn cell_type(&self, i: usize) -> u8 {
        debug_assert!(i < self.n);
        self.d[self.off_type + i]
    }

    /// Ellipsoid-body wedge of neuron `i`, or [`NO_WEDGE`].
    #[inline]
    pub fn wedge(&self, i: usize) -> u8 {
        debug_assert!(i < self.n);
        self.d[self.off_wedge + i]
    }

    /// Hemisphere of neuron `i`: 0 = left, 1 = right.
    #[inline]
    pub fn side(&self, i: usize) -> u8 {
        debug_assert!(i < self.n);
        self.d[self.off_side + i]
    }

    /// Half-open range of out-synapse indices for neuron `i`.
    #[inline]
    pub fn out_range(&self, i: usize) -> (usize, usize) {
        debug_assert!(i < self.n);
        (self.raw_offset(i) as usize, self.raw_offset(i + 1) as usize)
    }

    /// Out-degree of neuron `i`.
    #[inline]
    pub fn out_degree(&self, i: usize) -> usize {
        let (a, b) = self.out_range(i);
        b - a
    }

    /// Synapse `j` as `(post_neuron, flywire_synapse_count)`.
    #[inline]
    pub fn synapse(&self, j: usize) -> (u8, u8) {
        debug_assert!(j < self.s);
        let o = self.off_syn + 2 * j;
        (self.d[o], self.d[o + 1])
    }

    /// FlyWire root id of neuron `i`.
    #[inline]
    pub fn root(&self, i: usize) -> u64 {
        debug_assert!(i < self.n);
        let o = self.off_root + 8 * i;
        u64::from_be_bytes([
            self.d[o],
            self.d[o + 1],
            self.d[o + 2],
            self.d[o + 3],
            self.d[o + 4],
            self.d[o + 5],
            self.d[o + 6],
            self.d[o + 7],
        ])
    }

    /// Count of neurons of each cell type, indexed by `T_*`.
    pub fn type_histogram(&self) -> [u32; NUM_TYPES] {
        let mut h = [0u32; NUM_TYPES];
        for i in 0..self.n {
            let t = self.cell_type(i) as usize;
            if t < NUM_TYPES {
                h[t] += 1;
            }
        }
        h
    }

    /// Total FlyWire synapse count over all connections (the "45,961 synapses" figure).
    pub fn total_synapse_weight(&self) -> u64 {
        let mut total = 0u64;
        for j in 0..self.s {
            total += self.synapse(j).1 as u64;
        }
        total
    }
}

/// The canonical table, embedded at compile time.
///
/// The contract does not use this (it reads the table from a cell_dep); it exists so
/// host-side tests and reference tools run against exactly the same bytes.
#[cfg(feature = "embed")]
pub static TABLE: &[u8] = include_bytes!("../data/circuit.bin");

/// Parsed form of [`TABLE`].
#[cfg(feature = "embed")]
pub fn embedded() -> Circuit<'static> {
    Circuit::new(TABLE).expect("embedded circuit table is valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_table_parses() {
        let c = embedded();
        assert_eq!(c.n(), 155);
        assert_eq!(c.s(), 6522);
        assert_eq!(c.table().len(), 15_065);
    }

    #[test]
    fn embedded_table_matches_published_structure() {
        let c = embedded();
        assert_eq!(c.type_histogram(), [47, 4, 20, 20, 22, 42]);
        assert_eq!(c.total_synapse_weight(), 45_961);

        let with_wedge = (0..c.n()).filter(|&i| c.wedge(i) != NO_WEDGE).count();
        assert_eq!(with_wedge, 113);
        let left = (0..c.n()).filter(|&i| c.side(i) == 0).count();
        assert_eq!(left, 77);
        assert_eq!(c.n() - left, 78);
        assert!((0..c.n()).all(|i| c.root(i) != 0));
    }

    #[test]
    fn rejects_bad_tables() {
        assert_eq!(Circuit::new(&[]).unwrap_err(), CircuitError::Truncated);
        assert_eq!(
            Circuit::new(&[1, 0, 0, 0]).unwrap_err(),
            CircuitError::EmptyCircuit
        );
        assert_eq!(
            Circuit::new(&[2, 1, 0, 0]).unwrap_err(),
            CircuitError::BadVersion(2)
        );
        // Valid header, wrong declared length.
        assert_eq!(
            Circuit::new(&[1, 1, 0, 0]).unwrap_err(),
            CircuitError::LengthMismatch
        );
    }

    #[test]
    fn rejects_non_monotonic_offsets() {
        // N=1, S=1 -> 21 bytes. Point the offsets backwards.
        let mut t = vec![0u8; table_len(1, 1)];
        t[0] = 1;
        t[1] = 1;
        t[2] = 0;
        t[3] = 1;
        t[4] = T_EPG; // type
        t[5] = 0; // wedge
        t[6] = 0; // side
        // offsets: [0, 0] then bump the first one to 1
        t[7] = 0;
        t[8] = 1;
        t[9] = 0;
        t[10] = 0;
        assert_eq!(Circuit::new(&t).unwrap_err(), CircuitError::BadOffsets);
    }

    #[test]
    fn rejects_synapse_target_out_of_range() {
        let mut t = vec![0u8; table_len(1, 1)];
        t[0] = 1;
        t[1] = 1;
        t[2] = 0;
        t[3] = 1;
        t[4] = T_EPG;
        t[5] = 0;
        t[6] = 0;
        t[7] = 0;
        t[8] = 0; // offsets [0,0]
        t[9] = 0;
        t[10] = 1; // offsets [1,1]
        // syn[0] = (post=7, weight=1) -> out of range for N=1
        t[11] = 7;
        t[12] = 1;
        assert_eq!(
            Circuit::new(&t).unwrap_err(),
            CircuitError::BadSynapseTarget
        );
    }
}
