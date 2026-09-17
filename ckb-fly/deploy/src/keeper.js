/**
 * The keeper: keeps the fly alive without a human in the loop.
 *
 * # What it is for
 *
 * Upstream's first roadmap goal is "the genesis fly is continuously alive, visibly, without
 * a human in the loop". Everything else in this project — the contracts, the economics, the
 * front-end — is about a fly that lives; this is the thing that actually keeps it living.
 *
 * # The economics, stated honestly
 *
 * A tick releases `backing_per_step` for every step it advances, and feeding costs exactly
 * `backing_per_step` per step bought. The two numbers are the same, so **a keeper that both
 * ticks the fly and feeds it breaks even, minus fees.** Ticking is not a business.
 *
 * What that means in practice:
 *
 * * The fly's life is a *stock*. Ticking converts it into the keeper's change; feeding
 *   converts the keeper's change back into life. The keeper is a conduit.
 * * Whether the fly lives forever is decided by `net = fed − released` in the chronicle —
 *   the capacity other people have put in. A keeper with no feeder behind it can only
 *   recycle what is already there, and the fly dies when the stock runs out.
 * * The keeper's real cost is the **fee**, which is the one number here that is not
 *   neutral. So the keeper measures its own balance and reports it: if the balance falls
 *   faster than the life it bought, the difference is the fee drag, and that is the honest
 *   answer to "does this thing pay for itself".
 *
 * # Why it has to retry
 *
 * A CKB cell is a UTXO: the same version of the fly can be spent exactly once. Two keepers
 * — or one keeper and a curious visitor with the page open — cannot both tick it. One wins
 * and the other's transaction is rejected because the cell it named no longer exists. That
 * is not an error to be avoided; it is the model. So the keeper treats a lost race as a
 * signal to re-read and try again, which is exactly the behaviour the migration plan
 * predicted a CKB keeper would need.
 *
 * There is a second rejection that is easy to confuse with it, and the confusion is expensive.
 * A transaction is a deterministic function of the cell it spends, the action and the fee — so
 * **two keepers ticking the same fly build byte-identical transactions and the same hash**.
 * The second to arrive is told `PoolRejectedDuplicatedTransaction`, not "this cell is spent".
 * That is not a competitor and not a failure; it is the same race seen from the other side.
 * Counting it as a failure is what made two of three keepers stop after ten passes when they
 * were raced against each other on preview testnet. `classifySendError` separates the two, and
 * the ledger counts them separately, because the mix is diagnostic: all duplicates means the
 * keepers agree, many lost races means they disagree.
 *
 * # Running it
 *
 * ```sh
 * npm run keeper                      # forever, 64 steps every 5 s
 * KEEPER_MAX_TICKS=10 npm run keeper  # ten ticks, then a ledger
 * ```
 *
 * | variable | default | meaning |
 * |---|---|---|
 * | `KEEPER_INTERVAL_MS` | `5000` | how long to wait between ticks |
 * | `KEEPER_STEPS` | `64` | steps per tick, 1..=64 |
 * | `KEEPER_FEED_BELOW` | `200000` | feed when the fly has fewer steps of life than this |
 * | `KEEPER_FEED_AMOUNT` | `1000000` | steps of life to buy when it does |
 * | `KEEPER_MAX_TICKS` | unlimited | stop after this many ticks — or, in a dry run, this many passes |
 * | `KEEPER_DRY_RUN` | unset | set to `1` to decide and report without sending |
 *
 * @module keeper
 */

import { pathToFileURL } from "node:url";

import * as ccc from "@ckb-ccc/core";

import { CONFIG, applyAction, liveCells, makeClient, makeSigner, readDeployment } from "./cli.js";
import * as plan from "./plan.js";
import { classifySendError } from "./send.js";
import { describeBranches } from "./watch.js";
import { signableLock } from "./watch.js";

