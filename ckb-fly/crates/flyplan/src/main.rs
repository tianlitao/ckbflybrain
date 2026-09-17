//! `flyplan` — the off-chain half of a transaction.
//!
//! # Why this exists
//!
//! A CKB transaction has to carry the *exact* successor state, byte for byte, and the
//! *exact* capacity the economics allows. Anything else is rejected by the type script.
//! That means whoever builds a transaction must be able to compute the next state — and
//! the only implementation of the dynamics that is allowed to be authoritative is
//! [`flycore`], the same crate the validator runs.
//!
//! So the deployer does not reimplement the simulation in JavaScript. It shells out to
//! this binary, which is a thin, allocation-friendly wrapper over `flycore` that speaks
//! hex in and JSON out. The chain-side work — building, signing and sending transactions
//! — stays in `deploy/`, where a CKB SDK belongs; the neural work stays here, where the
//! bit-exactness proof lives.
//!
//! # Commands
//!
//! ```text
//! flyplan circuit
//! flyplan params   --set v1|v2|sim
//! flyplan args     --params v1|v2 --economics testnet|free [--circuit-hash 0x..]
//! flyplan genesis  --params v1|v2 --energy N --born-block B
//! flyplan action   tick --steps N
//! flyplan action   stimulate --channel C --param P --strength S --steps N
//! flyplan action   feed --steps N
//! flyplan action   resurrect --steps N --born-block B
//! flyplan apply    --params v1|v2 --economics testnet|free --state 0x.. --action 0x..
//!                  [--in-capacity SHANNONS]
//! flyplan decode   --params v1|v2 --state 0x..
//! flyplan decode-action --params v1|v2 --action 0x..
//! flyplan world-args   --fly-type-hash 0x..
//! flyplan world-open   --fly-state 0x.. --capacity N
//! flyplan world-sight  --world 0x.. --fly-state 0x.. --in-capacity N --out-capacity N
//! flyplan world-decode --world 0x..
//! flyplan golden
//! ```
//!
//! `apply` is the important one: it is the transaction builder's oracle. Given the state
//! the fly is in and the action the caller wants, it reports the state the output cell
//! must hold and the capacity that must leave the body — the two numbers a valid
//! transaction is made of.
//!
//! `decode` and `decode-action` are the mirror image, and they exist for the indexer. CKB
//! has no event log, so a fly's history is recovered by walking its chain of state cells
//! and reading each transaction's witness; decoding those bytes here rather than in the
//! indexer keeps one implementation of the format, and means the indexer can only report
//! actions the contract would have accepted.
//!
//! The `world-*` commands are the same bargain for the chronicle cell. `flyworld`'s type
//! script requires the chronicle to be the *exact* record of the fly in the same
//! transaction, so the transaction builder has to be able to compute that record — and the
//! only implementation allowed to be authoritative is the one the validator runs.
//!
//! Every command writes one JSON object to stdout and exits 0. A refusal (an illegal
//! action, a malformed state) is written to stderr and exits 1, because the caller must
//! not be able to mistake "the fly refused" for "the fly advanced".

use std::process::ExitCode;

use flycircuit::embedded;
use flycore::{
    action::Action,
    args::ScriptArgs,
    economics::Economics,
    keccak::keccak256,
    params::Params,
    sim::Sim,
    state::{MAX_STATE_LEN, state_len},
    world::{World, WorldArgs, read_fly},
};

fn main() -> ExitCode {
    match run() {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(msg) => {
            eprintln!("flyplan: {msg}");
            ExitCode::FAILURE
        }
    }
}

// ------------------------------------------------------------------ tiny CLI

/// Flags are `--name value`; the first bare word is the command, the second (if the
/// command takes one, like `action`) is the subcommand.
struct Cli {
    words: Vec<String>,
    flags: Vec<(String, String)>,
}

impl Cli {
    fn parse() -> Result<Self, String> {
        let mut words = Vec::new();
        let mut flags = Vec::new();
        let mut it = std::env::args().skip(1).peekable();

        while let Some(arg) = it.next() {
            if let Some(name) = arg.strip_prefix("--") {
                let (name, value) = match name.split_once('=') {
                    Some((n, v)) => (n.to_string(), v.to_string()),
                    None => match it.peek() {
                        // A bare `--flag` is boolean: the next word is its value only if it
                        // is not itself a flag. `--full` is the only one today, and
                        // requiring `--full true` would be a silly way to spell it.
                        Some(next) if !next.starts_with("--") => {
                            let v = it.next().expect("peeked");
                            (name.to_string(), v)
                        }
                        _ => (name.to_string(), "true".to_string()),
                    },
                };
                flags.push((name, value));
            } else if arg == "-h" || arg == "--help" {
                return Err(usage());
            } else {
                words.push(arg);
            }
        }
        Ok(Self { words, flags })
    }

