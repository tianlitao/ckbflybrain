//! The actions a transaction can perform on a fly.
//!
//! # Why actions live in the witness
//!
//! CKB has no EVM-style event log, and — more importantly — a validator that has to
//! guess *what the caller intended* cannot be strict. So the action is declared
//! explicitly in the witness, and the type script's job becomes a pure function check:
//!
//! ```text
//! output.data == simulate(input.data, action)
//! ```
//!
//! That is a much stronger statement than "the output is consistent with some action".
//! There is no room for an operator to nudge the state, skip a step, or invent an
//! action the contract never had: the validator recomputes the successor and compares
//! bytes. The witness is the *input* to that function, not a claim about it.
//!
//! The action goes in `WitnessArgs.input_type` of witness 0. CKB's convention is that
//! `witnesses[i]` carries the unlock data for `inputs[i]`; since there is exactly one
//! input cell of this type, a single well-known slot is unambiguous, and a lock that
//! needs no signature (see `contracts/flylock`) leaves the slot free.
//!
//! # Encoding
//!
//! ```text
//! [0]      u8    tag
//! [1..]          payload, little-endian, fixed width per tag
//! ```
//!
//! | tag | action | payload | length |
//! |---|---|---|---|
//! | 1 | `Tick` | `steps: u16` | 3 |
//! | 2 | `Stimulate` | `channel: u8, param: u8, strength: u8, steps: u16` | 6 |
//! | 3 | `Feed` | `steps: u64` | 9 |
//! | 4 | `Resurrect` | `steps: u64, born_block: u64` | 17 |
//!
//! Every action carries the number of steps to advance, because on CKB "stimulate and
//! tick" is one transaction, not two: the state cell can only be consumed once per
//! version, so fusing the actions is what keeps the fly moving at a predictable rate.

/// Advance the brain by `steps` steps. Free, as upstream: the ticker pays only the
/// transaction fee.
pub const TAG_TICK: u8 = 1;
/// Arm a stimulus and advance `steps` steps.
pub const TAG_STIMULATE: u8 = 2;
/// Buy `steps` steps of life by burning CKB.
pub const TAG_FEED: u8 = 3;
/// Begin a new life. Only valid while dead.
pub const TAG_RESURRECT: u8 = 4;

/// Minimum encoded length of an [`Action`]: the tag alone.
pub const MIN_ACTION_LEN: usize = 1;

/// Maximum encoded length of an [`Action`]: `Resurrect`'s tag + two `u64`s.
pub const MAX_ACTION_LEN: usize = 17;

/// What a transaction asks the fly to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Run the simulation forward.
    Tick {
        /// Steps to advance, `1..=params.max_steps`.
        steps: u16,
    },
    /// Arm a stimulus, then run the simulation forward.
    Stimulate {
        /// Stimulus channel, `1..=4`.
        channel: u8,
        /// CUE: the wedge to light up. Ignored for other channels.
        param: u8,
        /// Stimulus strength, `1..=255`.
        strength: u8,
        /// Steps to advance after arming.
        steps: u16,
    },
    /// Add steps of life. Costs CKB, which is burned as transaction fee.
    Feed {
        /// Steps of life to buy.
        steps: u64,
    },
    /// Reset a dead fly into a new life with `steps` steps of energy.
    Resurrect {
        /// Steps of energy for the new life. Must be non-zero: upstream's
        /// `resurrect(0)` burns the full price and then dies again on the next tick.
        steps: u64,
        /// Block number this life begins at. Must not go backwards.
        born_block: u64,
    },
}

/// Errors from decoding a witness action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionError {
    /// The witness is shorter than the tag's payload requires.
    Truncated,
    /// The tag is not one of the four defined actions.
    UnknownTag(u8),
    /// The payload has trailing bytes. Rejected so that a witness has exactly one
    /// encoding — otherwise two different witnesses could claim the same action.
    TrailingBytes,
    /// `steps` is outside `1..=params.max_steps` for an action that ticks.
    BadSteps,
    /// A stimulus argument is out of range.
    BadStimulus,
    /// `Feed` or `Resurrect` asked for zero steps.
    ZeroAmount,
}