const INTERVAL = Number(process.env.KEEPER_INTERVAL_MS ?? 5000);
const STEPS = Number(process.env.KEEPER_STEPS ?? 64);
const FEED_BELOW = BigInt(process.env.KEEPER_FEED_BELOW ?? "200000");
const FEED_AMOUNT = BigInt(process.env.KEEPER_FEED_AMOUNT ?? "1000000");
const MAX_TICKS = process.env.KEEPER_MAX_TICKS ? Number(process.env.KEEPER_MAX_TICKS) : Infinity;
const DRY_RUN = process.env.KEEPER_DRY_RUN === "1";

const CKB = 100_000_000n;
const ckb = (shannons) =>
  (Number(shannons) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 });


/** What the keeper has done, and what it cost. */
const ledger = {
  started: Date.now(),
  ticks: 0,
  feeds: 0,
  resurrects: 0,
  lostRaces: 0,
  duplicates: 0,
  dryRuns: 0,
  released: 0n,
  added: 0n,
  fees: 0n,
  failures: 0,
};

/**
 * Is the run over?
 *
 * `KEEPER_MAX_TICKS` bounds *ticks*, which is what it says and what a real run wants — a
 * keeper that is losing races should keep trying, not give up after N attempts. But a dry run
 * performs no ticks at all, so bounding it that way never terminates: `KEEPER_DRY_RUN=1
 * KEEPER_MAX_TICKS=3` loops forever, printing the same decision. Dry runs are bounded by
 * passes instead, and the report says which count it stopped on.
 */
const limitReached = () =>
  DRY_RUN ? ledger.dryRuns >= MAX_TICKS : ledger.ticks >= MAX_TICKS;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Read the fly as the chain currently has it.
 *
 * Deliberately a fresh read every time rather than a cached view: the whole point of the
 * retry loop is that this can change underneath the keeper between one line and the next.
 *
 * Three outcomes, and the middle one is the reason this does not use
 * `findSingletonCellByType`. That helper returns whichever cell the indexer orders first, so
 * on a branched fly the keeper would tick a branch it never chose, silently, and abandon the
 * others. A keeper is the *only* thing here that moves the fly unattended, so "pick one and
 * carry on" is the one answer it must not give — there is no page open for a human to notice
 * that the step counter is jumping around.
 *
 * @returns {Promise<null|{branched: object[]}|{cell: object, capacity: bigint, state: object}>}
 */
async function readFly(client, record) {
  // Found by type script, not by a stored out point: the keeper is the thing that moves the
  // fly, so any position it remembered would be stale by the time it looked again.
  const { matches } = await liveCells(client, record.fly.typeScript);
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    return { branched: matches };
  }
  const cell = matches[0];
  return {
    cell,
    capacity: BigInt(cell.cellOutput.capacity),
    state: plan.decode({ params: record.params, state: ccc.hexFrom(cell.outputData) }),
  };
}

/**
 * The fee a transaction actually paid: what went in, minus what came out.
 *
 * Measured from the transaction rather than from the keeper's balance, because a balance
 * measures everything a key did, not just this. On a dev chain the miner's reward is paid to
 * the same key — which made the first version of this report a rise of 601,318 CKB in
 * seventeen seconds and a "fee" of minus six hundred thousand.
 */
async function measureFee(client, txHash) {
  const tx = (await client.getTransaction(txHash)).transaction;
  let inTotal = 0n;
  for (const input of tx.inputs) {
    const cell = await client.getCell(input.previousOutput);
    if (!cell) {
      throw new Error(`cannot resolve an input of ${txHash} to measure its fee`);
    }
    inTotal += BigInt(cell.cellOutput.capacity);
  }
  let outTotal = 0n;
  for (const out of tx.outputs) {
    outTotal += BigInt(out.capacity);
  }
  return inTotal - outTotal;
}

/**
 * Run one action, tolerating the two ways a send can fail without meaning anything is wrong.
 * Returns the result, or `null` if it was lost or is still pending.
 */
async function attempt(spec) {
  try {
    return await applyAction(spec, { quiet: true, record: false });
  } catch (err) {
    const message = err.message ?? String(err);
    const kind = classifySendError(message);
    if (kind === "fatal") {
      throw err;
    }
    if (kind === "lost") {
      ledger.lostRaces += 1;
      console.log(`  lost the race: ${message}`);
    } else {
      ledger.duplicates += 1;
      console.log(`  still pending: ${message}`);
    }
    return null;
  }
}

