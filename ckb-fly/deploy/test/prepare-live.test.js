/**
 * The page's half of a click, against the real chain, spending nothing.
 *
 * A click is two halves now that there is no server: `createPrepare` builds the transaction, and
 * the wallet pays and signs it. `test/drive-live.test.js` exercises both, but it spends real
 * testnet CKB and is opt-in, so on its own it leaves the builder covered by nothing at all —
 * which is how a page can ship that builds a transaction it cannot build. (It did: `oracleFor`
 * called `action.encode`, which did not exist, and every button on the page threw. The one test
 * that would have caught it was the one that had been left pointing at a deleted endpoint.)
 *
 * So this covers the half that costs nothing and can be run every time:
 *
 *   * the transaction spends *this* fly's live cell, read from the chain at the moment of the
 *     click rather than from a snapshot;
 *   * its output data is what `flywasm` says the successor is — not a copy of the input, which
 *     would be a transaction the type script refuses;
 *   * the action is in witness 0, where the type script looks for it.
 *
 * It stops before `settle`: no fee, no signature, no broadcast.
 *
 *     node --test test/prepare-live.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as ccc from "@ckb-ccc/core";
import { createFeed } from "../public/chain.source.js";
import { createPrepare } from "../public/prepare.source.js";
import { loadSim } from "../public/sim.source.js";
import { decodeState } from "../src/fly.js";
import { bundleExists, startStaticPage } from "../src/static-page.js";

/**
 * Stand up the three things `app.source.js` stands up, in the same order.
 *
 * The static server is not a convenience: `loadSim` fetches the module by URL and Node's `fetch`
 * does not read `file://`, so the page's own directory has to be served for this to be the page's
 * code rather than a copy of it.
 */
async function pageOn() {
  const served = await startStaticPage();
  if (!served) return null;
  const sim = await loadSim({ url: new URL("flywasm.wasm", served.url) });
  const config = await fetch(new URL("deployment.json", served.url)).then((r) => r.json());
  const feed = createFeed({ config, table: sim.circuitTable() });
  await feed.refresh();
  return { served, sim, feed };
}

describe("the page builds the transaction a wallet will be asked to sign", () => {
  it("spends the live cell, carries the successor, and puts the action in witness 0", async (t) => {
    if (!bundleExists()) {
      t.skip("public/app.js is not built; run `cd .. && make build-front-end`");
      return;
    }

    const page = await pageOn();
    if (!page) {
      t.skip("public/app.js is not built; run `cd .. && make build-front-end`");
      return;
    }
    const { served, sim, feed } = page;

    try {
      const snap = feed.snapshot();
      if (!snap.current) {
        t.skip(`no transition could be read from ${snap.network}: ${snap.meta.error ?? "none"}`);
        return;
      }

      // A lock that would sign. This test is about the builder, not the wallet, so the fly's own
      // lock stands in: it is the one lock that is certain to satisfy its own lock check, and no
      // key is needed to name it.
      feed.setWalletLock(ccc.Script.from(snap.identity.lockScript));

      const spendable = await feed.spendable();
      const built = await createPrepare({ feed, sim })({ kind: "tick", steps: 1 });

      // 1. It spends the cell the chain has *now*, not the one the last poll saw.
      const spent = built.tx.inputs[built.flyInputIndex].previousOutput;
      assert.equal(
        `${spent.txHash}:${spent.index}`,
        `${spendable.outPoint.txHash}:${spendable.outPoint.index}`,
        "the transaction must spend the watched fly's live cell",
      );

      // 2. Its output data is the oracle's answer. The type script compares this for equality,
      //    so "the same state it came in with" would be a rejected transaction rather than a
      //    wrong one — and the step moving by exactly one is what proves `flywasm` ran.
      // `outputs` and `outputsData` are parallel arrays in CCC, which is why the fly's data is
      // not a field on its output.
      const data = built.tx.outputsData[built.flyInputIndex];
      assert.equal(data, built.after.state, "the output must carry the successor, byte for byte");
      const before = built.before;
      const after = decodeState(ccc.bytesFrom(built.after.state));
      assert.equal(
        BigInt(after.step),
        BigInt(before.step) + 1n,
        "a tick of 1 advances the fly exactly one step",
      );
      assert.notEqual(after.energy, before.energy, "and it costs life, which the release reflects");

      // 3. The action is in witness 0's input_type, which is where the type script reads it.
      //    `settle` sets it again after `completeFeeBy` rewrites the witness list, which is why
      //    this is the one thing worth checking before the fee is paid.
      assert.equal(
        built.tx.getWitnessArgsAt(0).inputType,
        built.action.action,
        "the action must be in witness 0",
      );
    } finally {
      await served.close();
    }
  });
});
