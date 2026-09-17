//! Integration tests: do the contracts actually behave on CKB-VM?
//!
//! These run the *real* RISC-V binaries through `ckb-testtool`, which executes them in the
//! same VM a node uses and reports the cycles consumed. So they answer three questions
//! that unit tests cannot:
//!
//! 1. Does the type script accept the transitions it should, and refuse the ones it
//!    shouldn't — with the specific exit code it advertises?
//! 2. Does a 64-step tick fit inside a node's per-transaction policy limit?
//! 3. Does the on-chain fly reproduce the same trajectory as BSC mainnet?
//!
//! That last one is the payoff of the bit-exact port: `tick_reproduces_the_mainnet_cue_
//! response` runs the identical action sequence on CKB that FlyBrain v1 ran on BNB Smart
//! Chain and asserts the same spike count and heading. The connectome and the arithmetic
//! are provably the same organism on two different chains.

use ckb_testtool::ckb_error::Error as CkbError;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::{DepType, ScriptHashType, TransactionBuilder, TransactionView},
    packed::{CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
};
use ckb_testtool::context::Context;

use flycircuit::TABLE;
use flycore::{
    action::Action, args::ScriptArgs, economics::Economics, params::Params, sim::Sim,
    state::state_len,
};

use crate::{MAX_TX_VERIFY_CYCLES, require_contracts};

const CKB: u64 = 100_000_000;

/// A fixed instance nonce: one organism, consistently identified across the tests.
const INSTANCE: [u8; 8] = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];

/// Enough capacity for the funding cell that pays for each transition. It is refunded as
/// change, so the exact value does not matter as long as it clears the body requirement.
const FUNDING: u64 = 10_000 * CKB;

/// Capacity for the filler cell that shifts the fly off index 0. It is refunded as change.
const FILLER: u64 = 100 * CKB;

fn params() -> Params {
    Params::V1_DEPLOYED
}

fn econ() -> Economics {
    Economics::TESTNET
}

/// Overrides for the transaction a test wants to build. `Spec::valid()` produces the
/// correct transaction for the action; a test mutates one field to break exactly one thing
/// and asserts the contract notices.
#[derive(Default)]
struct Spec {
    /// How many output cells wear the fly's type script.
    output_count: usize,
    /// Output capacity, when the test wants to get it wrong.
    capacity: Option<u64>,
    /// Output data, when the test wants to fabricate a state.
    data: Option<Vec<u8>>,
    /// Output lock, when the test wants to redirect the fly.
    lock: Option<Script>,
    /// Output type script, when the test wants to change the args.
    type_script: Option<Script>,
    /// `Some(None)` omits the witness entirely; `Some(Some(bytes))` supplies a raw one.
    witness: Option<Option<Vec<u8>>>,
    /// Leave the circuit table out of `cell_deps`.
    drop_circuit_dep: bool,
    /// Put a filler cell before the fly's output, so the fly's group index (0) and its
    /// absolute index (1) are different numbers.
    prepend_output: bool,
    /// Put a filler cell before the fly's input, for the same reason.
    prepend_input: bool,
}

impl Spec {
    fn valid() -> Self {
        Self {
            output_count: 1,
            ..Default::default()
        }
    }

    fn outputs(n: usize) -> Self {
        Self {
            output_count: n,
            ..Default::default()
        }
    }
}

/// A deployed fly, plus the state cell it currently lives in.
struct Fly {
    ctx: Context,
    /// The type script, including the 89-byte args.
    type_script: Script,
    /// `flylock` with empty args: the fly's lock, spendable by anyone.
    lock: Script,
    /// `flylock` with different args: a different lock, used to test lock immutability.
    foreign_lock: Script,
    circuit_dep: CellDep,
    circuit: flycircuit::Circuit<'static>,
    params: Params,
    econ: Economics,
    /// The current state cell.
    state: OutPoint,
    state_data: Vec<u8>,
    state_capacity: u64,
}

