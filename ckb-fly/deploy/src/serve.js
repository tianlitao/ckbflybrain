/**
 * The indexer, and the front-end's host.
 *
 * # What it is
 *
 * One process that does three jobs, because they share one thing — the fly's identity and
 * its recovered history — and splitting them would mean three copies of it:
 *
 * 1. **Index.** It follows the fly's state cell and keeps the life it recovers in memory,
 *    updating incrementally: after the first read, a new tick costs one RPC call rather
 *    than a re-walk of the whole chain (see `history.js`).
 * 2. **Serve.** `GET /api/fly` is the whole picture; `GET /api/events` is a
 *    server-sent-events stream that pushes each new transition as it lands.
 * 3. **Host.** It serves `public/` — the front-end — from the same origin, which is not
 *    laziness: a page talking to a CKB node directly needs that node to allow CORS, and a
 *    dev chain may not be configured to. Same-origin removes the question.
 *
 * # Why an indexer at all
 *
 * CKB has no event log. A fly's past is not a stream anyone emitted; it is a chain of
 * state cells, and it is recovered by walking that chain backwards and reading each
 * transaction's witness. That is more work than subscribing to logs, and it buys something
 * a log cannot: the history is not a claim by an operator, it is the chain, and every
 * action in it was parsed by the same code the validator ran before it agreed.
 *
 * # Configuration
 *
 * | variable | default | meaning |
 * |---|---|---|
 * | `PORT` | `8899` | what to listen on |
 * | `INDEXER_POLL_MS` | `3000` | how often to look for a new transition |
 * | `INDEXER_ALLOW_DRIVE` | unset | set to `1` to expose `POST /api/act` |
 *
 * Everything `cli.js` reads (`CKB_RPC_URL`, `FLY_STATE`, …) applies here too.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

import * as ccc from "@ckb-ccc/core";

import { PROJECT_ROOT } from "./fly.js";
import * as plan from "./plan.js";
import { CONFIG, FEE_RATE, applyAction, buildAction, makeClient, makeSigner, readDeployment } from "./cli.js";
import { findHead, identity, readChain } from "./history.js";
import { ambiguity, createGate, describeAmbiguity, driveAuthorization, rosterDue } from "./watch.js";
import { classifySendError, describeSendError } from "./send.js";

const PORT = Number(process.env.PORT ?? 8899);
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 3000);
const ALLOW_DRIVE = process.env.INDEXER_ALLOW_DRIVE === "1";
const PUBLIC_DIR = resolve(PROJECT_ROOT, "deploy", "public");

// ---------------------------------------------------------------- the index

const index = {
  id: null,
  /** The deploying key's lock, fixed for this process; used to explain private/public ownership. */
  myLock: null,
  /** Every transition, oldest first. */
  entries: [],
  /** The same entries, by transaction hash, so a re-walk can stop early. */
  byTx: new Map(),
  headTx: null,
  updatedAt: null,
  error: null,
  /** The chronicle cell, decoded, or `null` if this fly has none. */
  chronicle: null,
  /** The chronicle's type script, so its cell can be found wherever it has moved to. */
  worldScript: null,
  /**
   * Every organism on this chain, by type script hash.
   *
   * A fly's type script is its address, and the instance nonce in the args is what makes
   * two flies with the same genome two organisms. So the roster is found by asking for
   * cells wearing the flybrain *code*, and each one that comes back is a distinct fly.
   */
  flies: new Map(),
  /**
   * The one organism this server's key can move — the one it deployed.
   *
   * Separate from `id.typeHash`, which follows whatever the page is watching. Conflating the
   * two is how a tick lands on a fly nobody was looking at.
   */
  /** Idle polls since the last roster re-read; see `rosterDue`. */
  idleTicks: 0,
  /**
   * Type scripts worn by more than one live cell, if any.
   *
   * Reported, never resolved. See `watch.js` for why a chain that got here stays here.
   */
  collisions: [],
  /** What was last printed about `collisions`, so a permanent problem is not a permanent log. */
  collisionSignature: null,
};

/**
 * The index is one mutable object and the poll holds it across several `await`s, so every
 * operation that resets or appends to it goes through here. See `watch.js` for what
 * interleaving them actually costs.
 */
const gate = createGate();