    fn flag(&self, name: &str) -> Option<&str> {
        self.flags
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    fn required(&self, name: &str) -> Result<&str, String> {
        self.flag(name)
            .ok_or_else(|| format!("missing required --{name}"))
    }

    fn u64(&self, name: &str) -> Result<u64, String> {
        self.required(name)?
            .parse()
            .map_err(|_| format!("--{name} must be a decimal integer"))
    }

    fn u16(&self, name: &str) -> Result<u16, String> {
        self.required(name)?
            .parse()
            .map_err(|_| format!("--{name} must be 0..=65535"))
    }

    fn u8(&self, name: &str) -> Result<u8, String> {
        self.required(name)?
            .parse()
            .map_err(|_| format!("--{name} must be 0..=255"))
    }

    fn params(&self) -> Result<Params, String> {
        match self.flag("params").unwrap_or("v1") {
            "v1" => Ok(Params::V1_DEPLOYED),
            "v2" => Ok(Params::V2),
            "sim" => Ok(Params::SIM_DEFAULTS),
            other => Err(format!("unknown --params {other} (v1, v2, sim)")),
        }
    }

    fn economics(&self) -> Result<Economics, String> {
        match self.flag("economics").unwrap_or("testnet") {
            "testnet" => Ok(Economics::TESTNET),
            "free" => Ok(Economics::FREE),
            other => Err(format!("unknown --economics {other} (testnet, free)")),
        }
    }

    fn hex(&self, name: &str) -> Result<Vec<u8>, String> {
        decode_hex(self.required(name)?)
    }
}

fn usage() -> String {
    "usage: flyplan <circuit|params|args|genesis|action|apply|decode|golden> [--flags]".to_string()
}

fn run() -> Result<String, String> {
    let cli = Cli::parse()?;
    let cmd = cli.words.first().map(String::as_str).unwrap_or("");

    match cmd {
        "circuit" => circuit(&cli),
        "params" => params(&cli),
        "args" => args(&cli),
        "economics" => economics(&cli),
        "genesis" => genesis(&cli),
        "action" => action(&cli),
        "apply" => apply(&cli),
        "decode" => decode(&cli),
        "decode-action" => decode_action(&cli),
        "world-args" => world_args(&cli),
        "world-open" => world_open(&cli),
        "world-sight" => world_sight(&cli),
        "world-decode" => world_decode(&cli),
        "golden" => golden(),
        other => Err(format!("unknown command `{other}`. {}", usage())),
    }
}

// ------------------------------------------------------------------ hex

fn encode_hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(2 + 2 * b.len());
    s.push_str("0x");
    for byte in b {
        s.push_str(&format!("{byte:02x}"));
    }
    s
}

fn decode_hex(s: &str) -> Result<Vec<u8>, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if !s.len().is_multiple_of(2) {
        return Err("hex string has an odd number of digits".to_string());
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = (bytes[i] as char)
            .to_digit(16)
            .ok_or_else(|| format!("`{}` is not hex", &s[i..i + 2]))?;
        let lo = (bytes[i + 1] as char)
            .to_digit(16)
            .ok_or_else(|| format!("`{}` is not hex", &s[i..i + 2]))?;
        out.push((hi * 16 + lo) as u8);
    }
    Ok(out)
}

// ------------------------------------------------------------------ commands

fn circuit(cli: &Cli) -> Result<String, String> {
    let table = embedded();
    let raw = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../flycircuit/data/circuit.bin"
    ))
    .map_err(|e| format!("cannot read circuit.bin: {e}"))?;

    // `--layout` adds where each neuron sits in the ring, which is what a front-end needs
    // to draw the attractor as a ring rather than as an anonymous list of 155 numbers.
    // Exposing it here rather than parsing the table in JavaScript keeps one decoder.
    let layout = if cli.flag("layout").is_some() {
        let n = table.n();
        let items: Vec<String> = (0..n)
            .map(|i| {
                format!(
                    r#"{{"type":{},"wedge":{},"side":{}}}"#,
                    table.cell_type(i),
                    table.wedge(i),
                    table.side(i),
                )
            })
            .collect();
        format!(r#","layout":[{}]"#, items.join(","))
    } else {
        String::new()
    };

    Ok(format!(
        r#"{{"hash":"{}","bytes":{},"n":{},"wedges":{}{}}}"#,
        encode_hex(&keccak256(&raw)),
        raw.len(),
        table.n(),
        flycircuit::WEDGES,
        layout,
    ))
}

