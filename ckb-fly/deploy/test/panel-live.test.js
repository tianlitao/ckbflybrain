/**
 * The page a reader actually gets, measured in a real browser.
 *
 * Everything here is a number taken off the rendered page rather than a property of the source.
 * That is the point: the failures this guards against were all invisible to `node --test` and
 * perfectly reasonable in the CSS.
 *
 *   * **The roster columns.** They were 5em wide for the step column, and `第 1,024 步` needs
 *     6.24em, so four of the five Chinese rows wrapped onto two lines and the table read as a
 *     wall of broken pairs. The widths were originally measured by `node roster-widths.mjs`,
 *     which no longer exists — so nothing was measuring them, and the numbers in the comment had
 *     quietly stopped being true. This is that script, as a test, in both languages.
 *   * **The ring.** It is `position: sticky` so that a reader who scrolls down to the Drive
 *     buttons can still see the ring those buttons move. Sticky is a layout property with two
 *     silent preconditions — the element must be shorter than its grid area, and shorter than the
 *     window — and if either stops holding, the page still renders and the ring simply scrolls
 *     away. So this asserts the property that matters: with the Drive panel at the foot of the
 *     window, the whole ring is on screen.
 *   * **The Drive cards.** Each is a verb and what it costs. The sub-line is the part that
 *     distinguishes `tick 64` from `tick 32`, and a sub-line that has wrapped onto a second line
 *     is a card that no longer reads as a pair.
 *
 * It reads, scrolls and measures. It signs nothing, spends nothing, and needs no key.
 *
 *     node --test test/panel-live.test.js
 *
 * Environment: `FLY_PANEL_URL` (default `http://127.0.0.1:8898/`). Skips when no indexer is
 * serving the page, the same way the Rust integration suite skips without `FLY_REQUIRE_CONTRACT`.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { existsSync } from "node:fs";

const PAGE = process.env.FLY_PANEL_URL ?? "http://127.0.0.1:8898/";
const VIEWPORT = { width: 1440, height: 900 };

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

/**
 * Measure every cell of the roster, against the track it is in.
 *
 * The intrinsic width of a cell's content is measured with a `nowrap` span carrying the cell's own
 * font, rather than read from the cell itself — a cell that is *already* wrapping reports the
 * width of its longest word, which is the one number that cannot tell you it is too narrow.
 *
 * `em` throughout, because that is the unit the tracks are declared in: comparing a pixel width
 * against a pixel track would break the moment the font size changed, and the two numbers would
 * still look plausible.
 */
const MEASURE_ROSTER = `(() => {
  const rows = [...document.querySelectorAll("#roster li")];
  if (!rows.length) return { rows: 0, columns: [] };

  const probe = (el) => {
    const s = document.createElement("span");
    const cs = getComputedStyle(el);
    s.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px";
    s.style.fontFamily = cs.fontFamily;
    s.style.fontSize = cs.fontSize;
    s.style.fontWeight = cs.fontWeight;
    s.textContent = el.textContent;
    document.body.append(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return w;
  };

  const fs = parseFloat(getComputedStyle(rows[0]).fontSize);
  const tracks = getComputedStyle(rows[0]).gridTemplateColumns.split(/\\s+/).map(parseFloat);
  const columns = tracks.map((track, i) => ({
    i, trackEm: +(track / fs).toFixed(2), needEm: 0, sample: "", wrapped: 0,
  }));

  for (const row of rows) {
    [...row.children].forEach((cell, i) => {
      if (!columns[i]) return;
      const need = Math.ceil(probe(cell)) / fs;
      if (need > columns[i].needEm) {
        columns[i].needEm = +need.toFixed(2);
        columns[i].sample = cell.textContent.trim().slice(0, 24);
      }
      const line = parseFloat(getComputedStyle(cell).lineHeight) || fs * 1.2;
      if (cell.getBoundingClientRect().height > line * 1.6) columns[i].wrapped += 1;
    });
  }
  return { rows: rows.length, columns };
})()`;

