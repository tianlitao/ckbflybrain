//! What the fly's life is worth, in CKB.
//!
//! # The economic model, and why there is no token
//!
//! Upstream, feeding the fly means sending `$FLY` to `0x…dEaD`. The token exists for one
//! reason: to make a burn measurable. CKB already has a measurable, native quantity —
//! a cell's capacity — so the fly does not need a token at all.
//!
//! The model is one sentence: **the state cell's capacity is the fly's body, and every
//! step of life is backed by capacity locked in it.**
//!
//! ```text
//! required_capacity(energy) = body_capacity + energy * backing_per_step
//! ```
//!
//! * **Feeding** means increasing the state cell's capacity. The feeder's CKB is locked
//!   into the fly's body. Because the type script forbids destroying the body, that value
//!   can never be recovered — it is burned, but *verifiably* burned, and the fly is
//!   visibly richer by exactly that amount.
//! * **Ticking** decreases the state cell's capacity by the life it consumed. The value
//!   that leaves the cell is the ticker's: folded into a change output, it makes ticking
//!   profitable. CKB charges by transaction *size*, not by cycles, so a 64-step tick costs
//!   no more to submit than a 1-step tick — which is what makes long ticks the rational
//!   choice and a keeper willing to run them.
//! * **Stimulating** costs extra *life*, in proportion to strength, because it is the
//!   action a player takes to change the fly's behaviour rather than merely to keep it
//!   alive. The fly pays for being steered in the only currency it has.
//!
//! This deletes an entire class of problems the EVM version had to live with: no supply
//! schedule, no liquidity pool, no slippage, no `approve`/`transferFrom` dance, no
//! front-running, and no way for a third party to change the rules by moving a pool. The
//! fly's whole economics is 24 bytes of parameters and one capacity comparison.
//!
//! # Where the check happens
//!
//! The type script requires two things of the output cell:
//!
//! ```text
//! output.capacity == input.capacity - capacity_release(in.energy, out.energy)
//! output.capacity >= required_capacity(out.energy)
//! ```
//!
//! The first is exact, so the ticker cannot take a shannon more than the life it burned,
//! and cannot under-fund a feeding. The second is the invariant that makes `energy` mean
//! something: a fly claiming a million steps of life must be holding the capacity that
//! backs a million steps.

/// Encoded length of [`Economics`].
pub const ECONOMICS_LEN: usize = 24;

/// Shannons in one CKB. Named for readability: 1 byte of cell data costs 1 CKB.
pub const SHANNONS_PER_CKB: u64 = 100_000_000;

/// Prices that determine what the fly's life costs.
///
/// All values are in **shannons** (1 CKB = 10^8 shannons).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Economics {
    /// Capacity locked in the state cell per step of life.
    pub backing_per_step: u64,
    /// Steps of life the fly spends per unit of stimulus strength.
    ///
    /// These steps are *not* simulated: the fly pays for being steered without moving
    /// forward. Expressing the stimulus price in life rather than in capacity is what
    /// keeps the model consistent. A capacity charge would have to come out of the very
    /// capacity that backs the remaining energy, so an exactly-backed fly could never
    /// afford one — the arithmetic admits no solution. Charging in life keeps the
    /// invariant `capacity == body + energy * backing` true by construction, because the
    /// capacity delta is always exactly the value of the life consumed.
    pub stim_cost_steps: u64,
    /// Capacity the state cell must hold regardless of energy.
    ///
    /// This covers the cell's own data deposit — 1,213 bytes of state plus a lock and an
    /// 89-byte type script, about 1,392 bytes — with headroom. It is the fly's body,
    /// separate from its life.
    pub body_capacity: u64,
}

impl Economics {
    /// Free everything, for a throwaway testnet where the economics is not the point.
    ///
    /// With zero prices the fly's life costs nothing and ticking pays nothing, so a
    /// keeper has no incentive. Useful for exercising the state machine, not for running
    /// a fly that anyone else cares about.
    pub const FREE: Self = Self {
        backing_per_step: 0,
        stim_cost_steps: 0,
        body_capacity: 0,
    };