fn params(cli: &Cli) -> Result<String, String> {
    let set = cli.flag("set").unwrap_or("v1");
    let p = match set {
        "v1" => Params::V1_DEPLOYED,
        "v2" => Params::V2,
        "sim" => Params::SIM_DEFAULTS,
        other => return Err(format!("unknown --set {other} (v1, v2, sim)")),
    };
    let gains: Vec<String> = p.gains.iter().map(|g| g.to_string()).collect();
    Ok(format!(
        r#"{{"set":"{set}","leak":{},"thresh":{},"reset":{},"vMin":{},"gains":[{}],"gBias":{},"noise":{},"stimGain":{},"stimTTL":{},"walkThreshold":{},"maxSteps":{},"persistInput":{},"bytes":"{}"}}"#,
        p.leak,
        p.thresh,
        p.reset,
        p.v_min,
        gains.join(","),
        p.g_bias,
        p.noise,
        p.stim_gain,
        p.stim_ttl,
        p.walk_threshold,
        p.max_steps,
        p.persist_input,
        encode_hex(&p.to_bytes()),
    ))
}

fn circuit_hash(cli: &Cli) -> Result<[u8; 32], String> {
    match cli.flag("circuit-hash") {
        Some(h) => {
            let b = decode_hex(h)?;
            b.as_slice()
                .try_into()
                .map_err(|_| "--circuit-hash must be 32 bytes".to_string())
        }
        None => {
            let raw = std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../flycircuit/data/circuit.bin"
            ))
            .map_err(|e| format!("cannot read circuit.bin: {e}"))?;
            Ok(keccak256(&raw))
        }
    }
}

/// The args, including the instance nonce that makes two flies two organisms.
///
/// `--instance` is required rather than defaulted. A default would be a zero nonce, and two
/// flies deployed without thinking about it would share a type script — indistinguishable to
/// the chain, and a keeper would tick whichever it found first. The mistake is silent and
/// expensive; making the caller supply eight bytes is cheap.
fn args(cli: &Cli) -> Result<String, String> {
    let instance: [u8; flycore::args::INSTANCE_LEN] = cli
        .hex("instance")?
        .as_slice()
        .try_into()
        .map_err(|_| "--instance must be 8 bytes".to_string())?;
    let a = ScriptArgs::new(
        instance,
        cli.params()?,
        circuit_hash(cli)?,
        cli.economics()?,
    );
    Ok(format!(
        r#"{{"args":"{}","len":{},"instance":"{}"}}"#,
        encode_hex(&a.to_bytes()),
        flycore::ARGS_LEN,
        encode_hex(&instance),
    ))
}

/// The prices, so a client can check the backing invariant for itself.
///
/// A front-end that shows the fly's capacity without showing what it is *for* is showing a
/// number; with these three it can display `capacity == body + energy × backing`, which is
/// the whole economics and is worth being able to see hold.
fn economics(cli: &Cli) -> Result<String, String> {
    let econ = cli.economics()?;
    let name = cli.flag("economics").unwrap_or("testnet");
    Ok(format!(
        r#"{{"set":"{name}","backingPerStep":"{}","stimCostSteps":"{}","bodyCapacity":"{}","bytes":"{}"}}"#,
        econ.backing_per_step,
        econ.stim_cost_steps,
        econ.body_capacity,
        encode_hex(&econ.to_bytes()),
    ))
}

fn genesis(cli: &Cli) -> Result<String, String> {
    let sim = Sim::genesis(
        embedded(),
        cli.params()?,
        cli.u64("energy")?,
        cli.u64("born-block").unwrap_or(0),
    );
    Ok(state_json(&sim, None, false))
}

