/**
 * What a rejected send means, and why it is not the same as a failure.
 *
 * # Why this is its own module
 *
 * Two callers need it and they are on opposite sides of the project. The **keeper** runs
 * unattended and uses the answer to decide whether to re-read and try again or to stop; the
 * **page** has a visitor waiting, and uses it to decide what to tell them. Both are looking at
 * the same rejection and both would get it wrong in the same way, so the classification lives
 * here rather than in either of them — the same reasoning as `watch.js`, and for the same
 * reason: the day the two disagreed, the page disabled buttons the server would have honoured.
 *
 * # The three answers
 *
 * * **`lost`** — the cell this attempt named is gone, or is about to be spent by a transaction
 *   the node already has. That is the cell model working, not a failure. Re-read and try again.
 *   It arrives in three shapings, all measured, and the third is the one that hides:
 *
 *   ```text
 *   TransactionFailedToResolve: Resolve failed Unknown(OutPoint(Byte32(0x…), 0x0))   the winner committed
 *   PoolRejectedDuplicatedTransaction: … already exists in transaction_pool         the winner is byte-identical
 *   PoolRejectedRBF: RBF rejected: Tx's current fee is 2385, expect it to >= 5962
 *                    to replace old txs                                              the winner is a different action
 *   ```
 *
 *   The third says nothing about a cell or a race — it reads like a fee problem, and it is
 *   reached only when two *different* actions are built from the same state cell: the node
 *   treats the second as a replacement of the first and asks for a higher fee. Nobody is going
 *   to pay it; both transactions are ours and one of them has already won. Treating a fee
 *   complaint as `fatal` is what stopped a keeper the moment visitors started clicking, which
 *   is how this was found: `RBF` was added to the patterns after two browser tabs raced two
 *   different actions on preview testnet.
 * * **`pending`** — the node already has *this exact transaction*. Not a competitor that got
 *   there first, and not a failure: a transaction is a deterministic function of the cell it
 *   spends, the action and the fee, so **two independent tickers build byte-identical bytes
 *   and therefore the same hash**. The second one to arrive is rejected as a duplicate. (It is
 *   also what our own earlier attempt looks like if it is still in the pool, which is the same
 *   situation from the caller's point of view.) Either way the cell is about to be spent, so
 *   the answer is the same as a lost race — re-read — but it is worth telling apart, because
 *   a run that is *all* duplicates means the tickers agree and are merely racing, while a run
 *   with no duplicates and many lost races means they disagree and are genuinely competing for
 *   different successors. For a visitor the two mean opposite things: in a lost race their
 *   action did **not** happen, and in a duplicate it is already on its way.
 * * **`fatal`** — anything else. Counted, and after too many in a row the keeper stops.
 *
 * The first two are recognised by matching the node's message text, which is the only thing
 * available and is therefore a fragile thing to depend on. So every classification is logged
 * with the message that produced it: a pattern that silently stopped matching would otherwise
 * look like a keeper that mysteriously gave up, with the evidence gone. The same applies to
 * the page — see `handleAct`, which answers with the sentence this produces rather than with
 * the raw node text.
 *
 * @param {string} message
 * @returns {"lost"|"pending"|"fatal"}
 */
export function classifySendError(message) {
  const text = message ?? "";
  if (
    /Resolve failed|Unknown\(OutPoint|no longer live|Dead\(OutPoint|PoolRejectedRBF|RBF rejected/i.test(
      text,
    )
  ) {
    return "lost";
  }
  if (/PoolRejectedDuplicatedTransaction|already exists in transaction_pool/i.test(text)) {
    return "pending";
  }
  return "fatal";
}

/**
 * What to tell a person who clicked, given what the node said.
 *
 * Returns `null` for a rejection that is not worth explaining — the caller has a better
 * message of its own — and a sentence otherwise. The sentence a visitor needs is *not* the
 * node's, because the node's is about a Byte32 and the visitor's question is "did my click
 * count". The answer differs by kind and in both cases it is not "no":
 *
 * * A duplicate means the identical transaction is already in the pool. It will be committed,
 *   so the visitor's intent is being carried out — by someone else's click or their own
 *   earlier one, which are the same transaction. Telling them it failed would be false.
 * * A lost race means a *different* action got there first, so theirs did not happen. The
 *   honest answer is that the organism has moved and the state on screen is out of date.
 *
 * @param {string} message the node's error text
 * @param {string} instance which organism, so the sentence can name it
 * @returns {{kind: string, sentence: string, applied: boolean}|null}
 */
export function describeSendError(message, instance) {
  // Our own planner's refusals first, and they are not the node's. `flyplan` wraps a `flycore`
  // error as "the contract would refuse this action: …" (crates/flyplan/src/main.rs) and those
  // are the *rules*: a dead organism, a backwards `bornBlock`, a test that would exceed the
  // policy limit. They are not races and nothing about the chain has moved, so describing one
  // as "another visitor got there first" would send the visitor to click again on something
  // that will be refused every time.
  //
  // This is the one message where the two callers want different answers, and it is worth
  // saying why rather than leaving it to look like an oversight: `classifySendError` calls
  // `Dead(OutPoint)` "lost" because for the keeper *retrying is harmless* — it re-reads the
  // chain first and its death handling takes over. A visitor does not retry on their own, and
  // an explanation that is wrong is worse than the contract's own sentence.
  if (/^the contract would refuse this action/.test(message ?? "")) {
    return null;
  }

  const kind = classifySendError(message);
  if (kind === "pending") {
    return {
      kind,
      applied: true,
      sentence:
        `another visitor asked for exactly this, so the identical transaction is already on ` +
        `its way — a transaction is a function of the cell, the action and the fee, so two ` +
        `identical clicks are the same transaction. Nothing was lost; the organism will move ` +
        `when it is committed.`,
    };
  }
  if (kind === "lost") {
    return {
      kind,
      applied: false,
      sentence:
        `another visitor moved ${instance} first. Actions are not queued — the state cell is a ` +
        `UTXO, so one of two racing actions wins and the other is dropped. Yours was dropped; ` +
        `the winning transaction may still be uncommitted, so give it a moment before trying ` +
        `again from the state now on screen.`,
    };
  }
  return null;
}
