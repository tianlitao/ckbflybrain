//! Applying an [`Action`] to a [`Sim`].
//!
//! This is the function the type script runs. Keeping it here — rather than in the
//! contract — means the host tests, the transaction builder and the on-chain validator
//! all execute literally the same code, so "the builder produced a valid transaction"
//! and "the validator accepted it" cannot drift apart.

use crate::action::Action;
use crate::economics::Economics;
use crate::sim::Sim;

/// Why an action was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyError {
    /// The fly is dead. Only `Resurrect` is meaningful.
    Dead,
    /// The fly is alive, so it cannot be resurrected.
    NotDead,
    /// `tick` refused the step count, or could not run a single step.
    BadTick,
    /// `Resurrect` tried to set `born_block` earlier than the previous life's.
    BadBornBlock,
    /// `Feed` on a dead fly.
    ///
    /// Upstream's `_feed()` has no `alive` check, so feeding a corpse burns the tokens
    /// and adds energy that can never be spent — the fly is dead and `tick()` reverts.
    /// On CKB the burn is a real, irreversible destruction of coins, so the port refuses
    /// instead of silently taking the money.
    FeedWhileDead,
    /// `Feed` or `Resurrect` asked for zero steps.
    ZeroAmount,
}

impl<'a> Sim<'a> {
    /// Apply `action`, mirroring the corresponding `FlyBrain.sol` external call.
    ///
    /// Note that `Stimulate` also advances the simulation, because that is what the
    /// upstream `stimulate(channel, param, strength, steps)` does: the fourth argument is
    /// the number of steps to run immediately so the caller sees the reaction in the same
    /// transaction. On CKB fusing them is not just convenient but necessary — a state
    /// cell can only be consumed once per version, so two separate transactions cannot
    /// both build on the same state.
    /// Spend `steps` steps of life without simulating them.
    ///
    /// Used for the stimulus charge, which is a price rather than an action. Dies exactly
    /// as a tick does when the last step is spent, so an expensive stimulus can kill the
    /// fly — which is the correct behaviour and worth being explicit about.
    fn spend_life(&mut self, steps: u64) {
        if steps == 0 || !self.alive {
            return;
        }
        self.energy = self.energy.saturating_sub(steps);
        if self.energy == 0 {
            self.alive = false;
        }
    }

