# The noise source, and what it costs

`FlyBrain.sol` derives its background noise from

```solidity
mstore(0, shl(192, sn));
let rnd := keccak256(0, 8);
```

— one keccak per step, expanded eight bits at a time across 32 neurons and rehashed every
32 neurons. It uses no block data, which is exactly why the fly's trajectory is a pure
function of its state and the actions applied to it, and why `sim/flysim.py` can reproduce
mainnet bit for bit.

This document records why the port **kept** keccak for the first milestone, what it costs,
and what the cheaper alternative would require.

## What keccak costs on CKB-VM

A step needs five keccak permutations: one for the seed and four rehashes (at neurons 32,
64, 96 and 128). Keccak-f[1600] is 24 rounds of theta, rho+pi, chi and iota over a
25-lane state — roughly 1,500–2,500 cycles per permutation in Rust compiled for
`riscv64imac`, depending on how well the bit-manipulation extensions land.

That is about 10,000 cycles per step, or 640,000 for a full 64-step tick.

The measured 64-step tick with an active stimulus is 6,555,537 cycles, so the noise is
roughly a tenth of it. The rest is the neuron loop (155 neurons × 64 steps) and synaptic
propagation, which for a tick that fires ~54 spikes per step touches a large fraction of the
6,522 connections.

Keccak also hashes the connectome once per transaction, to check the `cell_dep` against the
hash in args: 15,065 bytes at rate 136 is 111 permutations, around 200,000 cycles — three
percent of a tick, and worth it, because it is what lets the type script trust a table it
did not deploy.

## Why keccak was kept

**It makes the differential test possible.** The whole validation story rests on being able
to run the same action sequence on CKB that ran on BSC and compare. That comparison is only
meaningful if the noise is the same noise. With blake2b, the mainnet fixture would be
useless and the port would have nothing to check itself against except its own expectations
— which is the failure mode this project was designed to avoid.

**It costs 9.4% of the per-transaction limit, not 90%.** There is no pressure to optimise
it away.

**It keeps the off-chain replica working.** Any client written against the BSC fly — the
Python replica, the JavaScript one the website uses — continues to produce the correct
animation frames without modification.

## The cheaper alternative, if it is ever needed

CKB exposes blake2b as a native syscall (`ckb_std::syscalls::blake2b`), which is
dramatically cheaper than a hand-rolled keccak in RISC-V: the syscall costs `500 + 0.25 ×
bytes` cycles, so hashing a 32-byte seed is about 508 cycles against ~2,000 for a
permutation.

A step would become something like

```text
seed = blake2b(step)
rnd  = prng(seed)          // a cheap xorshift or splitmix, not a hash
```

which is perhaps 600 cycles per step instead of 10,000 — a 94% reduction in the noise
budget, taking a 64-step tick from 6.5M cycles to roughly 5.9M. Real, but not
transformative: it buys about 9% of a tick.

**What it costs is not cycles, it is validation.** Changing the noise source changes every
membrane potential after the first step, so:

1. `sim/calibrate.py` must be re-run. The parameters (`leak`, `noise`, the six `gains`,
   `gBias`) were tuned against keccak noise; different noise statistics will need different
   values to keep the bump stable and the fly behaving like a fly.
2. The mainnet differential fixture becomes a *historical* record rather than a test. The
   port would need a new fixture generated from the new noise, and its correctness would
   rest on the Python replica being right rather than on the chain having agreed.
3. Any deployed fly would need a new organism. The type script's args carry the circuit
   hash, but not the noise function; the noise is in the code, so a new noise source means
   a new code hash, a new type script, and a new genesis.

That is a real trade — 9% of a tick for the strongest piece of evidence the port has — and
it is why the decision is deferred rather than made. If a future phase is cycle-bound (the
whole-brain verification window is the likely candidate, at ~63M of 70M), this is the first
lever to pull, and the analysis above says how much it would actually buy.