fn action(cli: &Cli) -> Result<String, String> {
    let sub = cli
        .words
        .get(1)
        .ok_or_else(|| "`action` needs a kind: tick, stimulate, feed, resurrect".to_string())?;

    let action = match sub.as_str() {
        "tick" => Action::Tick {
            steps: cli.u16("steps")?,
        },
        "stimulate" => Action::Stimulate {
            channel: cli.u8("channel")?,
            param: cli.u8("param")?,
            strength: cli.u8("strength")?,
            steps: cli.u16("steps")?,
        },
        "feed" => Action::Feed {
            steps: cli.u64("steps")?,
        },
        "resurrect" => Action::Resurrect {
            steps: cli.u64("steps")?,
            born_block: cli.u64("born-block")?,
        },
        other => return Err(format!("unknown action `{other}`")),
    };

    // Encode, then decode back through the validator's own parser: an action the builder
    // can produce but the type script would refuse must fail here, not on chain.
    let (buf, len) = action.encode_fixed();
    Action::decode(&buf[..len], &cli.params()?)
        .map_err(|e| format!("the contract would refuse this action: {e:?}"))?;

    Ok(format!(
        r#"{{"action":"{}","len":{}}}"#,
        encode_hex(&buf[..len]),
        len
    ))
}

fn apply(cli: &Cli) -> Result<String, String> {
    let params = cli.params()?;
    let econ = cli.economics()?;
    let data = cli.hex("state")?;
    let action_bytes = cli.hex("action")?;

    let mut sim = Sim::decode(embedded(), params, &data)
        .map_err(|e| format!("input state is not decodable: {e:?}"))?;
    let in_energy = sim.energy;

    let action = Action::decode(&action_bytes, &params)
        .map_err(|e| format!("the contract would refuse this action: {e:?}"))?;
    sim.apply(action, &econ)
        .map_err(|e| format!("the contract would refuse this action: {e:?}"))?;

    let in_capacity = cli.flag("in-capacity").map(|s| {
        s.parse::<i128>()
            .map_err(|_| "--in-capacity must be a decimal integer".to_string())
    });
    let in_capacity = match in_capacity {
        Some(r) => Some(r?),
        None => None,
    };

    Ok(state_json(
        &sim,
        in_capacity.map(|c| (c, in_energy, econ)),
        cli.flag("full").is_some(),
    ))
}

// ------------------------------------------------------------------ the world

/// The chronicle's args: the fly it governs, identified by type script hash.
fn world_args(cli: &Cli) -> Result<String, String> {
    let hash: [u8; 32] = cli
        .hex("fly-type-hash")?
        .as_slice()
        .try_into()
        .map_err(|_| "--fly-type-hash must be 32 bytes".to_string())?;
    let args = WorldArgs {
        fly_type_hash: hash,
    };
    Ok(format!(
        r#"{{"args":"{}","len":{}}}"#,
        encode_hex(&args.to_bytes()),
        flycore::world::ARGS_LEN,
    ))
}

fn world_open(cli: &Cli) -> Result<String, String> {
    let fly = cli.hex("fly-state")?;
    let header = read_fly(&fly).map_err(|e| format!("the fly's state is not decodable: {e:?}"))?;
    let world = World::open(&header, keccak256(&fly), cli.u64("capacity")?);
    Ok(world_json(&world, None))
}

fn world_sight(cli: &Cli) -> Result<String, String> {
    let fly = cli.hex("fly-state")?;
    let header = read_fly(&fly).map_err(|e| format!("the fly's state is not decodable: {e:?}"))?;
    let previous = World::decode(&cli.hex("world")?)
        .map_err(|e| format!("the input chronicle is not decodable: {e:?}"))?;

    let in_capacity = cli.u64("in-capacity")?;
    let out_capacity = cli.u64("out-capacity")?;
    let next = previous.sight(&header, keccak256(&fly), in_capacity, out_capacity);
    Ok(world_json(&next, Some(&previous)))
}

fn world_decode(cli: &Cli) -> Result<String, String> {
    let world = World::decode(&cli.hex("world")?)
        .map_err(|e| format!("the chronicle is not decodable: {e:?}"))?;
    Ok(world_json(&world, None))
}