/**
 * The organism this server's key can move, read from the deployment record *now*.
 *
 * Deliberately not cached. `applyAction` re-reads the record every time it builds a
 * transaction, so whatever answers "may this be driven?" has to read the same source. A
 * cached copy goes stale the moment anything rewrites the record — `genesis` does exactly
 * that, every time — and a stale copy is not merely wrong, it is wrong in the **permissive**
 * direction: it would approve an action because the page is watching the fly the server used
 * to own, and `applyAction` would then move the fly it owns now. That is the original bug,
 * reintroduced by caching the answer to it.
 */
function ownedTypeHash() {
  try {
    return ccc.Script.from(readDeployment().fly.typeScript).hash();
  } catch {
    // No record, or an unreadable one. `applyAction` will fail on its own terms; the guard's
    // job here is only to not approve anything.
    return null;
  }
}

/** The per-neuron arrays are for the newest state only; older ones are for a timeline. */
function stripArrays(entry) {
  if (!entry.state.v) {
    return entry;
  }
  const { v, bias, inp, ...rest } = entry.state;
  return { ...entry, state: rest };
}

let circuit = null;
let params = null;
let econ = null;
const subscribers = new Set();

function broadcast(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) {
    res.write(frame);
  }
}

/**
 * Bring the index up to date. Returns the entries that were new, if any.
 *
 * The head is found by asking the chain, never by trusting a stored out point: a stale
 * record would make the indexer report a fly that has already moved on. The walk stops at
 * the newest transaction it already has, so the cost of an update is proportional to how
 * much happened, not to how long the fly has lived.
 */
/**
 * Read the chronicle, if the fly has one.
 *
 * Nothing is computed here. The contract derived every field from the fly in the same
 * transaction that moved it, so the indexer's only job is to decode what is on chain and
 * hand it over — which is the same division of labour as everywhere else in this project.
 */
/**
 * Every live fly on the chain, and the chronicle watching each one.
 *
 * Discovery is by **code hash with a prefix match on the args**, which is the only search
 * that can express "any fly": each fly has a different type script, so there is no single
 * script to look up. An empty args prefix means "any args", so this finds every organism
 * ever created from this code, not just the one this deployment knows about.
 *
 * The chronicle is then found the other way round — its args are exactly
 * `version ‖ fly type hash`, so a prefix match on those 33 bytes identifies one fly's
 * chronicle and no other's.
 */
async function refreshFlies(client) {
  const { flybrain, flyworld } = index.deployment.codeCells;
  const seen = new Set();
  const rows = [];

  for await (const cell of client.findCells(
    {
      script: { codeHash: flybrain.codeHash, hashType: flybrain.hashType, args: "0x" },
      scriptType: "type",
      scriptSearchMode: "prefix",
    },
    "asc",
    200,
  )) {
    const script = ccc.Script.from(cell.cellOutput.type);
    const state = plan.decode({
      params: index.deployment.params,
      state: ccc.hexFrom(cell.outputData),
    });
    const { v, bias, inp, ...summary } = state;
    rows.push({
      typeHash: script.hash(),
      script,
      lock: ccc.Script.from(cell.cellOutput.lock),
      // The instance nonce: eight bytes after the version byte, and nothing else.
      instance: "0x" + script.args.slice(2 + 2, 2 + 2 + 16),
      outPoint: { txHash: cell.outPoint.txHash, index: Number(cell.outPoint.index) },
      state: summary,
    });
  }

  // Collected before anything is written, so that "two live cells wear this type script" is a
  // fact the roster can state. Building the map cell by cell would hide it: the second cell
  // would simply overwrite the first, and the roster would show whichever the indexer
  // happened to order last — a fly state that disagrees with `status` and with the indexer's
  // own history, with nothing to say why.
  const collisions = ambiguity(rows);
  const signature = collisions.map(describeAmbiguity).join(" | ");
  if (signature !== index.collisionSignature) {
    index.collisionSignature = signature;
    for (const collision of collisions) {
      console.warn(`  ! ${describeAmbiguity(collision)}`);
    }
  }
  index.collisions = collisions;

  for (const row of rows) {
    // The first cell is shown, but `collisions` says the choice was not the chain's to make.
    if (seen.has(row.typeHash)) {
      continue;
    }
    seen.add(row.typeHash);
    const chronicle = await findChronicle(client, flyworld, row.typeHash);
    const previous = index.flies.get(row.typeHash);
    index.flies.set(row.typeHash, {
      ...row,
      chronicle,
      // Keep the history we already walked; a roster refresh must not throw it away.
      history: previous?.history ?? null,
    });
  }

  // A fly whose cell is no longer live has been spent and not replaced, which the type
  // script forbids — so it has not happened. Dropping it keeps the roster honest.
  for (const typeHash of [...index.flies.keys()]) {
    if (!seen.has(typeHash)) {
      index.flies.delete(typeHash);
    }
  }
}

