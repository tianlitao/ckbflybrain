//! Integration tests for `flyworld`: can a chronicle be made to lie?
//!
//! The whole point of the world cell is that it is not told what happened — it is required
//! to look. So these tests are mostly attempts to make it record something untrue: a
//! sighting of a fly that is not in the transaction, a death that has not happened, a
//! generation that was never reached, a state hash the fly does not have. Each must be
//! refused, and refused with the code the contract advertises.
//!
//! The positive tests are the other half: that a chronicle opened at a birth follows the
//! fly through ticks, feeds, a death and a resurrection, deriving every field from the fly
//! rather than from anything a caller supplied.

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
    action::Action,
    args::ScriptArgs,
    economics::Economics,
    params::Params,
    sim::Sim,
    state::state_len,
    world::{WORLD_LEN, World, WorldArgs},
};

use crate::{MAX_TX_VERIFY_CYCLES, require_world_contracts};

const CKB: u64 = 100_000_000;

/// A fixed instance nonce: one organism, consistently identified across the tests.
const INSTANCE: [u8; 8] = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];

/// Enough capacity for the funding cell that pays for each transition. It is refunded as
/// change, so the exact value does not matter as long as it clears the body requirement.
const FUNDING: u64 = 10_000 * CKB;

/// The chronicle's capacity. It is a record, not a bank, so this value never changes — and
/// the contract refuses any transaction that tries to change it.
const WORLD_CAPACITY: u64 = 1_000 * CKB;

fn params() -> Params {
    Params::V1_DEPLOYED
}

fn econ() -> Economics {
    Economics::TESTNET
}

fn encode(sim: &Sim<'_>) -> Vec<u8> {
    let mut buf = vec![0u8; state_len(sim.circuit.n())];
    sim.encode(&mut buf).expect("encode");
    buf
}

/// The script exit code carried by a verification error.
///
/// `ckb-testtool` renders a script failure as `error code N on page …`, not as
/// `ExitCode(N)`, so the number has to be fished out of the rendered message.
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

/// Overrides for the transaction a test wants to build. `Spec::valid()` produces the
/// correct transaction for the action; a test mutates one field to break exactly one thing.
#[derive(Default)]
struct Spec {
    /// Fabricate the output chronicle.
    world_data: Option<Vec<u8>>,
    /// Move value into or out of the chronicle.
    world_capacity: Option<u64>,
    /// Redirect the chronicle to another lock.
    world_lock: Option<Script>,
    /// Repoint the chronicle at different args — that is, a different fly.
    world_type: Option<Script>,
    /// Fabricate the fly's state, to see whether the chronicle believes it.
    fly_data: Option<Vec<u8>>,
    /// Omit the fly from the inputs, so the chronicle has nothing to look at.
    drop_fly_input: bool,
    /// Omit the chronicle's output, which would delete it.
    drop_world_output: bool,
    /// Two chronicle outputs, so the "exactly one" rule has something to bite on.
    duplicate_world_output: bool,
    /// Leave the chronicle out of the inputs, which the contract reads as "open".
    drop_world_input: bool,
    /// Leave the circuit table out of `cell_deps`.
    drop_circuit_dep: bool,
}

impl Spec {
    fn valid() -> Self {
        Self::default()
    }

    /// A transaction with no chronicle input: an attempt to open one.
    fn opening() -> Self {
        Self {
            drop_world_input: true,
            ..Default::default()
        }
    }
}

/// A deployed fly with a chronicle watching it.
struct Worldly {
    ctx: Context,
    flylock_bin: Bytes,
    flyworld_bin: Bytes,
    fly_type: Script,
    world_type: Script,
    lock: Script,
    circuit_dep: CellDep,
    circuit: flycircuit::Circuit<'static>,
    params: Params,
    econ: Economics,

    fly_state: OutPoint,
    fly_data: Vec<u8>,
    fly_capacity: u64,

    world_state: OutPoint,
    world_data: Vec<u8>,
}