/// The chronicle as JSON. `previous` adds what a sighting changed, which is the interesting
/// part of a record — the totals on their own do not say what just happened.
fn world_json(world: &World, previous: Option<&World>) -> String {
    let mut buf = [0u8; flycore::world::WORLD_LEN];
    world
        .encode(&mut buf)
        .expect("buffer is sized to WORLD_LEN");

    let delta = match previous {
        Some(p) => format!(
            r#","released":"{}","added":"{}","newLife":{}"#,
            world.total_released - p.total_released,
            world.total_added - p.total_added,
            world.generation != p.generation,
        ),
        None => String::new(),
    };

    format!(
        r#"{{"data":"{}","len":{},"alive":{},"generation":{},"bornStep":"{}","diedStep":"{}","step":"{}","energy":"{}","lifeSteps":"{}","totalSpikes":"{}","capacity":"{}","totalReleased":"{}","totalAdded":"{}","netCapacity":"{}","sightings":"{}","stateHash":"{}"{}}}"#,
        encode_hex(&buf),
        flycore::world::WORLD_LEN,
        world.alive,
        world.generation,
        world.born_step,
        world.died_step,
        world.step,
        world.energy,
        world.life_steps,
        world.total_spikes,
        world.capacity,
        world.total_released,
        world.total_added,
        world.net_capacity(),
        world.sightings,
        encode_hex(&world.state_hash),
        delta,
    )
}

/// The one place a state is turned into JSON, so `genesis` and `apply` cannot describe
/// the same bytes differently.
///
/// `capacity` is `(input capacity, input energy, economics)` when the caller told us what
/// the input cell actually holds; it lets us report the exact capacity the output cell
/// must have, which is the number the transaction has to get right.
///
/// `full` adds the three per-neuron arrays. A front-end drawing the ring attractor needs
/// them; everything else only needs the summary, and 465 numbers per state is a lot of
/// JSON to ship to something that is not going to draw them.
fn state_json(sim: &Sim<'_>, capacity: Option<(i128, u64, Economics)>, full: bool) -> String {
    let n = state_len(sim.circuit.n());
    let mut buf = [0u8; MAX_STATE_LEN];
    sim.encode(&mut buf[..n])
        .expect("buffer is sized to state_len(n)");
    let state = &buf[..n];

    let hist: Vec<String> = sim.hist.iter().map(|w| w.to_string()).collect();

    let mut extra = String::new();
    if let Some((in_cap, in_energy, econ)) = capacity {
        let release = econ.capacity_release(in_energy, sim.energy);
        extra = format!(
            r#","inCapacity":"{}","release":"{}","outCapacity":"{}","inRequiredCapacity":"{}","outRequiredCapacity":"{}""#,
            in_cap,
            release,
            in_cap - release,
            econ.required_capacity(in_energy),
            econ.required_capacity(sim.energy),
        );
    }

    if full {
        let neurons = sim.circuit.n();
        let list = |f: &dyn Fn(usize) -> i64| -> String {
            (0..neurons)
                .map(|i| f(i).to_string())
                .collect::<Vec<_>>()
                .join(",")
        };
        extra.push_str(&format!(
            r#","v":[{}],"bias":[{}],"inp":[{}]"#,
            list(&|i| sim.v[i]),
            list(&|i| sim.bias[i] as i64),
            list(&|i| sim.inp[i]),
        ));
    }

    format!(
        r#"{{"state":"{}","len":{},"stateHash":"{}","n":{},"step":"{}","energy":"{}","alive":{},"generation":{},"totalSpikes":"{}","lifeSteps":"{}","lifeSpikes":"{}","bornBlock":"{}","stimUntil":"{}","stimChannel":{},"stimParam":{},"stimStrength":{},"headX":{},"headY":{},"posX":"{}","posY":"{}","headingHist":[{}]{}}}"#,
        encode_hex(state),
        n,
        encode_hex(&keccak256(state)),
        sim.circuit.n(),
        sim.step,
        sim.energy,
        sim.alive,
        sim.generation,
        sim.total_spikes,
        sim.life_steps,
        sim.life_spikes,
        sim.born_block,
        sim.stim_until,
        sim.stim_channel,
        sim.stim_param,
        sim.stim_strength,
        sim.head_x,
        sim.head_y,
        sim.pos_x,
        sim.pos_y,
        hist.join(","),
        extra,
    )
}

fn decode(cli: &Cli) -> Result<String, String> {
    let data = cli.hex("state")?;
    let sim = Sim::decode(embedded(), cli.params()?, &data)
        .map_err(|e| format!("state is not decodable: {e:?}"))?;
    Ok(state_json(&sim, None, cli.flag("full").is_some()))
}