    /// Priced for a real fly: 0.0001 CKB per step of life.
    ///
    /// | quantity | value |
    /// |---|---|
    /// | one step of life | 0.0001 CKB |
    /// | genesis energy of 1,000,000 steps | 100 CKB |
    /// | feeding 10,000 steps | 1 CKB |
    /// | a 64-step tick, released to the ticker | 0.0064 CKB |
    /// | a strength-4 cue, on top of the tick | 512 steps, i.e. 0.0512 CKB |
    /// | the body | 1,500 CKB, against the ~1,428 bytes it occupies |
    ///
    /// A state-transition transaction is a few kilobytes, and CKB's floor is 1,000
    /// shannons per KB, so ticking costs a ticker about 4,000 shannons to submit and pays
    /// it 640,000. A hundred and sixty ticks earn a CKB.
    pub const TESTNET: Self = Self {
        backing_per_step: 10_000,
        stim_cost_steps: 128,
        body_capacity: 1_500 * SHANNONS_PER_CKB,
    };

    /// Serialize to 24 bytes, little-endian.
    pub fn to_bytes(&self) -> [u8; ECONOMICS_LEN] {
        let mut b = [0u8; ECONOMICS_LEN];
        b[0..8].copy_from_slice(&self.backing_per_step.to_le_bytes());
        b[8..16].copy_from_slice(&self.stim_cost_steps.to_le_bytes());
        b[16..24].copy_from_slice(&self.body_capacity.to_le_bytes());
        b
    }

