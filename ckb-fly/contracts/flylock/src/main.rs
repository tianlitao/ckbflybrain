//! `flylock` — the lock the fly's state cell wears.
//!
//! # Why the fly needs a lock that anyone can spend
//!
//! Upstream, *anyone* can call `FlyBrain.tick()`. The contract is the authority; the
//! caller is incidental. CKB splits that authority in two: a cell's **lock** decides who
//! may consume it, and its **type script** decides what the transition must look like.
//!
//! If the state cell wore the owner's `secp256k1` lock, then only the owner could tick,
//! and the fly would become a private toy with a public audience. So the state cell wears
//! *this* lock instead: it accepts every transaction. All of the fly's rules live in the
//! type script, where anyone can read them and anyone can satisfy them.
//!
//! # Is that safe?
//!
//! A permissive lock does not make the fly stealable, because the type script requires the
//! output cell to wear **the same lock as the input**. A ticker cannot redirect the fly to
//! their own key, cannot destroy it (exactly one successor is required), and cannot rewind
//! it (the successor must be the exact result of applying the declared action). The worst
//! a griefer can do is advance the fly — which is the intended behaviour.
//!
//! # Curated flies
//!
//! Because the type script pins `output.lock == input.lock`, the lock is chosen once, at
//! genesis, and can never change. A deployer who wants a private fly simply creates the
//! genesis cell under a `secp256k1_blake160` lock instead of this one, and the same type
//! script enforces the rest. Nothing else has to change — which is the point of keeping
//! the two concerns in separate scripts.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

/// Accept every transaction.
///
/// Returning `0` is the whole implementation. There is deliberately no condition here:
/// any condition added to this lock would silently narrow who may advance the fly, and
/// the fly's actual rules belong in the type script, where they are auditable.
pub fn program_entry() -> i8 {
    0
}