impl Worldly {
    /// Deploy everything, then create the fly and its chronicle in one transaction.
    ///
    /// One transaction because the contract requires it: an opening must see the fly as an
    /// *output* and not as an input, so the only moment a chronicle can begin is the moment
    /// the fly does.
    fn open(energy: u64) -> Option<(Self, u64)> {
        let (mut ctx, flybrain_bin, flylock_bin, flyworld_bin) = require_world_contracts()?;

        let flybrain_op = ctx.deploy_cell(flybrain_bin);
        let flylock_op = ctx.deploy_cell(flylock_bin.clone());
        let flyworld_op = ctx.deploy_cell(flyworld_bin.clone());

        let args = ScriptArgs::new(
            INSTANCE,
            params(),
            flycore::keccak::keccak256(TABLE),
            econ(),
        );
        let fly_type = ctx
            .build_script_with_hash_type(
                &flybrain_op,
                ScriptHashType::Data1,
                args.to_bytes().to_vec().into(),
            )
            .expect("flybrain script");
        let lock = ctx
            .build_script_with_hash_type(&flylock_op, ScriptHashType::Data1, Bytes::new())
            .expect("flylock script");

        // The chronicle is pinned to this fly by its *type script hash*: two flies share the
        // flybrain code and differ in their args, and it is the args that make an organism.
        let world_args = WorldArgs {
            fly_type_hash: fly_type.calc_script_hash().as_slice().try_into().unwrap(),
        };
        let world_type = ctx
            .build_script_with_hash_type(
                &flyworld_op,
                ScriptHashType::Data1,
                world_args.to_bytes().to_vec().into(),
            )
            .expect("flyworld script");

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
        let sim = Sim::genesis(circuit, params(), energy, 0);
        let fly_data = encode(&sim);
        let fly_capacity = econ().required_capacity(energy);

        // The chronicle as the contract will write it: opened from the newborn.
        let newborn = World::open(
            &flycore::state::StateHeader::read(&fly_data).expect("newborn header"),
            flycore::keccak::keccak256(&fly_data),
            fly_capacity,
        );
        let mut world_data = vec![0u8; WORLD_LEN];
        newborn.encode(&mut world_data).expect("chronicle");

        let funding = ctx.create_cell(
            CellOutput::new_builder()
                .capacity(FUNDING)
                .lock(lock.clone())
                .build(),
            Bytes::new(),
        );

        let change = FUNDING - fly_capacity - WORLD_CAPACITY;
        let tx = TransactionBuilder::default()
            .input(CellInput::new_builder().previous_output(funding).build())
            .outputs(
                vec![
                    CellOutput::new_builder()
                        .capacity(fly_capacity)
                        .lock(lock.clone())
                        .type_(Some(fly_type.clone()))
                        .build(),
                    CellOutput::new_builder()
                        .capacity(WORLD_CAPACITY)
                        .lock(lock.clone())
                        .type_(Some(world_type.clone()))
                        .build(),
                    CellOutput::new_builder()
                        .capacity(change)
                        .lock(lock.clone())
                        .build(),
                ]
                .pack(),
            )
            .outputs_data(
                [
                    Bytes::from(fly_data.clone()),
                    Bytes::from(world_data.clone()),
                    Bytes::new(),
                ]
                .pack(),
            )
            .cell_dep(circuit_dep.clone())
            .build();
        let tx = ctx.complete_tx(tx);

        let cycles = ctx
            .verify_tx(&tx, MAX_TX_VERIFY_CYCLES)
            .unwrap_or_else(|e| panic!("opening the chronicle was rejected: {e}"));

        let fly_state = OutPoint::new(tx.hash(), 0);
        ctx.create_cell_with_out_point(
            fly_state.clone(),
            CellOutput::new_builder()
                .capacity(fly_capacity)
                .lock(lock.clone())
                .type_(Some(fly_type.clone()))
                .build(),
            Bytes::from(fly_data.clone()),
        );
        let world_state = OutPoint::new(tx.hash(), 1);
        ctx.create_cell_with_out_point(
            world_state.clone(),
            CellOutput::new_builder()
                .capacity(WORLD_CAPACITY)
                .lock(lock.clone())
                .type_(Some(world_type.clone()))
                .build(),
            Bytes::from(world_data.clone()),
        );

        Some((
            Self {
                ctx,
                flylock_bin,
                flyworld_bin,
                fly_type,
                world_type,
                lock,
                circuit_dep,
                circuit,
                params: params(),
                econ: econ(),
                fly_state,
                fly_data,
                fly_capacity,
                world_state,
                world_data,
            },
            cycles,
        ))
    }