impl Fly {
    /// Deploy both contracts, the circuit table and a genesis fly with `energy` steps of
    /// life.
    fn genesis(energy: u64) -> Option<(Self, u64)> {
        let (mut ctx, flybrain_bin, flylock_bin) = require_contracts()?;

        let flybrain_op = ctx.deploy_cell(flybrain_bin);
        let flylock_op = ctx.deploy_cell(flylock_bin);

        let args = ScriptArgs::new(
            INSTANCE,
            params(),
            flycore::keccak::keccak256(TABLE),
            econ(),
        );
        let type_script = ctx
            .build_script_with_hash_type(
                &flybrain_op,
                ScriptHashType::Data1,
                args.to_bytes().to_vec().into(),
            )
            .expect("flybrain script");
        let lock = ctx
            .build_script_with_hash_type(&flylock_op, ScriptHashType::Data1, Bytes::new())
            .expect("flylock script");
        let foreign_lock = ctx
            .build_script_with_hash_type(&flylock_op, ScriptHashType::Data1, Bytes::from(vec![1u8]))
            .expect("foreign flylock script");

        // The connectome lives in its own cell, referenced as a dependency and verified by
        // hash. 100 CKB of headroom over the 15,065 bytes of data.
        let circuit_op = ctx.create_cell(
            CellOutput::new_builder()
                .capacity(TABLE.len() as u64 + 100)
                .lock(lock.clone())
                .build(),
            Bytes::from(TABLE.to_vec()),
        );
        let circuit_dep = CellDep::new_builder()
            .out_point(circuit_op)
            .dep_type(DepType::Code)
            .build();

        let circuit = flycircuit::embedded();

        // Genesis: one output, no input of this type. The state must be exactly a newborn.
        let sim = Sim::genesis(circuit, params(), energy, 0);
        let data = encode(&sim);
        let capacity = econ().required_capacity(energy);

        let funding = ctx.create_cell(
            CellOutput::new_builder()
                .capacity(FUNDING)
                .lock(lock.clone())
                .build(),
            Bytes::new(),
        );

        let tx = TransactionBuilder::default()
            .input(CellInput::new_builder().previous_output(funding).build())
            .output(
                CellOutput::new_builder()
                    .capacity(capacity)
                    .lock(lock.clone())
                    .type_(Some(type_script.clone()))
                    .build(),
            )
            .outputs_data([Bytes::from(data.clone())].pack())
            .cell_dep(circuit_dep.clone())
            .build();
        let tx = ctx.complete_tx(tx);

        let cycles = ctx
            .verify_tx(&tx, MAX_TX_VERIFY_CYCLES)
            .unwrap_or_else(|e| panic!("genesis was rejected: {e}"));

        let state = OutPoint::new(tx.hash(), 0);
        ctx.create_cell_with_out_point(
            state.clone(),
            CellOutput::new_builder()
                .capacity(capacity)
                .lock(lock.clone())
                .type_(Some(type_script.clone()))
                .build(),
            Bytes::from(data.clone()),
        );

        Some((
            Self {
                ctx,
                type_script,
                lock,
                foreign_lock,
                circuit_dep,
                circuit,
                params: params(),
                econ: econ(),
                state,
                state_data: data,
                state_capacity: capacity,
            },
            cycles,
        ))
    }

