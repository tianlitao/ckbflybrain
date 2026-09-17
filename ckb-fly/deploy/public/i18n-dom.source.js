/**
 * The DOM half of i18n: applying a language to the page, and the switch that changes it.
 *
 * `i18n.source.js` holds the dictionaries and knows nothing about the document — that is what
 * lets a test import it and check the two languages against each other. This module is the
 * other half: it walks `[data-i18n]`, renders the switch, remembers the choice, and tells
 * whoever drew the dynamic parts to draw them again.
 *
 * # The static half and the dynamic half
 *
 * Everything written directly in `index.html` carries `data-i18n` (or `data-i18n-html` for the
 * captions that carry markup — a `<strong>` lead, or a `<code>` for a script's name) and is
 * filled from here. Everything drawn in JavaScript — the panels, the roster, the timeline, the
 * notes — is redrawn by its own renderer when the language changes, because only it knows what it
 * drew. `onLanguage` is that signal; the page re-runs its renderers and does not need to know
 * which strings exist.
 *
 * @module i18n-dom
 */

import { lang, locale, setLang, t } from "./i18n.source.js";

export { lang, locale, t };

const STORAGE = "ckbfly.lang";
const listeners = [];

/**
 * The language to start in: what the reader last chose, else what the browser asks for.
 *
 * `localStorage` can throw in a sandboxed frame or a partitioned context, and a page that will
 * not load because it could not read a preference is worse than a page in the wrong language.
 */
export function initLanguage() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE);
  } catch {
    /* the browser will not tell us; the preferred language is still fine */
  }
  if (stored === "en" || stored === "zh") {
    setLang(stored);
  }
  document.documentElement.lang = lang() === "zh" ? "zh-Hans" : "en";
  document.title = t("doc.title");
  return lang();
}

/** Fill every `[data-i18n]` and `[data-i18n-html]` element in the document. */
export function applyLanguage() {
  document.documentElement.lang = lang() === "zh" ? "zh-Hans" : "en";
  document.title = t("doc.title");
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-html]")) {
    // The dictionary is a local literal, not user input — the `<strong>`, `<em>` and `<code>` tags
    // in the captions and the two prose pages are the only markup any of these strings contains.
    // Anything that ever interpolates into one of these keys would have to be escaped first;
    // nothing does.
    el.innerHTML = t(el.dataset.i18nHtml);
  }
}

/** Redraw the switch. Called on load and on every change, because it shows which one is active. */
export function renderLanguageSwitch() {
  const target = document.getElementById("lang-switch");
  if (!target) {
    return;
  }
  target.innerHTML = "";
  for (const code of ["en", "zh"]) {
    const button = document.createElement("button");
    button.className = code === lang() ? "lang active" : "lang";
    button.textContent = code === "en" ? "EN" : "中文";
    button.setAttribute("aria-pressed", String(code === lang()));
    button.addEventListener("click", () => choose(code));
    target.append(button);
  }
}

function choose(code) {
  if (code === lang()) {
    return;
  }
  setLang(code);
  try {
    localStorage.setItem(STORAGE, code);
  } catch {
    /* the choice lasts for this page view instead of forever, which is not worth failing over */
  }
  applyLanguage();
  renderLanguageSwitch();
  for (const fn of listeners) {
    fn(code);
  }
}

/**
 * Called after the language changes, so the page can redraw what it drew itself.
 *
 * The static strings are already handled by `applyLanguage`; this is for the panels, the
 * roster, the timeline, and every sentence with a number in it.
 */
export function onLanguage(fn) {
  listeners.push(fn);
}