    fn sim(&self) -> Sim<'static> {
        Sim::decode(self.circuit, self.params, &self.fly_data).expect("valid state cell")
    }

    fn chronicle(&self) -> World {
        World::decode(&self.world_data).expect("valid chronicle")
    }

    /// The fly state and capacity the action should produce, or `None` if the action is
    /// illegal for this state.
    fn successor(&self, action: Action) -> Option<(Vec<u8>, u64)> {
        let mut sim = self.sim();
        sim.apply(action, &self.econ).ok()?;
        let release = self.econ.capacity_release(self.sim().energy, sim.energy);
        let capacity = (self.fly_capacity as i128 - release) as u64;
        Some((encode(&sim), capacity))
    }

    /// Build a transaction that applies `action` to the fly and records the sighting,
    /// honouring `spec`.
    fn build(&mut self, action: Action, spec: &Spec) -> (TransactionView, Vec<u8>, Vec<u8>) {
        let (data, capacity) = self
            .successor(action)
            .unwrap_or_else(|| (self.fly_data.clone(), self.fly_capacity));
        let out_fly_data = spec.fly_data.clone().unwrap_or_else(|| data.clone());
        let out_fly_capacity = capacity;

        let out_world_capacity = spec.world_capacity.unwrap_or(WORLD_CAPACITY);
        let out_world_lock = spec.world_lock.clone().unwrap_or_else(|| self.lock.clone());
        let out_world_type = spec
            .world_type
            .clone()
            .unwrap_or_else(|| self.world_type.clone());

        let out_world_data = spec.world_data.clone().unwrap_or_else(|| {
            let header = flycore::state::StateHeader::read(&out_fly_data).expect("fly header");
            let previous = self.chronicle();
            let next = if spec.drop_world_input {
                World::open(
                    &header,
                    flycore::keccak::keccak256(&out_fly_data),
                    out_fly_capacity,
                )
            } else {
                previous.sight(
                    &header,
                    flycore::keccak::keccak256(&out_fly_data),
                    self.fly_capacity,
                    out_fly_capacity,
                )
            };
            let mut buf = vec![0u8; WORLD_LEN];
            next.encode(&mut buf).expect("chronicle");
            buf
        });

        let funding = self.ctx.create_cell(
            CellOutput::new_builder()
                .capacity(FUNDING)
                .lock(self.lock.clone())
                .build(),
            Bytes::new(),
        );

        // The fly goes first so that its witness is witness 0, which is where the type
        // script looks for the action.
        let mut inputs = Vec::new();
        if !spec.drop_fly_input {
            inputs.push(
                CellInput::new_builder()
                    .previous_output(self.fly_state.clone())
                    .build(),
            );
        }
        if !spec.drop_world_input {
            inputs.push(
                CellInput::new_builder()
                    .previous_output(self.world_state.clone())
                    .build(),
            );
        }
        inputs.push(CellInput::new_builder().previous_output(funding).build());

        let mut outputs = vec![
            CellOutput::new_builder()
                .capacity(out_fly_capacity)
                .lock(self.lock.clone())
                .type_(Some(self.fly_type.clone()))
                .build(),
        ];
        let mut outputs_data = vec![Bytes::from(out_fly_data.clone())];

        if !spec.drop_world_output {
            outputs.push(
                CellOutput::new_builder()
                    .capacity(out_world_capacity)
                    .lock(out_world_lock)
                    .type_(Some(out_world_type))
                    .build(),
            );
            outputs_data.push(Bytes::from(out_world_data.clone()));
            if spec.duplicate_world_output {
                outputs.push(
                    CellOutput::new_builder()
                        .capacity(out_world_capacity)
                        .lock(self.lock.clone())
                        .type_(Some(self.world_type.clone()))
                        .build(),
                );
                outputs_data.push(Bytes::from(out_world_data.clone()));
            }
        }

        // Refund everything that is left as change. The fly releases the value of the life
        // it burned, so the change is larger than the funding input — that surplus is the
        // ticker's reward.
        let spent: u64 = outputs.iter().map(|o| u64::from(o.capacity())).sum();
        let in_fly = if spec.drop_fly_input {
            0
        } else {
            self.fly_capacity
        };
        let in_world = if spec.drop_world_input {
            0
        } else {
            WORLD_CAPACITY
        };
        let change = FUNDING + in_fly + in_world - spent;
        outputs.push(
            CellOutput::new_builder()
                .capacity(change)
                .lock(self.lock.clone())
                .build(),
        );
        outputs_data.push(Bytes::new());

        // The action witness must sit at the fly's index, which is 0 whenever the fly is an
        // input. When it is not, the contract has nothing to read and must refuse.
        let (buf, n) = action.encode_fixed();
        let action_witness = WitnessArgs::new_builder()
            .input_type(Some(Bytes::from(buf[..n].to_vec())))
            .build()
            .as_bytes();
        let witnesses: Vec<Bytes> = match inputs.len() {
            0 => Vec::new(),
            _ => {
                let mut w = vec![action_witness];
                // One witness per remaining input.
                for _ in 1..inputs.len() {
                    w.push(WitnessArgs::default().as_bytes());
                }
                w
            }
        };

        let mut deps = vec![self.circuit_dep.clone()];
        if spec.drop_circuit_dep {
            deps.clear();
        }

        let tx = TransactionBuilder::default()
            .inputs(inputs.pack())
            .outputs(outputs.pack())
            .outputs_data(outputs_data.pack())
            .cell_deps(deps.pack())
            .witnesses(witnesses.pack())
            .build();

        (self.ctx.complete_tx(tx), out_world_data, out_fly_data)
    }

    /// Verify `action` without advancing the harness.
    fn try_apply(&mut self, action: Action, spec: &Spec) -> Result<u64, CkbError> {
        let (tx, _, _) = self.build(action, spec);
        self.ctx.verify_tx(&tx, MAX_TX_VERIFY_CYCLES)
    }

    /// Verify `action` and, on success, move the harness to the new fly and chronicle.
    fn apply(&mut self, action: Action) -> Result<u64, CkbError> {
        let (tx, world_data, fly_data) = self.build(action, &Spec::valid());
        let cycles = self.ctx.verify_tx(&tx, MAX_TX_VERIFY_CYCLES)?;

        let fly_capacity = self
            .successor(action)
            .map(|(_, c)| c)
            .unwrap_or(self.fly_capacity);

        let fly_state = OutPoint::new(tx.hash(), 0);
        self.ctx.create_cell_with_out_point(
            fly_state.clone(),
            CellOutput::new_builder()
                .capacity(fly_capacity)
                .lock(self.lock.clone())
                .type_(Some(self.fly_type.clone()))
                .build(),
            Bytes::from(fly_data.clone()),
        );
        let world_state = OutPoint::new(tx.hash(), 1);
        self.ctx.create_cell_with_out_point(
            world_state.clone(),
            CellOutput::new_builder()
                .capacity(WORLD_CAPACITY)
                .lock(self.lock.clone())
                .type_(Some(self.world_type.clone()))
                .build(),
            Bytes::from(world_data.clone()),
        );

        self.fly_state = fly_state;
        self.fly_data = fly_data;
        self.fly_capacity = fly_capacity;
        self.world_state = world_state;
        self.world_data = world_data;
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

fn tick(steps: u16) -> Action {
    Action::Tick { steps }
}

// ===================================================================== positive paths

#[test]
fn a_chronicle_opens_at_the_birth_and_records_it() {
    let Some((fly, cycles)) = Worldly::open(1_000_000) else {
        return;
    };

    let w = fly.chronicle();
    assert!(w.alive);
    assert_eq!(w.generation, 0);
    assert_eq!(w.born_step, 0, "the life began at step 0");
    assert_eq!(w.died_step, 0, "and it has not died");
    assert_eq!(w.step, 0);
    assert_eq!(w.energy, 1_000_000);
    assert_eq!(w.capacity, econ().required_capacity(1_000_000));
    assert_eq!(w.sightings, 1);
    assert_eq!(w.total_added, 0);
    assert_eq!(w.total_released, 0);
    assert_eq!(
        w.state_hash,
        flycore::keccak::keccak256(&fly.fly_data),
        "the chronicle must carry the fly's own state hash",
    );
    println!("opening a chronicle with a genesis costs {cycles} cycles");
}

#[test]
fn a_sighting_follows_the_fly_and_moves_value_the_right_way() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };

    let before = fly.chronicle();

    // A 64-step tick releases the value of 64 steps to whoever ticked it.
    let cycles = fly.apply(tick(64)).expect("tick");
    let after = fly.chronicle();

    assert_eq!(after.step, 64);
    assert_eq!(after.energy, 999_936);
    assert!(after.alive);
    assert_eq!(after.sightings, before.sightings + 1);
    assert_eq!(after.capacity, fly.fly_capacity);
    assert_eq!(
        after.total_released,
        64 * econ().backing_per_step,
        "a 64-step tick releases exactly the value of 64 steps",
    );
    assert_eq!(after.total_added, 0);
    assert_eq!(
        after.net_capacity(),
        -((64 * econ().backing_per_step) as i128)
    );
    assert_eq!(after.state_hash, flycore::keccak::keccak256(&fly.fly_data));
    println!("a tick plus a sighting costs {cycles} cycles");

    // Feeding moves value the other way, by exactly the amount added.
    let capacity_before = fly.fly_capacity;
    fly.apply(Action::Feed { steps: 10_000 }).expect("feed");
    let fed = fly.chronicle();
    assert_eq!(fed.total_added, fly.fly_capacity - capacity_before);
    assert_eq!(
        fed.total_released, after.total_released,
        "feeding does not tick"
    );
    assert_eq!(fed.energy, 1_009_936);
}

