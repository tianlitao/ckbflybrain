//! The organism: a bit-exact port of `FlyBrain.sol`'s spiking simulation.
//!
//! # Why "bit-exact"
//!
//! The upstream project's central claim is that its on-chain dynamics are
//! reproducible: `sim/flysim.py` is a Python replica and `Differential.t.sol` replays
//! real BSC mainnet transactions and asserts exact spike counts and head vectors.
//! Porting the arithmetic exactly — rather than "cleaning it up" — buys three things:
//!
//! 1. The mainnet differential fixture becomes a Rust unit test, so the port is
//!    validated against real chain history instead of against my own expectations.
//! 2. The same `keccak256(step)` noise sequence is preserved, so an off-chain replica
//!    written for BSC keeps working.
//! 3. Any deviation is a bug, not a design choice. There is nowhere to hide.
//!
//! # The three subtleties that make this non-obvious
//!
//! * **Truncating division.** The EVM's `SDIV` truncates toward zero; `-95_000 / 1024`
//!   is `-92`, not `-93`. Rust's `/` on integers has the same semantics, so
//!   [`div_trunc`] is a thin wrapper — but the *intermediates* are evaluated in 256-bit
//!   words on the EVM, so every product is widened here to avoid `i32`/`i64` overflow
//!   (debug builds have overflow checks on, and a panic in a validator is a failed
//!   transaction).
//! * **Wide memory, narrow storage.** `v`, `bias` and `inp` are `int32[]` in EVM memory
//!   but the assembly writes full 256-bit words into those slots. Values therefore
//!   accumulate at full width during a tick and are only narrowed when stored: `v` is
//!   clamped to `i16`, `inp` is truncated to `i32`, `bias` to `i8`. [`Sim`] mirrors that
//!   by computing in `i64` and narrowing only in [`Sim::encode`].
//! * **Spikes are synchronous.** A neuron that fires at step `t` delivers current that
//!   is *integrated at step `t+1`*. Pass 1 of a step reads the input buffer and zeroes
//!   it; pass 2 writes the next step's input. Nothing in pass 2 can affect pass 1.

use flycircuit::{Circuit, T_DELTA7, T_EPGT, T_PEN_A, T_PEN_B};

/// Compass wedge count and the "no wedge" sentinel, re-exported from the circuit format
/// so callers of the simulation do not need a second import.
pub use flycircuit::{NO_WEDGE, WEDGES};

use crate::keccak::keccak256;
use crate::params::Params;

/// Upper bound on the neuron count. The table header stores `N` in a single byte, so
/// 255 is the format's own limit; fixed-size arrays let the contract run without a
/// heap allocator in the hot loop.
pub const MAX_N: usize = 255;

/// Bounds on the engram (`bias`) term.
pub const BIAS_MAX: i32 = 24;

/// Cells walked per step at full bump strength, in 1/256ths of a cell.
pub const STRIDE: i64 = 16;

/// Stimulus channels, matching `FlyBrain.sol`'s `CH_*` constants.
pub const CH_NONE: u8 = 0;
/// Visual landmark: drives EPG/EPGt neurons of one wedge.
pub const CH_CUE: u8 = 1;
/// Angular velocity: drives left-side PEN neurons.
pub const CH_TURN_LEFT: u8 = 2;
/// Angular velocity: drives right-side PEN neurons.
pub const CH_TURN_RIGHT: u8 = 3;
/// Noxious stimulus: drives every Δ7 neuron, collapsing the bump.
pub const CH_SHOCK: u8 = 4;

/// `cos` of each wedge centre, scaled to 127.
pub const COS16: [i64; WEDGES] = [
    125, 106, 71, 25, -25, -71, -106, -125, -125, -106, -71, -25, 25, 71, 106, 125,
];

/// `sin` of each wedge centre, scaled to 127.
pub const SIN16: [i64; WEDGES] = [
    25, 71, 106, 125, 125, 106, 71, 25, -25, -71, -106, -125, -125, -106, -71, -25,
];