impl Action {
    /// Serialize into `out`, which must be at least [`MAX_ACTION_LEN`] bytes. Returns the
    /// number of bytes written.
    pub fn encode(&self, out: &mut [u8]) -> usize {
        debug_assert!(out.len() >= MAX_ACTION_LEN);
        match *self {
            Action::Tick { steps } => {
                out[0] = TAG_TICK;
                out[1..3].copy_from_slice(&steps.to_le_bytes());
                3
            }
            Action::Stimulate {
                channel,
                param,
                strength,
                steps,
            } => {
                out[0] = TAG_STIMULATE;
                out[1] = channel;
                out[2] = param;
                out[3] = strength;
                out[4..6].copy_from_slice(&steps.to_le_bytes());
                6
            }
            Action::Feed { steps } => {
                out[0] = TAG_FEED;
                out[1..9].copy_from_slice(&steps.to_le_bytes());
                9
            }
            Action::Resurrect { steps, born_block } => {
                out[0] = TAG_RESURRECT;
                out[1..9].copy_from_slice(&steps.to_le_bytes());
                out[9..17].copy_from_slice(&born_block.to_le_bytes());
                17
            }
        }
    }

    /// Serialize into a fixed buffer plus a length, for callers that cannot allocate.
    pub fn encode_fixed(&self) -> ([u8; MAX_ACTION_LEN], usize) {
        let mut buf = [0u8; MAX_ACTION_LEN];
        let n = self.encode(&mut buf);
        (buf, n)
    }

    /// Parse and validate an action against the parameters it will run under.
    ///
    /// Validation happens here rather than in the type script so that the contract and
    /// the transaction builder cannot disagree about what is legal.
    pub fn decode(b: &[u8], params: &crate::params::Params) -> Result<Self, ActionError> {
        let tag = *b.first().ok_or(ActionError::Truncated)?;
        let rd_u16 = |o: usize| -> Result<u16, ActionError> {
            let s = b.get(o..o + 2).ok_or(ActionError::Truncated)?;
            Ok(u16::from_le_bytes([s[0], s[1]]))
        };
        let rd_u64 = |o: usize| -> Result<u64, ActionError> {
            let s = b.get(o..o + 8).ok_or(ActionError::Truncated)?;
            Ok(u64::from_le_bytes([
                s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7],
            ]))
        };
        let check_steps = |steps: u16| -> Result<u16, ActionError> {
            if steps == 0 || steps > params.max_steps as u16 {
                return Err(ActionError::BadSteps);
            }
            Ok(steps)
        };

        let (action, want_len) = match tag {
            TAG_TICK => (
                Action::Tick {
                    steps: check_steps(rd_u16(1)?)?,
                },
                3,
            ),
            TAG_STIMULATE => {
                let s = b.get(1..5).ok_or(ActionError::Truncated)?;
                let (channel, param, strength) = (s[0], s[1], s[2]);
                // Mirrors `_stimulate`'s reverts.
                if channel == 0 || channel > crate::sim::CH_SHOCK || strength == 0 {
                    return Err(ActionError::BadStimulus);
                }
                if channel == crate::sim::CH_CUE && param as usize >= crate::sim::WEDGES {
                    return Err(ActionError::BadStimulus);
                }
                (
                    Action::Stimulate {
                        channel,
                        param,
                        strength,
                        steps: check_steps(rd_u16(4)?)?,
                    },
                    6,
                )
            }
            TAG_FEED => {
                let steps = rd_u64(1)?;
                if steps == 0 {
                    return Err(ActionError::ZeroAmount);
                }
                (Action::Feed { steps }, 9)
            }
            TAG_RESURRECT => {
                let steps = rd_u64(1)?;
                if steps == 0 {
                    return Err(ActionError::ZeroAmount);
                }
                (
                    Action::Resurrect {
                        steps,
                        born_block: rd_u64(9)?,
                    },
                    17,
                )
            }
            other => return Err(ActionError::UnknownTag(other)),
        };

