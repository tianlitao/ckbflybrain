/**
 * The rules for driving CCC's connector, checked without a browser.
 *
 * Each of these is a bug that actually happened while wiring the connector into the page, and
 * each one is invisible from the outside: the modal was on screen with five wallet rows in the
 * DOM and no pixels, a wallet could be picked and nothing happened, a second dismissal left the
 * modal open. None of them throws, and none of them is a rendering detail — they are four
 * statements about the order events arrive in, which is why they live in a module with no
 * browser in it and are checked here.
 *
 * The fake is deliberately as dumb as the real element is about this: a `classList`, an
 * `updateComplete` that resolves, and a `signer` that a test can set late.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLOSED,
  closeConnector,
  openConnector,
  settledSigner,
  watchConnector,
} from "../public/connector.source.js";

/** The three `classList` methods the module uses, and nothing else. */
class ClassList {
  #names = new Set();
  add(name) {
    this.#names.add(name);
  }
  remove(name) {
    this.#names.delete(name);
  }
  contains(name) {
    return this.#names.has(name);
  }
}

/** An element that behaves like `ccc-connector` in the four ways this module depends on. */
class FakeConnector extends EventTarget {
  constructor() {
    super();
    this.classList = new ClassList();
    this.updates = 0;
    this.updateComplete = Promise.resolve();
    this.signer = undefined;
  }

  requestUpdate() {
    this.updates += 1;
  }

  /** What the element does on its own timeout after a close. */
  fireClose() {
    this.dispatchEvent(new Event("close"));
  }
}

/** A signer, identified by name so a test can say which one it means. */
const signerNamed = (name) => ({ name, signer: { name } });

/** Let every pending microtask and timer callback run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

describe("showing and hiding the modal", () => {
  it("hides by adding the class, and shows by removing it", () => {
    const element = new FakeConnector();

    closeConnector(element);
    assert.equal(element.classList.contains(CLOSED), true);

    openConnector(element);
    assert.equal(element.classList.contains(CLOSED), false);
  });

  it("asks the element to re-render when it opens, or the card comes back zero pixels tall", () => {
    // The connector collapses its own card on close by writing `height: 0`, and only recomputes
    // it in `updated()` — which runs on a re-render, and opening changes no property. Without
    // this the second open is a modal that is present, `display: block`, and invisible.
    const element = new FakeConnector();
    closeConnector(element);
    const before = element.updates;

    openConnector(element);

    assert.equal(element.updates, before + 1, "opening must ask for an update");
  });
});

describe("waiting for the signer", () => {
  it("returns the signer that arrives after the close, which is the real order", async () => {
    // Measured: `close` is dispatched one tick *before* the element even starts resolving the
    // signer, and that resolution is async. So the signer is undefined at close time and defined
    // shortly after — a handler that reads it synchronously sees nothing.
    const element = new FakeConnector();
    assert.equal(element.signer, undefined);

    setTimeout(() => {
      element.signer = signerNamed("JoyID");
    }, 5);

    const info = await settledSigner(element, { tries: 20, waitMs: 5 });
    assert.equal(info?.name, "JoyID");
  });

  it("gives up rather than waiting forever on a wallet that never answers", async () => {
    const element = new FakeConnector();
    const info = await settledSigner(element, { tries: 3, waitMs: 1 });
    assert.equal(info, null);
  });

  it("survives an element that was never upgraded, so a missing tag is not a hang", async () => {
    // `updateComplete` is a Lit property. If the custom element never registered — a bundling
    // mistake, a browser that refused the module — reading it must not throw.
    const info = await settledSigner({}, { tries: 1, waitMs: 1 });
    assert.equal(info, null);
  });
});

describe("watching the connector", () => {
  it("hides the modal on close and reports the wallet that was picked", async () => {
    const element = new FakeConnector();
    const chosen = [];
    watchConnector(element, (info) => chosen.push(info), { tries: 20, waitMs: 5 });

    setTimeout(() => {
      element.signer = signerNamed("UTXO Global");
    }, 5);
    element.fireClose();

    await new Promise((done) => setTimeout(done, 60));
    assert.equal(element.classList.contains(CLOSED), true, "the modal hid itself");
    assert.deepEqual(chosen.map((i) => i.name), ["UTXO Global"]);
  });

  it("hides the modal on the second close too", async () => {
    // The regression. `onClose(callback)` is not a subscription — it uses the callback for the
    // next close only — so the modal hid the first time and stayed on screen after that.
    const element = new FakeConnector();
    const chosen = [];
    watchConnector(element, (info) => chosen.push(info), { tries: 2, waitMs: 1 });

    element.fireClose();
    await settle();
    openConnector(element);
    assert.equal(element.classList.contains(CLOSED), false);

    element.fireClose();
    await settle();

    assert.equal(element.classList.contains(CLOSED), true, "the second close hid it as well");
    assert.deepEqual(chosen, [], "nothing was picked either time");
  });

  it("reports nothing when the reader dismisses the modal without picking anything", async () => {
    const element = new FakeConnector();
    const chosen = [];
    watchConnector(element, (info) => chosen.push(info), { tries: 2, waitMs: 1 });

    element.fireClose();
    await new Promise((done) => setTimeout(done, 20));

    assert.deepEqual(chosen, []);
  });

  it("does not mistake our own disconnect for a choice", async () => {
    // Disconnecting closes the modal, and the connector fires the same `close` it fires when a
    // wallet is picked. The signer is still readable for a moment after the connector clears it,
    // so without the mute the wallet would be adopted straight back.
    const element = new FakeConnector();
    const chosen = [];
    const watch = watchConnector(element, (info) => chosen.push(info), { tries: 2, waitMs: 1 });

    element.signer = signerNamed("JoyID");
    watch.muteNextClose();
    element.fireClose();
    await new Promise((done) => setTimeout(done, 20));

    assert.deepEqual(chosen, [], "the close we caused reported nothing");
    assert.equal(element.classList.contains(CLOSED), true, "and it still hid the modal");

    // And the mute is spent: the next close is the reader's, and is reported.
    element.fireClose();
    await new Promise((done) => setTimeout(done, 20));
    assert.deepEqual(chosen.map((i) => i.name), ["JoyID"]);
  });
});