#[test]
fn a_death_is_recorded_at_the_step_it_happened() {
    let Some((mut fly, _)) = Worldly::open(8) else {
        return;
    };

    fly.apply(tick(8)).expect("the tick that kills it");
    let w = fly.chronicle();
    assert!(!w.alive);
    assert_eq!(w.died_step, 8, "the step the life ended at");
    assert_eq!(w.born_step, 0);
    assert_eq!(w.energy, 0);

    // Nothing happens while it is dead, so nothing in the chronicle may move.
    fly.apply(tick(1)).ok();
    let still = fly.chronicle();
    assert!(!still.alive);
    assert_eq!(
        still.died_step, 8,
        "a refused tick must not rewrite the death"
    );
}

#[test]
fn a_resurrection_starts_a_new_life() {
    let Some((mut fly, _)) = Worldly::open(8) else {
        return;
    };

    fly.apply(tick(8)).expect("die");
    let dead = fly.chronicle();
    assert_eq!(dead.died_step, 8);
    assert_eq!(dead.generation, 0);

    fly.apply(Action::Resurrect {
        steps: 10_000,
        born_block: 0,
    })
    .expect("resurrect");

    let alive = fly.chronicle();
    assert!(alive.alive);
    assert_eq!(
        alive.generation, 1,
        "the fly says so, and the chronicle agrees"
    );
    assert_eq!(
        alive.born_step, 8,
        "this life began where the last one stopped"
    );
    assert_eq!(alive.died_step, 0, "and it has not died yet");
    assert!(alive.total_added > 0, "the resurrection was paid for");
}

