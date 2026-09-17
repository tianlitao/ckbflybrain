/**
 * The page's half of a click: build the transaction for one action.
 *
 * This is the whole of what used to be `POST /api/prepare`, and it is short because the work is
 * in `src/tx.js` — the same builder the CLI uses. The differences are the oracle
 * (`oracleFor(sim, …)`, which is `flywasm`, where the CLI passes `flyplan`) and where the two
 * cells come from: read from the chain at the moment of the click rather than from the roster,
 * because the roster is a picture and a spent out point is not a stale picture, it is a
 * rejected transaction.
 *
 * The chronicle's type script is built from the watched fly's type hash rather than taken from
 * the deployment record. The record's `world` names *the deployer's* chronicle; this page can be
 * watching a different organism, and a chronicle belongs to exactly one fly.
 *
 * # Why this is a module and not a function in `app.source.js`
 *
 * It is the one part of a click the browser test has to reach, and the alternative to
 * extracting it was for that test to write its own — a second builder, which is exactly the
 * thing this project does not allow. A copy would have been exercised by a test that spends
 * real testnet CKB, so it would have been *proven correct* right up to the moment it drifted
 * from the page's, which is the worst time to find out. `test/drive-live.test.js` imports this
 * same function and runs it in a real browser.
 *
 * @param {object} options
 * @param {object} options.feed the page's index of the chain: see `chain.source.js`
 * @param {object} options.sim the loaded dynamics module: see `sim.source.js`
 * @returns {(spec: object) => Promise<object>} the `prepare` that `wallet.drive()` asks for
 */

import * as ccc from "@ckb-ccc/core";

import { buildAction } from "../src/tx.js";
import { oracleFor } from "./sim.source.js";

export function createPrepare({ feed, sim }) {
  return async function prepare(spec) {
    // Both cells are read *now*, from the chain, not from the last poll. A snapshot is a
    // picture of a moment that has already passed by the time a reader has decided to click,
    // and a transaction that spends a cell the chain has already moved is rejected for a
    // reason that points at the input rather than at the age of the page's data.
    const flyCell = await feed.spendable();
    const worldCell = await feed.chronicleCell();
    const identity = feed.snapshot().identity;

    return buildAction(spec, {
      deployment: {
        params: identity.params,
        economics: identity.economics,
        codeCells: identity.codeCells,
        fly: { typeScript: identity.typeScript, lockScript: identity.lockScript },
        world: worldCell ? { typeScript: ccc.Script.from(worldCell.cellOutput.type) } : null,
      },
      signerLock: feed.walletLock(),
      oracle: oracleFor(sim, identity),
      flyCell,
      worldCell,
    });
  };
}
