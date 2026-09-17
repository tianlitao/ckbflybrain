/**
 * Wallets: the half of driving a fly that needs a private key.
 *
 * # Why this is a separate module, and why it is so thin
 *
 * The successor state has to be *exact* — the type script recomputes it and compares bytes — so
 * whoever builds the transaction must be able to run the organism. That used to mean asking a
 * server, because `flyplan` is a native binary. It does not any more: `flywasm` is the same
 * `flycore` compiled for wasm, and `crates/flywasm/verify.mjs` fails if the two ever disagree on
 * a byte. So the transaction is built **in the page**, by `src/tx.js` — the same code the CLI
 * uses, with `flywasm` where the CLI has `flyplan`.
 *
 * What is genuinely left for a key is three things, and this module is those three plus the
 * wallet list: **pay the fee, sign, send.**
 *
 * # The three steps are a contract, not an implementation detail
 *
 * `completeFeeBy` adds the payer's inputs and a change output, and **it can rewrite the witness
 * list** — including witness 0, which is where the type script reads the action from. So the
 * action is re-set *after* the fee is completed. Skipping that produces a transaction the node
 * accepts and the type script refuses for a reason (`MissingWitness`) that says nothing about
 * what actually went wrong. `flyInputIndex` is carried rather than assumed: the type script
 * reads witness 0 of its *input group*, and that group has exactly one member.
 *
 * That sequence is `tx.settle`, which the CLI calls too — so "complete the fee, put the action
 * back, check the fly did not move" is written once rather than twice.
 *
 * # `Transaction.from` is the wrong decoder, and it does not say so
 *
 * The transaction arrives as an object now, so `fromBytes` is no longer on this path — but the
 * mistake it guarded against has moved rather than gone. CCC has two decoders:
 * `Transaction.from(txLike)` takes an **object**, and `Transaction.fromBytes(bytes)` takes
 * serialized molecule bytes. Handed a hex string, `from` does not throw — a string has no
 * `inputs` key, so it builds a **valid, empty transaction**. Measured here: the same 2,090-byte
 * prepared hex decoded to `2 inputs / 2 outputs / 1 witness` through `fromBytes` and to
 * `0 / 0 / 0` through `from`, with no error either way. An empty transaction that is then
 * fee-completed, signed and broadcast is a real transaction, just not the one that was asked
 * for: the first attempt at this flow sent a bare transfer and the node rejected it for its fee
 * rate, which is the *best* outcome available to that mistake.
 *
 * So the signed result is checked against what was signed (see `drive`). A wallet that returns
 * something other than the transaction it was given — which is what the empty decode above turns
 * into, one layer down in an adapter — must not be broadcast at all. The check is cheap and the
 * alternative is sending a transaction nobody can explain.
 *
 * # Wallets are a list, and swapping one is a line
 *
 * `signerInfo` returns whatever the environment has. UTXO Global is an extension, so it appears
 * only when `window.utxoGlobal` exists — the adapter returns an empty list otherwise rather than
 * throwing. JoyID needs nothing installed and works through a popup. Both factories return
 * `ccc.SignerInfo[]`, which is the whole reason they can be listed here together; adding a third
 * is one line in `adapters` and nothing else changes.
 *
 * @module wallet
 */

// One import per wallet, not the `@ckb-ccc/ccc` umbrella. The umbrella is convenient — it
// re-exports core and every adapter — but it also re-exports Spore, DID, type-id, UDT, the backend
// shell, and through Xverse the whole of bitcoinjs-lib and axios. None of that signs anything here,
// and it took the bundle from 885 KB to 1.4 MB. Importing the adapters directly costs six lines and
// keeps the page to the code it uses.
//
// Every one of these pins `@ckb-ccc/core` at exactly the version this project depends on, so npm
// installs one copy. That matters more than it looks: two copies means two `Transaction` classes,
// and a wallet handed a transaction built by the other one.
import * as ccc from "@ckb-ccc/core";
import { JoyId } from "@ckb-ccc/joy-id";
import { Okx } from "@ckb-ccc/okx";
import { Rei } from "@ckb-ccc/rei";
import { UniSat } from "@ckb-ccc/uni-sat";
import { UtxoGlobal } from "@ckb-ccc/utxo-global";
import { Xverse } from "@ckb-ccc/xverse";

import { FEE_RATE, settle } from "../src/tx.js";

/**
 * The icon JoyID shows beside the app name.
 *
 * A `data:` URI rather than `${location.origin}/favicon.ico`, and that is not a stylistic
 * choice. JoyID's own page is https and its CSP is `img-src https://* ipfs://* data: blob:`,
 * so on a local http server the favicon URL is blocked — measured, not assumed:
 *
 *   Loading the image 'http://127.0.0.1:8898/favicon.ico' violates the following Content
 *   Security Policy directive: "img-src https://* ipfs://* data: blob:".
 *
 * That is the first screen a reader sees, the one asking them to trust this app with a passkey,
 * and it was showing a broken image. `data:` is allowed on both schemes, so the mark is the same
 * picture wherever the page is served from.
 *
 * @returns {string}
 */
