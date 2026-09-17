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
    assert.equal(t("wallet.connect", { name: "CKB" }), "连接 CKB");
    setLang("en");
    assert.equal(t("roster.step", { n: "0xf6a509c8" }), "step 0xf6a509c8");
    assert.equal(t("wallet.connect", { name: "CKB" }), "connect CKB");
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
