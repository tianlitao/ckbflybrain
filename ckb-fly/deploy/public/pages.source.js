/**
 * The two prose pages, and the only script they need.
 *
 * `about.html` and `guide.html` are text: a reader arrives, reads, and either goes back or does
 * not. What they need from JavaScript is the language switch and the dictionary, which is
 * `i18n-dom.source.js` and nothing else — no wallet, no chain, no `flywasm`.
 *
 * That is why this is a second bundle rather than a second entry into `app.js`: `app.js` carries
 * CCC and every wallet adapter (2.9 MB) because a page that can *drive* the fly needs them, and a
 * page that explains a ring attractor does not. `pages.js` is the dictionary and the switch.
 *
 * @module pages
 */

import { applyLanguage, initLanguage, onLanguage, renderLanguageSwitch } from "./i18n-dom.source.js";
import { t } from "./i18n.source.js";

// Each page says which it is, so the tab keeps saying the right thing after a language switch —
// `initLanguage` sets a single title, and "CKB Fly" on both tabs would be a small lie about which
// page a reader has open.
const here = document.documentElement.dataset.page;
const titleKey = here === "guide" ? "doc.titleGuide" : "doc.titleAbout";
const setTitle = () => {
  document.title = t(titleKey);
};

initLanguage();
applyLanguage();
setTitle();
renderLanguageSwitch();
onLanguage(setTitle);