export function appIcon() {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
    "<circle cx='16' cy='16' r='15' fill='#0b0b0b'/>" +
    "<circle cx='16' cy='16' r='8.5' fill='none' stroke='#7ee787' stroke-width='3'/>" +
    "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Label a signer with the wallet it came from.
 *
 * JoyID names its CKB signer "CKB" — the *chain* — so the page's only connect control read
 * "Connect CKB", and the ceremony behind it is a passkey prompt from JoyID. That is a surprising
 * enough thing to be asked for that the reader deserves to be told whose prompt it is. The
 * factories know which wallet they are, so the label is set here; `connect()` records the name
 * from this list, which is what the connected-state label then shows.
 *
 * @param {string} wallet
 */
const named = (wallet) => (info) => ({ ...info, name: wallet });

/**
 * Everything offerable in this browser, in the order a reader should try it.
 *
 * One line per wallet CCC ships an adapter for, because each adapter knows how to find its own
 * wallet — an extension, a popup, a passkey — and returns `SignerInfo[]`. That uniformity is what
 * makes this a list rather than a set of special cases, and adding a wallet CCC supports is one
 * more line and nothing else.
 *
 * Only signers that can sign a **CKB** transaction are kept. Every adapter returns more than that:
 * JoyID offers BTC, EVM and Nostr as well, UTXO Global adds BTC and DOGE. A signer for another
 * chain is useless here — picked from a list, one of them fails deep inside fee completion, or
 * worse signs the wrong preimage, and the reader has no way to know they chose the wrong kind of
 * thing. The filter is `signer.type`, which is what the signer itself says it signs.
 *
 * **Which of these can actually move the fly, in CCC 1.2.3 / 1.1.12.** Read off the type
 * definitions, since a headless browser has no extensions installed and every factory returns an
 * empty list there:
 *
 *   joy-id        `CkbSigner extends ccc.Signer`     — CKB, and it needs nothing installed
 *   utxo-global   `SignerCkb extends ccc.Signer`     — CKB
 *   rei           `ReiSigner extends ccc.Signer`     — CKB
 *   okx           `BitcoinSigner extends SignerBtc`  — Bitcoin only
 *   uni-sat       `Signer extends SignerBtc`         — Bitcoin only
 *   xverse        `Signer extends SignerBtc`         — Bitcoin only
 *
 * The three Bitcoin-only ones are listed anyway, and the filter above is what makes that safe: a
 * reader never sees a wallet that cannot sign here. Keeping the lines means a CCC version that
 * gives them CKB support needs no change on this side. It is not free — Xverse's adapter drags in
 * bitcoinjs-lib and valibot, about 215 KB minified, for a wallet that can never appear. Dropping
 * those three lines is the way to buy that back.
 *
 * @param {ccc.Client} client
 * @returns {ccc.SignerInfo[]}
 */
function adapters(client) {
  const offered = [
    ...UniSat.getUniSatSigners(client).map(named("UniSat")),
    ...Okx.getOKXSigners(client).map(named("OKX")),
    // Xverse returns `{ wallet, signerInfo }[]` rather than `SignerInfo[]` — the one adapter with a
    // different shape, and the reason this list is worth reading rather than skimming.
    ...Xverse.getXverseSigners(client).map((x) => named("Xverse")(x.signerInfo)),
    ...Rei.getReiSigners(client).map(named("Rei")),
    ...UtxoGlobal.getUtxoGlobalSigners(client).map(named("UTXO Global")),
    // A popup opened outside a click handler is blocked, and the click that connects happens later
    // than this list is built — so nothing here opens anything. `connect()` does, from the button.
    ...JoyId.getJoyIdSigners(client, "CKB Fly", appIcon()).map(named("JoyID")),
  ];
  return offered.filter((info) => info.signer.type === ccc.SignerType.CKB);
}

/**
 * A visitor's wallet, or no wallet.
 *
 * @param {string} rpc the node this page reads, so the wallet and the feed are never on
 *   different chains — a wallet pointed at another network would sign a transaction the feed
 *   cannot see confirmed, and the click would look lost rather than wrong
 */
export function createWallet(rpc) {
  const client = new ccc.ClientPublicTestnet(
    ccc.ClientPublicTestnet.resolveConfig({ url: rpc, fallbacks: [] }),
  );

  let signers = [];
  let signer = null;
  let address = null;
  let name = null;
  let lockCache = null;
  const listeners = [];

  const notify = () => {
    for (const fn of listeners) {
      fn();
    }
  };

  return {
    client,

    /** Rebuild the list. Called on load and whenever a panel needs to show what is available. */
    refresh() {
      signers = adapters(client);
      return signers;
    },

    available() {
      return signers;
    },

    current() {
      return signer;
    },

    address() {
      return address;
    },

    /**
     * The lock this wallet signs with.
     *
     * Resolved here rather than at each use because it is the input to a rule — `signableLock`,
     * which decides whether a click is even attempted — and that rule has to be asked about the
     * key that will actually sign. Resolved through the *address*, not the signer's class: the
     * address is what the chain will see, so the two cannot disagree about which lock is meant.
     *
     * Cached, because it cannot change while a signer is connected and the answer is needed on
     * every snapshot.
     */
    async lock() {
      if (!signer) {
        return null;
      }
      if (!lockCache) {
        lockCache = (await signer.getAddressObj()).script;
      }
      return lockCache;
    },

    onChange(fn) {
      listeners.push(fn);
    },

    /**
     * Ask the wallet for an account.
     *
     * Nothing is signed here and no transaction is built: this is the ceremony, and for JoyID it
     * involves a passkey and a popup, which is why it must be reached from a click.
     */
    /**
     * Take a signer chosen somewhere else.
     *
     * The connector owns the picker now — it renders the wallet list and the modal — so this
     * object only needs the result. `connect()` is still here for the private-key path the tests
     * use, where there is no UI to choose anything.
     */
    async adopt(info) {
      name = info.name;
      signer = info.signer;
      lockCache = null;
      address = await signer.getRecommendedAddress();
      notify();
      return { address };
    },

    async connect(info) {
      // The *name from the list*, not the class name: the page is minified, so
      // `signer.constructor.name` renders as `r` and tells the reader nothing about which of
      // two wallets they just connected.
      name = info.name;
      signer = info.signer;
      lockCache = null;
      await signer.connect();
      address = await signer.getRecommendedAddress();
      notify();
      return { address, balance: await signer.getBalance() };
    },

    name() {
      return name;
    },

    async disconnect() {
      // The wallet's own disconnect is best-effort: JoyID keeps a session, UTXO Global does not
      // have one to end. Failing here must not leave the page thinking it is still connected.
      try {
        await signer?.disconnect?.();
      } catch {
        /* the page-side state below is what matters */
      }
      signer = null;
      address = null;
      name = null;
      lockCache = null;
      notify();
    },

    /**
     * Drive the organism on screen with this wallet: build, pay, sign, send.
     *
     * `prepare` is the page's half, supplied by the caller rather than imported, so that this
     * module stays about wallets. It returns the result of `tx.buildAction` — a transaction with
     * the action already in its witness and no fee paid. Everything before the fee is the same
     * code the CLI runs, with `flywasm` where the CLI has `flyplan`; everything from the fee on
     * is the same three steps either way, and they are `tx.settle`.
     *
     * `feeRate` is optional and is the reader's choice when they made one: the fee comes out of
     * their own change output, so a fee-rate control in the UI has to reach this call or it is a
     * setting that does nothing. Left out, the page's own rate stands — which is what the
     * connector's "Auto" resolves to.
     *
     * @param {{ kind: string, steps?: number, channel?: number, param?: number, strength?: number }} spec
     * @param {{ feeRate?: bigint|number|string, prepare: (spec: object) => Promise<object> }} options
     */
    async drive(spec, { feeRate, prepare } = {}) {
      if (!signer || !address) {
        throw new Error("no wallet is connected");
      }
      if (typeof prepare !== "function") {
        throw new Error(
          "drive needs a `prepare`: the transaction is built by the page (see public/chain.source.js), " +
            "and this module only pays, signs and sends it",
        );
      }

      const built = await prepare(spec);
      const flyIndex = built.flyInputIndex ?? 0;
      if (built.tx.inputs.length <= flyIndex) {
        throw new Error(
          `the built transaction has ${built.tx.inputs.length} inputs, so the organism is not in it`,
        );
      }

      await settle(built, { signer, feeRate: BigInt(feeRate ?? FEE_RATE) });

      // Signed and sent as two steps rather than one (`signer.sendTransaction`) so that what
      // comes back can be compared with what was given. A wallet that returns a *different*
      // transaction — a bare transfer, an empty one, the same one with the action dropped —
      // must be refused here, where nothing has been broadcast yet. Inputs, outputs and cell
      // deps are the parts a signature does not change; only the witnesses may differ.
      const signed = await signer.signTransaction(built.tx);
      const same =
        signed.inputs.length === built.tx.inputs.length &&
        signed.outputs.length === built.tx.outputs.length &&
        signed.cellDeps.length === built.tx.cellDeps.length;
      if (!same) {
        throw new Error(
          `the wallet returned a different transaction (${signed.inputs.length} inputs and ` +
            `${signed.outputs.length} outputs, where it was given ${built.tx.inputs.length} and ` +
            `${built.tx.outputs.length}). Nothing was sent.`,
        );
      }

      const txHash = await client.sendTransaction(signed);
      return { txHash, before: built.before, after: built.after };
    },
  };
}