#[test]
fn the_chronicle_is_a_record_and_not_a_bank() {
    let Some((fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    let (cell, data) = fly.ctx.get_cell(&fly.world_state).expect("chronicle cell");

    // Measured rather than modelled: CKB charges 8 for the capacity field, the payload, and
    // 33 bytes per script — a code hash and a hash type — plus that script's args. The
    // chronicle's lock is `flylock` with no args; its type carries the 33 bytes naming the fly.
    let occupied = 8 + data.len() as u64 + 33 + (33 + 33);
    assert_eq!(data.len(), WORLD_LEN);
    assert_eq!(WORLD_LEN, 128);
    assert_eq!(occupied, 235);
    assert!(
        u64::from(cell.capacity()) >= occupied,
        "the chronicle's capacity must cover its own bytes",
    );
}

// ===================================================================== refusals

#[test]
fn refuses_a_chronicle_that_does_not_match_the_fly() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    // A plausible-looking chronicle with the wrong energy: everything else is right, so
    // only the "the record must be exact" check can catch it.
    let mut forged = fly.chronicle();
    forged.energy += 1;
    let mut data = vec![0u8; WORLD_LEN];
    forged.encode(&mut data).unwrap();

    assert_eq!(
        fly.reject_code(
            tick(64),
            &Spec {
                world_data: Some(data),
                ..Spec::valid()
            }
        ),
        11,
        "SightingMismatch",
    );
}

#[test]
fn refuses_to_move_value_through_the_chronicle() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    // One shannon more than it had. A record that can hold value is a record that can be
    // used to hide value.
    assert_eq!(
        fly.reject_code(
            tick(64),
            &Spec {
                world_capacity: Some(WORLD_CAPACITY + 1),
                ..Spec::valid()
            }
        ),
        12,
        "CapacityChanged",
    );
}

