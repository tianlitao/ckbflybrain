/**
 * The bridge to `crates/flyplan`, the host-side planner.
 *
 * The rule this module exists to enforce: **the deployer never computes fly bytes.** The
 * state a transaction must carry, the capacity it must release, the action witness, the
 * type-script args — all of it comes from the same Rust crate the on-chain validator
 * runs. A JavaScript reimplementation of the dynamics would be a second source of truth,
 * and the whole point of the port is that there is exactly one.
 *
 * `fly.js` is the other half of that bargain: it is the mirror a browser will need
 * (a front-end cannot shell out to Rust), and `test/golden.test.js` fails if it ever
 * disagrees with what this module returns.
 *
 * @module plan
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { PROJECT_ROOT } from "./artifacts.js";

/**
 * The planner binary.
 *
 * Built by `make plan`. `FLYPLAN` overrides the path, which is what lets a release build
 * be used without changing the code that calls it.
 */
export function plannerPath() {
  if (process.env.FLYPLAN) {
    return process.env.FLYPLAN;
  }
  const candidates = [
    join(PROJECT_ROOT, "target", "debug", "flyplan"),
    join(PROJECT_ROOT, "target", "release", "flyplan"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `the planner binary is missing. Run \`make plan\` first (looked in ${candidates.join(", ")}).`,
    );
  }
  return found;
}

/**
 * Run the planner and parse its JSON.
 *
 * The planner refuses illegal input by exiting non-zero with a message on stderr, and a
 * refusal must not be mistaken for a result, so it is turned into a thrown error here
 * rather than a `null` the caller might pass on to a transaction builder.
 *
 * @param {string[]} args
 * @returns {object}
 */
export function plan(args) {
  const bin = plannerPath();
  let stdout;
  try {
    stdout = execFileSync(bin, args, { encoding: "utf8" });
  } catch (err) {
    const detail = (err.stderr ?? "").trim() || err.message;
    throw new Error(`flyplan ${args.join(" ")} failed: ${detail}`);
  }
  return JSON.parse(stdout);
}

/**
 * The connectome as the planner sees it: keccak256, byte length, neuron count.
 *
 * `layout` adds each neuron's cell type, compass wedge and hemisphere. A front-end needs
 * it to draw the ring attractor as a ring rather than as 155 anonymous numbers, and taking
 * it from here rather than parsing the table in JavaScript keeps one decoder for one
 * format.
 */
export function circuit({ layout = false } = {}) {
  return plan(layout ? ["circuit", "--layout"] : ["circuit"]);
}

/** One of the three parameter sets, plus its 32-byte encoding. */
export function params(set = "v1") {
  return plan(["params", "--set", set]);
}

/**
 * A fresh eight-byte instance nonce for a newborn fly.
 *
 * **Always fresh. Never inherited from an existing fly.** The nonce is part of the fly's type
 * script args, so two flies that shared one would share a type script — and then "find the
 * cell wearing the fly's type script" returns an arbitrary one of them. The symptoms are
 * quiet: `status` reads the wrong organism, and a keeper driving both ticks first one and
 * then the other, so the step counter goes backwards and nothing errors. That is exactly the
 * failure this field was introduced to prevent, which makes reusing a record's instance the
 * one thing this function must never be asked to do.
 *
 * It lives here, next to `args`, rather than in the CLI: the CLI has the deployment record in
 * hand and is therefore the place where inheriting would look reasonable.
 */
export function mintInstance() {
  return "0x" + randomBytes(8).toString("hex");
}

/**
 * The 97 bytes of type-script args for an organism.
 *
 * `instance` is required, not defaulted: a default would be a zero nonce, and two flies
 * deployed without thinking about it would share a type script — indistinguishable to the
 * chain, so a keeper would tick whichever it found first and the step counter would go
 * backwards without anything erroring.
 */
export function args({ instance, params: set = "v1", economics = "testnet", circuitHash } = {}) {
  if (!instance) {
    throw new Error("args needs an `instance`: eight bytes that make this fly a particular organism");
  }
  const argv = ["args", "--instance", instance, "--params", set, "--economics", economics];
  if (circuitHash) {
    argv.push("--circuit-hash", circuitHash);
  }
  return plan(argv);
}