        if b.len() != want_len {
            return Err(ActionError::TrailingBytes);
        }
        Ok(action)
    }

    /// Steps this action advances the simulation by. `Feed` and `Resurrect` do not tick.
    pub const fn steps(&self) -> u32 {
        match *self {
            Action::Tick { steps } | Action::Stimulate { steps, .. } => steps as u32,
            Action::Feed { .. } | Action::Resurrect { .. } => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::Params;

    fn round_trip(a: Action) {
        let (buf, n) = a.encode_fixed();
        assert_eq!(Action::decode(&buf[..n], &Params::V2).unwrap(), a);
    }

    #[test]
    fn round_trips() {
        round_trip(Action::Tick { steps: 1 });
        round_trip(Action::Tick { steps: 64 });
        round_trip(Action::Stimulate {
            channel: 1,
            param: 4,
            strength: 4,
            steps: 32,
        });
        round_trip(Action::Stimulate {
            channel: 4,
            param: 0,
            strength: 255,
            steps: 64,
        });
        round_trip(Action::Feed { steps: 10_000 });
        round_trip(Action::Resurrect {
            steps: 5,
            born_block: 20_000_000,
        });
    }

    #[test]
    fn encodings_are_exactly_sized() {
        assert_eq!(Action::Tick { steps: 64 }.encode_fixed().1, 3);
        assert_eq!(
            Action::Stimulate {
                channel: 1,
                param: 4,
                strength: 4,
                steps: 32
            }
            .encode_fixed()
            .1,
            6
        );
        assert_eq!(Action::Feed { steps: 1 }.encode_fixed().1, 9);
        assert_eq!(
            Action::Resurrect {
                steps: 1,
                born_block: 1
            }
            .encode_fixed()
            .1,
            17
        );
    }

    #[test]
    fn only_ticking_actions_advance_time() {
        assert_eq!(Action::Tick { steps: 64 }.steps(), 64);
        assert_eq!(
            Action::Stimulate {
                channel: 1,
                param: 0,
                strength: 1,
                steps: 32
            }
            .steps(),
            32
        );
        assert_eq!(Action::Feed { steps: 999 }.steps(), 0);
        assert_eq!(
            Action::Resurrect {
                steps: 999,
                born_block: 0
            }
            .steps(),
            0
        );
    }

    #[test]
    fn rejects_bad_actions() {
        let p = Params::V2; // max_steps = 64

        assert_eq!(Action::decode(&[], &p).unwrap_err(), ActionError::Truncated);
        assert_eq!(
            Action::decode(&[9, 0, 0], &p).unwrap_err(),
            ActionError::UnknownTag(9)
        );
        assert_eq!(
            Action::decode(&[TAG_TICK, 0, 0], &p).unwrap_err(),
            ActionError::BadSteps
        );
        assert_eq!(
            Action::decode(&[TAG_TICK, 65, 0], &p).unwrap_err(),
            ActionError::BadSteps
        );
        assert_eq!(
            Action::decode(&[TAG_TICK, 1], &p).unwrap_err(),
            ActionError::Truncated
        );
        // Trailing bytes would give an action two encodings.
        assert_eq!(
            Action::decode(&[TAG_TICK, 1, 0, 0], &p).unwrap_err(),
            ActionError::TrailingBytes
        );

        // Stimulus validation mirrors `_stimulate`.
        assert_eq!(
            Action::decode(&[TAG_STIMULATE, 0, 0, 1, 1, 0], &p).unwrap_err(),
            ActionError::BadStimulus,
            "channel 0 is CH_NONE"
        );
        assert_eq!(
            Action::decode(&[TAG_STIMULATE, 5, 0, 1, 1, 0], &p).unwrap_err(),
            ActionError::BadStimulus,
            "channel 5 does not exist"
        );
        assert_eq!(
            Action::decode(&[TAG_STIMULATE, 1, 0, 0, 1, 0], &p).unwrap_err(),
            ActionError::BadStimulus,
            "strength 0"
        );
        assert_eq!(
            Action::decode(&[TAG_STIMULATE, 1, 16, 1, 1, 0], &p).unwrap_err(),
            ActionError::BadStimulus,
            "wedge 16 is out of range"
        );

        assert_eq!(
            Action::decode(&[TAG_FEED, 0, 0, 0, 0, 0, 0, 0, 0], &p).unwrap_err(),
            ActionError::ZeroAmount,
            "upstream `_feed` reverts on zero"
        );
        assert_eq!(
            Action::decode(
                &[
                    TAG_RESURRECT,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    1,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                &p
            )
            .unwrap_err(),
            ActionError::ZeroAmount,
            "upstream `_resurrect(0)` burns the price and then dies again; refused"
        );
    }

    #[test]
    fn stimulus_strength_may_be_maximal() {
        // 255 is legal upstream; only 0 is rejected.
        let a = Action::Stimulate {
            channel: 4,
            param: 0,
            strength: 255,
            steps: 1,
        };
        let (buf, n) = a.encode_fixed();
        assert_eq!(Action::decode(&buf[..n], &Params::V2).unwrap(), a);
    }
}