/** The chronicle that watches one fly, decoded, or `null` if it has none. */
async function findChronicle(client, flyworld, flyTypeHash) {
  const prefix = "0x01" + flyTypeHash.slice(2);
  for await (const cell of client.findCells(
    {
      script: { codeHash: flyworld.codeHash, hashType: flyworld.hashType, args: prefix },
      scriptType: "type",
      scriptSearchMode: "prefix",
    },
    "asc",
    2,
  )) {
    return {
      outPoint: { txHash: cell.outPoint.txHash, index: Number(cell.outPoint.index) },
      capacity: String(cell.cellOutput.capacity),
      ...plan.worldDecode({ world: ccc.hexFrom(cell.outputData) }),
    };
  }
  return null;
}

/**
 * Watch a different organism.
 *
 * Everything the page shows — the ring, the history, the chronicle — hangs off
 * `index.id`, so switching is a matter of pointing it at another fly and walking that fly's
 * chain. The history machinery is reset rather than reused, because the two flies have
 * nothing in common but their genome.
 */
async function selectFly(client, typeHash) {
  const fly = index.flies.get(typeHash);
  if (!fly) {
    throw new Error(`no organism ${typeHash} on this chain`);
  }
  const { flyworld } = index.deployment.codeCells;

  index.id = {
    typeScript: fly.script,
    typeHash: fly.typeHash,
    lockScript: fly.lock,
    params: index.deployment.params,
    economics: index.deployment.economics,
    codeCells: index.deployment.codeCells,
  };
  // The chronicle's args are `version ‖ fly type hash`, so this fly's chronicle is a script
  // that can be constructed rather than searched for.
  index.worldScript = ccc.Script.from({
    codeHash: flyworld.codeHash,
    hashType: flyworld.hashType,
    args: "0x01" + fly.typeHash.slice(2),
  });

  index.entries = [];
  index.byTx = new Map();
  index.headTx = null;
  await refresh({ force: true });
  console.log(`  watching ${typeHash.slice(0, 18)}…`);
}

async function refreshChronicle(client) {
  if (!index.worldScript) {
    index.chronicle = null;
    return;
  }
  // Found by type script, not by a stored out point. The chronicle moves whenever the fly
  // does, so a remembered position is stale the moment anything touches it — and "anything"
  // now includes a keeper running in another terminal.
  const cell = await client.findSingletonCellByType(index.worldScript, true);
  if (!cell) {
    index.chronicle = null;
    return;
  }
  index.chronicle = {
    // `outPoint.index` is a bigint, which `JSON.stringify` refuses. The snapshot is JSON, so
    // it becomes a number here rather than blowing up at the edge.
    outPoint: { txHash: cell.outPoint.txHash, index: Number(cell.outPoint.index) },
    capacity: String(cell.cellOutput.capacity),
    ...plan.worldDecode({ world: ccc.hexFrom(cell.outputData) }),
  };
}

async function refresh({ force = false } = {}) {
  const client = await makeClient();
  const head = await findHead(client, index.id);
  const headTx = head.outPoint.txHash;
  if (!force && headTx === index.headTx) {
    return [];
  }

  const fresh = await readChain({
    client,
    head,
    identity: index.id,
    full: true,
    stopAt: new Set(index.byTx.keys()),
  });

  const added = [];
  for (const entry of fresh) {
    if (!index.byTx.has(entry.txHash)) {
      index.byTx.set(entry.txHash, entry);
      index.entries.push(entry);
      added.push(entry);
    }
  }

  // Only the newest state keeps its neuron arrays; the rest are timeline entries and 465
  // numbers each would be a payload nobody draws.
  for (const entry of index.entries) {
    if (entry.txHash !== headTx && entry.state.v) {
      Object.assign(entry, stripArrays(entry));
    }
  }

  index.headTx = headTx;
  index.updatedAt = new Date().toISOString();
  await refreshChronicle(client);
  await refreshFlies(client);
  return added;
}

