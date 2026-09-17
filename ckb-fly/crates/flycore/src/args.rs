//! What lives in the type script's args.
//!
//! CKB treats a script's args as part of its identity: the same code hash with
//! different args is a *different* type script. That is exactly the property the fly
//! needs, and it is a free upgrade over the EVM, where `immutable` parameters lived in
//! the bytecode and every parameter change required a redeployment.
//!
//! ```text
//! [0]         u8        args version (2)
//! [1..9]      8         instance — a nonce, so that two flies are two organisms
//! [9..41]     32        Params (see `params::Params::to_bytes`)
//! [41..73]    32        keccak256 of the circuit table
//! [73..97]    24        Economics (see `economics::Economics::to_bytes`)
//! ```
//!
//! # Why there is a nonce
//!
//! The first version of this had no instance field, and the omission was invisible for as
//! long as only one fly existed. Everything else in the args describes a *species*: two
//! flies with the same parameters, the same connectome and the same prices have the same
//! type script, and therefore the same identity as far as the chain is concerned. So
//! "find the cell wearing the fly's type script" finds an arbitrary one of them, and a
//! keeper driving two flies ticks first one and then the other — the step counter goes
//! backwards, and nothing errors.
//!
//! Upstream has no such ambiguity: each fly is its own contract deployment, so each has its
//! own address. The nonce is the CKB spelling of that address. Without it the "anyone can
//! create a new organism" promise in the README is not actually usable, because two
//! organisms would be indistinguishable.
//!
//! It sits next to the version rather than at the end because the first nine bytes are what
//! say *which* organism this is; the rest describes what it is made of.
//!
//! # Why the circuit is a hash and not the table
//!
//! Putting the circuit *hash* rather than the circuit itself in args keeps the script
//! small and lets many organisms share one code cell while each pins its own
//! connectome. The table itself arrives as a `cell_dep`, and the type script hashes it
//! before trusting a single byte — the 15 KB table is never taken on faith.
//!
//! 97 bytes of args cost 97 CKB of capacity in the state cell. The alternative,
//! embedding the table in the script, would put 15 KB in the code cell and make every
//! connectome a separate deployment; this is both cheaper and more general.

use crate::economics::{ECONOMICS_LEN, Economics};
use crate::params::{PARAMS_LEN, Params};

/// Args version.
///
/// Bumped from 1 when the instance field was added: an old-format arg must be *refused*,
/// not misread as a fly with a nonsensical genome.
pub const VERSION: u8 = 2;

/// Byte length of the instance nonce.
pub const INSTANCE_LEN: usize = 8;

/// Total args length: 1 + 8 + 32 + 32 + 24.
pub const ARGS_LEN: usize = 1 + INSTANCE_LEN + PARAMS_LEN + 32 + ECONOMICS_LEN;

/// The immutable half of an organism's identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptArgs {
    /// Which organism this is, as opposed to what it is made of.
    ///
    /// A nonce chosen when the fly is created and never changed — the fly's address. Two
    /// flies with identical parameters must differ here, or they are the same organism to
    /// the chain and every tool that tracks "the fly" will sometimes track the wrong one.
    pub instance: [u8; INSTANCE_LEN],
    /// Dynamics parameters.
    pub params: Params,
    /// keccak256 of the circuit table the organism runs.
    ///
    /// For the FlyWire ring attractor this is
    /// `0xffbe0e7f28e1f0dd2cfaa01d1d221c502bf41c1fd519ebfe8d9b8203e7cedfc2`, the same
    /// value the BSC contract reports from `circuitHash()`.
    pub circuit_hash: [u8; 32],
    /// What the fly's life costs.
    pub economics: Economics,
}

impl ScriptArgs {
    /// Build args from their parts.
    pub const fn new(
        instance: [u8; INSTANCE_LEN],
        params: Params,
        circuit_hash: [u8; 32],
        economics: Economics,
    ) -> Self {
        Self {
            instance,
            params,
            circuit_hash,
            economics,
        }
    }

    /// Serialize to the on-chain form.
    pub fn to_bytes(&self) -> [u8; ARGS_LEN] {
        let mut b = [0u8; ARGS_LEN];
        b[0] = VERSION;
        b[1..1 + INSTANCE_LEN].copy_from_slice(&self.instance);
        let o = 1 + INSTANCE_LEN;
        b[o..o + PARAMS_LEN].copy_from_slice(&self.params.to_bytes());
        b[o + PARAMS_LEN..o + PARAMS_LEN + 32].copy_from_slice(&self.circuit_hash);
        b[o + PARAMS_LEN + 32..].copy_from_slice(&self.economics.to_bytes());
        b
    }