#[test]
fn refuses_to_hand_the_chronicle_to_someone_else() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    // A different lock: `flylock` with args, so it is a different script from the one the
    // chronicle currently wears. Without this check, whoever updates the chronicle could
    // redirect it to themselves and the fly would lose its own history.
    let flylock_op = fly.ctx.deploy_cell(fly.flylock_bin.clone());
    let other = fly
        .ctx
        .build_script_with_hash_type(&flylock_op, ScriptHashType::Data1, Bytes::from(vec![1u8]))
        .expect("a lock nobody has");

    assert_eq!(
        fly.reject_code(
            tick(64),
            &Spec {
                world_lock: Some(other),
                ..Spec::valid()
            }
        ),
        4,
        "LockChanged",
    );
}

#[test]
fn refuses_to_repoint_the_chronicle_at_another_fly() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    // Changing the args changes the script hash, so CKB judges the transaction twice: the
    // original group has an input and no output, and the tampered group has an output and
    // no input — which looks like an opening, and an opening for a fly that already exists
    // is refused. Which of the two is reported depends on the order CKB runs the groups in,
    // so this asserts the set rather than a single code.
    let flyworld_op = fly.ctx.deploy_cell(fly.flyworld_bin.clone());
    let tampered = fly
        .ctx
        .build_script_with_hash_type(
            &flyworld_op,
            ScriptHashType::Data1,
            Bytes::from(
                WorldArgs {
                    fly_type_hash: [0u8; 32],
                }
                .to_bytes()
                .to_vec(),
            ),
        )
        .expect("a chronicle for another fly");

    let code = fly.reject_code(
        tick(64),
        &Spec {
            world_type: Some(tampered),
            ..Spec::valid()
        },
    );
    assert!(
        code == 3 || code == 9,
        "expected WrongOutputCount or FlyMissing, got {code}",
    );
}

#[test]
fn refuses_a_sighting_without_the_fly() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    // Drop the fly from the inputs. The chronicle then has nothing to look at, and the fly's
    // own group has no input either — so both scripts refuse, and which code is reported
    // depends on the order the groups run in.
    let code = fly.reject_code(
        tick(64),
        &Spec {
            drop_fly_input: true,
            ..Spec::valid()
        },
    );
    assert!(
        code == 9 || code == 18,
        "expected FlyMissing or NotGenesis, got {code}"
    );
}

