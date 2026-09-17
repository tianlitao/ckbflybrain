/**
 * CCC's connector, and the four things this page has to know about it.
 *
 * The wallet picker is not this page's. `@ckb-ccc/connector` is a Lit element that renders the
 * whole modal — the wallet list, each wallet's own icon, the connected view, the fee-rate
 * selector — and the work here is to mount it, open it, hide it, and take the signer it settles
 * on. Those rules are this module.
 *
 * **They were measured in a browser against connector 1.3.0, not read off the documentation.**
 * The package's docs describe 2.x, whose API differs in the one place that matters: 2.x hands the
 * application a `connectionOwner` on a `connection` event, and 1.3.0 has no such event — it
 * exposes a `signer` property and a `close` event, and nothing to dispose.
 *
 * Nothing here imports the connector. The element is made by the caller and passed in, which
 * keeps this a plain DOM module: `@ckb-ccc/connector` calls `customElements.define` at import
 * time, so it cannot be loaded outside a browser at all, and a rule that cannot be tested is a
 * rule that gets discovered twice.
 *
 * @module connector
 */

/**
 * The class that hides the modal.
 *
 * See `style.css`: it hides with `visibility`, not `display`, because the element measures its
 * own scene to size the card and a `display: none` element measures zero.
 */
export const CLOSED = "wallet-closed";

/**
 * Show the modal.
 *
 * Two statements, and the second is the one that was missing.
 *
 * The connector collapses its own card on close by writing an explicit `height: 0`, and nothing
 * puts the height back: it is recomputed in the element's `updated()`, which only runs when the
 * element re-renders, and opening changes none of its properties. So the *second* time a reader
 * opened the modal it was all there — `display: block`, five wallet rows in the DOM — and zero
 * pixels tall. `requestUpdate()` is that re-render, asked for through the element's own lifecycle
 * rather than by reaching into its shadow root for the card.
 *
 * @param {HTMLElement & { requestUpdate(): void }} element
 */
export function openConnector(element) {
  element.classList.remove(CLOSED);
  element.requestUpdate();
}

/**
 * Hide the modal. The reader's wallet, if any, is untouched — this is only about the overlay.
 *
 * @param {HTMLElement} element
 */
export function closeConnector(element) {
  element.classList.add(CLOSED);
}

/**
 * The signer the connector settled on, or `null` if it settled on none.
 *
 * **`close` is dispatched before the signer exists.** The element closes itself in `onClose()`,
 * whose timeout dispatches `close` and *then* runs the callback that reports the choice; the
 * element's own handler records `walletName`/`signerName` and resolves the signer from there,
 * through an `async updateSigner` that first asks the wallet whether it is really connected. So
 * at the moment the modal closes, `element.signer` is still undefined. A handler that reads it
 * there concludes the reader chose nothing — which is exactly what this page did, and why the
 * wallet list opened, a wallet could be picked, and nothing ever happened next.
 *
 * `updateComplete` is the element's own render cycle, which is what the assignment triggers.
 * Bounded, because a wallet that never answers must not leave the page waiting: the reader gets
 * the bar back with no connection rather than a page that looks stuck.
 *
 * @param {{ signer?: unknown, updateComplete?: Promise<unknown> }} element
 * @returns {Promise<object|null>}
 */
export async function settledSigner(element, { tries = 20, waitMs = 100 } = {}) {
  for (let i = 0; i < tries; i++) {
    await element.updateComplete;
    if (element.signer) {
      return element.signer;
    }
    await new Promise((done) => setTimeout(done, waitMs));
  }
  return null;
}

/**
 * Hide the modal whenever it closes, and report the signer the reader ended up with.
 *
 * Listening for the `close` **event** rather than calling the element's `onClose(callback)` is
 * not a style choice. `onClose` is not a subscription: it takes one callback and uses it for the
 * next close only, so a callback registered once fires once — after which the modal stops hiding
 * itself, because nothing else in the page knows it closed. Measured: the first dismissal hid it,
 * the second left it on screen. `close` is a real event and fires every time.
 *
 * @param {HTMLElement} element
 * @param {(info: object) => void} onChosen called only when there is a signer to report
 * @param {{ tries?: number, waitMs?: number }} [settle] forwarded to `settledSigner`, for tests
 * @returns {{ muteNextClose(): void }} the handle the caller needs when *it* closes the modal
 */
export function watchConnector(element, onChosen, settle) {
  // Closes this page caused itself. Our own disconnect also closes the modal, and the connector
  // fires the same `close` event it fires when the reader picks a wallet — so without this, a
  // disconnect would be read as a choice and the wallet adopted straight back. Counted rather
  // than a boolean so the bookkeeping cannot drift out of step with the events.
  let muted = 0;

  element.addEventListener("close", async () => {
    closeConnector(element);
    if (muted > 0) {
      muted -= 1;
      return;
    }
    const info = await settledSigner(element, settle);
    if (info) {
      onChosen(info);
    }
  });

  return {
    /** Ignore the next close, because this page is the one that caused it. */
    muteNextClose() {
      muted += 1;
    },
  };
}