    /// Parse the on-chain form. Returns `None` if the length, version or either encoding
    /// is not canonical.
    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() != ARGS_LEN || b[0] != VERSION {
            return None;
        }
        let mut instance = [0u8; INSTANCE_LEN];
        instance.copy_from_slice(&b[1..1 + INSTANCE_LEN]);
        let o = 1 + INSTANCE_LEN;
        let params = Params::from_bytes(&b[o..o + PARAMS_LEN])?;
        let mut circuit_hash = [0u8; 32];
        circuit_hash.copy_from_slice(&b[o + PARAMS_LEN..o + PARAMS_LEN + 32]);
        let economics = Economics::from_bytes(&b[o + PARAMS_LEN + 32..])?;
        Some(Self {
            instance,
            params,
            circuit_hash,
            economics,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ScriptArgs {
        let mut h = [0u8; 32];
        h[0] = 0xff;
        h[31] = 0xc2;
        ScriptArgs::new(
            [1, 2, 3, 4, 5, 6, 7, 8],
            Params::V1_DEPLOYED,
            h,
            Economics::TESTNET,
        )
    }

    #[test]
    fn args_len_is_97() {
        assert_eq!(ARGS_LEN, 97);
        assert_eq!(sample().to_bytes().len(), 97);
        // The first nine bytes are the identity: a version and which organism this is.
        assert_eq!(sample().to_bytes()[0], VERSION);
        assert_eq!(&sample().to_bytes()[1..9], &[1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn round_trips() {
        let a = sample();
        let b = a.to_bytes();
        assert_eq!(b[0], VERSION);
        assert_eq!(ScriptArgs::from_bytes(&b), Some(a));
    }

    #[test]
    fn rejects_malformed_args() {
        let good = sample().to_bytes();

        assert_eq!(ScriptArgs::from_bytes(&good[..88]), None, "short");

        let mut long = good.to_vec();
        long.push(0);
        assert_eq!(ScriptArgs::from_bytes(&long), None, "long");

        let mut b = good;
        // Version 1 is the format before the instance field existed. It must be refused,
        // not misread: its params begin one byte earlier than this version looks for them.
        b[0] = 1;
        assert_eq!(ScriptArgs::from_bytes(&b), None, "version");
        let mut b = good;
        b[0] = 99;
        assert_eq!(ScriptArgs::from_bytes(&b), None, "unknown version");

        let mut b = good;
        b[1 + INSTANCE_LEN + 30] = 0; // params byte 30 = max_steps = 0
        assert_eq!(ScriptArgs::from_bytes(&b), None, "max_steps");

        // An old-format arg is one byte short of a params field that starts where this
        // version expects it, so it must be refused rather than misread.
        let mut old = vec![1u8];
        old.extend_from_slice(&Params::V1_DEPLOYED.to_bytes());
        old.extend_from_slice(&[0u8; 32]);
        old.extend_from_slice(&Economics::TESTNET.to_bytes());
        assert_eq!(old.len(), 89);
        assert_eq!(ScriptArgs::from_bytes(&old), None, "version 1 args");
    }

    #[test]
    fn distinguishes_organisms() {
        // Different params, circuit or economics must all produce different args, or CKB
        // would treat two different organisms as the same type script.
        let base = sample().to_bytes();

        assert_ne!(
            base,
            ScriptArgs::new(
                sample().instance,
                Params::V2,
                sample().circuit_hash,
                Economics::TESTNET
            )
            .to_bytes()
        );

        let mut other_circuit = sample().circuit_hash;
        other_circuit[0] ^= 1;
        assert_ne!(
            base,
            ScriptArgs::new(
                sample().instance,
                Params::V1_DEPLOYED,
                other_circuit,
                Economics::TESTNET
            )
            .to_bytes()
        );

        assert_ne!(
            base,
            ScriptArgs::new(
                sample().instance,
                Params::V1_DEPLOYED,
                sample().circuit_hash,
                Economics::FREE
            )
            .to_bytes()
        );

        // And the one that matters most: two flies with the same genome are still two flies.
        let mut other_instance = sample().instance;
        other_instance[0] ^= 1;
        assert_ne!(
            base,
            ScriptArgs::new(
                other_instance,
                Params::V1_DEPLOYED,
                sample().circuit_hash,
                Economics::TESTNET
            )
            .to_bytes(),
            "a different instance must be a different organism",
        );
    }
}