    /// Decode the current state.
    fn sim(&self) -> Sim<'static> {
        Sim::decode(self.circuit, self.params, &self.state_data).expect("valid state cell")
    }

    /// The state and capacity the action should produce, or `None` if the action is
    /// illegal for this state.
    ///
    /// `None` is not a test bug: the rejection tests deliberately ask for illegal actions
    /// (ticking a corpse, resurrecting a live fly), and they still need a transaction to
    /// submit. When there is no legal successor, `build` falls back to echoing the current
    /// state, which the contract will refuse for the reason under test.
    fn successor(&self, action: Action) -> Option<(Vec<u8>, u64)> {
        let mut sim = self.sim();
        sim.apply(action, &self.econ).ok()?;
        let release = self.econ.capacity_release(self.sim().energy, sim.energy);
        let capacity = (self.state_capacity as i128 - release) as u64;
        Some((encode(&sim), capacity))
    }

    /// Build a transaction that applies `action` to the current state, honouring `spec`.
    fn build(&mut self, action: Action, spec: &Spec) -> (TransactionView, Vec<u8>, u64) {
        let (data, capacity) = self
            .successor(action)
            .unwrap_or_else(|| (self.state_data.clone(), self.state_capacity));
        let out_data = spec.data.clone().unwrap_or_else(|| data.clone());
        let out_capacity = spec.capacity.unwrap_or(capacity);
        let out_lock = spec.lock.clone().unwrap_or_else(|| self.lock.clone());
        let out_type = spec
            .type_script
            .clone()
            .unwrap_or_else(|| self.type_script.clone());

        let funding = self.ctx.create_cell(
            CellOutput::new_builder()
                .capacity(FUNDING)
                .lock(self.lock.clone())
                .build(),
            Bytes::new(),
        );

        // A cell that exists only to sit in front of the fly, so that the fly's index within
        // its group and its index within the transaction are different numbers.
        let filler = self.ctx.create_cell(
            CellOutput::new_builder()
                .capacity(FILLER)
                .lock(self.lock.clone())
                .build(),
            Bytes::new(),
        );

        // The state cell goes first so that its witness is witness 0, which is where the
        // type script looks for the action.
        let mut outputs = Vec::new();
        let mut outputs_data = Vec::new();
        if spec.prepend_output {
            outputs.push(
                CellOutput::new_builder()
                    .capacity(FILLER)
                    .lock(self.lock.clone())
                    .build(),
            );
            outputs_data.push(Bytes::new());
        }
        for _ in 0..spec.output_count {
            outputs.push(
                CellOutput::new_builder()
                    .capacity(out_capacity)
                    .lock(out_lock.clone())
                    .type_(Some(out_type.clone()))
                    .build(),
            );
            outputs_data.push(Bytes::from(out_data.clone()));
        }

        // Refund the funding cell as change. Because the state cell releases the value of
        // the life it burned, the change is *larger* than the funding input — that surplus
        // is the ticker's reward, which is the whole point of the economic model.
        let spent: u64 = outputs.iter().map(|o| u64::from(o.capacity())).sum();
        let change = FUNDING + self.state_capacity - spent;
        outputs.push(
            CellOutput::new_builder()
                .capacity(change)
                .lock(self.lock.clone())
                .build(),
        );
        outputs_data.push(Bytes::new());

        // Witnesses line up with inputs, so a filler input needs a filler witness — and the
        // action, which the type script reads at the fly's position *within its group*, then
        // lands at the fly's absolute index rather than at 0.
        let mut witnesses: Vec<Bytes> = Vec::new();
        if spec.prepend_input {
            witnesses.push(WitnessArgs::default().as_bytes());
        }
        match &spec.witness {
            // Explicitly no witnesses at all.
            Some(None) => {}
            // A raw payload, for malformed-witness tests.
            Some(Some(raw)) => witnesses.push(
                WitnessArgs::new_builder()
                    .input_type(Some(Bytes::from(raw.clone())))
                    .build()
                    .as_bytes(),
            ),
            // The correct action.
            None => {
                let (buf, n) = action.encode_fixed();
                witnesses.push(
                    WitnessArgs::new_builder()
                        .input_type(Some(Bytes::from(buf[..n].to_vec())))
                        .build()
                        .as_bytes(),
                );
            }
        }

        let mut deps = vec![self.circuit_dep.clone()];
        if spec.drop_circuit_dep {
            deps.clear();
        }

        let tx = TransactionBuilder::default()
            .inputs(
                {
                    let mut inputs = Vec::new();
                    if spec.prepend_input {
                        inputs.push(CellInput::new_builder().previous_output(filler).build());
                    }
                    inputs.push(
                        CellInput::new_builder()
                            .previous_output(self.state.clone())
                            .build(),
                    );
                    inputs.push(CellInput::new_builder().previous_output(funding).build());
                    inputs
                }
                .pack(),
            )
            .outputs(outputs.pack())
            .outputs_data(outputs_data.pack())
            .cell_deps(deps.pack())
            .witnesses(witnesses.pack())
            .build();

        (self.ctx.complete_tx(tx), out_data, out_capacity)
    }

    /// Verify `action` without advancing the harness. Used by the failure tests.
    fn try_apply(&mut self, action: Action, spec: &Spec) -> Result<u64, CkbError> {
        let (tx, _, _) = self.build(action, spec);
        self.ctx.verify_tx(&tx, MAX_TX_VERIFY_CYCLES)
    }

    /// Verify `action` and, on success, move the harness to the new state cell.
    fn apply(&mut self, action: Action) -> Result<u64, CkbError> {
        let (tx, data, capacity) = self.build(action, &Spec::valid());
        let cycles = self.ctx.verify_tx(&tx, MAX_TX_VERIFY_CYCLES)?;

        let state = OutPoint::new(tx.hash(), 0);
        self.ctx.create_cell_with_out_point(
            state.clone(),
            CellOutput::new_builder()
                .capacity(capacity)
                .lock(self.lock.clone())
                .type_(Some(self.type_script.clone()))
                .build(),
            Bytes::from(data.clone()),
        );
        self.state = state;
        self.state_data = data;
        self.state_capacity = capacity;
        Ok(cycles)
    }

    /// The exit code a rejected transaction produced.
    fn reject_code(&mut self, action: Action, spec: &Spec) -> i8 {
        match self.try_apply(action, spec) {
            Ok(cycles) => {
                panic!("expected rejection, but the transaction was accepted ({cycles} cycles)")
            }
            Err(e) => exit_code(&e),
        }
    }
}