async function startIndex() {
  const deployment = readDeployment();
  index.deployment = deployment;
  index.id = identity({ deployment });
  index.worldScript = deployment.world ? ccc.Script.from(deployment.world.typeScript) : null;

  // The lock this server's key signs for. Computed once, and that is safe in a way the
  // *record's* fly is not: this is a property of the key the process was started with, which
  // cannot change while it runs, whereas `genesis` rewrites `deployment.fly` underneath a
  // running process — which is exactly why `ownedTypeHash()` reads the record every time.
  index.myLock = (await makeSigner(await makeClient()).getAddressObjSecp256k1()).script;

  circuit = plan.circuit({ layout: true });
  params = plan.params(deployment.params);
  econ = plan.economics({ set: deployment.economics });
  await refresh({ force: true });
  console.log(
    `found ${index.flies.size} organism(s) on this chain\n` +
      `indexed ${index.entries.length} transitions of fly ${index.id.typeHash}\n` +
      `  params ${deployment.params}, economics ${deployment.economics}\n` +
      `  head ${index.headTx}\n` +
      (index.chronicle
        ? `  chronicle ${index.chronicle.alive ? "alive" : "dead"}, generation ${index.chronicle.generation}, ` +
          `${index.chronicle.sightings} sightings`
        : "  no chronicle for this fly"),
  );

  setInterval(async () => {
    try {
      // Through the gate. `refresh` holds the index across several awaits, and a switch that
      // landed in the middle of one would append the previous fly's transitions to the new
      // fly's freshly-reset history.
      const added = await gate(async () => {
        const fresh = await refresh();
        if (fresh.length === 0) {
          index.idleTicks += 1;
          // The roster is refreshed on a slower beat than the watched fly. A fly that is idle
          // does not announce the arrival of another one, so relying on `refresh` alone would
          // leave a new organism invisible until the watched one happened to move.
          if (rosterDue(index.idleTicks)) {
            await refreshFlies(await makeClient());
          }
        } else {
          index.idleTicks = 0;
        }
        return fresh;
      });
      if (added.length > 0) {
        console.log(`  + ${added.length} transition(s), head ${index.headTx}`);
        broadcast({ type: "append", entries: added.map(stripArrays) });
      }
      // Cleared here rather than inside `refresh`, because a poll that succeeds *without
      // walking* is still a poll that succeeded. `refresh` returns early when the head has not
      // moved, and it used to be the only thing that cleared the error — so a transient RPC
      // failure while the watched fly happened to be idle left the message on screen for good.
      // The page would keep saying "the node reported: …" about a node that was answering
      // every request, and nothing would ever contradict it: an error that cannot clear itself
      // is worse than no error, because it teaches the reader to ignore the field.
      index.error = null;
    } catch (err) {
      // A transient RPC failure must not kill the indexer; the next tick will retry. The
      // error is surfaced to clients so a page can say "the node is unreachable" rather
      // than showing a fly that stopped moving for no visible reason.
      index.error = err.message;
      broadcast({ type: "error", message: err.message });
    }
  }, POLL_MS).unref?.();
}

// ---------------------------------------------------------------- http

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = resolve(PUBLIC_DIR, normalize(rel));
  // `resolve` collapses `..`, so comparing the result against the root is enough to stop a
  // traversal without having to reason about encodings.
  if (!target.startsWith(PUBLIC_DIR)) {
    return json(res, 403, { error: "outside the public directory" });
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    json(res, 404, { error: `no such file: ${rel}` });
  }
}

/**
 * Build the in-memory deployment view used when the page drives a public organism.
 *
 * The local record is still the source of code cells, params and economics, but its `fly` is
 * only the organism the server deployed. Public drive must target `index.id` — the organism on
 * screen — or a click after a roster switch will spend the right kind of cell belonging to the
 * wrong organism. The world script is deterministic from the watched fly type hash.
 */
