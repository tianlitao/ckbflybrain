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
 *     buttons can still see the ring those buttons move. Sticky has silent preconditions — the
 *     element has to be shorter than the window, and it has to have somewhere to travel — and if
 *     one stops holding, the page still renders and the ring simply scrolls away. The
 *     preconditions are also not fully explicable from the CSS: the stylesheet's own explanation
 *     held in two columns and was simply wrong in one. So this asserts the reader's consequence
 *     instead, at both widths: with the Drive panel at the foot of the window, the whole ring is
 *     on screen.
 *   * **The Drive cards.** Each is a verb and what it costs. The sub-line is the part that
 *     distinguishes `tick 64` from `tick 32`, and a sub-line that has wrapped onto a second line
 *     is a card that no longer reads as a pair.
 *
 * It reads, scrolls and measures. It signs nothing, spends nothing, and needs no key.
 *
 *     node --test test/panel-live.test.js
 *
 * Environment: `FLY_PANEL_URL`, to point at a page served somewhere else. Without it the test
 * serves `deploy/public/` itself, because a static directory is all the page needs now that it
 * reads the chain directly. Skips when there is no browser, or no `public/app.js` to serve — the
 * same way the Rust integration suite skips without `FLY_REQUIRE_CONTRACT`.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { existsSync } from "node:fs";

import { bundleExists, startStaticPage } from "./static-page.js";

/**
 * Where the page comes from. `FLY_PANEL_URL` for one served somewhere else; otherwise `before`
 * starts a static server over `public/` and points this at it.
 *
 * @type {string|null}
 */
let PAGE = process.env.FLY_PANEL_URL ?? null;

/** The server `PAGE` points at, when this test started it. */
let served = null;