fn encode(sim: &Sim<'_>) -> Vec<u8> {
    let mut buf = vec![0u8; state_len(sim.circuit.n())];
    sim.encode(&mut buf).expect("encode");
    buf
}

/// The script exit code carried by a verification error.
///
/// `ckb-testtool` renders a script failure as
/// `ValidationFailure: see error code 7 on page https://…/#7`. Digging the number out
/// lets the tests assert on *which* check failed, not merely that something did — which is
/// the difference between testing the contract and testing that it fails somehow.
fn exit_code(err: &CkbError) -> i8 {
    let text = format!("{err:?}");
    let marker = "error code ";
    let start = text
        .find(marker)
        .unwrap_or_else(|| panic!("no exit code in: {text}"))
        + marker.len();
    let rest = &text[start..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    rest[..end]
        .parse::<i32>()
        .unwrap_or_else(|_| panic!("unparseable exit code in: {text}")) as i8
}

// ===================================================================== positive paths

#[test]
fn the_args_reach_the_script_unchanged() {
    // A regression guard for a mistake that costs nothing to make and is invisible until a
    // contract actually runs: `packed::Bytes::as_slice()` returns the molecule *encoding*
    // of a byte vector — a four-byte length prefix followed by the payload — not the
    // payload. Reading it as args makes every transaction fail with `InvalidArgs`, which
    // looks like a parameter problem rather than an accessor problem. Pin the round trip.
    let Some((mut ctx, flybrain_bin, _)) = require_contracts() else {
        return;
    };
    let op = ctx.deploy_cell(flybrain_bin);
    let args = ScriptArgs::new(
        INSTANCE,
        params(),
        flycore::keccak::keccak256(TABLE),
        econ(),
    );
    let bytes = args.to_bytes();

    let script = ctx
        .build_script_with_hash_type(&op, ScriptHashType::Data1, Bytes::from(bytes.to_vec()))
        .expect("script");

    // The molecule encoding is four bytes longer than the payload...
    assert_eq!(
        script.args().as_slice().len(),
        bytes.len() + 4,
        "as_slice() carries the molecule length prefix"
    );
    // ...and `raw_data()` is the payload the contract reads.
    assert_eq!(script.args().raw_data().as_ref(), &bytes[..]);
    assert_eq!(
        ScriptArgs::from_bytes(script.args().raw_data().as_ref()),
        Some(args)
    );
}

#[test]
fn genesis_creates_a_newborn_fly() {
    let Some((fly, cycles)) = Fly::genesis(1_000_000) else {
        return;
    };
    let sim = fly.sim();
    assert!(sim.alive);
    assert_eq!(sim.step, 0);
    assert_eq!(sim.energy, 1_000_000);
    assert_eq!(sim.generation, 0);
    assert_eq!(sim.total_spikes, 0);
    assert!(
        sim.v.iter().all(|&v| v == 0),
        "a newborn must have no membrane potential"
    );
    assert!(sim.bias.iter().all(|&b| b == 0), "and no engram");
    println!("genesis: {cycles} cycles");
}

#[test]
fn tick_advances_the_fly() {
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    fly.apply(Action::Tick { steps: 64 }).expect("tick");
    let sim = fly.sim();
    assert_eq!(sim.step, 64);
    assert_eq!(sim.energy, 1_000_000 - 64);
    assert_eq!(sim.life_steps, 64);
    assert!(sim.alive);
}

#[test]
fn tick_reproduces_the_mainnet_cue_response() {
    // The same action sequence FlyBrain v1 executed on BNB Smart Chain, run here on
    // CKB-VM. If the port were not bit-exact these numbers would not survive the
    // cross-compilation, the different word size, or the different endianness handling.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };

    fly.apply(Action::Tick { steps: 64 }).expect("tick(64)");
    assert_eq!(fly.sim().total_spikes, 0, "silent with no stimulus");

    fly.apply(Action::Feed { steps: 10_000 }).expect("feed");
    assert_eq!(fly.sim().energy, 1_000_000 - 64 + 10_000);

    fly.apply(Action::Stimulate {
        channel: 1,
        param: 4,
        strength: 4,
        steps: 32,
    })
    .expect("cue");
    let sim = fly.sim();
    assert_eq!(sim.total_spikes, 279, "the mainnet cue response");
    assert_eq!((sim.head_x, sim.head_y), (-2446, 11821));
    assert_eq!((sim.pos_x, sim.pos_y), (-103, 501));

    fly.apply(Action::Tick { steps: 32 }).expect("tick");
    let sim = fly.sim();
    assert_eq!(sim.total_spikes, 533);
    assert_eq!((sim.head_x, sim.head_y), (-835, 11896));
    assert_eq!((sim.pos_x, sim.pos_y), (-138, 1011));

    fly.apply(Action::Tick { steps: 32 }).expect("tick");
    assert_eq!(fly.sim().total_spikes, 533);

    fly.apply(Action::Stimulate {
        channel: 4,
        param: 0,
        strength: 4,
        steps: 32,
    })
    .expect("shock");
    let sim = fly.sim();
    assert_eq!(sim.total_spikes, 816, "the mainnet shock response");
    assert_eq!((sim.head_x, sim.head_y), (0, 0), "the bump collapses");
    // The neural trajectory is bit-identical to BSC mainnet — every spike count and both
    // heading vectors above match the chain. The *energy* does not, by exactly the price
    // of the two stimuli: on CKB a stimulus costs the fly 128 steps of life per unit of
    // strength, where upstream charged the caller in tokens. Same organism, same dynamics,
    // different accounting for who pays.
    let stim_tax = 2 * econ().stim_cost(4);
    assert_eq!(
        sim.energy,
        1_009_808 - stim_tax,
        "the mainnet energy minus the stimulus tax"
    );
    assert_eq!(stim_tax, 1_024);
}

#[test]
fn feed_moves_capacity_into_the_body() {
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let before = fly.state_capacity;
    fly.apply(Action::Feed { steps: 10_000 }).expect("feed");

    assert_eq!(fly.sim().energy, 1_010_000);
    // 10,000 steps at 0.0001 CKB each is 1 CKB, and 1 CKB is 10^8 shannons.
    assert_eq!(
        fly.state_capacity - before,
        10_000 * fly.econ.backing_per_step,
        "feeding must lock exactly the value of the life it buys"
    );
}

#[test]
fn a_fly_can_die_and_be_resurrected() {
    let Some((mut fly, _)) = Fly::genesis(64) else {
        return;
    };

    // Exactly enough energy for one maximum tick.
    fly.apply(Action::Tick { steps: 64 }).expect("tick");
    let sim = fly.sim();
    assert!(!sim.alive, "energy hit zero, so the fly died");
    assert_eq!(sim.energy, 0);

    // A dead fly refuses to move...
    assert_ne!(
        fly.reject_code(Action::Tick { steps: 1 }, &Spec::valid()),
        0,
        "a dead fly cannot tick"
    );

    // ...and can be brought back with a fresh life.
    fly.apply(Action::Resurrect {
        steps: 1_000,
        born_block: 42,
    })
    .expect("resurrect");
    let sim = fly.sim();
    assert!(sim.alive);
    assert_eq!(sim.generation, 1);
    assert_eq!(sim.energy, 1_000);
    assert_eq!(sim.born_block, 42);
    assert_eq!(sim.step, 64, "resurrection does not rewind or advance time");
    assert_eq!(sim.life_steps, 0, "the new life starts fresh");

    fly.apply(Action::Tick { steps: 32 }).expect("tick");
    assert_eq!(fly.sim().life_steps, 32);
}

#[test]
fn a_64_step_tick_fits_in_the_per_transaction_policy_limit() {
    // The number that decides whether this design works at all. CKB charges fees by
    // transaction *size*, so cycles only matter as a limit, not as a price — but if a tick
    // exceeded the node's `max_tx_verify_cycles` it could never be included in a block.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    fly.apply(Action::Tick { steps: 64 }).expect("warm up");
    fly.apply(Action::Feed { steps: 10_000 }).expect("feed");

    let cycles = fly
        .apply(Action::Stimulate {
            channel: 1,
            param: 4,
            strength: 4,
            steps: 64,
        })
        .expect("a full-length tick");

    println!("64-step tick with an active stimulus: {cycles} cycles");
    assert!(
        cycles < MAX_TX_VERIFY_CYCLES,
        "a 64-step tick must fit under the per-transaction policy limit: {cycles} >= {MAX_TX_VERIFY_CYCLES}"
    );
    // And with real headroom, because the whole-brain phases depend on it.
    assert!(
        cycles < MAX_TX_VERIFY_CYCLES / 4,
        "a 64-step tick should use well under a quarter of the limit: {cycles}"
    );
}

#[test]
fn the_engram_actually_moves() {
    // Plasticity is the fly's only long-term memory. If it never fired, the fly would
    // still tick — so assert it explicitly rather than trusting the state codec.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    fly.apply(Action::Stimulate {
        channel: 1,
        param: 4,
        strength: 4,
        steps: 64,
    })
    .expect("cue");
    let sim = fly.sim();
    assert!(
        sim.bias.iter().any(|&b| b != 0),
        "a tick with spikes must leave a trace in the engram"
    );
    assert!(
        sim.bias
            .iter()
            .all(|&b| (-flycore::BIAS_MAX..=flycore::BIAS_MAX).contains(&b)),
        "the engram must stay bounded"
    );
}