/// Division that truncates toward zero, i.e. the EVM's `SDIV`.
///
/// Rust's integer `/` already does this; the wrapper exists so that every division in
/// the simulation is grep-able and so that the intent survives a future refactor.
#[inline(always)]
pub const fn div_trunc(a: i64, b: i64) -> i64 {
    a / b
}

/// Integer square root, identical to `FlyBrain._sqrt` (Newton's method).
///
/// The caller guarantees `x <= 2^63`, which holds because `x` is `hx² + hy²` and
/// `|hx|, |hy| <= 155 * 127`. That bound is what makes `(x + 1)` safe under the
/// contract's overflow checks.
pub fn isqrt(x: u64) -> u64 {
    if x == 0 {
        return 0;
    }
    // `(x + 1) / 2`, as in `FlyBrain._sqrt`. Spelled `div_ceil` because it is the same
    // value and, unlike `(x + 1) / 2`, cannot overflow when `x` is near `u64::MAX`.
    let mut z = x.div_ceil(2);
    let mut y = x;
    while z < y {
        y = z;
        z = (x / z + z) / 2;
    }
    y
}

/// What one [`Sim::tick`] did, mirroring the `Ticked` event's payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TickResult {
    /// Steps actually executed (`min(requested, energy)`).
    pub steps: u32,
    /// Spikes across all neurons and all steps of this tick.
    pub spikes: u32,
    /// Compass population vector, x component.
    pub head_x: i32,
    /// Compass population vector, y component.
    pub head_y: i32,
    /// Position after walking, in 1/256ths of a cell.
    pub pos_x: i64,
    /// Position after walking, in 1/256ths of a cell.
    pub pos_y: i64,
    /// Energy remaining.
    pub energy: u64,
    /// `true` if the fly died during this tick.
    pub died: bool,
}

/// Errors from decoding a state cell.
///
/// Defined in [`crate::state`], where the decoding lives, and re-exported here because
/// callers reach the decoder through [`Sim`].
pub use crate::state::StateError;

/// Per-tick scratch space.
///
/// Kept out of [`Sim`] because it must reset every tick, and out of the recursion path
/// because it must not be allocated per step.
struct Scratch {
    spk: [u32; MAX_N],
    spike_list: [u16; MAX_N],
    bins: [u32; WEDGES],
    stim_i: [i64; MAX_N],
    hx: i64,
    hy: i64,
    tick_spikes: u32,
}

impl Scratch {
    fn new() -> Self {
        Self {
            spk: [0; MAX_N],
            spike_list: [0; MAX_N],
            bins: [0; WEDGES],
            stim_i: [0; MAX_N],
            hx: 0,
            hy: 0,
            tick_spikes: 0,
        }
    }
}

/// One organism: the circuit it runs, the parameters it runs with, and its full state.
///
/// Borrows the circuit table rather than owning it, so the contract can point it at a
/// `cell_dep`'s data with zero copies.
#[derive(Debug, Clone)]
pub struct Sim<'a> {
    /// The connectome.
    pub circuit: Circuit<'a>,
    /// The 12 numbers that determine the dynamics.
    pub params: Params,

    /// Membrane potentials. `i16` on disk, full width in flight.
    pub v: [i64; MAX_N],
    /// Engram: slow per-neuron excitability, `i8` on disk, bounded to ±[`BIAS_MAX`].
    pub bias: [i32; MAX_N],
    /// Synaptic input pending for the next step.
    pub inp: [i64; MAX_N],
    /// Lifetime spike count per compass wedge (the fly's heading memory).
    pub hist: [u16; WEDGES],

    /// Total simulation steps since genesis.
    pub step: u64,
    /// Steps of life remaining.
    pub energy: u64,
    /// Spikes since genesis.
    pub total_spikes: u64,
    /// Steps lived in the current life.
    pub life_steps: u64,
    /// Spikes fired in the current life.
    pub life_spikes: u64,
    /// Block number this life began at.
    pub born_block: u64,
    /// 0 = genesis life, +1 per resurrection.
    pub generation: u32,
    /// Position, 1/256th of a cell per unit.
    pub pos_x: i64,
    /// Position, 1/256th of a cell per unit.
    pub pos_y: i64,
    /// Compass population vector at the end of the last tick.
    pub head_x: i32,
    /// Compass population vector at the end of the last tick.
    pub head_y: i32,
    /// `false` once energy hits zero; only `resurrect` clears it.
    pub alive: bool,

    /// Active stimulus channel, or [`CH_NONE`].
    pub stim_channel: u8,
    /// CUE stimulus: which wedge. Ignored for other channels.
    pub stim_param: u8,
    /// Stimulus strength, 1..=255.
    pub stim_strength: u16,
    /// Step at which the active stimulus expires.
    pub stim_until: u64,
}