/// The inverse of `action`: the bytes a witness carries, back into what was asked.
///
/// The action is validated on the way out, so the indexer cannot report an action the
/// type script would have refused. That matters more than it sounds: it means a history
/// entry is not the indexer's opinion of what a transaction meant, it is the same parse
/// the contract performed before it agreed to the transition.
fn decode_action(cli: &Cli) -> Result<String, String> {
    let bytes = cli.hex("action")?;
    let action = Action::decode(&bytes, &cli.params()?)
        .map_err(|e| format!("not an action the contract would accept: {e:?}"))?;

    Ok(match action {
        Action::Tick { steps } => format!(r#"{{"kind":"tick","steps":{steps}}}"#),
        Action::Stimulate {
            channel,
            param,
            strength,
            steps,
        } => format!(
            r#"{{"kind":"stimulate","channel":{channel},"param":{param},"strength":{strength},"steps":{steps}}}"#
        ),
        Action::Feed { steps } => format!(r#"{{"kind":"feed","steps":{steps}}}"#),
        Action::Resurrect { steps, born_block } => {
            format!(r#"{{"kind":"resurrect","steps":{steps},"bornBlock":{born_block}}}"#)
        }
    })
}

/// The vectors `deploy/test/golden.test.js` pins the TypeScript encoder against.
///
/// The point is not that these numbers are interesting — it is that they are *produced by
/// the same code the validator runs*. A JavaScript mirror of the encoders is only safe as
/// long as something fails loudly when the two drift, and this is that something.
fn golden() -> Result<String, String> {
    let params = Params::V1_DEPLOYED;
    let econ = Economics::TESTNET;
    let circuit = circuit_hash(&Cli {
        words: vec![],
        flags: vec![],
    })?;

    let actions = [
        ("tick64", Action::Tick { steps: 64 }),
        (
            "stimulateCue4",
            Action::Stimulate {
                channel: 1,
                param: 4,
                strength: 4,
                steps: 32,
            },
        ),
        ("feed10000", Action::Feed { steps: 10_000 }),
        (
            "resurrect1000",
            Action::Resurrect {
                steps: 1_000,
                born_block: 42,
            },
        ),
    ];
    let actions_json: Vec<String> = actions
        .iter()
        .map(|(name, a)| {
            let (buf, len) = a.encode_fixed();
            format!(r#""{name}":"{}""#, encode_hex(&buf[..len]))
        })
        .collect();

    // A worked transition: the mainnet replay's opening move, `tick(64)` on a newborn
    // million-step fly. This pins the encoder *and* the dynamics in one number.
    let start = Sim::genesis(embedded(), params, 1_000_000, 0);
    let mut start_bytes = [0u8; MAX_STATE_LEN];
    let n = state_len(155);
    start.encode(&mut start_bytes[..n]).unwrap();

    let mut end = Sim::decode(embedded(), params, &start_bytes[..n]).unwrap();
    end.apply(Action::Tick { steps: 64 }, &econ).unwrap();
    let mut end_bytes = [0u8; MAX_STATE_LEN];
    end.encode(&mut end_bytes[..n]).unwrap();

    let in_cap = econ.required_capacity(start.energy);
    let release = econ.capacity_release(start.energy, end.energy);

    Ok(format!(
        r#"{{"stateLen":{},"argsLen":{},"paramsV1":"{}","paramsV2":"{}","economicsTestnet":"{}","economicsFree":"{}","argsV1Testnet":"{}","circuitHash":"{}","actions":{{{}}},"genesis":{{"energy":"1000000","bornBlock":"0","state":"{}"}},"transition":{{"action":"tick64","from":"{}","to":"{}","inEnergy":"{}","outEnergy":"{}","inCapacity":"{}","release":"{}","outCapacity":"{}","totalSpikes":"{}","step":"{}"}}}}"#,
        n,
        flycore::ARGS_LEN,
        encode_hex(&params.to_bytes()),
        encode_hex(&Params::V2.to_bytes()),
        encode_hex(&econ.to_bytes()),
        encode_hex(&Economics::FREE.to_bytes()),
        encode_hex(&ScriptArgs::new([0xAB; 8], params, circuit, econ).to_bytes()),
        encode_hex(&circuit),
        actions_json.join(","),
        encode_hex(&start_bytes[..n]),
        encode_hex(&start_bytes[..n]),
        encode_hex(&end_bytes[..n]),
        start.energy,
        end.energy,
        in_cap,
        release,
        in_cap as i128 - release,
        end.total_spikes,
        end.step,
    ))
}