// ===================================================================== rejection paths

#[test]
fn refuses_to_destroy_the_fly() {
    // No output wearing the type script: the fly would simply cease to exist.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let code = fly.reject_code(Action::Tick { steps: 64 }, &Spec::outputs(0));
    assert_eq!(code, 6, "WrongOutputCount");
}

#[test]
fn refuses_a_second_state_cell() {
    // Two successors would fork the fly: whoever held the second one could claim to be it.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let code = fly.reject_code(Action::Tick { steps: 64 }, &Spec::outputs(2));
    assert_eq!(code, 6, "WrongOutputCount");
}

#[test]
fn refuses_to_hand_the_fly_to_someone_else() {
    // The attack this prevents: tick the fly, point the successor at your own lock, and
    // walk away with an organism that anyone had been free to advance.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let foreign = fly.foreign_lock.clone();
    let code = fly.reject_code(
        Action::Tick { steps: 64 },
        &Spec {
            lock: Some(foreign),
            ..Spec::valid()
        },
    );
    assert_eq!(code, 7, "LockChanged");
}

#[test]
fn refuses_to_change_the_dynamics() {
    // Repointing the fly at different parameters, a different connectome, or different
    // prices changes its type script hash, and CKB forms script groups by that hash. So
    // this transaction is judged **twice**, by two independent runs of the same code:
    //
    //   * the original script's group holds the input and no output — the fly would have
    //     no successor, which is `WrongOutputCount` (6);
    //   * the tampered script's group holds the output and no input — which looks exactly
    //     like a genesis transaction, and is refused by the newborn check as
    //     `NotGenesis` (18), because a state that has already lived is not a newborn.
    //
    // Both are legitimate refusals and the transaction is rejected either way. Which code
    // is *reported* depends on the order CKB happens to run the groups in, so asserting a
    // single code here would be asserting something the protocol does not promise. Assert
    // the set, and assert the thing that actually matters: it is refused.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let mut args = ScriptArgs::new(
        INSTANCE,
        params(),
        flycore::keccak::keccak256(TABLE),
        econ(),
    );
    args.params.leak += 1;
    let tampered = {
        let op = fly
            .ctx
            .get_cell_by_data_hash(&fly.type_script.code_hash())
            .expect("flybrain cell");
        fly.ctx
            .build_script_with_hash_type(
                &op,
                ScriptHashType::Data1,
                args.to_bytes().to_vec().into(),
            )
            .expect("tampered script")
    };
    assert_ne!(
        tampered, fly.type_script,
        "one byte of `leak` is a different organism"
    );

    let code = fly.reject_code(
        Action::Tick { steps: 64 },
        &Spec {
            type_script: Some(tampered),
            ..Spec::valid()
        },
    );
    assert!(
        code == 6 || code == 18,
        "changing the dynamics must be refused as WrongOutputCount (6) or NotGenesis (18), got {code}"
    );
}