/**
 * The prices that back a step of life.
 *
 * A client that shows a fly's capacity without showing what the capacity is *for* is
 * showing a number. With these three it can display `capacity == body + energy × backing`,
 * which is the entire economics and is worth being able to watch hold.
 */
export function economics({ set = "testnet" } = {}) {
  return plan(["economics", "--economics", set]);
}

/** A newborn state, exactly as the genesis branch of the type script demands it. */
export function genesis({ params: set = "v1", energy, bornBlock = 0n }) {
  return plan([
    "genesis",
    "--params",
    set,
    "--energy",
    String(energy),
    "--born-block",
    String(bornBlock),
  ]);
}

/**
 * Encode an action exactly as the witness must carry it.
 *
 * @param {{kind: string} & Record<string, unknown>} spec
 */
export function action(spec) {
  const argv = ["action", spec.kind];
  if (spec.kind === "stimulate") {
    argv.push(
      "--channel",
      String(spec.channel),
      "--param",
      String(spec.param),
      "--strength",
      String(spec.strength),
      "--steps",
      String(spec.steps),
    );
  } else {
    argv.push("--steps", String(spec.steps));
  }
  if (spec.kind === "resurrect") {
    argv.push("--born-block", String(spec.bornBlock));
  }
  // Every action is range-checked against the parameters by the contract's own parser
  // before it is returned, so an illegal one fails here rather than on chain.
  return plan([...argv, "--params", spec.params ?? "v1"]);
}

/**
 * The successor state and the capacity that must leave the body.
 *
 * This is the deployer's oracle: `state` is what the output cell must hold byte for byte,
 * and `outCapacity` is what it must hold in shannons. Get either wrong and the type script
 * refuses the transaction — which is the design working, not a problem with the tooling.
 */
export function apply({ params: set = "v1", economics = "testnet", state, action: actionHex, inCapacity }) {
  const argv = [
    "apply",
    "--params",
    set,
    "--economics",
    economics,
    "--state",
    state,
    "--action",
    actionHex,
  ];
  if (inCapacity !== undefined) {
    argv.push("--in-capacity", String(inCapacity));
  }
  return plan(argv);
}

/**
 * Decode a state cell.
 *
 * `full` adds the three per-neuron arrays, which is what a front-end drawing the ring
 * attractor needs and what nothing else does — 465 numbers per state is a lot of JSON to
 * send to something that is only going to print a summary.
 */
export function decode({ params: set = "v1", state, full = false }) {
  const argv = ["decode", "--params", set, "--state", state];
  if (full) {
    argv.push("--full");
  }
  return plan(argv);
}

/**
 * Decode the action a witness carries, validated on the way out.
 *
 * The planner refuses anything the contract would have refused, so a history entry
 * recovered from the chain is not the indexer's reading of what a transaction meant — it
 * is the same parse the type script performed before it agreed to the transition.
 */
export function decodeAction({ params: set = "v1", action: actionHex }) {
  return plan(["decode-action", "--params", set, "--action", actionHex]);
}

/** The vectors `test/golden.test.js` pins `fly.js` against. */
export function golden() {
  return plan(["golden"]);
}

// ---------------------------------------------------------------- the world

/** The chronicle's args: the fly it governs, identified by type script hash. */
export function worldArgs({ flyTypeHash }) {
  return plan(["world-args", "--fly-type-hash", flyTypeHash]);
}

/**
 * Open a chronicle for a fly that has just been born.
 *
 * `flyState` must be the newborn state and `capacity` the capacity of the cell holding it,
 * because the chronicle's opening record is the fly's own — there is nothing for the caller
 * to choose.
 */
export function worldOpen({ flyState, capacity }) {
  return plan(["world-open", "--fly-state", flyState, "--capacity", String(capacity)]);
}

/**
 * Record a sighting: the successor chronicle, derived from the fly on both sides of the
 * transition.
 *
 * Both capacities are the *fly's*, not the chronicle's — the chronicle's own capacity never
 * changes, and its type script refuses any transaction that tries to change it.
 */
export function worldSight({ world, flyState, inCapacity, outCapacity }) {
  return plan([
    "world-sight",
    "--world",
    world,
    "--fly-state",
    flyState,
    "--in-capacity",
    String(inCapacity),
    "--out-capacity",
    String(outCapacity),
  ]);
}

/** Decode a chronicle for display. */
export function worldDecode({ world }) {
  return plan(["world-decode", "--world", world]);
}
