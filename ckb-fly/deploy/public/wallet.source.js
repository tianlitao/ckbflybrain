/**
 * Wallets: the half of driving a fly that needs a private key.
 *
 * # Why this is a separate module, and why it is so thin
 *
 * The successor state is the output of the Rust simulation. Recomputing it in the browser would
 * be a second implementation of the one thing this port is about — the page would be able to
 * disagree with the type script about what a tick produces, and the disagreement would look like
 * a rejected transaction with no explanation. So this module does **not** decide what the fly
 * becomes. It asks the server for that (`POST /api/prepare`, which runs the same planner the
 * CLI does), and then does the only three things that genuinely require a key in the browser:
 *
 * 1. pay the fee, from the visitor's own coins;
 * 2. sign;
 * 3. send.
 *
 * The result is that the operator can offer the page **without a key on the server**: `prepare`
 * signs nothing, and `POST /api/act` (the server-signed path) need not be enabled at all.
 *
 * # The three steps are a contract with the server, not an implementation detail
 *
 * `completeFeeBy` adds the payer's inputs and a change output, and **it can rewrite the witness
 * list** — including witness 0, which is where the type script reads the action from. So the
 * action is re-set *after* the fee is completed. Skipping that produces a transaction the node
 * accepts and the type script refuses for a reason (`MissingWitness`) that says nothing about
 * what actually went wrong. `flyInputIndex` comes back from the server for the same reason: the
 * type script reads witness 0 of its *input group*, and that group has exactly one member.
 *
 * # `Transaction.from` is the wrong decoder, and it does not say so
 *
 * CCC has two: `Transaction.from(txLike)` takes an **object**, and `Transaction.fromBytes(bytes)`
 * takes serialized molecule bytes. Handed a hex string, `from` does not throw — a string has no
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

import * as ccc from "@ckb-ccc/core";
import { UtxoGlobal } from "@ckb-ccc/utxo-global";
import { JoyId } from "@ckb-ccc/joy-id";

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
function appIcon() {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
    "<circle cx='16' cy='16' r='15' fill='#0b0b0b'/>" +
    "<circle cx='16' cy='16' r='8.5' fill='none' stroke='#7ee787' stroke-width='3'/>" +
    "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Everything offerable in this browser, in the order a reader should try it.
 *
 * Only signers that can sign a **CKB** transaction are kept. Both adapters return more than that:
 * JoyID offers BTC, EVM and Nostr as well, and UTXO Global adds BTC and DOGE. Those are real
 * signers for other chains and they are useless here — picked from a list, one of them produces
 * a failure deep inside fee completion, or worse a signature over the wrong preimage, and the
 * reader has no way to know they chose the wrong kind of thing. The filter is `signType`'s chain,
 * which is what the signer itself says it signs.
 *
 * **Each wallet is named for the wallet, not for the chain.** JoyID labels its CKB signer "CKB",
 * so the page's only connect control read "Connect CKB" — and the ceremony behind it is a
 * passkey prompt from JoyID, which is a surprising enough thing to be asked for that the reader
 * deserves to be told whose prompt it is. The factories already know which wallet they came
 * from, so the label is set here; `connect()` still records the name from this list, which is
 * what the connected-state label shows.
 *
 * @param {ccc.Client} client
 * @returns {ccc.SignerInfo[]}
 */
function adapters(client) {
  const offered = [
    ...UtxoGlobal.getUtxoGlobalSigners(client).map((info) => ({ ...info, name: "UTXO Global" })),
    // A popup opened outside a click handler is blocked, and the click that connects happens
    // later than this list is built — so nothing here opens anything. `connect()` does, and it is
    // called from the button.
    ...JoyId.getJoyIdSigners(client, "CKB Fly", appIcon()).map((info) => ({
      ...info,
      name: "JoyID",
    })),
  ];
  return offered.filter((info) => info.signer.type === ccc.SignerType.CKB);
}

/**
 * A visitor's wallet, or no wallet.
 *
 * @param {string} rpc the node this page's server reads, so the two are never on different chains
 */
export function createWallet(rpc) {
  const client = new ccc.ClientPublicTestnet(
    ccc.ClientPublicTestnet.resolveConfig({ url: rpc, fallbacks: [] }),
  );

  let signers = [];
  let signer = null;
  let address = null;
  let name = null;
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

    onChange(fn) {
      listeners.push(fn);
    },

    /**
     * Ask the wallet for an account.
     *
     * Nothing is signed here and no transaction is built: this is the ceremony, and for JoyID it
     * involves a passkey and a popup, which is why it must be reached from a click.
     */
    async connect(info) {
      // The *name from the list*, not the class name: the page is minified, so
      // `signer.constructor.name` renders as `r` and tells the reader nothing about which of
      // two wallets they just connected.
      name = info.name;
      signer = info.signer;
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
      notify();
    },

    /**
     * Drive the organism on screen with this wallet: prepare, pay, sign, send.
     *
     * Returns what the server predicted the transition would be, so the caller can show the
     * change before the chain confirms it — the indexer will report the same numbers a few
     * seconds later, from the chain, and the page should not have to guess in between.
     */
    async drive(spec) {
      if (!signer || !address) {
        throw new Error("no wallet is connected");
      }

      const res = await fetch("/api/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...spec, address }),
      });
      const prepared = await res.json();
      if (!prepared.ok) {
        throw new Error(prepared.error);
      }

      // `fromBytes`, never `from`: see the module comment. A hex string handed to `from`
      // silently yields an empty transaction, which then gets fee-completed, signed and sent.
      const tx = ccc.Transaction.fromBytes(prepared.tx);
      const flyIndex = prepared.flyInputIndex ?? 0;
      if (tx.inputs.length <= flyIndex) {
        throw new Error(
          `the prepared transaction decoded to ${tx.inputs.length} inputs, so the organism is not in it`,
        );
      }

      await tx.completeFeeBy(signer, BigInt(prepared.feeRate));
      // After completion, never before: completing a fee can rewrite the witness list.
      tx.setWitnessArgsAt(flyIndex, { inputType: prepared.action });

      // Signed and sent as two steps rather than one (`signer.sendTransaction`) so that what
      // comes back can be compared with what was given. A wallet that returns a *different*
      // transaction — a bare transfer, an empty one, the same one with the action dropped —
      // must be refused here, where nothing has been broadcast yet. Inputs, outputs and cell
      // deps are the parts a signature does not change; only the witnesses may differ.
      const signed = await signer.signTransaction(tx);
      const same =
        signed.inputs.length === tx.inputs.length &&
        signed.outputs.length === tx.outputs.length &&
        signed.cellDeps.length === tx.cellDeps.length;
      if (!same) {
        throw new Error(
          `the wallet returned a different transaction (${signed.inputs.length} inputs and ` +
            `${signed.outputs.length} outputs, where it was given ${tx.inputs.length} and ` +
            `${tx.outputs.length}). Nothing was sent.`,
        );
      }

      const txHash = await client.sendTransaction(signed);
      return { txHash, before: prepared.before, after: prepared.after };
    },
  };
}