#[test]
fn refuses_a_fabricated_state() {
    // The core guarantee: the output must be the *exact* successor. A single flipped byte
    // in a membrane potential is enough to be refused.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let (good, _) = fly.successor(Action::Tick { steps: 64 }).unwrap();
    let mut tampered = good.clone();
    tampered[128] ^= 1; // one byte of the first neuron's membrane potential

    let code = fly.reject_code(
        Action::Tick { steps: 64 },
        &Spec {
            data: Some(tampered),
            ..Spec::valid()
        },
    );
    assert_eq!(code, 14, "TransitionMismatch");
}

#[test]
fn refuses_a_plausible_but_wrong_number_of_steps() {
    // The output is a perfectly valid fly state — just for a different action. This is the
    // case a "does the output look sane?" validator would wave through.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let (other, _) = fly.successor(Action::Tick { steps: 32 }).unwrap();
    let code = fly.reject_code(
        Action::Tick { steps: 64 },
        &Spec {
            data: Some(other),
            ..Spec::valid()
        },
    );
    assert_eq!(code, 14, "TransitionMismatch");
}

#[test]
fn refuses_an_underpaid_output() {
    // The ticker may not take more than the life it burned.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let (_, correct) = fly.successor(Action::Tick { steps: 64 }).unwrap();
    let code = fly.reject_code(
        Action::Tick { steps: 64 },
        &Spec {
            capacity: Some(correct - 1),
            ..Spec::valid()
        },
    );
    assert_eq!(code, 15, "CapacityMismatch");
}