impl<'a> Sim<'a> {
    /// A genesis organism: all neurons at rest, no energy, alive.
    ///
    /// `energy` is a parameter because the EVM constructor took it; on CKB the fly is
    /// born by the transaction that creates the state cell, and feeding is a separate
    /// action.
    pub fn genesis(circuit: Circuit<'a>, params: Params, energy: u64, born_block: u64) -> Self {
        Self {
            circuit,
            params,
            v: [0; MAX_N],
            bias: [0; MAX_N],
            inp: [0; MAX_N],
            hist: [0; WEDGES],
            step: 0,
            energy,
            total_spikes: 0,
            life_steps: 0,
            life_spikes: 0,
            born_block,
            generation: 0,
            pos_x: 0,
            pos_y: 0,
            head_x: 0,
            head_y: 0,
            alive: true,
            stim_channel: CH_NONE,
            stim_param: 0,
            stim_strength: 0,
            stim_until: 0,
        }
    }

    /// Arm a stimulus, mirroring `_stimulate`.
    ///
    /// Returns `false` if the arguments would have reverted upstream. Unlike the
    /// contract, this does not advance the simulation — on CKB, "stimulate and tick"
    /// is two scripts in one transaction, not one fused call.
    pub fn stimulate(&mut self, channel: u8, param: u8, strength: u8) -> bool {
        if !self.alive {
            return false;
        }
        if channel == CH_NONE || channel > CH_SHOCK {
            return false;
        }
        if strength == 0 {
            return false;
        }
        if channel == CH_CUE && param as usize >= WEDGES {
            return false;
        }
        self.stim_channel = channel;
        self.stim_param = param;
        self.stim_strength = strength as u16;
        self.stim_until = self.step + self.params.stim_ttl as u64;
        true
    }

    /// Add `steps` of life, mirroring `_feed`'s `energy += added`.
    ///
    /// # Upstream bug this fixes
    ///
    /// `_feed()` has no `alive` check, so feeding a dead fly burns tokens and adds
    /// energy that can never be spent — the fly is dead and `tick()` reverts. On CKB the
    /// burn is a separate output, so the fix belongs in the transaction builder: the
    /// feed action must assert `alive` before it is allowed to destroy the coin. This
    /// method returns `false` to make that assertion available at the simulation layer
    /// too.
    pub fn feed(&mut self, steps: u64) -> bool {
        if steps == 0 || !self.alive {
            return false;
        }
        self.energy += steps;
        true
    }

    /// Whether the fly can be resurrected.
    ///
    /// # Upstream bug this fixes
    ///
    /// `_resurrect(0)` burns `RESURRECT_PRICE` and then sets `energy = 0`, so the fly
    /// dies again on the very next tick — 100,000 FLY for nothing. Requiring at least
    /// one step of energy makes the resurrection meaningful.
    pub fn can_resurrect(&self) -> bool {
        !self.alive
    }

    /// Begin a new life, mirroring `_resurrect` but refusing `energy == 0`.
    pub fn resurrect(&mut self, extra_steps: u64, block: u64) -> bool {
        if self.alive || extra_steps == 0 {
            return false;
        }
        self.alive = true;
        self.generation += 1;
        self.born_block = block;
        self.life_steps = 0;
        self.life_spikes = 0;
        self.pos_x = 0;
        self.pos_y = 0;
        self.energy = extra_steps;
        true
    }