    /// Parse the 24-byte form.
    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() != ECONOMICS_LEN {
            return None;
        }
        let rd = |o: usize| {
            let mut w = [0u8; 8];
            w.copy_from_slice(&b[o..o + 8]);
            u64::from_le_bytes(w)
        };
        Some(Self {
            backing_per_step: rd(0),
            stim_cost_steps: rd(8),
            body_capacity: rd(16),
        })
    }

    /// Minimum capacity the state cell must hold to claim `energy` steps of life.
    ///
    /// Saturating: an absurd energy should make the requirement unaffordable, not wrap
    /// around to something cheap.
    pub fn required_capacity(&self, energy: u64) -> u64 {
        self.body_capacity
            .saturating_add(self.backing_per_step.saturating_mul(energy))
    }

    /// Net shannons that must leave the state cell for this transition.
    ///
    /// Positive means the cell releases value (life was spent); negative means the cell
    /// must gain value (life was bought). The energies come from the states rather than
    /// from the requested step count, so a tick that ran short because the fly was nearly
    /// out of energy releases exactly what it burned, not what was asked for.
    ///
    /// Note that the action itself is not a parameter: whatever an action did, the value
    /// that leaves the body is the value of the life it consumed. That is what makes the
    /// backing invariant hold by induction rather than by case analysis.
    pub fn capacity_release(&self, input_energy: u64, output_energy: u64) -> i128 {
        let consumed = input_energy as i128 - output_energy as i128;
        (self.backing_per_step as i128).saturating_mul(consumed)
    }

    /// Steps of life a stimulus of `strength` costs, on top of the steps it advances.
    pub fn stim_cost(&self, strength: u8) -> u64 {
        self.stim_cost_steps.saturating_mul(strength as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        for e in [Economics::FREE, Economics::TESTNET] {
            assert_eq!(Economics::from_bytes(&e.to_bytes()), Some(e));
        }
        assert_eq!(Economics::TESTNET.to_bytes().len(), 24);
        assert_eq!(Economics::from_bytes(&[0u8; 23]), None);
    }

    #[test]
    fn body_capacity_covers_the_cell() {
        // The real serialized size of the state cell, measured rather than modelled:
        // molecule tables carry a total-size word plus one offset per field, and getting
        // that arithmetic wrong by hand is how a body ends up smaller than its own data.
        // `tests/src/tests.rs` pins the same number against a live cell.
        let occupied_bytes = 1_428usize;
        let body_ckb = Economics::TESTNET.body_capacity / SHANNONS_PER_CKB;
        assert!(
            body_ckb > occupied_bytes as u64,
            "the body ({body_ckb} CKB) must exceed its own data deposit ({occupied_bytes} CKB)"
        );
    }

    #[test]
    fn required_capacity_tracks_energy() {
        let e = Economics::TESTNET;
        assert_eq!(e.required_capacity(0), e.body_capacity);

        let million = e.required_capacity(1_000_000);
        assert_eq!(million, e.body_capacity + 10_000 * 1_000_000);
        assert_eq!(
            (million - e.body_capacity) / SHANNONS_PER_CKB,
            100,
            "a million steps of life is backed by 100 CKB"
        );
    }

    #[test]
    fn ticking_releases_value_and_feeding_acquires_it() {
        let e = Economics::TESTNET;

        // Burn 64 steps: the cell releases 64 * 0.0001 CKB = 640,000 shannons.
        assert_eq!(e.capacity_release(1_000, 936), 640_000);

        // Buy 10,000 steps: the cell must gain 1 CKB.
        assert_eq!(
            e.capacity_release(1_000, 11_000),
            -(SHANNONS_PER_CKB as i128)
        );

        // Resurrecting a dead fly into a 10,000-step life is the same purchase.
        assert_eq!(e.capacity_release(0, 10_000), -(SHANNONS_PER_CKB as i128));
    }

    #[test]
    fn a_short_tick_releases_only_what_it_burned() {
        // The fly had 10 steps of life and was asked for 64. It ran 10. It must release
        // the value of 10 steps, not 64 — otherwise a ticker could drain the body by
        // repeatedly asking for more than the fly can pay. Deriving the release from the
        // energies rather than from the requested step count is what makes this automatic.
        let e = Economics::TESTNET;
        assert_eq!(e.capacity_release(10, 0), 100_000);
    }

    #[test]
    fn a_stimulus_costs_life_not_capacity() {
        // The distinction that keeps the model consistent: a strength-4 stimulus costs 512
        // *steps of life*, and the capacity that leaves the body is the value of those
        // steps. A capacity-denominated charge would have to come out of the very capacity
        // backing the remaining energy, which an exactly-backed fly can never afford.
        let e = Economics::TESTNET;
        assert_eq!(e.stim_cost(0), 0);
        assert_eq!(e.stim_cost(4), 512);
        assert_eq!(e.stim_cost(255), 255 * 128);

        // Steering is cheaper than moving: 512 steps of life against a 64-step tick.
        assert!(e.stim_cost(4) > 64);
    }

    #[test]
    fn the_backing_invariant_survives_every_action() {
        // The property the whole economic design rests on: if the input cell is exactly
        // backed, and the capacity delta is exactly the value of the life consumed, then
        // the output is exactly backed too — for any action, without case analysis.
        let e = Economics::TESTNET;
        for (in_energy, out_energy) in [(1_000u64, 936u64), (1_000, 1_000), (10, 0), (0, 5_000)] {
            let in_cap = e.required_capacity(in_energy);
            let release = e.capacity_release(in_energy, out_energy);
            let out_cap = (in_cap as i128 - release) as u64;
            assert_eq!(
                out_cap,
                e.required_capacity(out_energy),
                "backing must hold for {in_energy} -> {out_energy}"
            );
        }
    }

    #[test]
    fn ticking_pays_for_itself_by_a_wide_margin() {
        // The claim in the module docs, checked rather than asserted in prose. CKB's
        // minimum fee rate is 1,000 shannons per KB and a state transition is a few
        // kilobytes, so a 4 KB transaction at the floor costs 4,000 shannons.
        let e = Economics::TESTNET;
        let reward = e.capacity_release(1_000, 936);
        let tx_fee_at_floor = 4_000i128;
        assert_eq!(reward, 640_000);
        assert!(reward > tx_fee_at_floor * 100);
    }

    #[test]
    fn absurd_prices_do_not_wrap() {
        let e = Economics {
            backing_per_step: u64::MAX,
            stim_cost_steps: u64::MAX,
            body_capacity: u64::MAX,
        };
        // The requirement saturates at the top of u64 rather than wrapping to something
        // cheap, so an absurd price makes the fly unaffordable.
        assert_eq!(e.required_capacity(2), u64::MAX);
        assert_eq!(e.stim_cost(255), u64::MAX);
        // The release stays an exact i128 multiple: no wraparound, no sign flip.
        assert_eq!(e.capacity_release(0, 2), -(u64::MAX as i128) * 2);
    }

    #[test]
    fn free_economics_never_charges() {
        let e = Economics::FREE;
        assert_eq!(e.required_capacity(1_000_000_000), 0);
        assert_eq!(e.capacity_release(1_000, 936), 0);
        assert_eq!(e.stim_cost(255), 0);
    }
}