function watchedDeployment() {
  const fly = index.flies.get(index.id.typeHash);
  if (!fly) {
    throw new Error(`no watched organism ${index.id.typeHash} in the roster`);
  }
  const flyTypeScript = fly.script;
  const worldCode = index.deployment.codeCells.flyworld;
  const worldTypeScript = ccc.Script.from({
    codeHash: worldCode.codeHash,
    hashType: worldCode.hashType,
    args: "0x01" + fly.typeHash.slice(2),
  });
  return {
    ...index.deployment,
    // applyAction mutates only when keepRecord is true; public drive passes false. These plain
    // objects make that boundary obvious and ensure a public click cannot rewrite the server's
    // selected deployment record.
    fly: {
      instance: fly.instance,
      typeArgs: flyTypeScript.args,
      typeScript: {
        codeHash: flyTypeScript.codeHash,
        hashType: flyTypeScript.hashType,
        args: flyTypeScript.args,
      },
      typeHash: fly.typeHash,
      lockScript: {
        codeHash: fly.lock.codeHash,
        hashType: fly.lock.hashType,
        args: fly.lock.args,
      },
    },
    world: {
      typeScript: {
        codeHash: worldTypeScript.codeHash,
        hashType: worldTypeScript.hashType,
        args: worldTypeScript.args,
      },
      typeHash: worldTypeScript.hash(),
    },
  };
}

async function handleAct(req, res) {
  if (!ALLOW_DRIVE) {
    return json(res, 403, {
      error:
        "driving the fly from the browser is disabled. Start the server with INDEXER_ALLOW_DRIVE=1 to enable it; it signs transactions with the key in CKB_PRIVATE_KEY, which is only appropriate on a chain where that key is not worth anything.",
    });
  }

  const body = await readBody(req);
  let spec;
  try {
    spec = JSON.parse(body);
  } catch {
    return json(res, 400, { error: "body must be JSON" });
  }

  const allowed = ["tick", "feed", "stimulate", "resurrect"];
  if (!allowed.includes(spec.kind)) {
    return json(res, 400, { error: `kind must be one of ${allowed.join(", ")}` });
  }

  const target = watchedDeployment();
  const lockContext = {
    myLock: index.myLock,
    alwaysLockCodeHash: index.deployment.codeCells.flylock.codeHash,
  };
  // The same call the snapshot makes, so the buttons a reader is looking at and the answer
  // they get here cannot disagree. This used to consult `signableLock` directly while the
  // snapshot additionally required the watched organism to be the record's, which meant the
  // page disabled buttons for — and explained away — an organism this endpoint went on to
  // move. See `driveAuthorization`.
  const auth = driveAuthorization({ lockScript: target.fly.lockScript, ...lockContext });

  if (!auth.allowed) {
    return json(res, 409, {
      ok: false,
      error: auth.reason,
      watching: index.id.typeHash,
      drivable: false,
      lock: auth.lock,
      undrivableReason: auth.reason,
    });
  }

  try {
    // Not inside the gate: signing and sending touches no shared state, and holding the
    // indexer for the length of a network round trip would stall the poll for no reason.
    // Public clicks use the watched deployment view and never rewrite the local record.
    const result = await applyAction(spec, { quiet: true, record: false, deployment: target });
    const added = await gate(() => refresh({ force: true }));
    if (added.length > 0) {
      broadcast({ type: "append", entries: added.map(stripArrays) });
    }
    return json(res, 200, {
      ok: true,
      txHash: result.txHash,
      before: result.before,
      after: result.after,
    });
  } catch (err) {
    // A refusal is information, but the node's sentence is not information a *visitor* can
    // use: "PoolRejectedDuplicatedTransaction: Transaction(Byte32(0x…)) already exists in
    // transaction_pool" is about a hash, and their question is "did my click count". Two of
    // the three answers are not failures, and both were measured between two visitors on
    // preview testnet clicking the same organism at the same time:
    //
    //   user A: 400 after 3.0s  PoolRejectedDuplicatedTransaction: … already exists in pool
    //   user B: 200 after 41.1s
    //
    // A's click *did* take effect — a transaction is a function of the cell, the action and
    // the fee, so two identical clicks are one transaction — and they were told it failed.
    const explained = describeSendError(err.message, target.fly.instance);
    if (explained) {
      // The state on screen is out of date either way: in a lost race the organism has moved,
      // and in a duplicate it is about to. But the *visitor* is answered first and the re-walk
      // is not awaited — walking a fly's chain takes about twenty seconds, and making a person
      // wait that long to be told "someone else got there first" is a worse page than one whose
      // step counter catches up a few seconds later through the poll and the SSE frame it
      // broadcasts. Measured: awaiting it turned an instant answer into 23s.
      gate(() => refresh({ force: true }))
        .then((added) => {
          if (added.length > 0) {
            broadcast({ type: "append", entries: added.map(stripArrays) });
          }
        })
        .catch((err) => {
          // Nothing to tell the visitor — they have already been answered — so this goes to
          // the log and to `meta.error` on the next successful poll, which is where an
          // unreachable node is supposed to surface.
          console.error(`refresh after a refused drive failed: ${err.message}`);
        });
      return json(res, explained.applied ? 200 : 409, {
        ok: explained.applied,
        // `applied` is the field to branch on: `ok` alone cannot express "your intent is being
        // carried out by a transaction you did not send".
        applied: explained.applied,
        duplicate: explained.kind === "pending",
        lost: explained.kind === "lost",
        error: explained.sentence,
        instance: target.fly.instance,
      });
    }
    // Anything else is a real refusal — the type script rejected the transition, or the
    // planner refused to build it. The caller should see the reason, unwrapped.
    return json(res, 400, { ok: false, error: err.message, kind: classifySendError(err.message) });
  }
}