    pub fn apply(&mut self, action: Action, econ: &Economics) -> Result<(), ApplyError> {
        match action {
            Action::Tick { steps } => {
                if !self.alive {
                    return Err(ApplyError::Dead);
                }
                self.tick(steps).map(|_| ()).ok_or(ApplyError::BadTick)
            }

            Action::Stimulate {
                channel,
                param,
                strength,
                steps,
            } => {
                if !self.alive {
                    return Err(ApplyError::Dead);
                }
                // `Action::decode` has already range-checked the arguments against the
                // parameters, so a failure here would mean the two disagree.
                if !self.stimulate(channel, param, strength) {
                    return Err(ApplyError::BadTick);
                }
                self.tick(steps).map(|_| ()).ok_or(ApplyError::BadTick)?;

                // Being steered costs life. These steps are spent but not simulated: the
                // fly pays for the stimulus without moving forward. Charging in life
                // rather than in capacity is what keeps `capacity == body + energy *
                // backing` true, because the capacity delta is then always exactly the
                // value of the life consumed.
                self.spend_life(econ.stim_cost(strength));
                Ok(())
            }

            Action::Feed { steps } => {
                if steps == 0 {
                    return Err(ApplyError::ZeroAmount);
                }
                if !self.alive {
                    return Err(ApplyError::FeedWhileDead);
                }
                self.feed(steps).then_some(()).ok_or(ApplyError::ZeroAmount)
            }

            Action::Resurrect { steps, born_block } => {
                if steps == 0 {
                    return Err(ApplyError::ZeroAmount);
                }
                if self.alive {
                    return Err(ApplyError::NotDead);
                }
                // `born_block` is cosmetic, but letting it go backwards would make the
                // lineage lie about when a life began, so it is monotonic.
                if born_block < self.born_block {
                    return Err(ApplyError::BadBornBlock);
                }
                self.resurrect(steps, born_block)
                    .then_some(())
                    .ok_or(ApplyError::ZeroAmount)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economics::Economics;
    use crate::params::Params;
    use crate::sim::{CH_CUE, Sim};
    use flycircuit::embedded;

    fn econ() -> Economics {
        Economics::TESTNET
    }

    fn genesis(energy: u64) -> Sim<'static> {
        genesis_at(energy, 0)
    }

    fn genesis_at(energy: u64, born_block: u64) -> Sim<'static> {
        Sim::genesis(embedded(), Params::V1_DEPLOYED, energy, born_block)
    }

    #[test]
    fn tick_advances_and_refuses_when_dead() {
        let mut sim = genesis(100);
        sim.apply(Action::Tick { steps: 32 }, &econ()).unwrap();
        assert_eq!(sim.step, 32);
        assert_eq!(sim.energy, 68);

        sim.apply(Action::Tick { steps: 64 }, &econ()).unwrap();
        assert_eq!(sim.step, 96);
        assert_eq!(sim.energy, 4);
        assert!(sim.alive);

        sim.apply(Action::Tick { steps: 4 }, &econ()).unwrap();
        assert_eq!(sim.step, 100);
        assert!(!sim.alive);

        assert_eq!(
            sim.apply(Action::Tick { steps: 1 }, &econ()),
            Err(ApplyError::Dead)
        );
        assert_eq!(
            sim.apply(
                Action::Stimulate {
                    channel: CH_CUE,
                    param: 0,
                    strength: 1,
                    steps: 1
                },
                &econ()
            ),
            Err(ApplyError::Dead)
        );
    }

    #[test]
    fn a_tick_longer_than_max_steps_is_refused() {
        let mut sim = genesis(1_000);
        assert_eq!(
            sim.apply(Action::Tick { steps: 65 }, &econ()),
            Err(ApplyError::BadTick)
        );
        assert_eq!(
            sim.apply(Action::Tick { steps: 0 }, &econ()),
            Err(ApplyError::BadTick)
        );
        assert_eq!(sim.step, 0, "a refused tick must not advance anything");
    }

    #[test]
    fn stimulate_arms_and_advances_in_one_action() {
        // The same action sequence the mainnet replay uses, expressed as actions rather
        // than as direct calls, so the action layer is pinned to the chain trajectory too.
        let mut sim = genesis(1_000_000);
        sim.apply(Action::Tick { steps: 64 }, &econ()).unwrap();
        sim.apply(Action::Feed { steps: 10_000 }, &econ()).unwrap();
        sim.apply(
            Action::Stimulate {
                channel: CH_CUE,
                param: 4,
                strength: 4,
                steps: 32,
            },
            &econ(),
        )
        .unwrap();

        assert_eq!(sim.step, 96);
        assert_eq!(sim.total_spikes, 279, "the same mainnet cue response");
        assert_eq!((sim.head_x, sim.head_y), (-2446, 11821));
        assert_eq!(sim.stim_channel, CH_CUE);
        assert_eq!(sim.stim_until, 128, "armed at step 64 for STIM_TTL = 64");
        // 32 simulated steps plus 4 units of strength at 128 steps each: the fly pays for
        // being steered without moving forward.
        assert_eq!(
            sim.energy,
            1_000_000 - 64 + 10_000 - 32 - econ().stim_cost(4)
        );
    }

    #[test]
    fn feed_buys_life_but_not_for_a_corpse() {
        let mut sim = genesis(1);
        sim.apply(Action::Feed { steps: 100 }, &econ()).unwrap();
        assert_eq!(sim.energy, 101);

        let mut sim = genesis(1);
        sim.apply(Action::Tick { steps: 1 }, &econ()).unwrap();
        assert!(!sim.alive);
        assert_eq!(
            sim.apply(Action::Feed { steps: 100 }, &econ()),
            Err(ApplyError::FeedWhileDead),
            "upstream would take the money and give nothing"
        );
        assert_eq!(sim.energy, 0);
    }

    #[test]
    fn resurrect_requires_death_and_energy() {
        // A fly born at block 100, so `born_block` monotonicity has something to bite on.
        let mut sim = genesis_at(1, 100);
        assert_eq!(
            sim.apply(
                Action::Resurrect {
                    steps: 10,
                    born_block: 200
                },
                &econ()
            ),
            Err(ApplyError::NotDead)
        );

        sim.apply(Action::Tick { steps: 1 }, &econ()).unwrap();
        assert!(!sim.alive);

        assert_eq!(
            sim.apply(
                Action::Resurrect {
                    steps: 0,
                    born_block: 200
                },
                &econ()
            ),
            Err(ApplyError::ZeroAmount)
        );
        assert_eq!(
            sim.apply(
                Action::Resurrect {
                    steps: 10,
                    born_block: 99
                },
                &econ()
            ),
            Err(ApplyError::BadBornBlock),
            "born_block must not go backwards"
        );
        assert!(!sim.alive, "a refused resurrection must not revive the fly");

        // Equal is allowed: two lives may begin in the same block.
        sim.apply(
            Action::Resurrect {
                steps: 10,
                born_block: 100,
            },
            &econ(),
        )
        .unwrap();
        assert!(sim.alive);
        assert_eq!(sim.generation, 1);
        assert_eq!(sim.energy, 10);
        assert_eq!(sim.born_block, 100);
        assert_eq!(sim.step, 1, "resurrection does not advance time");
    }

    #[test]
    fn resurrect_then_tick_actually_lives() {
        // The bug this guards: upstream's `resurrect(0)` burns the full price and the fly
        // dies again on the very next tick. A resurrection must produce a fly that can
        // take at least one step.
        let mut sim = genesis(1);
        sim.apply(Action::Tick { steps: 1 }, &econ()).unwrap();
        sim.apply(
            Action::Resurrect {
                steps: 1,
                born_block: 1,
            },
            &econ(),
        )
        .unwrap();
        sim.apply(Action::Tick { steps: 1 }, &econ()).unwrap();
        assert_eq!(sim.step, 2);
        assert_eq!(sim.life_steps, 1);
        assert!(
            !sim.alive,
            "one step of energy is spent, so it dies again — but it lived"
        );
    }
}
