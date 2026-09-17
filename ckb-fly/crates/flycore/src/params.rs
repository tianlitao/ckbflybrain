//! Simulation parameters.
//!
//! These are the 12 numbers that fully determine the dynamics. In the EVM they were
//! `immutable` constructor arguments; on CKB they live in the type script's **args**,
//! which CKB already treats as part of the script's identity — so changing a single
//! parameter byte yields a different script hash, and a cell can never silently change
//! the dynamics it runs.

use crate::div_trunc;

/// Encoded length of [`Params`] in bytes.
pub const PARAMS_LEN: usize = 32;

/// The dynamic state of one organism's nervous system.
///
/// Field order matches the `Params` struct in `FlyBrain.sol` so the two can be
/// diffed by eye.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Params {
    /// `v -= v * leak / 1024` each step. Truncating division, as in the EVM.
    pub leak: u16,
    /// Spike threshold; a neuron spikes when `v >= thresh`.
    pub thresh: i16,
    /// Post-spike potential.
    pub reset: i16,
    /// Floor on hyperpolarisation.
    pub v_min: i16,
    /// Synaptic gain per presynaptic cell type; `T_DELTA7` (index 5) is negative.
    /// Contribution of one synapse is `weight * gain / 16`.
    pub gains: [i16; 6],
    /// Engram gain: contribution of the per-neuron bias is `bias * g_bias`.
    pub g_bias: u16,
    /// Background noise amplitude: `noise_byte * noise / 128`.
    pub noise: u16,
    /// Stimulus current is `strength * stim_gain`.
    pub stim_gain: u16,
    /// Steps a stimulus stays active.
    pub stim_ttl: u16,
    /// Minimum `|heading vector|` per step required to walk.
    pub walk_threshold: u16,
    /// Maximum steps in a single tick.
    pub max_steps: u8,
    /// Keep pending synaptic input across ticks (v2) instead of dropping it (v1).
    pub persist_input: bool,
}

impl Params {
    /// The parameter set that was actually deployed as FlyBrain v1 on BSC
    /// (`0x32D28e97b50f5978eb51d7608492CC7221b01f63`), read back from
    /// `data/params_v1_deployed.json`. This is the set the mainnet differential
    /// fixture was generated with.
    pub const V1_DEPLOYED: Self = Self {
        leak: 95,
        thresh: 1000,
        reset: -500,
        v_min: -4000,
        gains: [190, 114, 5, 108, 7, -297],
        g_bias: 4,
        noise: 35,
        stim_gain: 157,
        stim_ttl: 64,
        walk_threshold: 100,
        max_steps: 64,
        persist_input: false,
    };

    /// FlyBrain v2 (`0xee80f8cB5309C572343c38b5D717283BBBb517c5`), the live brain.
    /// Adds `persistInput` and recalibrates every gain.
    pub const V2: Self = Self {
        leak: 69,
        thresh: 1000,
        reset: -200,
        v_min: -4000,
        gains: [130, 28, 447, 56, 40, -372],
        g_bias: 4,
        noise: 67,
        stim_gain: 161,
        stim_ttl: 64,
        walk_threshold: 100,
        max_steps: 64,
        persist_input: true,
    };

    /// The defaults baked into `sim/flysim.py`'s `DEFAULT_PARAMS`, i.e. the
    /// pre-calibration starting point.
    pub const SIM_DEFAULTS: Self = Self {
        leak: 120,
        thresh: 1000,
        reset: -300,
        v_min: -2000,
        gains: [40, 40, 40, 40, 40, -40],
        g_bias: 8,
        noise: 120,
        stim_gain: 40,
        stim_ttl: 64,
        walk_threshold: 100,
        max_steps: 64,
        persist_input: false,
    };