/**
 * The two widths a reader might actually have. 980px is where the stylesheet collapses to one
 * column, and the ring has to survive that — it is not a decoration that can be dropped on a
 * laptop, it is the only feedback a click has. The height is the same for both so that a failure
 * means the width did it.
 */
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 900, height: 900 },
];

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
  // Probed here rather than in `before` so the skip names the missing bundle: `public/app.js` is
  // built by `make build-front-end` and is deliberately not in the repository, so a fresh checkout
  // has no page to serve and that has to read as a skip rather than as a broken test.
  if (!process.env.FLY_PANEL_URL && !bundleExists()) {
    return "public/app.js is missing; run `make build-front-end`";
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
    if (!PAGE) {
      served = await startStaticPage();
      PAGE = served.url;
    }
    const { chromium } = await import(PLAYWRIGHT);
    browser = await chromium.launch({
      headless: true,
      // curl and Node read HTTPS_PROXY from the environment; a browser does not.
      args: process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [],
      executablePath: chromiumPath(),
    });
    page = await browser.newPage({ viewport: VIEWPORTS[0] });
    // `networkidle` never fires — the page polls the node every few seconds — so wait for
    // something the app renders instead.
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
    await served?.close();
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
    // Both widths are measured before anything is asserted. The two layouts reach the ring by
    // different mechanisms — the stylesheet's explanation of one is wrong for the other — so a run
    // that stops at the first failure would report half the story and hide the half that broke.
    const complaints = [];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
      const where = `${viewport.width}×${viewport.height}`;

      const fits = await page.evaluate(() => {
        const canvas = document.getElementById("ring").getBoundingClientRect();
        return { ring: Math.round(canvas.height), window: window.innerHeight };
      });
      // The precondition for `position: sticky` doing anything at all: an element taller than the
      // window has nowhere to stick to, and `top: 16px` on it is a no-op.
      if (fits.ring >= fits.window) {
        complaints.push(
          `at ${where} the ring is ${fits.ring}px tall in a ${fits.window}px window: it cannot stick`,
        );
        continue;
      }

      const seen = await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 150));
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
      // The assertion is about the reader, not about the CSS: they scrolled to the buttons, and
      // the thing those buttons change has to still be there.
      if (!(seen.ringTop >= 0 && seen.ringBottom <= seen.window)) {
        complaints.push(
          `at ${where}, with the Drive panel at y=${seen.driveTop}, the ring spans ` +
            `${seen.ringTop}–${seen.ringBottom} in a ${seen.window}px window`,
        );
      }
    }

    // Put the page back the way the other tests expect to find it, pass or fail.
    await page.setViewportSize(VIEWPORTS[0]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);

    assert.deepEqual(complaints, [], "the ring is not where the reader can watch it");
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

  it("renders the bold leads as markup, not as tags a reader can see", async (t) => {
    if (why) return t.skip(why);
    // The other half of what `i18n.test.js` checks. That one proves the dictionary carries a lead
    // and that the markup declares which keys are HTML; this proves the page honours the
    // declaration. Both are needed: the failure this guards against is a string containing
    // `<strong>` reaching an element filled with `textContent`, which puts the angle brackets on
    // the screen — and that has happened here, caught from a screenshot with every test green.
    for (const code of ["zh", "en"]) {
      await choose(page, code);
      const found = await page.evaluate(() => {
        // `[data-i18n-html]` is the DOM filler's half; the two ids are the renderers' half.
        const els = [
          ...document.querySelectorAll("[data-i18n-html]"),
          document.getElementById("wallet-note"),
          document.getElementById("drive-note"),
        ].filter(Boolean);
        return els.map((el) => ({
          key: el.dataset.i18nHtml ?? el.id,
          strongs: el.querySelectorAll("strong").length,
          literal: /<\/?(strong|em|code|b|i)>/.test(el.textContent),
        }));
      });

      assert.ok(found.length >= 8, `${code}: only ${found.length} lead-bearing elements found`);
      const bad = found.filter((f) => f.strongs === 0 || f.literal);
      assert.deepEqual(
        bad.map((f) => `${f.key} strong=${f.strongs} literal=${f.literal}`),
        [],
        `${code}: these leads did not render as markup`,
      );
    }
    await choose(page, "zh");
  });

  it("spends the width the panels give it, in both tables", async (t) => {
    if (why) return t.skip(why);
    // A grid of fixed tracks with no flexible one puts its content on the left and leaves the
    // remainder as a hole on the right — and the row rules still run the full width, so the table
    // reads as left-shifted rather than as narrow. The roster's nine tracks came to 908px inside a
    // 1242px row, which left 325px of dead space beside every value on the page a reader is
    // comparing down a column. Nothing about that is visible in the stylesheet.
    const complaints = [];
    for (const [name, rowSel] of [
      ["roster", "#roster li"],
      ["timeline", "#timeline li"],
    ]) {
      const seen = await page.evaluate((sel) => {
        const li = document.querySelector(sel);
        if (!li) return null;
        const cs = getComputedStyle(li);
        const b = li.getBoundingClientRect();
        const kids = [...li.children];
        if (!kids.length) return null;
        return {
          slackRight: Math.round(b.right - parseFloat(cs.paddingRight) - Math.max(...kids.map((k) => k.getBoundingClientRect().right))),
          slackLeft: Math.round(Math.min(...kids.map((k) => k.getBoundingClientRect().left)) - (b.left + parseFloat(cs.paddingLeft))),
        };
      }, rowSel);
      if (!seen) {
        complaints.push(`${name}: no row to measure`);
        continue;
      }
      // One pixel is rounding; more than that is a column that did not stretch.
      if (seen.slackRight > 2) complaints.push(`${name}: ${seen.slackRight}px of dead space on the right`);
      if (seen.slackLeft > 2) complaints.push(`${name}: ${seen.slackLeft}px of dead space on the left`);
    }
    assert.deepEqual(complaints, [], "a table does not use the width it is given");
  });

  it("keeps every paragraph within the measure of the page's own lead", async (t) => {
    if (why) return t.skip(why);
    // The opening paragraph sets the measure and nothing else may exceed it. This is the one
    // comparison that gets the relationship the right way round: a caption is *smaller* text, and
    // smaller text tolerates less line length rather than more. The captions were `92ch` against
    // the standfirst's `62ch`, so every panel's explanation ran 48% longer per line than the page's
    // own introduction — around 90 Latin characters, or 58 Chinese ones, which is past the point
    // where a reader starts re-reading lines to find their place.
    for (const code of ["zh", "en"]) {
      await choose(page, code);
      const seen = await page.evaluate(() => {
        const lead = document.querySelector(".standfirst");
        const blocks = [lead, ...document.querySelectorAll(".caption")].filter(Boolean);
        return {
          lead: Math.round(lead.getBoundingClientRect().width),
          blocks: blocks.map((el) => ({
            id: el.id || el.dataset.i18nHtml || "standfirst",
            w: Math.round(el.getBoundingClientRect().width),
            px: parseFloat(getComputedStyle(el).fontSize),
          })),
        };
      });
      const over = seen.blocks.filter((b) => b.w > seen.lead + 1);
      assert.deepEqual(
        over.map((b) => `${b.id} is ${b.w}px at ${b.px}px against a ${seen.lead}px lead`),
        [],
        `${code}: these paragraphs are wider than the page's opening paragraph`,
      );
    }
    await choose(page, "zh");
  });

  it("logs no errors while all of that happens", async (t) => {
    if (why) return t.skip(why);
    // Collected from the start of the run. A page that renders correctly while throwing in a
    // renderer is a page that will render incorrectly the next time something changes.
    const failures = [];
    const fresh = await browser.newPage({ viewport: VIEWPORTS[0] });
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
