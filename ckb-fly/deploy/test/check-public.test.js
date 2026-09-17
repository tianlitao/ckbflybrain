/**
 * The refusals in `check-public.mjs`, which is what `serve-public.sh` used to be for.
 *
 * The page is a static directory now, so nothing of ours runs when it is served — which means
 * the two mistakes that used to be caught at startup are no longer caught by anything at all.
 * Uploading a directory cannot fail: the host takes every file, and the cost is paid by a
 * reader whose browser opens a page that loads and then reads nothing.
 *
 * Both are *invisible* until they have already cost something:
 *
 *   * **A dev chain in `deployment.json`.** The network is inferred from the RPC URL, so
 *     `127.0.0.1` reads as "the dev chain" — and a published page naming it is a page with no
 *     chain to read.
 *   * **The missing build products.** `app.js` and `flywasm.wasm` are not in git, so a fresh
 *     clone has a directory that looks complete and is not.
 *
 * Nothing here needs a chain, a node or a port — `publishProblems()` reads a directory — so
 * these are checks a guard can actually run, rather than paragraphs in a README.
 *
 *     node --test test/check-public.test.js
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { publishProblems } from "../check-public.mjs";
import { REQUIRED } from "../src/static-page.js";

/** A directory shaped like `public/`, with only the named files actually in it. */
function fakePublic({ config, omit = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "fly-public-"));
  for (const name of REQUIRED) {
    if (!omit.includes(name)) writeFileSync(join(dir, name), "x");
  }
  if (config !== undefined) {
    writeFileSync(join(dir, "deployment.json"), JSON.stringify(config));
  }
  return dir;
}

const PREVIEW = {
  network: "https://testnet.ckb.dev/",
  params: "v1",
  economics: "testnet",
  codeCells: {},
  fly: { instance: 1, typeHash: "0x" + "11".repeat(32) },
};

describe("check-public refuses a directory that would publish a page reading nothing", () => {
  it("names the command that builds each missing artifact", () => {
    // Both are build products and neither is in git, so a fresh clone hits them. The check is
    // worth having only if the message says what to run — otherwise it is the same 404 the
    // browser would have produced on its own.
    const problems = publishProblems(fakePublic({ config: PREVIEW, omit: REQUIRED }));
    assert.equal(problems.length, 1, "one problem, not one per file");
    assert.match(problems[0], /app\.js/);
    assert.match(problems[0], /flywasm\.wasm/);
    assert.match(problems[0], /make build-front-end/);
  });

  it("asks for the config by name, because it is the one thing the page cannot discover", () => {
    const problems = publishProblems(fakePublic({ omit: ["deployment.json"] }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /make publish-config/);
  });

  it("refuses a loopback chain, which is the same mistake as no chain at all", () => {
    for (const network of ["http://127.0.0.1:8114", "http://localhost:8114", "http://[::1]:8114"]) {
      const problems = publishProblems(fakePublic({ config: { ...PREVIEW, network } }));
      assert.equal(problems.length, 1, `${network} must be refused`);
      assert.match(problems[0], /dev chain/);
      // The message has to name the consequence and the way out, not just the wrong value.
      assert.match(problems[0], /make publish-config/);
    }
  });

  it("refuses a config that does not say which chain, rather than guessing", () => {
    const problems = publishProblems(fakePublic({ config: { ...PREVIEW, network: "" } }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /no `network`/);
  });

  it("says nothing about a directory that is ready", () => {
    // The point of the positive case is that the guards are narrow: a check that refused
    // everything would pass all four tests above and be useless.
    assert.deepEqual(publishProblems(fakePublic({ config: PREVIEW })), []);
  });
});