async function step(client, signer, record) {
  const fly = await readFly(client, record);
  if (!fly) {
    console.log("  the fly's state cell is gone — it was spent and not replaced");
    return false;
  }
  if (fly.branched) {
    console.log(
      `  ${describeBranches(record.fly.typeHash, fly.branched.map((cell) => cell.outPoint))}`,
    );
    console.log("  stopping rather than choosing a branch.");
    return false;
  }

  const { state } = fly;
  if (!state.alive) {
    // A dead fly can only be resurrected, and only if there is capacity to buy a life with.
    // A keeper that resurrects on its own account is buying a life it cannot get back, so
    // this is opt-in: the default is to stop and say so.
    if (process.env.KEEPER_RESURRECT !== "1") {
      console.log(`  the fly is dead at step ${state.step} — stopping (set KEEPER_RESURRECT=1 to revive it)`);
      return false;
    }
    if (DRY_RUN) {
      console.log(`  would resurrect with ${ckb(FEED_AMOUNT * 10_000n)} CKB`);
      return true;
    }
    const result = await attempt({
      kind: "resurrect",
      steps: Number(FEED_AMOUNT),
      bornBlock: Number(await client.getTip()) + 1,
    });
    if (result) {
      ledger.resurrects += 1;
      ledger.added += BigInt(result.after.outCapacity) - BigInt(result.capacityBefore);
      ledger.fees += await measureFee(client, result.txHash);
      console.log(`  resurrected: generation ${result.after.generation}, ${ckb(FEED_AMOUNT * 10_000n)} CKB bought`);
    }
    return true;
  }

  // Feed first when life is short, so the fly never dies waiting for the next tick. The
  // threshold is checked against the *current* energy, before the tick is applied.
  if (BigInt(state.energy) < FEED_BELOW) {
    if (DRY_RUN) {
      console.log(`  would feed ${ckb(FEED_AMOUNT)} steps (energy ${state.energy})`);
    } else {
      const result = await attempt({ kind: "feed", steps: Number(FEED_AMOUNT) });
      if (result) {
        ledger.feeds += 1;
        ledger.added += BigInt(result.after.outCapacity) - BigInt(result.capacityBefore);
        ledger.fees += await measureFee(client, result.txHash);
        console.log(
          `  fed ${Number(FEED_AMOUNT).toLocaleString("en-US")} steps for ` +
            `${ckb(FEED_AMOUNT * 10_000n)} CKB (energy ${state.energy} -> ${result.after.energy})`,
        );
      }
    }
  }

  if (DRY_RUN) {
    ledger.dryRuns += 1;
    console.log(`  would tick ${STEPS} steps (step ${state.step}, energy ${state.energy})`);
    return true;
  }

  const result = await attempt({ kind: "tick", steps: STEPS });
  if (!result) {
    return true; // lost the race; the next pass re-reads
  }

  ledger.ticks += 1;
  ledger.released += BigInt(result.after.release);
  ledger.fees += await measureFee(client, result.txHash);
  console.log(
    `  tick ${String(ledger.ticks).padStart(4)}  step ${String(result.after.step).padStart(6)}  ` +
      `energy ${String(result.after.energy).padStart(9)}  spikes ${String(result.after.totalSpikes).padStart(7)}  ` +
      `+${ckb(BigInt(result.after.release))} CKB`,
  );
  return true;
}

