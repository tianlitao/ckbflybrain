/**
 * Watching one organism, driving another: the invariants that keep a page honest.
 *
 * # Why this is a module and not four lines in `serve.js`
 *
 * The indexer serves any fly on the chain but can only *move* the one its key locks, and the
 * page lets you switch between flies while a poll is in flight. The properties below are all
 * about that gap, and all of them fail silently when they fail:
 *
 * 1. **The fly you are looking at must be the fly an action moves.** This one is no longer a
 *    check here — it is a property of the transaction. `handleAct` builds its target from the
 *    *watched* organism (`watchedDeployment`), and `applyAction` resolves the cell to spend
 *    from that organism's own type script, so the record cannot be what moves. There used to
 *    be a second, separate check here refusing any action against an organism that was not
 *    the record's — and once the target became the watched organism, that check was the only
 *    thing left that disagreed with what the server actually did: see `driveAuthorization`.
 * 2. **A read that started under one fly must never write into the index after the index has
 *    been pointed at another.** The index is one mutable object, and the poll holds it across
 *    several `await`s. An interleaved switch mixes two lives into one history, and a mixed
 *    history still parses.
 * 3. **A roster is re-read on a timer, not on an event.** An idle fly does not announce the
 *    arrival of another one, so a roster that only updates when the watched fly moves leaves
 *    new organisms invisible for as long as the watched one happens to sit still.
 *
 * Silent failures are the ones worth pinning, so the logic lives here where a test can reach
 * it without starting a server or a chain.
 *
 * @module watch
 */


function short(hash) {
  return typeof hash === "string" ? `${hash.slice(0, 10)}…` : String(hash);
}

/**
 * Serialise asynchronous work: at most one task runs at a time, in the order it was queued.
 *
 * This is what stops a switch from landing in the middle of a poll. `refresh()` reads the
 * head, walks the chain and then writes `index.entries`, `index.byTx` and `index.headTx` —
 * holding the index across every `await` in between. `selectFly()` resets exactly those
 * fields. Run the two concurrently and the poll's write lands after the reset, putting the
 * previous fly's transitions at the front of the new fly's history.
 *
 * The gate is deliberately a queue rather than a lock: a task is never dropped, and a task
 * that rejects does not poison the ones behind it.
 *
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function createGate() {
  let tail = Promise.resolve();
  return function run(task) {
    // Both callbacks are `task`: the queue must advance whether or not its predecessor
    // succeeded, because a transient RPC failure is not a reason to stop indexing.
    const result = tail.then(task, task);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };
}

/** How many idle polls between roster re-reads. */
export const ROSTER_IDLE_EVERY = 4;

/**
 * Should the roster be re-read on this idle beat?
 *
 * Counted in *idle* polls only. A beat where the watched fly moved has already re-read the
 * roster as part of `refresh`, so counting it too would just make the cadence depend on how
 * busy the fly is — and a busy fly is the case where the roster least needs re-reading.
 *
 * @param {number} idleTicks how many idle polls have happened, including this one
 * @returns {boolean}
 */
export function rosterDue(idleTicks) {
  return idleTicks > 0 && idleTicks % ROSTER_IDLE_EVERY === 0;
}

/**
 * Type scripts worn by more than one live cell.
 *
 * "A fly is a chain of state cells" only holds while each fly has exactly one live cell. The
 * type script cannot enforce that — it validates a transaction, and two transactions can each
 * consume a *different* predecessor wearing the same script — so a chain that reached this
 * state by any route stays in it forever, branching a little more with every tick.
 *
 * The reason to look for it is that everything downstream silently picks one of them: a
 * roster keyed by type hash keeps whichever cell it saw last, `findSingletonCellByType`
 * returns whichever the indexer happens to order first, and a tick then moves a branch nobody
 * was looking at. The symptom is not an error, it is a page that disagrees with `status`.
 * So the collision is computed and reported rather than resolved.
 *
 * @param {Array<{typeHash: string, outPoint: {txHash: string, index: number}, state: object}>} rows
 * @returns {Array<{typeHash: string, count: number, cells: object[]}>}
 */