    /// Advance the brain by up to `steps` steps, mirroring `_tick`.
    ///
    /// Returns `None` if the arguments would have reverted upstream (dead fly, or
    /// `steps` outside `1..=max_steps`).
    pub fn tick(&mut self, steps: u16) -> Option<TickResult> {
        if !self.alive || steps == 0 || steps > self.params.max_steps as u16 {
            return None;
        }

        let mut sc = Scratch::new();
        let stim_active = self.stim_channel != CH_NONE && self.step < self.stim_until;
        if stim_active {
            self.build_stim(&mut sc.stim_i);
        }
        let stim_until = self.stim_until;

        // v1 semantics: pending input does not survive a tick boundary.
        if !self.params.persist_input {
            for i in 0..self.circuit.n() {
                self.inp[i] = 0;
            }
        }

        let s0 = self.step;
        let mut en = self.energy;
        let mut ran: u32 = 0;
        while ran < steps as u32 && en > 0 {
            let sn = s0 + ran as u64;
            self.step_once(&mut sc, sn, stim_active && sn < stim_until);
            ran += 1;
            en -= 1;
        }

        self.apply_plasticity(&sc, ran);
        self.walk(&sc, ran);

        self.step = s0 + ran as u64;
        self.energy = en;
        self.total_spikes += sc.tick_spikes as u64;
        self.life_steps += ran as u64;
        self.life_spikes += sc.tick_spikes as u64;
        if stim_active && self.step >= stim_until {
            self.stim_channel = CH_NONE;
        }
        let died = en == 0;
        if died {
            self.alive = false;
        }

        Some(TickResult {
            steps: ran,
            spikes: sc.tick_spikes,
            head_x: self.head_x,
            head_y: self.head_y,
            pos_x: self.pos_x,
            pos_y: self.pos_y,
            energy: en,
            died,
        })
    }

    /// One synchronous LIF step. Spikes fired here arrive at their targets next step.
    fn step_once(&mut self, sc: &mut Scratch, sn: u64, stim_now: bool) {
        let c = self.circuit;
        let p = self.params;
        let n = c.n();

        // Background noise is a pure function of the step number: keccak256(step), then
        // rehashed every 32 neurons to yield one signed byte per neuron.
        //
        // The byte index is the part that bites. The EVM does
        // `and(shr(mul(and(i, 31), 8), rnd), 0xFF)`, i.e. it shifts a 256-bit *number*
        // right and masks — so it walks the digest from the **least** significant byte
        // upward, which in big-endian byte order is `rnd[31 - (i & 31)]`. Reading
        // `rnd[i & 31]` instead compiles, runs, and produces a plausible fly that
        // diverges from the chain on the first step where noise matters. The first
        // `tick(64)` of the mainnet trajectory fires nothing, so it cannot catch this;
        // the cue tick can.
        let mut rnd = keccak256(&sn.to_be_bytes());
        let mut n_spk: usize = 0;

        // Pass 1: leak, integrate, threshold.
        for i in 0..n {
            if i & 31 == 0 && i != 0 {
                rnd = keccak256(&rnd);
            }
            let nz = rnd[31 - (i & 31)] as i64 - 128;

            let mut x = self.v[i];
            x = p.leak_step(x);
            x += self.inp[i];
            x += div_trunc(nz * p.noise as i64, 128);
            x += self.bias[i] as i64 * p.g_bias as i64;
            if stim_now {
                x += sc.stim_i[i];
            }
            self.inp[i] = 0;

            if x < p.v_min as i64 {
                x = p.v_min as i64;
            }
            if x >= p.thresh as i64 {
                x = p.reset as i64;
                sc.spike_list[n_spk] = i as u16;
                n_spk += 1;
                sc.spk[i] += 1;

                // Only the compass ring contributes to the heading vector.
                if c.cell_type(i) <= T_EPGT {
                    let w = c.wedge(i);
                    if (w as usize) < WEDGES {
                        sc.hx += COS16[w as usize];
                        sc.hy += SIN16[w as usize];
                        sc.bins[w as usize] += 1;
                    }
                }
            }
            self.v[i] = x;
        }

        // Pass 2: deliver this step's spikes as next step's input.
        for k in 0..n_spk {
            let i = sc.spike_list[k] as usize;
            let g = p.gains[c.cell_type(i) as usize] as i64;
            let (a, b) = c.out_range(i);
            for j in a..b {
                let (post, w) = c.synapse(j);
                self.inp[post as usize] += div_trunc(w as i64 * g, 16);
            }
        }

        sc.tick_spikes += n_spk as u32;
    }