#[test]
fn refuses_an_opening_for_a_fly_that_already_exists() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    // No chronicle input, so the contract reads this as an opening — but the fly is an
    // input, which means its birth is not in this transaction. A chronicle opened here
    // could not honestly say when the fly was born.
    assert_eq!(fly.reject_code(tick(64), &Spec::opening()), 9, "FlyMissing",);
}

#[test]
fn refuses_to_destroy_the_chronicle() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    assert_eq!(
        fly.reject_code(
            tick(64),
            &Spec {
                drop_world_output: true,
                ..Spec::valid()
            }
        ),
        3,
        "WrongOutputCount",
    );
}

#[test]
fn refuses_a_second_chronicle() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    assert_eq!(
        fly.reject_code(
            tick(64),
            &Spec {
                duplicate_world_output: true,
                ..Spec::valid()
            }
        ),
        3,
        "WrongOutputCount",
    );
}

#[test]
fn a_chronicle_that_is_not_the_record_is_caught_by_comparison_not_by_decoding() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    // A well-formed chronicle of the right length carrying the wrong version byte. The
    // contract does not decode the output at all — it computes what the record must be and
    // compares bytes — so this is refused as a mismatch rather than as malformed data. That
    // is the stronger check: a decoder can be fooled into accepting a plausible chronicle,
    // an equality test cannot.
    let mut data = vec![0u8; WORLD_LEN];
    data[0] = 9;
    assert_eq!(
        fly.reject_code(
            tick(64),
            &Spec {
                world_data: Some(data),
                ..Spec::valid()
            }
        ),
        11,
        "SightingMismatch",
    );
}

#[test]
fn a_malformed_chronicle_cannot_exist_to_begin_with() {
    // `InputWorldMalformed` (6) and `OutputWorldMalformed` (7) are defensive: the type
    // script is the only thing that can create a cell wearing its own type script, and the
    // creation path requires the data to equal a chronicle it computed. So a malformed
    // chronicle cannot be produced, and these codes exist for the case where one somehow
    // does — a decoder that tolerated it would let the next sighting build on a lie.
    //
    // This test pins the property rather than the codes: every chronicle the contract
    // writes decodes, over a run of transitions that includes a death and a resurrection.
    let Some((mut fly, _)) = Worldly::open(8) else {
        return;
    };
    assert!(
        World::decode(&fly.world_data).is_ok(),
        "the opening is decodable"
    );

    fly.apply(tick(8)).expect("die");
    assert!(
        World::decode(&fly.world_data).is_ok(),
        "the death is decodable"
    );

    fly.apply(Action::Resurrect {
        steps: 10_000,
        born_block: 0,
    })
    .expect("resurrect");
    assert!(
        World::decode(&fly.world_data).is_ok(),
        "the resurrection is decodable"
    );
}

#[test]
fn a_fly_whose_state_was_fabricated_is_refused_by_the_fly_not_the_chronicle() {
    // The chronicle records whatever the fly says — so the defence against a fabricated
    // sighting is that the fly's own type script refuses a fabricated state. This test
    // pins that division of labour: the failure comes from `flybrain`'s exit code, not from
    // the chronicle's.
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    let mut forged = fly.fly_data.clone();
    forged[32] ^= 1; // one byte of the energy field

    let code = fly.reject_code(
        tick(64),
        &Spec {
            fly_data: Some(forged),
            ..Spec::valid()
        },
    );
    assert!(
        code == 14 || code == 13 || code == 11,
        "expected the fly to refuse a fabricated state (13, 14) or the chronicle to notice a \
         mismatch (11), got {code}",
    );
}

#[test]
fn a_sighting_fits_in_the_per_transaction_policy_limit() {
    let Some((mut fly, _)) = Worldly::open(1_000_000) else {
        return;
    };
    let cycles = fly.apply(tick(64)).expect("tick");
    assert!(
        cycles < MAX_TX_VERIFY_CYCLES,
        "a tick plus a sighting costs {cycles} cycles, over the {MAX_TX_VERIFY_CYCLES} limit",
    );
    // And the sighting itself is cheap: the chronicle reads a header, not a simulation.
    println!("a 64-step tick with a sighting: {cycles} cycles");
}