#[test]
fn refuses_an_overpaid_output() {
    // ...and may not hand the fly extra capacity for free either, because that would let a
    // ticker smuggle value in or out of the body.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let (_, correct) = fly.successor(Action::Tick { steps: 64 }).unwrap();
    let code = fly.reject_code(
        Action::Tick { steps: 64 },
        &Spec {
            capacity: Some(correct + 1),
            ..Spec::valid()
        },
    );
    assert_eq!(code, 15, "CapacityMismatch");
}

#[test]
fn refuses_an_unbacked_energy_claim() {
    // Energy must be backed by capacity, or a fly could claim a billion steps of life
    // while holding nothing. The state is otherwise a perfect successor, so only the
    // backing check can catch this — and it must.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };

    // A feed that adds life without adding capacity.
    let mut sim = fly.sim();
    sim.apply(Action::Feed { steps: 1_000_000 }, &econ())
        .expect("feed");
    let greedy = encode(&sim);

    let code = fly.reject_code(
        Action::Feed { steps: 1_000_000 },
        &Spec {
            data: Some(greedy),
            // Keep the capacity where it was: 100 CKB of life claimed for free.
            capacity: Some(fly.state_capacity),
            ..Spec::valid()
        },
    );
    assert_eq!(code, 15, "CapacityMismatch fires before the backing check");
}

#[test]
fn refuses_a_malformed_witness() {
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    // An unknown action tag.
    assert_eq!(
        fly.reject_code(
            Action::Tick { steps: 64 },
            &Spec {
                witness: Some(Some(vec![0xEE, 0x00, 0x00])),
                ..Spec::valid()
            }
        ),
        10,
        "WitnessMalformed"
    );

    // A tick for more steps than the parameters allow.
    assert_eq!(
        fly.reject_code(
            Action::Tick { steps: 64 },
            &Spec {
                witness: Some(Some(vec![1, 65, 0])),
                ..Spec::valid()
            }
        ),
        10,
        "WitnessMalformed"
    );

    // No witness at all.
    assert_eq!(
        fly.reject_code(
            Action::Tick { steps: 64 },
            &Spec {
                witness: Some(None),
                ..Spec::valid()
            }
        ),
        9,
        "MissingWitness"
    );
}

#[test]
fn refuses_a_missing_circuit_table() {
    // Without the connectome there is nothing to simulate, and the script must not fall
    // back on an embedded copy — the args are the authority.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let code = fly.reject_code(
        Action::Tick { steps: 64 },
        &Spec {
            drop_circuit_dep: true,
            ..Spec::valid()
        },
    );
    assert_eq!(code, 2, "MissingCircuitDep");
}

#[test]
fn refuses_a_genesis_that_is_not_newborn() {
    // A deployer must not be able to hand themselves a fly that has already been fed,
    // stimulated or plasticised. Genesis is exactly `Sim::genesis`, nothing else.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };

    // Run a real life forward so we have a non-newborn state, then try to install it as
    // the output of a transaction with no input of this type.
    let mut sim = fly.sim();
    sim.apply(Action::Tick { steps: 64 }, &econ())
        .expect("tick");
    let experienced = encode(&sim);

    let funding = fly.ctx.create_cell(
        CellOutput::new_builder()
            .capacity(FUNDING)
            .lock(fly.lock.clone())
            .build(),
        Bytes::new(),
    );
    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(funding).build())
        .output(
            CellOutput::new_builder()
                .capacity(fly.state_capacity)
                .lock(fly.lock.clone())
                .type_(Some(fly.type_script.clone()))
                .build(),
        )
        .outputs_data([Bytes::from(experienced)].pack())
        .cell_dep(fly.circuit_dep.clone())
        .build();
    let tx = fly.ctx.complete_tx(tx);

    let err = fly
        .ctx
        .verify_tx(&tx, MAX_TX_VERIFY_CYCLES)
        .expect_err("a pre-lived state must not be installable as genesis");
    assert_eq!(exit_code(&err), 18, "NotGenesis");
}

