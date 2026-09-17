/**
 * The wallet modal, in a real browser.
 *
 * `node --test test/connector.test.js` checks the rules — the order events arrive in, which
 * callback fires how many times — against a fake element. It cannot check the two things that
 * were actually wrong on screen, because both are geometry: a card with a transparent background
 * (the theme variables were undefined, so `background: var(--background)` resolved to nothing and
 * the page showed through), and a card with `height: 0` on the *second* open.
 *
 * Both looked fine in the DOM. Both were found by opening the page and looking. So this does that
 * on every run, and it is cheap: it reads, it clicks, it measures — it signs nothing, spends
 * nothing, and needs no key.
 *
 *     node --test test/connector-live.test.js
 *
 * Environment: `FLY_CONNECTOR_URL` (default `http://127.0.0.1:8898/`). Skips when no indexer is
 * serving the page, the same way the Rust integration suite skips without `FLY_REQUIRE_CONTRACT`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";

const PAGE = process.env.FLY_CONNECTOR_URL ?? "http://127.0.0.1:8898/";

/** Playwright lives outside this project, so its absence is a skip rather than a failure. */
const PLAYWRIGHT = "/Users/mac/node_modules/playwright-core/index.mjs";

/** Chromium's location, which playwright-core 1.49.1 cannot work out on its own. */
function chromiumPath() {
  return [
    process.env.CHROME_PATH,
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => p && existsSync(p));
}

async function unavailable() {
  if (!existsSync(PLAYWRIGHT)) return `playwright-core is not at ${PLAYWRIGHT}`;
  if (!chromiumPath()) return "no chromium found";
  try {
    const res = await fetch(new URL("/api/fly", PAGE), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return `the indexer at ${PAGE} answered ${res.status}`;
  } catch (err) {
    return `no indexer at ${PAGE} (${err.message})`;
  }
  return null;
}

describe("the wallet modal in a browser", () => {
  it("renders readably, hides on close, and comes back the same size", async (t) => {
    const why = await unavailable();
    if (why) {
      t.skip(why);
      return;
    }

    const { chromium } = await import(PLAYWRIGHT);
    const browser = await chromium.launch({
      headless: true,
      // curl and Node read HTTPS_PROXY from the environment; a browser does not.
      args: process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [],
      executablePath: chromiumPath(),
    });

    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
      const failures = [];
      page.on("pageerror", (e) => failures.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") failures.push(m.text());
      });

      // `networkidle` never fires — the page holds an SSE connection open — so wait for
      // something the app renders instead.
      await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForFunction(() => document.querySelector("#identity")?.children.length > 0, {
        timeout: 30000,
      });

      /**
       * What the modal looks like right now.
       *
       * The connector's content is inside two nested shadow roots — `ccc-connector` renders
       * `ccc-selecting-scene`, which has its own — so nothing here can be reached with a plain
       * query selector from the document.
       */
      const look = () =>
        page.evaluate(() => {
          const el = document.querySelector("ccc-connector");
          if (!el) return { present: false };
          const shadow = el.shadowRoot;
          const card = shadow?.querySelector(".main");
          const scene = shadow?.querySelector("ccc-selecting-scene, ccc-connected-scene");
          const box = card?.getBoundingClientRect();
          return {
            present: true,
            visibility: getComputedStyle(el).visibility,
            cardBackground: card ? getComputedStyle(card).backgroundColor : null,
            cardHeight: box ? Math.round(box.height) : null,
            rows: scene?.shadowRoot
              ? [...scene.shadowRoot.querySelectorAll("button, ccc-button")].filter(
                  (b) => b.getBoundingClientRect().height > 0,
                ).length
              : 0,
          };
        });

      const hidden = await look();
      assert.equal(hidden.present, true, "the connector is mounted on every page load");
      assert.equal(hidden.visibility, "hidden", "and it does not cover the fly until asked");

      await page.locator("#wallet-bar button").first().click();
      await page.waitForTimeout(700);
      const open = await look();

      assert.equal(open.visibility, "visible", "the button shows it");
      assert.ok(open.cardHeight > 0, `the card is ${open.cardHeight}px tall`);
      assert.ok(open.rows >= 2, `only ${open.rows} wallet row(s) rendered`);
      // An opaque card is the point: the connector reads its colours from CSS custom properties
      // that the package does not ship, so an undefined `--background` is an invisible modal
      // rather than a missing one.
      assert.match(
        open.cardBackground ?? "",
        /^rgb\(\d+, \d+, \d+\)$/,
        `the card background is ${open.cardBackground} — the page shows through it`,
      );

      // Dismissed the way the connector dismisses itself: a click on the scrim.
      await page.mouse.click(20, 20);
      await page.waitForTimeout(700);
      assert.equal((await look()).visibility, "hidden", "clicking outside hides it");

      // And again. `onClose(callback)` is not a subscription — it uses the callback for the next
      // close only — so subscribing that way hid the modal once and never again. Opening is the
      // other half: the connector collapses its card to an explicit height of 0 on close and only
      // recomputes it on a re-render, so a second open used to be a full-height DOM with a
      // zero-height card.
      await page.locator("#wallet-bar button").first().click();
      await page.waitForTimeout(700);
      const reopened = await look();
      assert.equal(reopened.visibility, "visible", "the button shows it the second time");
      assert.equal(
        reopened.cardHeight,
        open.cardHeight,
        "and the card is the same size as the first time",
      );

      assert.deepEqual(failures, [], `the page logged errors: ${failures.join("; ")}`);
    } finally {
      await browser.close();
    }
  });
});