/**
 * Build a transition for somebody else's key to sign.
 *
 * This is the endpoint that makes a *visitor's wallet* able to drive a public organism, and it
 * is deliberately the only one that touches the transaction without a key: it assembles the
 * fly's successor (which only the Rust planner knows how to compute) and hands the unfinished
 * transaction back. It signs nothing, completes no fee, and reads no private key — so unlike
 * `POST /api/act` it does **not** need `INDEXER_ALLOW_DRIVE`, and an operator can offer it
 * without putting a key on the server at all.
 *
 * What it does check is that the key which *will* sign can satisfy the organism's lock, using
 * the same `driveAuthorization` the button state comes from — with the visitor's wallet as the
 * key, so a public `flylock` organism is open to anyone and a private one is not.
 *
 * The browser's half of this contract (see `public/app.source.js`):
 *
 *   1. `Transaction.from(prepared.tx)`
 *   2. `completeFeeBy(signer, prepared.feeRate)` — the visitor pays, and the change is theirs
 *   3. `setWitnessArgsAt(0, { inputType: prepared.action })` again, because completion can
 *      rewrite the witness list
 *   4. `signer.sendTransaction(tx)`
 *
 * Steps 2 and 3 are not optional and not guessable, which is why they are listed in the
 * response as well as here: the action lives in witness 0's `inputType`, and a transaction
 * whose witness list was rebuilt by fee completion and not re-set would be refused on chain
 * with a message about a witness rather than about what actually happened.
 */