/** Click the language switch and wait for the renderers to have run. */
async function choose(page, code) {
  await page.evaluate((want) => {
    const label = want === "en" ? "EN" : "中文";
    [...document.querySelectorAll("#lang-switch button")]
      .find((b) => b.textContent.trim() === label)
      ?.click();
  }, code);
  await page.waitForTimeout(400);
}

describe("the page a reader gets", () => {
  let browser = null;
  let page = null;
  let why = null;

  before(async () => {
    why = await unavailable();
    if (why) return;
    const { chromium } = await import(PLAYWRIGHT);
    browser = await chromium.launch({
      headless: true,
      // curl and Node read HTTPS_PROXY from the environment; a browser does not.
      args: process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [],
      executablePath: chromiumPath(),
    });
    page = await browser.newPage({ viewport: VIEWPORT });
    // `networkidle` never fires — the page holds an SSE connection open — so wait for something
    // the app renders instead.
    await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => document.querySelector("#identity")?.children.length > 0, {
      timeout: 30000,
    });
    // The roster is the last of the three lists to be filled, and it is the one being measured.
    await page.waitForFunction(() => document.querySelectorAll("#roster li").length > 0, {
      timeout: 30000,
    });
  });

  after(async () => {
    await browser?.close();
  });

  it("keeps every roster column wide enough, in both languages", async (t) => {
    if (why) return t.skip(why);
    for (const code of ["zh", "en"]) {
      await choose(page, code);
      const { rows, columns } = await page.evaluate(MEASURE_ROSTER);
      assert.ok(rows > 0, `${code}: no rows to measure`);

      const wrapped = columns.filter((c) => c.wrapped > 0);
      assert.deepEqual(
        wrapped.map((c) => `col${c.i} "${c.sample}" ×${c.wrapped}`),
        [],
        `${code}: ${wrapped.length} column(s) wrapped a row onto a second line`,
      );

      const narrow = columns.filter((c) => c.needEm > c.trackEm);
      assert.deepEqual(
        narrow.map((c) => `col${c.i} needs ${c.needEm}em in ${c.trackEm}em: "${c.sample}"`),
        [],
        `${code}: the widest value in these columns does not fit its track`,
      );
    }
    await choose(page, "zh");
  });

  it("keeps the whole ring on screen while the Drive buttons are", async (t) => {
    if (why) return t.skip(why);
    const fits = await page.evaluate(() => {
      const canvas = document.getElementById("ring").getBoundingClientRect();
      return { ring: Math.round(canvas.height), window: window.innerHeight };
    });
    // The precondition for `position: sticky` doing anything at all: an element taller than the
    // window has nowhere to stick to, and `top: 16px` on it is a no-op.
    assert.ok(
      fits.ring < fits.window,
      `the ring is ${fits.ring}px tall in a ${fits.window}px window: it cannot stick`,
    );

    const seen = await page.evaluate(async () => {
      document.getElementById("drive-panel").scrollIntoView({ block: "end" });
      await new Promise((r) => setTimeout(r, 400));
      const ring = document.getElementById("ring").getBoundingClientRect();
      const drive = document.getElementById("drive-panel").getBoundingClientRect();
      return {
        ringTop: Math.round(ring.top),
        ringBottom: Math.round(ring.bottom),
        driveTop: Math.round(drive.top),
        window: window.innerHeight,
      };
    });
    // The assertion is about the reader, not about the CSS: they scrolled to the buttons, and the
    // thing those buttons change has to still be there.
    assert.ok(
      seen.ringTop >= 0 && seen.ringBottom <= seen.window,
      `with the Drive panel at y=${seen.driveTop}, the ring spans ${seen.ringTop}–${seen.ringBottom} ` +
        `in a ${seen.window}px window`,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
  });

  it("offers every action as a verb with what it costs, and says nothing until asked", async (t) => {
    if (why) return t.skip(why);
    const drive = await page.evaluate(() => {
      const line = (el) => parseFloat(getComputedStyle(el).lineHeight) || 16;
      return {
        life: document.getElementById("drive-life")?.textContent?.trim() ?? "",
        hidden: document.getElementById("drive-status")?.hidden ?? null,
        state: document.getElementById("drive-status")?.dataset.state ?? null,
        cards: [...document.querySelectorAll("#drive button")].map((b) => {
          const label = b.querySelector(".action-label");
          const sub = b.querySelector(".action-sub");
          return {
            label: label?.textContent?.trim() ?? null,
            sub: sub?.textContent?.trim() ?? null,
            subLines: sub ? Math.round(sub.getBoundingClientRect().height / line(sub)) : 0,
            height: Math.round(b.getBoundingClientRect().height),
          };
        }),
      };
    });

    assert.equal(drive.cards.length, 5, "five actions are offered");
    for (const card of drive.cards) {
      assert.ok(card.label, `a card with no verb: ${JSON.stringify(card)}`);
      // The sub-line is not decoration. `tick 64` and `tick 32` differ by one digit; what makes
      // them two different decisions is the cost under the label.
      assert.ok(card.sub, `"${card.label}" does not say what it costs`);
      assert.equal(card.subLines, 1, `"${card.label}" has a sub-line that wrapped`);
    }

    // The one number a reader wants before clicking.
    assert.match(drive.life, /\d/, `the life readout says ${JSON.stringify(drive.life)}`);

    // Nothing has happened yet, so there is nothing to report. An empty box that is always there
    // reads as a broken one.
    assert.equal(drive.hidden, true, "the outcome box is hidden until a click produces one");
    assert.equal(drive.state, null, "and it has no state to colour");
  });

  it("colours the outcome by what happened, not by the words", async (t) => {
    if (why) return t.skip(why);
    // The three states, forced rather than produced. Producing them means spending testnet CKB and
    // waiting on a node; the colours are a property of the stylesheet, and that is what is checked.
    const dots = await page.evaluate(() => {
      const el = document.getElementById("drive-status");
      const out = {};
      for (const state of ["busy", "ok", "bad"]) {
        el.hidden = false;
        el.dataset.state = state;
        out[state] = getComputedStyle(el, "::before").backgroundColor;
      }
      el.hidden = true;
      delete el.dataset.state;
      return out;
    });
    const colours = Object.values(dots);
    for (const [state, colour] of Object.entries(dots)) {
      assert.match(
        colour,
        /^rgb\(/,
        `the ${state} dot is ${colour} — the state has no colour of its own`,
      );
    }
    assert.equal(new Set(colours).size, 3, `the three states share a colour: ${JSON.stringify(dots)}`);
  });

  it("redraws the Drive cards when the language changes", async (t) => {
    if (why) return t.skip(why);
    // `renderDrive` draws these, so `applyLanguage` cannot reach them — it only fills the elements
    // that carry `data-i18n`. The renderer has to be on `onLanguage`, and a missing entry there is
    // invisible until someone switches language.
    await choose(page, "zh");
    const zh = await page.evaluate(() =>
      [...document.querySelectorAll("#drive button .action-label")].map((e) => e.textContent),
    );
    await choose(page, "en");
    const en = await page.evaluate(() =>
      [...document.querySelectorAll("#drive button .action-label")].map((e) => e.textContent),
    );
    assert.notDeepEqual(zh, en, "the cards are the same in both languages");
    assert.deepEqual(en, ["tick 64", "tick 32", "feed 10,000", "cue, wedge 4", "shock"]);
    await choose(page, "zh");
  });

  it("logs no errors while all of that happens", async (t) => {
    if (why) return t.skip(why);
    // Collected from the start of the run. A page that renders correctly while throwing in a
    // renderer is a page that will render incorrectly the next time something changes.
    const failures = [];
    const fresh = await browser.newPage({ viewport: VIEWPORT });
    fresh.on("pageerror", (e) => failures.push(String(e)));
    fresh.on("console", (m) => {
      if (m.type() === "error") failures.push(m.text());
    });
    await fresh.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await fresh.waitForFunction(() => document.querySelector("#identity")?.children.length > 0, {
      timeout: 30000,
    });
    await choose(fresh, "en");
    await choose(fresh, "zh");
    await fresh.close();
    assert.deepEqual(failures, [], `the page logged errors: ${failures.join("; ")}`);
  });
});
