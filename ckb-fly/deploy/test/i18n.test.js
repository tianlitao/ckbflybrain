/**
 * The two dictionaries, checked against each other.
 *
 * This is the whole reason `i18n.source.js` is a module with no DOM in it: the failure mode of
 * a translated page is not a crash, it is one string in the wrong language. A key that exists in
 * English and not in Chinese renders as English (by fallback), and a key that exists in neither
 * renders as the key itself — and both look perfectly fine to whoever is checking, because they
 * are reading one language and the page is mostly right.
 *
 * The test cannot tell whether a translation is *good*. It can tell whether one is *missing*, and
 * that is the half that rots silently.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { EN, ZH, lang, locale, missingKeys, setLang, t } from "../public/i18n.source.js";

describe("the two languages", () => {
  it("have exactly the same keys", () => {
    const { inEnglishOnly, inChineseOnly } = missingKeys();
    assert.deepEqual(inEnglishOnly, [], "keys added in English and not translated");
    assert.deepEqual(inChineseOnly, [], "keys with no English original to fall back to");
  });

  it("do not define any key twice, which loses a string silently", () => {
    // Read from the source rather than from the imported objects, because by the time JavaScript
    // has evaluated the literal the duplicate is gone: the *second* definition wins and the first
    // string simply does not exist. This happened: `life.heading` was both the panel's title and
    // the name of the "heading" row inside it, so the panel was headed "heading" in English and
    // "朝向" in Chinese. It looked like a styling oddity, and no test that inspects the objects
    // can see it.
    const source = readFileSync(new URL("../public/i18n.source.js", import.meta.url), "utf8");
    const [english, chinese] = source.split("const ZH = {");
    for (const [name, text] of [
      ["en", english],
      ["zh", chinese],
    ]) {
      const keys = [...text.matchAll(/^\s{2}"([^"]+)":/gm)].map((m) => m[1]);
      const seen = new Set();
      const duplicated = keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
      assert.deepEqual([...new Set(duplicated)], [], `${name} defines these keys twice`);
    }
  });

  it("say something in every one of them", () => {
    for (const [name, dict] of [
      ["en", EN],
      ["zh", ZH],
    ]) {
      for (const [key, value] of Object.entries(dict)) {
        assert.equal(typeof value, "string", `${name}:${key} is not a string`);
        assert.ok(value.trim().length > 0, `${name}:${key} is empty`);
      }
    }
  });

  it("use the same placeholders in both, because a lost one renders as `{name}`", () => {
    const placeholders = (text) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(EN)) {
      assert.deepEqual(
        placeholders(ZH[key]),
        placeholders(EN[key]),
        `${key}: the two languages interpolate different things`,
      );
    }
  });

  it("does not translate the values that go into a sentence", () => {
    // The substituted values are addresses, hashes, numbers and wallet names. A translator who
    // localises one of those has broken the page in a way no dictionary can express, so this
    // pins the shape: the parameter is passed straight through.
    setLang("zh");
    assert.equal(t("roster.step", { n: "0xf6a509c8" }), "第 0xf6a509c8 步");
    assert.equal(
      t("wallet.connected", { address: "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt" }),
      "已连接 ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt…",
    );
    setLang("en");
    assert.equal(t("roster.step", { n: "0xf6a509c8" }), "step 0xf6a509c8");
    assert.equal(
      t("wallet.connected", { address: "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt" }),
      "connected ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt…",
    );
  });

  it("renders the same bold lead in both languages, and only where the markup says so", () => {
    // Two files decide this and nothing was making them agree. `index.html` marks the elements it
    // fills with `innerHTML` (`data-i18n-html`); `i18n.source.js` holds the strings. A key given a
    // `<strong>` lead in one language and not the other is invisible to every other test in this
    // file — the dictionaries still have the same keys, the same placeholders and no empty values —
    // and it is invisible to a reader too, who only ever reads one of the two languages. Three keys
    // were in exactly that state when this was written.
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const declared = new Set([
      ...[...html.matchAll(/data-i18n-html="([^"]+)"/g)].map((m) => m[1]),
      // Rendered by a renderer rather than by the DOM filler, because the choice depends on state:
      // `wallet.noteConnected` / `wallet.noteOffered` in `renderWallet`, and the four `drive.note*`
      // through `renderDrive`'s `lead()` helper. They have to be listed because a key that appears
      // only in JavaScript cannot be found by scanning the markup — and if one is added and left
      // off this list, the last assertion below fails rather than the key going quietly unchecked.
      "wallet.noteConnected",
      "wallet.noteOffered",
      "drive.noteWallet",
      "drive.notePublic",
      "drive.notePrivate",
      "drive.noteNoDrive",
    ]);

    const codeSpans = (text) => [...text.matchAll(/<code>(.*?)<\/code>/g)].map((m) => m[1]);
    const complaints = [];
    for (const key of declared) {
      for (const [name, dict] of [
        ["en", EN],
        ["zh", ZH],
      ]) {
        const value = dict[key];
        if (value === undefined) {
          complaints.push(`${name}:${key} does not exist`);
          continue;
        }
        // A lead is the sentence that opens the paragraph, so it has to open the string.
        if (!value.startsWith("<strong>")) {
          complaints.push(`${name}:${key} does not open with a bold lead`);
        }
        if (!value.includes("</strong>")) {
          complaints.push(`${name}:${key} opens a <strong> and never closes it`);
        }
      }
      // The `<code>` spans are compared because they hold the technical nouns, which this project
      // does not translate — `flyworld` is `flyworld` in both. The `<strong>` lead is compared
      // above. `<em>` deliberately is not: it marks emphasis on a word, and where English stresses
      // one the Chinese may carry the stress lexically instead — `backing.caption` says
      // "its capacity <em>is</em> its body" and 「它的容量就是它的身体」. Demanding tag parity
      // there would force the translator to add an emphasis the sentence does not need.
      if (EN[key] !== undefined && ZH[key] !== undefined) {
        const [enCode, zhCode] = [codeSpans(EN[key]), codeSpans(ZH[key])];
        if (enCode.join() !== zhCode.join()) {
          complaints.push(`${key}: en marks [${enCode}] as code and zh marks [${zhCode}]`);
        }
      }
    }
    assert.deepEqual(complaints, [], "a declared lead is missing or malformed in one language");

    // The other direction, and what makes the list above self-enforcing: markup in a key that
    // nothing declares as HTML renders as literal angle brackets on the page, because those
    // elements are filled with `textContent`. That is not hypothetical — it is how the missing
    // `data-i18n-html` on two captions was noticed, from a screenshot, with every test green.
    const undeclared = [];
    for (const key of Object.keys(EN)) {
      if (declared.has(key)) continue;
      for (const [name, dict] of [
        ["en", EN],
        ["zh", ZH],
      ]) {
        if (/<[a-z/]/.test(dict[key] ?? "")) undeclared.push(`${name}:${key}`);
      }
    }
    assert.deepEqual(undeclared, [], "these carry markup but nothing renders them as HTML");

    // The one key that must never carry any, named so the reason survives: it interpolates a
    // refusal reason that came from the server, and a server-supplied string goes in as text.
    assert.ok(!/<[a-z/]/.test(EN["drive.disabled"]), "drive.disabled interpolates a server string");
  });

  it("falls back to English rather than to a hole", () => {
    setLang("zh");
    assert.equal(t("this.key.does.not.exist"), "this.key.does.not.exist");
    assert.equal(t("doc.title"), ZH["doc.title"]);
    setLang("en");
  });

  it("carries the locale with it, because numbers follow the language", () => {
    setLang("zh");
    assert.equal(locale(), "zh-CN");
    setLang("en");
    assert.equal(locale(), "en-US");
    assert.equal(lang(), "en");
  });

  it("refuses a language it does not have", () => {
    // Guessing here would mean a page that quietly renders English for a reader who asked for
    // something the page has never heard of.
    assert.throws(() => setLang("fr"), /unknown language/);
  });
});