async function handlePrepare(req, res) {
  const body = await readBody(req);
  let spec;
  try {
    spec = JSON.parse(body);
  } catch {
    return json(res, 400, { error: "body must be JSON" });
  }

  const allowed = ["tick", "feed", "stimulate", "resurrect"];
  if (!allowed.includes(spec.kind)) {
    return json(res, 400, { error: `kind must be one of ${allowed.join(", ")}` });
  }
  // Required, not optional: `buildAction` refuses a fly the signing key cannot move, and the
  // only way to know is to be told which key. A request without one is a request that has not
  // said who is going to pay.
  if (typeof spec.address !== "string" || !spec.address) {
    return json(res, 400, {
      error: "address is required: this builds a transaction for a wallet to sign, and the lock check is about that wallet",
    });
  }

  const client = await makeClient();
  let visitorLock;
  try {
    visitorLock = (await ccc.Address.fromString(spec.address, client)).script;
  } catch (err) {
    return json(res, 400, { error: `address is not a CKB address on this network: ${err.message}` });
  }

  const target = watchedDeployment();
  const auth = driveAuthorization({
    lockScript: target.fly.lockScript,
    myLock: visitorLock,
    alwaysLockCodeHash: index.deployment.codeCells.flylock.codeHash,
    subject: "your wallet",
  });
  if (!auth.allowed) {
    return json(res, 409, {
      ok: false,
      error: auth.reason,
      lock: auth.lock,
      instance: target.fly.instance,
      public: auth.public,
    });
  }

  try {
    const built = await buildAction(
      { ...spec, address: undefined },
      { deployment: target, signerLock: visitorLock, client },
    );
    return json(res, 200, {
      ok: true,
      // The transaction, unfinished: no fee inputs, no signature. Handing back a *signed* one
      // would defeat the point, which is that this server never holds the visitor's key and
      // the visitor never trusts this server with a transaction they cannot see.
      tx: ccc.hexFrom(built.tx.toBytes()),
      action: built.action.action,
      feeRate: String(FEE_RATE),
      instance: built.record.fly.instance,
      watching: index.id.typeHash,
      before: built.before,
      after: built.after,
      // Named so a caller cannot get them the wrong way round: the fly is input 0 because the
      // type script reads the action from witness 0 of its input group.
      flyInputIndex: 0,
    });
  } catch (err) {
    return json(res, 400, { ok: false, error: err.message });
  }
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    req.on("data", (c) => {
      chunks.push(c);
      if (chunks.reduce((n, c) => n + c.length, 0) > 1 << 20) {
        fail(new Error("request too large"));
      }
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

/**
 * The lock behind the address a visitor said they are using, or `null`.
 *
 * Parsed per request rather than cached: a wallet can switch accounts, and an answer about the
 * wrong key is the failure this whole area keeps producing. A malformed address is not worth
 * failing a snapshot over — the page then simply gets the server's answer as before — but it is
 * not silently ignored either, because `/api/prepare` will refuse the same address outright.
 */
async function walletLockFrom(address) {
  if (!address) {
    return null;
  }
  try {
    return (await ccc.Address.fromString(address, await makeClient())).script;
  } catch {
    return null;
  }
}

/**
 * The facts about *this server and this chain* that both endpoints answer with.
 *
 * Extracted because they were on `/api/fly` only, while the README said both carried them —
 * and the roster is exactly where a reader needs `collisions`: it is the list of organisms, so
 * it is where a branched one has to be visible. A consumer that polls only the roster
 * otherwise has no way to learn that some type script is worn by more than one live cell.
 *
 * @param {string|null} owned the type hash this server's key can move
 * @param {object|null} walletLock the lock of the wallet the page has connected, if any
 */
function diagnostics(owned, walletLock = null) {
  const alwaysLockCodeHash = index.deployment?.codeCells?.flylock?.codeHash;
  const lockContext = { myLock: index.myLock, alwaysLockCodeHash };

  // Two questions, and only the first of them is a decision. `drive` asks whether this server
  // would sign at all; `drivable` asks whether the organism on screen wears a lock its key can
  // satisfy. That is the whole of it — whether the organism is also the one the deployment
  // record selects is reported separately as `watchingOwn`, and deliberately does not enter
  // the answer, because the record is rewritten by `genesis` while this must describe what
  // `POST /api/act` will do now.
  //
  // With a wallet attached the question moves to the visitor's key, because that is the key
  // their click will be signed with (`POST /api/prepare`), and `as` says which answer this is
  // so a page can never show one while the other is about to act.
  const auth = driveAuthorization({
    lockScript: index.id.lockScript,
    myLock: walletLock ?? index.myLock,
    alwaysLockCodeHash,
    subject: walletLock ? "your wallet" : undefined,
  });

  return {
    updatedAt: index.updatedAt,
    error: index.error,
    drive: ALLOW_DRIVE,
    drivable: auth.allowed,
    // Which key `drivable` is about: the server's, or the wallet the reader connected. The page
    // uses it to decide which endpoint a click goes to, so the two cannot drift apart.
    as: walletLock ? "wallet" : "server",
    // `POST /api/prepare` needs no key on the server, so it is offered whether or not
    // `INDEXER_ALLOW_DRIVE` is set: a visitor signing with their own wallet is not this
    // server signing.
    prepare: true,
    watchingOwn: index.id.typeHash === owned,
    // So the page can tell a reader *which* reason applies, rather than only that it is off.
    lock: auth.lock,
    undrivableReason: auth.reason,
    // Empty on a healthy chain. Anything in here means some type script is worn by more than
    // one live cell, and every "the fly" in this snapshot is one arbitrary choice of several —
    // including, on this chain, the one the deployer holds the key for.
    collisions: index.collisions.map((collision) => ({
      typeHash: collision.typeHash,
      count: collision.count,
      cells: collision.cells.map((cell) => ({
        outPoint: cell.outPoint,
        instance: cell.instance,
        step: cell.state.step,
      })),
    })),
  };
}

function snapshot(walletLock = null) {
  const current = index.entries.at(-1) ?? null;
  // Read once per snapshot, from the record, for the same reason the guard does.
  const owned = ownedTypeHash();
  return {
    network: CONFIG.rpc,
    watching: index.id.typeHash,
    identity: {
      typeHash: index.id.typeHash,
      typeScript: index.id.typeScript,
      lockScript: index.id.lockScript,
      params: index.id.params,
      economics: index.id.economics,
      codeCells: index.id.codeCells,
    },
    circuit,
    params,
    economics: econ,
    chronicle: index.chronicle,
    roster: [...index.flies.values()].map((fly) => ({
      typeHash: fly.typeHash,
      instance: fly.instance,
      state: fly.state,
      chronicle: fly.chronicle,
      selected: fly.typeHash === index.id.typeHash,
      // The roster is where a reader finds out *which* organism the buttons act on, so the
      // fact has to be in the list rather than only in the refusal.
      owned: fly.typeHash === owned,
    })),
    current,
    // Everything *before* the head. The newest transition is delivered as `current`, state and
    // all, so repeating it here would be a second copy of the same thing — and the two could
    // disagree if a client read them at different moments. Hence `slice(0, -1)`: `history`
    // answers "how did it get here", `current` answers "where is it".
    history: index.entries.slice(0, -1).map(stripArrays),
    meta: { count: index.entries.length, ...diagnostics(owned, walletLock) },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/api/fly") {
      const wanted = url.searchParams.get("type");
      if (wanted && wanted !== index.id.typeHash) {
        // Through the gate, so a switch cannot land in the middle of a poll's walk — and two
        // switches racing each other are serialised rather than interleaved, so the page ends
        // up on whichever was asked for last, with a history that belongs to it.
        const client = await makeClient();
        await gate(() => selectFly(client, wanted));
        broadcast({ type: "switched", typeHash: wanted });
      }
      // A visitor who has connected a wallet tells us which one, so `meta.drivable` describes
      // *their* key rather than this server's. Without it the page would be reporting a
      // decision about a key the reader is not using — which is exactly the shape of the bug
      // that had it disabling buttons for an organism the server could move.
      return json(res, 200, snapshot(await walletLockFrom(url.searchParams.get("address"))));
    }

    if (url.pathname === "/api/prepare") {
      return await handlePrepare(req, res);
    }

    // The roster: every organism on this chain, each with its own chronicle. A fly's type
    // script is its address, so this is what "anyone can create a new organism" looks like
    // from outside — and the instance nonce is why the entries are distinguishable.
    if (url.pathname === "/api/flies") {
      const owned = ownedTypeHash();
      return json(res, 200, {
        network: CONFIG.rpc,
        selected: index.id.typeHash,
        flies: [...index.flies.values()].map((fly) => ({
          ...fly,
          selected: fly.typeHash === index.id.typeHash,
          owned: fly.typeHash === owned,
        })),
        // `organisms`, not `count`: on `/api/fly` a `count` is transitions, and two endpoints
        // using one word for two quantities is how a client ends up reporting the wrong number.
        meta: {
          organisms: index.flies.size,
          ...diagnostics(owned, await walletLockFrom(url.searchParams.get("address"))),
        },
      });
    }

    // The history entries carry only a summary, because 465 numbers per transition is a
    // payload nobody draws. When someone actually wants to look at a past state, it is
    // decoded on demand from the hex the entry already holds.
    if (url.pathname === "/api/state") {
      const tx = url.searchParams.get("tx");
      const entry = index.byTx.get(tx);
      if (!entry) {
        return json(res, 404, { error: `no transition ${tx} in the index` });
      }
      return json(res, 200, {
        txHash: entry.txHash,
        action: entry.action,
        blockNumber: entry.blockNumber,
        capacity: entry.capacity,
        state: plan.decode({ params: index.id.params, state: entry.state.state, full: true }),
      });
    }

    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "snapshot", count: index.entries.length })}\n\n`);
      subscribers.add(res);
      // A comment frame every 15s keeps intermediaries from deciding the stream is dead.
      const beat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(beat);
        subscribers.delete(res);
      });
      return;
    }

    if (url.pathname === "/api/act") {
      if (req.method !== "POST") {
        return json(res, 405, { error: "POST only" });
      }
      return await handleAct(req, res);
    }

    if (url.pathname.startsWith("/api/")) {
      return json(res, 404, { error: "no such endpoint" });
    }

    return await serveStatic(res, url.pathname);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

await startIndex();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nhttp://127.0.0.1:${PORT}  (drive ${ALLOW_DRIVE ? "enabled" : "disabled"})`);
});