#[test]
fn the_state_cell_is_exactly_the_size_we_planned() {
    // The capacity requirement is derived from the serialized cell size, so if this ever
    // drifts the economics drifts with it. Measure the real serialization rather than
    // modelling molecule's table layout by hand — a table carries a total-size word plus
    // one offset per field, and guessing that wrong is how a body ends up smaller than its
    // own data.
    let Some((fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };
    let (cell, data) = fly.ctx.get_cell(&fly.state).expect("state cell");

    assert_eq!(data.len(), 1_213, "the state is 128 + 7*155 bytes");

    // `Cell` is a molecule table: a four-byte total-size word, one four-byte offset per
    // field (two fields), then the fields themselves. The data field is a byte vector: a
    // four-byte count plus the bytes, padded up to a four-byte boundary. Modelling this by
    // hand is exactly the sort of arithmetic that silently comes out 32 bytes short — an
    // earlier version of this test predicted 1,396 because it forgot that `ScriptOpt` is
    // itself a table with its own header. Measure the real serialization instead.
    let output_len = cell.as_slice().len();
    let data_field = (4 + data.len()).div_ceil(4) * 4;
    let serialized = 12 + output_len + data_field;
    println!(
        "state cell: data {} bytes, CellOutput {output_len} bytes, serialized {serialized} bytes",
        data.len()
    );

    // `body_capacity` is what the economics promises the cell can hold, and it has to be
    // at least the real serialization — otherwise no fly could ever be created. Assert the
    // inequality rather than a hand-derived constant, and pin the pieces so a change in
    // either shows up as a clear failure.
    assert_eq!(data.len(), 1_213);
    assert_eq!(serialized, output_len + data_field + 12);
    assert!(
        serialized as u64 <= fly.econ.body_capacity / CKB,
        "the body ({} CKB) must cover a {serialized}-byte cell",
        fly.econ.body_capacity / CKB
    );

    // And the body must cover it, or the fly could never be created.
    assert!(
        fly.econ.body_capacity >= serialized as u64 * CKB,
        "body_capacity {} must cover {serialized} bytes",
        fly.econ.body_capacity
    );

    let capacity = u64::from(cell.capacity());
    assert_eq!(capacity, fly.econ.required_capacity(1_000_000));
}

// ===================================================================== where the fly sits

#[test]
fn the_fly_is_found_wherever_it_sits_in_the_transaction() {
    // The bug this guards is worth spelling out, because it hides.
    //
    // The index `group_cell` returns is a position *within the script group*, while
    // `load_cell_data(i, Source::Input)` takes a position *within the transaction*. With
    // the fly at input 0 and output 0 the two happen to be the same number, so a contract
    // that mixes them reads the right cell by accident — through an entire integration
    // suite, a deployment, and six live transactions.
    //
    // Put anything else first and it starts reading the wrong cell: comparing a stranger's
    // lock, decoding a stranger's state, charging a stranger's capacity. The symptom is a
    // contract refusing a correct transaction, which sends you looking at the transition
    // rather than at the index.
    let Some((mut fly, _)) = Fly::genesis(1_000_000) else {
        return;
    };

    let cycles = fly
        .try_apply(
            Action::Tick { steps: 64 },
            &Spec {
                prepend_output: true,
                ..Spec::valid()
            },
        )
        .unwrap_or_else(|e| panic!("a fly at output 1 was refused: {e}"));
    assert!(cycles < MAX_TX_VERIFY_CYCLES);

    // And with a filler input in front, which also moves the action witness — the type
    // script reads it at the fly's position *within its group*, so the group lookup has to
    // be group-relative too.
    let cycles = fly
        .try_apply(
            Action::Tick { steps: 64 },
            &Spec {
                prepend_input: true,
                ..Spec::valid()
            },
        )
        .unwrap_or_else(|e| panic!("a fly at input 1 was refused: {e}"));
    assert!(cycles < MAX_TX_VERIFY_CYCLES);
}