    /// Serialize to the 32-byte layout carried in the type script's args.
    ///
    /// Little-endian, no padding. `flags` bit 0 is `persist_input`; all other bits are
    /// reserved and must be zero, so the encoding is canonical and two equal parameter
    /// sets always produce identical args.
    pub fn to_bytes(&self) -> [u8; PARAMS_LEN] {
        let mut b = [0u8; PARAMS_LEN];
        b[0..2].copy_from_slice(&self.leak.to_le_bytes());
        b[2..4].copy_from_slice(&self.thresh.to_le_bytes());
        b[4..6].copy_from_slice(&self.reset.to_le_bytes());
        b[6..8].copy_from_slice(&self.v_min.to_le_bytes());
        for (k, g) in self.gains.iter().enumerate() {
            let o = 8 + 2 * k;
            b[o..o + 2].copy_from_slice(&g.to_le_bytes());
        }
        b[20..22].copy_from_slice(&self.g_bias.to_le_bytes());
        b[22..24].copy_from_slice(&self.noise.to_le_bytes());
        b[24..26].copy_from_slice(&self.stim_gain.to_le_bytes());
        b[26..28].copy_from_slice(&self.stim_ttl.to_le_bytes());
        b[28..30].copy_from_slice(&self.walk_threshold.to_le_bytes());
        b[30] = self.max_steps;
        b[31] = u8::from(self.persist_input);
        b
    }

    /// Inverse of [`Params::to_bytes`]. Returns `None` for a non-canonical encoding
    /// (reserved flag bits set, or a zero `max_steps`, which would make `tick`
    /// unusable).
    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() != PARAMS_LEN {
            return None;
        }
        if b[31] & !1 != 0 {
            return None;
        }
        if b[30] == 0 {
            return None;
        }
        let rd_u16 = |o: usize| u16::from_le_bytes([b[o], b[o + 1]]);
        let rd_i16 = |o: usize| i16::from_le_bytes([b[o], b[o + 1]]);
        let mut gains = [0i16; 6];
        for (k, g) in gains.iter_mut().enumerate() {
            *g = rd_i16(8 + 2 * k);
        }
        Some(Self {
            leak: rd_u16(0),
            thresh: rd_i16(2),
            reset: rd_i16(4),
            v_min: rd_i16(6),
            gains,
            g_bias: rd_u16(20),
            noise: rd_u16(22),
            stim_gain: rd_u16(24),
            stim_ttl: rd_u16(26),
            walk_threshold: rd_u16(28),
            max_steps: b[30],
            persist_input: b[31] & 1 != 0,
        })
    }

    /// `v -= v * leak / 1024`, with the EVM's truncate-toward-zero division.
    ///
    /// The intermediate product is widened to `i64` because the EVM evaluates it in a
    /// 256-bit word: a caller is free to set `leak` up to `u16::MAX`, and `i32`
    /// multiplication would overflow. Debug builds have overflow checks on, so this is
    /// not merely defensive — it is required for the contract to accept wide `leak`
    /// values at all.
    #[inline(always)]
    pub fn leak_step(&self, v: i64) -> i64 {
        v - div_trunc(v * self.leak as i64, 1024)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        for p in [Params::V1_DEPLOYED, Params::V2, Params::SIM_DEFAULTS] {
            assert_eq!(Params::from_bytes(&p.to_bytes()), Some(p));
        }
    }

    #[test]
    fn v1_matches_upstream_json() {
        let b = Params::V1_DEPLOYED.to_bytes();
        assert_eq!(u16::from_le_bytes([b[0], b[1]]), 95);
        assert_eq!(i16::from_le_bytes([b[2], b[3]]), 1000);
        assert_eq!(i16::from_le_bytes([b[4], b[5]]), -500);
        assert_eq!(b[31], 0, "v1 predates persistInput");
    }

    #[test]
    fn v2_matches_upstream_json() {
        assert_eq!(Params::V2.gains, [130, 28, 447, 56, 40, -372]);
        assert_eq!(Params::V2.to_bytes()[31], 1);
    }

    #[test]
    fn rejects_non_canonical_encodings() {
        let mut b = Params::V2.to_bytes();
        b[31] = 0x80; // reserved flag bit
        assert_eq!(Params::from_bytes(&b), None);

        let mut b = Params::V2.to_bytes();
        b[30] = 0; // max_steps = 0 makes tick() impossible
        assert_eq!(Params::from_bytes(&b), None);

        assert_eq!(Params::from_bytes(&[0u8; 31]), None);
    }

    #[test]
    fn leak_uses_truncating_division() {
        let p = Params::V1_DEPLOYED; // leak = 95
        assert_eq!(p.leak_step(0), 0);
        // -1000 * 95 / 1024 = -92.77 -> -92 (toward zero, not -93)
        assert_eq!(p.leak_step(-1000), -1000 - div_trunc(-95_000, 1024));
        assert_eq!(div_trunc(-95_000, 1024), -92);
        assert_eq!(p.leak_step(-1000), -908);
    }
}
