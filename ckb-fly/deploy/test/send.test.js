/**
 * What a rejected send means, and what to say about it.
 *
 * This test exists because the answer was wrong, and being wrong was invisible. Two callers
 * read the same rejection:
 *
 * * The **keeper** treated *every* rejection from a send as a failure except a lost race, and
 *   counted failures without ever resetting the count. Raced against itself on preview testnet,
 *   three keepers produced 31 rejections that were all the same one —
 *   `PoolRejectedDuplicatedTransaction`, its own earlier attempt still sitting in the pool — and
 *   two of the three stopped after ten passes with "too many failures in a row", which was also
 *   not true.
 * * The **page** had no answer at all: it re-served the node's text, so a visitor whose click
 *   was rejected as a duplicate was told that a `Byte32` already existed in a transaction pool —
 *   for a click that *did* take effect.
 *
 * The classifier is matched on the node's message text, which is the only thing available and
 * therefore the part that will rot first. It is pinned here for that reason. The module is
 * `src/send.js` rather than either caller because both need it and neither owns it; `keeper.js`
 * guards its `main()` the way `cli.js` does, so importing the keeper in a test does not start a
 * keeper either way.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifySendError, describeSendError } from "../src/send.js";

describe("classifying a rejected send", () => {
  it("reads the resolve failure that means someone else spent the cell", () => {
    // Verbatim from preview testnet, CKB 0.209.0.
    const message =
      "Client request error TransactionFailedToResolve: Resolve failed " +
      "Unknown(OutPoint(Byte32(0x7e4ad2ab3b95332a97d2b5bcce26ba7e3e74c9c0c766d8d828c615bc091e2ec2), 0x0))";
    assert.equal(classifySendError(message), "lost");
  });

  it("reads the duplicate rejection that means the identical transaction is already in the pool", () => {
    // Also verbatim. This is the one that was being counted as a failure, and it is not a
    // competitor arriving first — a transaction is a deterministic function of the cell it
    // spends, the action and the fee, so two tickers ticking the same fly build byte-identical
    // bytes. The second to arrive sees this instead of a resolve failure.
    const message =
      "Client request error PoolRejectedDuplicatedTransaction: " +
      "Transaction(Byte32(0xe8557b9c76928ff4136256df2bb49262f5ba1b49bab16cc0750ff2cac4ca68a1)) " +
      "already exists in transaction_pool";
    assert.equal(classifySendError(message), "pending");
  });

  it("separates the two, because the mix between them is diagnostic", () => {
    // All duplicates means the tickers agree and are merely racing; many lost races means they
    // disagree and are competing for different successors. A keeper that cannot tell them
    // apart cannot report which situation it is in.
    const lost = classifySendError("Resolve failed Unknown(OutPoint(Byte32(0x00), 0x0))");
    const pending = classifySendError("PoolRejectedDuplicatedTransaction: already exists");
    assert.notEqual(lost, pending);
  });

  it("reads a fee complaint as a lost race, because that is what it is", () => {
    // Measured between two browser tabs on preview testnet, both clicking at once but on
    // *different* actions ("tick 32" and "tick 64") — the loser got:
    //
    //   PoolRejectedRBF: RBF rejected: Tx's current fee is 2385, expect it to >= 5962 to
    //   replace old txs
    //
    // Nothing about that sentence mentions a cell or a race. It is the node offering to let
    // the loser replace the winner if they pay more — which nobody should, since both
    // transactions are ours and one has already won. Classified as `fatal`, it stopped a
    // keeper the first time a visitor clicked on a fly it was minding.
    const rbf =
      "Client request error PoolRejectedRBF: RBF rejected: Tx's current fee is 2385, " +
      "expect it to >= 5962 to replace old txs";
    assert.equal(classifySendError(rbf), "lost");
  });

  it("still recognises the messages the original pattern was written for", () => {
    // The first three patterns predate the testnet run and must keep working.
    assert.equal(classifySendError("the state cell is no longer live"), "lost");
    assert.equal(classifySendError("Resolve failed"), "lost");
    assert.equal(classifySendError("Unknown(OutPoint(Byte32(0x00), 0x0))"), "lost");
    assert.equal(classifySendError("the contract would refuse this action: Dead(OutPoint)"), "lost");
  });

  it("is case-insensitive, because node messages are not consistent about it", () => {
    assert.equal(classifySendError("poolrejectedduplicatedtransaction"), "pending");
    assert.equal(classifySendError("resolve FAILED"), "lost");
  });

  it("calls anything it does not recognise fatal, rather than assuming it is benign", () => {
    // The direction of the default matters. Guessing "retryable" for an unknown rejection
    // would loop forever on a genuinely broken transaction — a fee rate below the node's
    // minimum, a malformed witness, a cell the contract refuses — and the keeper would look
    // busy while achieving nothing.
    assert.equal(classifySendError("PoolRejectedTransactionByMinFeeRate: fee rate is too low"), "fatal");
    assert.equal(classifySendError("the contract would refuse this action: EnergyExhausted"), "fatal");
    assert.equal(classifySendError(""), "fatal");
    assert.equal(classifySendError(undefined), "fatal");
  });
});

describe("what to tell the person who clicked", () => {
  // Measured between two visitors clicking the same organism at the same moment on preview
  // testnet: one got `400 PoolRejectedDuplicatedTransaction` after 3.0s, the other `200` after
  // 41.1s. The rejection was the click that had *already worked*.
  const duplicate =
    "Client request error PoolRejectedDuplicatedTransaction: " +
    "Transaction(Byte32(0x92c9c9c57fd174bff883cc90c1619413446672bab989033a887d974614999d32)) " +
    "already exists in transaction_pool";
  const lost =
    "Client request error TransactionFailedToResolve: Resolve failed " +
    "Unknown(OutPoint(Byte32(0x92c9c9c57fd174bff883cc90c1619413446672bab989033a887d974614999d32), 0x0))";

  it("tells a duplicate apart from a lost race, because they mean opposite things", () => {
    // In a duplicate the visitor's action is on its way; in a lost race it did not happen. A
    // single message for both would have to be wrong for one of them.
    assert.equal(describeSendError(duplicate, "0xaa").applied, true);
    assert.equal(describeSendError(lost, "0xaa").applied, false);
  });

  it("never returns the node's own text, which is about a hash and not about the click", () => {
    for (const message of [duplicate, lost]) {
      const said = describeSendError(message, "0xbf087bf97a1c8d9f");
      assert.doesNotMatch(said.sentence, /Byte32|transaction_pool|Client request error/);
    }
  });

  it("names the organism in the lost-race sentence, because there are five of them", () => {
    const said = describeSendError(lost, "0xbf087bf97a1c8d9f");
    assert.match(said.sentence, /0xbf087bf97a1c8d9f/);
    assert.match(said.sentence, /UTXO|not queued/);
  });

  it("tells the loser of a lost race to wait if the winner may still be in the pool", () => {
    // Two shapings of the same loss: `Resolve failed` means the winner committed and a retry
    // works now; `PoolRejectedRBF` means it is still in the pool, and a retry in the next
    // second will simply lose again. One sentence has to be true for both, so it says what
    // actually happened and asks for a moment rather than promising the button will work.
    const rbf =
      "Client request error PoolRejectedRBF: RBF rejected: Tx's current fee is 2385, " +
      "expect it to >= 5962 to replace old txs";
    const said = describeSendError(rbf, "0xbf087bf97a1c8d9f");
    assert.equal(said.applied, false);
    assert.match(said.sentence, /moment|uncommitted/);
  });

  it("says nothing for a real refusal, so the caller serves the contract's own reason", () => {
    // "fatal" is not a thing to paraphrase: it is a transaction the node or the planner
    // refused, and the message is the explanation. A friendly sentence here would hide it.
    assert.equal(describeSendError("PoolRejectedTransactionByMinFeeRate: fee rate is too low", "0xaa"), null);
  });

  it("does not call the planner's own refusal a race, even though the keeper counts it as one", () => {
    // Written after the first version of this function failed its own test. `flyplan` wraps a
    // `flycore` error as "the contract would refuse this action: Dead(OutPoint)" — the organism
    // is dead, or the `bornBlock` is backwards, or the action is invalid for the current state.
    // Nothing has moved and no other visitor exists, so the lost-race sentence — "another
    // visitor moved it first" — would be a confident lie about a click that will be refused
    // every single time.
    //
    // `classifySendError` still reads `Dead(OutPoint)` as "lost" on purpose, because the
    // keeper *retries* on lost and retrying is harmless there: it re-reads the chain first.
    const refusal = "the contract would refuse this action: Dead(OutPoint(Byte32(0x00), 0x0))";
    assert.equal(classifySendError(refusal), "lost", "the keeper's answer is unchanged");
    assert.equal(
      describeSendError(refusal, "0xaa"),
      null,
      "but a visitor is told what the contract said, not that someone raced them",
    );
  });
});
