/**
 * Watching one organism and driving another.
 *
 * The indexer serves any fly on the chain, but the server's key can only advance the ones
 * whose lock it satisfies, and the page lets a reader switch between flies while a poll is in
 * flight. The properties below are about that gap, and they all fail *silently* when they
 * fail — a transaction that moves the wrong fly succeeds, and a history that mixes two lives
 * still parses. Silent failures are what a test is for.
 *
 * This test exists because the bug was real. `POST /api/act` built its transaction from the
 * deployment record and never looked at what the page was watching, so switching to another
 * fly and pressing "tick 64" spent *the other fly's* cell and reported `accepted`. The page
 * kept drawing the fly you had switched to, which had not moved.
 *
 * It has since found a second one, in the repair: the ownership test that used to guard the
 * endpoint had a twin in the snapshot path, and once the endpoint stopped needing it the twin
 * survived as a *refusal* — read `driveAuthorization` below for the two claims the page made
 * about an organism it could have driven.
 *
 * The rules live in `src/watch.js` rather than inline in `serve.js` precisely so they can be
 * tested without a node, a chain, or a running server — `serve.js` listens on a port as soon
 * as it is imported.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ROSTER_IDLE_EVERY,
  ambiguity,
  createGate,
  describeAmbiguity,
  describeBranches,
  driveAuthorization,
  lockKind,
  rosterDue,
  signableLock,
} from "../src/watch.js";

const A = "0x" + "aa".repeat(32);
const B = "0x" + "bb".repeat(32);

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("one question, one answer", () => {
  // `driveAuthorization` is what `/api/fly` reports as `meta.drivable` *and* what
  // `POST /api/act` sends or refuses on. It had no test of its own — the two functions it
  // composes each did — which is how its two callers came to ask different questions, and how
  // a page spent a while disabling buttons that worked.
  const FLYLOCK = "0x" + "f1".repeat(32);
  const OWNER = "0x" + "9b".repeat(32);
  const SOMEONE_ELSE = "0x" + "d2".repeat(32);
  const OWNER_ARGS = "0x" + "22".repeat(20);
  const context = {
    myLock: { codeHash: OWNER, hashType: "type", args: OWNER_ARGS },
    alwaysLockCodeHash: FLYLOCK,
  };
  const lock = (codeHash, args = "0x") => ({ codeHash, hashType: "type", args });

  it("allows a public organism, whichever one is being watched", () => {
    // `flylock` accepts every transaction, so "is it the record's fly" is not a question that
    // can change the answer. Only one type hash is passed in, because there is nowhere left
    // for the record to enter.
    const auth = driveAuthorization({ lockScript: lock(FLYLOCK), ...context });
    assert.equal(auth.allowed, true);
    assert.equal(auth.lock, "flylock");
    assert.equal(auth.public, true, "a public organism is not a private one with a live button");
    assert.equal(auth.reason, null);
  });

  it("allows a private organism wearing this server's own lock, even when the record selects another", () => {
    // The regression, measured on preview testnet before it was fixed: an organism created by
    // `genesis --lock owner` is not the fly the deployment record holds — `genesis` writes one
    // fly — so the snapshot's extra ownership test refused it with "moving it needs a key that
    // its lock accepts", while the very same server moved it on the next request. The key is
    // this server's own; there is no other key that could be meant.
    const auth = driveAuthorization({ lockScript: lock(OWNER, OWNER_ARGS), ...context });
    assert.equal(auth.allowed, true);
    assert.equal(auth.lock, "owner");
    assert.equal(auth.public, false, "private and allowed is a state that has to be nameable");
    assert.equal(auth.reason, null);
  });

  it("refuses a lock this server cannot sign for, in the lock's own words", () => {
    const auth = driveAuthorization({ lockScript: lock(SOMEONE_ELSE), ...context });
    assert.equal(auth.allowed, false);
    assert.equal(auth.lock, "other");
    assert.equal(auth.reason, signableLock(lock(SOMEONE_ELSE), context));
  });

  it("refuses a record that does not say which lock the organism wears", () => {
    const auth = driveAuthorization({ lockScript: undefined, ...context });
    assert.equal(auth.allowed, false);
    assert.equal(auth.lock, "none");
    assert.match(auth.reason, /does not say which lock/);
  });

  it("does not read the deployment record, which is what made the old answer go stale", () => {
    // `genesis` rewrites `deployment.fly`, so any answer derived from the record can be
    // superseded under a running server — and staleness there was wrong in the *permissive*
    // direction: a captured "the fly I own" approved a click, and `applyAction`, which
    // re-reads, then moved the *new* fly. The repair was not to refresh the capture. It was
    // to stop asking: whether this server can advance what is on screen is a fact about the
    // lock, and the lock is on the chain, in the organism's own type script.
    const inputs = { lockScript: lock(OWNER, OWNER_ARGS), ...context };
    assert.deepEqual(
      Object.keys(inputs).sort(),
      ["alwaysLockCodeHash", "lockScript", "myLock"],
      "the record is not among the inputs, so it cannot go stale inside the answer",
    );
    assert.deepEqual(driveAuthorization(inputs), driveAuthorization({ ...inputs }));
  });

  it("exports no second rule for the same question", async () => {
    // The old `drivable(watched, owned)` is deliberately gone rather than left unused. A
    // function that answers "may I drive this" from the deployment record is not a helper any
    // caller should be able to reach for, and the way it comes back is by being exported.
    const mod = await import("../src/watch.js");
    assert.equal(mod.drivable, undefined);
    const decisions = Object.keys(mod).filter((name) => /^(driveAuthorization|drivable)$/.test(name));
    assert.deepEqual(decisions, ["driveAuthorization"], "exactly one name decides this");
  });
});

describe("the gate", () => {
  it("runs one task at a time, in the order they were queued", async () => {
    const gate = createGate();
    const log = [];
    const slow = (name) => async () => {
      log.push(`${name}:enter`);
      await sleep(5);
      log.push(`${name}:exit`);
    };
    await Promise.all([gate(slow("poll")), gate(slow("switch"))]);
    assert.deepEqual(
      log,
      ["poll:enter", "poll:exit", "switch:enter", "switch:exit"],
      "an overlapping switch must wait for the poll, not interleave with it",
    );
  });

  it("does not let a failed task poison the queue", async () => {
    const gate = createGate();
    const ran = [];
    const failed = gate(async () => {
      throw new Error("a transient RPC failure");
    });
    const after = gate(async () => {
      ran.push("ran");
      return "ok";
    });
    await assert.rejects(failed, /transient RPC failure/);
    assert.equal(await after, "ok", "the next poll must still happen");
    assert.deepEqual(ran, ["ran"]);
  });

  it("returns each task's own result", async () => {
    const gate = createGate();
    const results = await Promise.all([gate(async () => 1), gate(async () => 2)]);
    assert.deepEqual(results, [1, 2]);
  });

  it("keeps a walk in flight from landing in the fly the page switched to", async () => {
    // The shape the bug has in `serve.js`, reduced to what matters: `refresh` reads, reads,
    // then writes, holding the index across both awaits; `selectFly` resets exactly the
    // fields it writes.
    const index = { id: A, entries: [], headTx: null };
    const pollOnce = async (fly) => {
      await sleep(0); // findHead
      await sleep(0); // readChain
      index.entries.push(`${fly}:transition`);
      index.headTx = `${fly}:head`;
    };
    const switchTo = async (fly) => {
      index.id = fly;
      index.entries = [];
      index.headTx = null;
      await pollOnce(fly);
    };

    // Without the gate: the poll for A resumes first and writes into the index the switch
    // has already pointed at B. A's transition ends up in B's history.
    await Promise.all([pollOnce(A), switchTo(B)]);
    assert.deepEqual(
      index.entries,
      [`${A}:transition`, `${B}:transition`],
      "this is the bug — the assertion documents it, it does not approve of it",
    );
    assert.equal(index.id, B, "and the page is on B, so nothing on screen explains it");

    // With the gate: the switch waits, and B's history contains only B.
    index.id = A;
    index.entries = [];
    index.headTx = null;
    const gate = createGate();
    await Promise.all([gate(() => pollOnce(A)), gate(() => switchTo(B))]);
    assert.deepEqual(index.entries, [`${B}:transition`], "a reset must not be written past");
    assert.equal(index.id, B);
  });
});

describe("the roster cadence", () => {
  it("does not fire before an idle beat has happened", () => {
    assert.equal(rosterDue(0), false);
  });

  it("fires every fourth idle beat", () => {
    const fired = [];
    for (let tick = 1; tick <= 12; tick++) {
      if (rosterDue(tick)) {
        fired.push(tick);
      }
    }
    assert.deepEqual(fired, [4, 8, 12], `every ${ROSTER_IDLE_EVERY} idle polls`);
  });

  it("does not fire on the beats in between", () => {
    // Three idle polls is three seconds of a new organism being invisible; a cadence that
    // fired every beat would be a different design, and this pins which one it is.
    assert.equal(rosterDue(1), false);
    assert.equal(rosterDue(2), false);
    assert.equal(rosterDue(3), false);
  });

  it("counts idle beats only, so a busy fly cannot starve the roster", () => {
    // `serve.js` resets the counter whenever the watched fly moved, because `refresh` has
    // already re-read the roster in that case. A busy fly therefore neither accelerates nor
    // starves the roster read — the cadence is a function of quiet, not of traffic.
    assert.equal(rosterDue(0), false, "a beat that found transitions is not an idle beat");
  });
});

describe("one type script, several live cells", () => {
  const cell = (typeHash, tx, index, step) => ({
    typeHash,
    outPoint: { txHash: tx, index },
    state: { step },
  });

  it("finds nothing on a chain where every fly has one live cell", () => {
    const rows = [cell(A, "0x" + "1".repeat(64), 0, 0), cell(B, "0x" + "2".repeat(64), 0, 384)];
    assert.deepEqual(ambiguity(rows), []);
  });

  it("reports the type script, the count and every competing cell", () => {
    // The real shape: three live cells wearing the deployed fly's type script, at three
    // different steps, each reachable by a tick. This is not hypothetical — it is what the
    // dev chain was in when this was written, and what `status` and `/api/flies` disagreed
    // about for an afternoon.
    const rows = [
      cell(A, "0x" + "1".repeat(64), 0, 384),
      cell(A, "0x" + "2".repeat(64), 0, 0),
      cell(A, "0x" + "3".repeat(64), 0, 0),
      cell(B, "0x" + "4".repeat(64), 0, 384),
    ];
    const found = ambiguity(rows);
    assert.equal(found.length, 1, "only the duplicated type script is reported");
    assert.equal(found[0].typeHash, A);
    assert.equal(found[0].count, 3);
    assert.deepEqual(
      found[0].cells.map((c) => c.state.step),
      [384, 0, 0],
      "every competing cell, in the order the chain returned them",
    );
  });

  it("names the cells in the message, so the collision can be acted on", () => {
    const found = ambiguity([
      cell(A, "0x" + "ab".repeat(32), 0, 384),
      cell(A, "0x" + "cd".repeat(32), 0, 0),
    ]);
    const text = describeAmbiguity(found[0]);
    assert.match(text, /2 live cells/);
    assert.match(text, /ababab/);
    assert.match(text, /cdcdcd/);
    assert.match(text, /step 384/);
    assert.match(text, /step 0/);
  });

  it("is a report, not a repair", () => {
    // The function must not drop or pick cells: `refreshFlies` decides what to show, and
    // `liveCell` refuses to act. A "helpful" dedupe here would hide the collision again.
    const rows = [cell(A, "0x" + "1".repeat(64), 0, 0), cell(A, "0x" + "2".repeat(64), 0, 64)];
    const found = ambiguity(rows);
    assert.equal(found[0].cells.length, 2);
    assert.equal(rows.length, 2, "the input is not mutated");
  });
});

describe("refusing to move a branched fly", () => {
  const op = (tx, index) => ({ txHash: tx, index });

  it("names every branch, and says there is no single fly to move", () => {
    const text = describeBranches(A, [op("0x" + "ab".repeat(32), 0), op("0x" + "cd".repeat(32), 1)]);
    assert.match(text, /2 live cells/);
    assert.match(text, /ababab/);
    assert.match(text, /cdcdcd/);
    assert.match(text, /:1/, "the index is part of the identity, not just the transaction");
    assert.match(text, /exactly one live cell/);
  });

  it("says the branch cannot be spent away, because that is the part nobody guesses", () => {
    // The natural first instinct is "tick the extras until only one is left". It cannot work:
    // the type script requires exactly one successor wearing the same script, so consuming a
    // branch moves it forward. A refusal that does not say so sends the reader to try it.
    const text = describeBranches(A, [op("0x" + "11".repeat(32), 0), op("0x" + "22".repeat(32), 0)]);
    assert.match(text, /not repairable/);
    assert.match(text, /moves it forward, never removes it/);
  });

  it("works from out points alone, without decoding anything", () => {
    // This is the difference from `describeAmbiguity`, which wants `state.step` and is a
    // report for a reader. A caller about to spend a cell has not chosen which one yet and
    // should not have to pay for decoding all of them to be told it must not.
    const text = describeBranches(A, [op("0x" + "33".repeat(32), 0), op("0x" + "44".repeat(32), 0)]);
    assert.doesNotMatch(text, /step/);
  });

  it("renders a bigint index, which is what the indexer hands back", () => {
    // `Cell.outPoint.index` from CCC is a bigint. A refusal that printed `[object Object]`
    // or threw on interpolation would be worse than useless at the moment it is needed.
    const text = describeBranches(A, [op("0x" + "55".repeat(32), 0n), op("0x" + "66".repeat(32), 3n)]);
    assert.match(text, /:0/);
    assert.match(text, /:3/);
  });

  it("handles two branches, which is the smallest case that is already unrecoverable", () => {
    const text = describeBranches(A, [op("0x" + "77".repeat(32), 0), op("0x" + "88".repeat(32), 0)]);
    assert.match(text, /2 live cells/);
  });
});

describe("whose lock is it, and can this server sign for it", () => {
  const FLYLOCK = "0x" + "f1".repeat(32);
  const OWNER = "0x" + "9b".repeat(32);
  const SOMEONE_ELSE = "0x" + "d2".repeat(32);
  const OWNER_ARGS = "0x" + "22".repeat(20);

  const myLock = { codeHash: OWNER, hashType: "type", args: OWNER_ARGS };
  const context = { myLock, alwaysLockCodeHash: FLYLOCK };

  const lock = (codeHash, args = "0x") => ({ codeHash, hashType: "type", args });

  it("names the three kinds, because a bare hash says nothing about who can sign", () => {
    assert.equal(lockKind(lock(FLYLOCK), context), "flylock");
    assert.equal(lockKind(lock(OWNER, OWNER_ARGS), context), "owner");
    assert.equal(lockKind(lock(SOMEONE_ELSE), context), "other");
  });

  it("treats a missing lock as its own kind rather than guessing", () => {
    // A record written before the lock was a choice has no `lockScript`. Defaulting that to
    // "public" would be a guess in the permissive direction about who may move an organism.
    assert.equal(lockKind(undefined, context), "none");
    assert.match(signableLock(undefined, context), /does not say which lock/);
  });

  it("counts `flylock` as signable even with args", () => {
    // Its program returns 0 without reading anything, so args cannot narrow who may spend it.
    // Refusing here would refuse to drive a fly that anyone, including this server, can drive.
    assert.equal(lockKind(lock(FLYLOCK, "0xdeadbeef"), context), "flylock");
    assert.equal(signableLock(lock(FLYLOCK, "0xdeadbeef"), context), null);
  });

  it("refuses somebody else's lock, and says the choice is permanent", () => {
    const text = signableLock(lock(SOMEONE_ELSE), context);
    assert.match(text, /cannot sign for/);
    assert.match(text, /chosen at genesis and can never change/);
  });

  it("is about the lock, not a restatement of the ownership question", () => {
    // The whole reason this exists: a private fly is the organism this server *deployed* and
    // still not one it can move — a `genesis --lock <someone else's lock>`. That is a fact
    // about the lock and it is answered here; "is this the fly the record selects" is a
    // different fact, reported as `watchingOwn`, and the page may not refuse on it.
    assert.notEqual(signableLock(lock(SOMEONE_ELSE), context), null, "cannot sign for it");
    assert.equal(signableLock(lock(FLYLOCK), context), null, "and can sign for a public one");
  });

  it("does not confuse the owner's lock with a lock that merely shares its code hash", () => {
    // Args are part of a lock's identity: the same code with different args is a different
    // lock, and a different key's. Comparing code hashes alone would approve the wrong one.
    assert.equal(lockKind(lock(OWNER, "0x" + "33".repeat(20)), context), "other");
  });

  it("lets a watched public fly through even when it is not the deployment record's fly", () => {
    const auth = driveAuthorization({
      watched: B,
      owned: A,
      lockScript: lock(FLYLOCK),
      myLock,
      alwaysLockCodeHash: FLYLOCK,
    });
    assert.deepEqual(auth, { allowed: true, lock: "flylock", reason: null, public: true });
  });

  it("still blocks a watched private fly that belongs to somebody else", () => {
    const auth = driveAuthorization({
      watched: B,
      owned: A,
      lockScript: lock(SOMEONE_ELSE),
      myLock,
      alwaysLockCodeHash: FLYLOCK,
    });
    assert.equal(auth.allowed, false);
    assert.equal(auth.public, false);
    assert.match(auth.reason, /cannot sign for/);
  });
});