export function ambiguity(rows) {
  const byType = new Map();
  for (const row of rows) {
    const list = byType.get(row.typeHash);
    if (list) {
      list.push(row);
    } else {
      byType.set(row.typeHash, [row]);
    }
  }
  const collisions = [];
  for (const [typeHash, cells] of byType) {
    if (cells.length > 1) {
      collisions.push({ typeHash, count: cells.length, cells });
    }
  }
  return collisions;
}

/** One collision, as a sentence that names every competing cell and its step. */
export function describeAmbiguity({ typeHash, cells }) {
  const where = cells
    .map((cell) => `${short(cell.outPoint.txHash)}:${cell.outPoint.index} (step ${cell.state.step})`)
    .join(", ");
  return `${cells.length} live cells wear type script ${short(typeHash)}: ${where}`;
}

/**
 * What kind of lock is this organism wearing?
 *
 * The lock is chosen at genesis and can never change — the type script pins
 * `output.lock == input.lock` — so it is the answer to "who may advance this organism":
 *
 * - `flylock` accepts every transaction. Anyone may tick, which is what upstream's `tick()` is.
 * - `owner` is the deploying key's own `secp256k1_blake160` lock: a **private** fly.
 * - `other` is somebody else's lock — a wallet's, another key's — and this server cannot sign
 *   for it at all.
 * - `none` means the record does not say, which only happens for a record written before the
 *   lock was a choice.
 *
 * @param {object} lockScript `{codeHash, hashType, args}`
 * @param {{myLock?: object, alwaysLockCodeHash?: string}} context
 * @returns {"flylock"|"owner"|"other"|"none"}
 */
export function lockKind(lockScript, { myLock, alwaysLockCodeHash } = {}) {
  if (!lockScript) {
    return "none";
  }
  if (alwaysLockCodeHash && lockScript.codeHash === alwaysLockCodeHash) {
    // The code hash alone is the test, not the args. `flylock`'s program returns 0 without
    // reading anything, so args cannot narrow who may spend it — a fly wearing `flylock` with
    // args is still the everyone-can-spend lock, and treating it as somebody else's would refuse
    // to drive a fly that anyone, including this server, can drive.
    return "flylock";
  }
  if (
    myLock &&
    lockScript.codeHash === myLock.codeHash &&
    lockScript.hashType === myLock.hashType &&
    lockScript.args === myLock.args
  ) {
    return "owner";
  }
  return "other";
}

/**
 * Can this server sign for the lock the organism wears?
 *
 * Returns `null` when it can, or a sentence saying why it cannot. This is the *only* question
 * behind whether the page may advance an organism: a fly's lock was chosen at genesis and can
 * never change, so it is the complete answer to "who may move this".
 *
 * The other half of the pairing is `drive`, which asks whether the server would sign at all,
 * and comes from `INDEXER_ALLOW_DRIVE`. What does *not* belong here is "is this the organism
 * the deployment record selects" — that was asked once, and it is a different question with a
 * different answer (see `driveAuthorization`).
 *
 * They only come apart once the lock is a choice, which is why this did not exist before: with
 * every fly wearing `flylock`, "the organism I deployed" and "the organism I can advance" were
 * the same set.
 *
 * @param {object} lockScript
 * @param {{myLock?: object, alwaysLockCodeHash?: string, subject?: string}} context
 * @returns {string|null}
 */
export function signableLock(lockScript, context = {}) {
  const kind = lockKind(lockScript, context);
  if (kind === "flylock" || kind === "owner") {
    return null;
  }
  if (kind === "none") {
    return "the record does not say which lock this organism wears, so there is no way to know whether this server could sign for it";
  }
  // `subject` is who is asking. The rule is the same either way; the sentence is not, because
  // the key that cannot sign is this server's for the CLI and the keeper, and the *visitor's
  // wallet* for the page. Defaulting to the server keeps the two remaining audiences (a
  // terminal and a log file) reading what they always read.
  const subject = context.subject ?? "this server's key";
  return (
    `this organism wears a lock ${subject} cannot sign for (${short(lockScript.codeHash)}). ` +
    `A fly's lock is chosen at genesis and can never change, so only a holder of that lock's key ` +
    `can advance it — watching it is fine, moving it is not.`
  );
}