    /// Engram: neurons active in at least 1/8 of the tick's steps potentiate, neurons
    /// that never fired depress. Slow, permanent, bounded to ±[`BIAS_MAX`].
    ///
    /// The two branches are mutually exclusive by construction: a neuron with any spikes
    /// at all cannot be silent, and a neuron with no spikes cannot clear the 1/8 bar.
    /// `spk[i]` never exceeds `ran`, so `spk[i] * 8` cannot overflow.
    fn apply_plasticity(&mut self, sc: &Scratch, ran: u32) {
        for i in 0..self.circuit.n() {
            let mut b = self.bias[i];
            if sc.spk[i] * 8 >= ran {
                if b < BIAS_MAX {
                    b += 1;
                }
            } else if sc.spk[i] == 0 && b > -BIAS_MAX {
                b -= 1;
            }
            self.bias[i] = b;
        }
    }

    /// Heading memory and locomotion.
    ///
    /// The compass bump's population vector over this tick picks the direction; the fly
    /// walks `STRIDE/256` cells per step when the bump is strong enough to trust.
    fn walk(&mut self, sc: &Scratch, ran: u32) {
        let mut best = 0usize;
        let mut best_count = 0u32;
        for w in 0..WEDGES {
            if sc.bins[w] > best_count {
                best_count = sc.bins[w];
                best = w;
            }
        }
        if best_count > 0 && self.hist[best] < u16::MAX {
            self.hist[best] += 1;
        }

        let hx = sc.hx;
        let hy = sc.hy;
        let ran_i = ran as i64;
        let mag = isqrt((hx * hx + hy * hy) as u64) as i64;
        if mag > 0 && mag >= self.params.walk_threshold as i64 * ran_i {
            self.pos_x += div_trunc(hx * STRIDE * ran_i, mag);
            self.pos_y += div_trunc(hy * STRIDE * ran_i, mag);
        }
        self.head_x = hx as i32;
        self.head_y = hy as i32;
    }

    /// Current injected into each neuron by the active stimulus, mirroring `_buildStim`.
    fn build_stim(&self, stim_i: &mut [i64; MAX_N]) {
        let c = self.circuit;
        let n = c.n();
        let amp = self.stim_strength as i64 * self.params.stim_gain as i64;
        let ch = self.stim_channel;
        let param = self.stim_param as usize;

        for (i, slot) in stim_i.iter_mut().enumerate().take(n) {
            let t = c.cell_type(i);
            if ch == CH_CUE && t <= T_EPGT {
                let w = c.wedge(i);
                if w == NO_WEDGE {
                    continue;
                }
                let dist = (w as usize + WEDGES - param) % WEDGES;
                if dist == 0 {
                    *slot = amp;
                } else if dist == 1 || dist == WEDGES - 1 {
                    // Neighbouring wedges get a half-strength cue, so the bump can be
                    // pulled around the ring by moving the landmark.
                    *slot = amp / 2;
                }
            } else if ch == CH_TURN_LEFT || ch == CH_TURN_RIGHT {
                if t == T_PEN_A || t == T_PEN_B {
                    let side = c.side(i);
                    let want = if ch == CH_TURN_LEFT { 0 } else { 1 };
                    if side == want {
                        *slot = amp;
                    }
                }
            } else if ch == CH_SHOCK && t == T_DELTA7 {
                *slot = amp;
            }
        }
    }
}