function report() {
  const seconds = Math.round((Date.now() - ledger.started) / 1000);
  const net = ledger.released - ledger.added;
  const actions = ledger.ticks + ledger.feeds + ledger.resurrects;

  console.log("\nledger");
  console.log(`  ran for       ${seconds}s`);
  console.log(`  ticks         ${ledger.ticks}`);
  console.log(`  feeds         ${ledger.feeds}`);
  console.log(`  resurrects    ${ledger.resurrects}`);
  console.log(`  lost races    ${ledger.lostRaces}`);
  if (ledger.duplicates) {
    console.log(
      `  duplicates    ${ledger.duplicates}  (another keeper built the identical transaction, ` +
        `or ours is still in the pool — the cell was about to be spent either way)`,
    );
  }
  if (DRY_RUN) {
    console.log(`  dry passes    ${ledger.dryRuns}  (nothing was sent; \`KEEPER_MAX_TICKS\` bounds these)`);
  }
  console.log(`  released      ${ckb(ledger.released)} CKB  (taken from the fly)`);
  console.log(`  added         ${ckb(ledger.added)} CKB  (put back)`);
  console.log(`  net           ${ckb(net)} CKB`);
  console.log(`  fees paid     ${ckb(ledger.fees)} CKB  (${actions} transactions)`);
  if (actions > 0) {
    console.log(`  per action    fee ${ckb(ledger.fees / BigInt(actions))} CKB`);
  }
  if (ledger.ticks > 0) {
    const perTick = ledger.released / BigInt(ledger.ticks);
    const feePerTick = ledger.fees / BigInt(actions || 1);
    console.log(
      `  margin        ${ckb(perTick)} CKB released per tick against ${ckb(feePerTick)} CKB of fee ` +
        `(${perTick > feePerTick ? "profitable" : "a loss"} by ` +
        `${feePerTick > 0n ? Number(perTick) / Number(feePerTick) : 0}×)`,
    );
  }
  console.log(
    "\n  A keeper's reward is exactly the life it burns, so `net` should be near zero — the " +
      "fly is a conduit, not an income. `fees paid` is the real cost of keeping it alive, and " +
      "it is the number to compare against whatever a feeder is willing to put in.",
  );
}

async function main() {
  const record = readDeployment();
  const client = await makeClient();
  const signer = makeSigner(client);
  const myLock = (await signer.getAddressObjSecp256k1()).script;
  const lockRefusal = signableLock(record.fly.lockScript, {
    myLock,
    alwaysLockCodeHash: record.codeCells.flylock.codeHash,
  });
  if (lockRefusal) {
    throw new Error(lockRefusal);
  }

  const address = await signer.getRecommendedAddress();
  const fly = await readFly(client, record);
  if (!fly) {
    throw new Error("the fly's state cell is not live; nothing to keep");
  }
  if (fly.branched) {
    // Refuse before printing a policy, because there is no policy that makes this safe.
    throw new Error(describeBranches(record.fly.typeHash, fly.branched.map((cell) => cell.outPoint)));
  }

  console.log(`keeper for fly ${record.fly.typeHash}`);
  console.log(`  as         ${address}`);
  console.log(`  fly        step ${fly.state.step}, energy ${fly.state.energy}, ${fly.state.alive ? "alive" : "dead"}`);
  console.log(
    `  policy     tick ${STEPS} steps every ${INTERVAL} ms, feed ${FEED_AMOUNT} steps below ${FEED_BELOW}` +
      (DRY_RUN ? ", dry run" : ""),
  );
  console.log("");

  let running = true;
  const stop = () => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Consecutive, not total. The message has always said "in a row", but the counter was never
  // reset — so eleven failures scattered across a week of otherwise healthy running would kill
  // the keeper, and the log would claim they had been consecutive. A long-lived daemon has to
  // tolerate isolated failures; what it must not tolerate is a run of them.
  let consecutiveFailures = 0;

  while (running && !limitReached()) {
    try {
      if (!(await step(client, signer, record))) {
        break;
      }
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      ledger.failures += 1;
      console.log(`  failed (${consecutiveFailures} in a row): ${err.message}`);
      if (consecutiveFailures > 10) {
        console.log("  too many failures in a row; stopping");
        break;
      }
    }
    if (running && !limitReached()) {
      await sleep(INTERVAL);
    }
  }

  report();
}

// Same guard as `cli.js`, for the same reason and one more. The same reason: importing a
// module must not execute a command. The extra one: without it, importing this file in a test
// would start a keeper — it would read a deployment, build a client and begin sending
// transactions — so the decision in `classifySendError`, which is the part most likely to rot,
// could not be tested at all.
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((err) => {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  });
}