/**
 * Decide whether a browser action may target the organism currently being watched.
 *
 * One question, one answer, and *one* implementation: this is called by `/api/fly` to fill
 * `meta.drivable` and by `POST /api/act` to decide whether to send anything, so the button
 * state a reader sees is the answer they will get. It did not used to be. The two call sites
 * asked different things — `handleAct` consulted the lock, while the snapshot additionally
 * required the watched organism to be the one the deployment record selects — and the gap was
 * reachable: an organism wearing this server's *own* lock, created by `genesis --lock owner`
 * and therefore not the record's fly, was reported `drivable: false` with the reason "moving
 * it needs a key that its lock accepts" while `POST /api/act` moved it. The page disabled five
 * buttons that worked, and explained them with two claims that were both false.
 *
 * The record ownership test was not wrong when it was written. It existed because
 * `applyAction` built its transaction from the deployment record and never looked at what the
 * page was watching, so "watched must equal the record's fly" was a proxy for "the action will
 * move what is on screen". Once `handleAct` started passing the watched organism
 * (`watchedDeployment`) and `applyAction` began resolving its cell from that organism's own
 * type script, the proxy stopped standing for that and started contradicting it: a public
 * `flylock` fly that is not the record's has been drivable ever since, and the rule only ever
 * fired against private flies — the one case where the server demonstrably holds the key.
 *
 * So the lock is the whole answer. "Is this the organism in the record" is still worth
 * *reporting* — it is `watchingOwn`, and the roster marks the row — but it is not a thing to
 * refuse on, and the record is rewritten by `genesis`, which is the last fact you want a
 * refusal reading.
 *
 * @returns {{allowed: boolean, lock: string, reason: string|null, public: boolean}}
 */
export function driveAuthorization({ lockScript, myLock, alwaysLockCodeHash, subject }) {
  const lock = lockKind(lockScript, { myLock, alwaysLockCodeHash });
  const reason = signableLock(lockScript, { myLock, alwaysLockCodeHash, subject });
  return { allowed: reason === null, lock, reason, public: lock === "flylock" };
}

/**
 * A branched fly, as a sentence that names every competing cell.
 *
 * This is the refusal shared by everything that would *move* a fly. `describeAmbiguity` above
 * is the *report* — it is for a reader who is looking, and it can afford to decode each branch
 * to say what step it is on. This one is the *refusal*, for a caller that was about to spend
 * one of them, and it has to work from out points alone because a caller that has not decided
 * which cell to move should not have to pay for decoding all of them first.
 *
 * The reason it refuses rather than picking is worth stating once, here, because both callers
 * need the same explanation and it is the part a reader will not guess: the type script
 * requires exactly one successor wearing the same script, so consuming a branch **moves it
 * forward** and never removes it. A branched fly is branched for good. The remedy is a new
 * instance, not a cleanup.
 *
 * @param {string} typeHash the type script worn by more than one live cell
 * @param {Array<{txHash: string, index: number|bigint}>} outPoints every live cell wearing it
 * @returns {string}
 */
export function describeBranches(typeHash, outPoints) {
  const where = outPoints.map((op) => `${short(op.txHash)}:${op.index}`).join(", ");
  return (
    `${outPoints.length} live cells wear type script ${short(typeHash)}: ${where}. ` +
    `A state cell is consumed and recreated, so a fly should have exactly one live cell; ` +
    `with several there is no single fly to move, and moving one branch would silently ` +
    `abandon the others. This is not repairable by spending the extras — consuming a branch ` +
    `moves it forward, never removes it — so point FLY_STATE at a deployment whose fly is ` +
    `unbranched.`
  );
}
