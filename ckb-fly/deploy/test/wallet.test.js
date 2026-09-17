/**
 * The wallet's own state, checked without a browser, a chain or a key.
 *
 * This file exists because of a bug that nothing else could have caught. `wallet.lock()` asked
 * the signer for `getAddressObj()` — a method **CCC's `Signer` does not have**. It has
 * `getAddressObjs()` (plural) and `getRecommendedAddressObj()`, and only *some* adapters define a
 * private `getAddressObj` of their own, so:
 *
 *   * it worked for the wallets that define one, and threw `signer.getAddressObj is not a
 *     function` for every other wallet, immediately after the reader had connected;
 *   * nothing died visibly. The page was left with no lock, so `drivable` stayed false and every
 *     Drive button stayed grey — a reader connecting a wallet and finding the organism
 *     un-drivable, with no error anywhere to explain it;
 *   * no test failed, because this module had no unit test at all and the one live test that
 *     covers the whole click (`drive-live.test.js`) skips itself unless `FLY_DRIVE_LIVE=1`.
 *
 * So the stub below implements **only the documented surface** — `getRecommendedAddressObj`,
 * `getRecommendedAddress`, `connect`, `disconnect`, `getBalance`, `type` — and deliberately
 * nothing else. Any future call to a method CCC does not promise fails here, in a test that
 * needs no chain, instead of in a reader's browser where it shows up as a grey button.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as ccc from "@ckb-ccc/core";

import { createWallet } from "../public/wallet.source.js";

/** The chain the wallet is pointed at. Never contacted: nothing here builds or sends anything. */
const RPC = "https://testnet.ckb.dev/";

/** A lock to answer with, built from a real script so `lock()` returns a real value. */
const lockOf = (args) =>
  new ccc.Script(
    "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
    "type",
    args,
  );

/**
 * A signer shaped like the ones CCC's adapters hand out, and no more than that.
 *
 * `calls` counts how often the address was asked for, which is how the caching is pinned — the
 * lock is needed on every snapshot, and asking the wallet each time would be a popup-shaped
 * round trip on a 3-second poll.
 *
 * @param {ccc.Script} script the lock this signer would sign with
 */
function fakeSigner(script) {
  const client = new ccc.ClientPublicTestnet({ url: RPC, fallbacks: [] });
  const address = ccc.Address.fromScript(script, client);
  const calls = { addressObj: 0 };
  const signer = {
    calls,
    // `type` is what `adapters()` filters on, and what the connector's inner core is checked for.
    type: ccc.SignerType.CKB,
    connect: async () => {},
    disconnect: async () => {},
    getBalance: async () => 0n,
    getRecommendedAddress: async () => (await address).toString(),
    getRecommendedAddressObj: async () => {
      calls.addressObj += 1;
      return await address;
    },
  };
  return signer;
}

describe("what the page knows about the reader's key", () => {
  it("answers about nobody before a wallet is connected", async () => {
    const wallet = createWallet(RPC);
    assert.equal(await wallet.lock(), null);
    assert.equal(wallet.address(), null);
    assert.equal(wallet.current(), null);
  });

  it("reads the lock through the address CCC documents", async () => {
    const wallet = createWallet(RPC);
    const signer = fakeSigner(lockOf("0x1111111111111111111111111111111111111111"));

    // The claim the whole file rests on, asserted rather than trusted: a signer is *not*
    // promised a `getAddressObj`. If a future CCC adds one, this fails and the comment above
    // gets re-read — which is the point.
    assert.equal(
      typeof ccc.Signer.prototype.getAddressObj,
      "undefined",
      "CCC's base Signer has no getAddressObj; the module must not call one",
    );
    assert.ok(
      !("getAddressObj" in signer),
      "and this stub deliberately does not have one either, so calling it fails here first",
    );

    await wallet.adopt({ name: "Fake", signer });
    const lock = await wallet.lock();
    assert.equal(lock.codeHash, lockOf("0x1111").codeHash);
    assert.equal(lock.args, "0x1111111111111111111111111111111111111111");
  });

  it("answers about the same account it shows, and caches the answer", async () => {
    const wallet = createWallet(RPC);
    const script = lockOf("0x2222222222222222222222222222222222222222");
    const signer = fakeSigner(script);
    await wallet.adopt({ name: "Fake", signer });

    const lock = await wallet.lock();
    await wallet.lock();

    // The lock is the script of the address on screen — resolved through the address rather than
    // through a signer class, so the address a reader copies and the lock `drivable` is about
    // cannot be two different accounts.
    const client = new ccc.ClientPublicTestnet({ url: RPC, fallbacks: [] });
    const shown = (await ccc.Address.fromString(wallet.address(), client)).script;
    assert.equal(lock.codeHash, shown.codeHash);
    assert.equal(lock.hashType, shown.hashType);
    assert.equal(lock.args, shown.args);

    assert.equal(signer.calls.addressObj, 1, "the wallet is asked once, not once per snapshot");
  });

  it("re-reads the lock when a different wallet is connected", async () => {
    const wallet = createWallet(RPC);
    const first = fakeSigner(lockOf("0x3333333333333333333333333333333333333333"));
    const second = fakeSigner(lockOf("0x4444444444444444444444444444444444444444"));

    await wallet.adopt({ name: "First", signer: first });
    assert.equal((await wallet.lock()).args, "0x3333333333333333333333333333333333333333");

    await wallet.adopt({ name: "Second", signer: second });
    assert.equal(
      (await wallet.lock()).args,
      "0x4444444444444444444444444444444444444444",
      "the cache must not survive a change of signer",
    );
    assert.equal(wallet.name(), "Second");
  });

  it("forgets the key when the wallet is disconnected", async () => {
    const wallet = createWallet(RPC);
    const signer = fakeSigner(lockOf("0x5555555555555555555555555555555555555555"));
    await wallet.adopt({ name: "Fake", signer });

    await wallet.disconnect();

    // A page that keeps answering with a disconnected wallet's lock is a page showing a decision
    // about a key nobody is using — and offering buttons that would be signed by nobody.
    assert.equal(await wallet.lock(), null);
    assert.equal(wallet.address(), null);
    assert.equal(wallet.name(), null);
  });

  it("does not need the wallet's own disconnect to succeed", async () => {
    const wallet = createWallet(RPC);
    const signer = fakeSigner(lockOf("0x6666666666666666666666666666666666666666"));
    signer.disconnect = async () => {
      throw new Error("this wallet has no session to end");
    };
    await wallet.adopt({ name: "Fake", signer });

    await wallet.disconnect();

    assert.equal(await wallet.lock(), null, "a wallet that cannot close must still be let go of");
  });
});

describe("what a click refuses before it costs anything", () => {
  it("refuses to drive with no wallet connected", async () => {
    const wallet = createWallet(RPC);
    await assert.rejects(
      () => wallet.drive({ kind: "tick", steps: 1 }, { prepare: async () => ({}) }),
      /no wallet is connected/,
    );
  });

  it("refuses to drive without the page's half of the click", async () => {
    const wallet = createWallet(RPC);
    await wallet.adopt({
      name: "Fake",
      signer: fakeSigner(lockOf("0x7777777777777777777777777777777777777777")),
    });

    // `prepare` is the page's, and it is required rather than optional: this module pays, signs
    // and sends, and has no way to know what the fly's successor state should be.
    await assert.rejects(
      () => wallet.drive({ kind: "tick", steps: 1 }, {}),
      /drive needs a `prepare`/,
    );
  });
});
