/**
 * The browser's driving path, end to end, against a real chain.
 *
 * `wallet.source.js` is what a visitor's click runs: ask the server for an unsigned transaction,
 * pay the fee from the visitor's own coins, sign, and send. Every unit test in this directory
 * stops at the server's half of that — `POST /api/prepare` — because the rest needs a signer, a
 * funded address, and a chain to land on.
 *
 * JoyID's passkey ceremony is the one part a machine cannot perform. Everything *after* it is the
 * same code for every signer, because CCC's `Signer` interface is what JoyID and a private key
 * both implement. So this drives the real `createWallet().drive()` in a real browser with a
 * private key standing in, which covers the parts a mock cannot:
 *
 *   * `completeFeeBy` adding the visitor's inputs — and **rewriting the witness list**, which is
 *     why the action is re-set afterwards. Skip that and the node accepts a transaction the type
 *     script refuses with `MissingWitness`, which says nothing about what went wrong.
 *   * the signed-matches-given check, which exists because `Transaction.from` silently decodes a
 *     hex string into an *empty* transaction.
 *   * the broadcast, and the chain actually showing the transition.
 *
 * It spends real testnet CKB and advances a public fly, so it is opt-in: set `FLY_DRIVE_LIVE=1`.
 * Without it the test skips, the same way the Rust integration suite skips without
 * `FLY_REQUIRE_CONTRACT`.
 *
 *     FLY_DRIVE_LIVE=1 node --test test/drive-live.test.js
 *
 * Environment: `FLY_DRIVE_URL` (default `http://127.0.0.1:8898/`), `FLY_VISITOR_KEY_FILE`
 * (default `.key.visitor`), `FLY_DRIVE_RPC` (default the preview testnet).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

/** `deploy/`, so esbuild finds both the source and the installed packages. */
const DEPLOY = join(dirname(fileURLToPath(import.meta.url)), "..");

const PAGE = process.env.FLY_DRIVE_URL ?? "http://127.0.0.1:8898/";
const RPC = process.env.FLY_DRIVE_RPC ?? "https://testnet.ckb.dev/rpc";
const KEY_FILE =
  process.env.FLY_VISITOR_KEY_FILE ?? join(process.cwd(), ".key.visitor");

/** Playwright lives outside this project, so its absence is a skip rather than a failure. */
const PLAYWRIGHT = "/Users/mac/node_modules/playwright-core/index.mjs";

/**
 * Why this test cannot run, or `null` if it can.
 *
 * Collected rather than thrown one at a time: a reader who has none of the prerequisites should
 * see the whole list in one line, not discover them one run at a time.
 */
async function unavailable() {
  if (!process.env.FLY_DRIVE_LIVE) {
    return "FLY_DRIVE_LIVE is not set (this spends testnet CKB and advances a public fly)";
  }
  if (!existsSync(PLAYWRIGHT)) return `playwright-core is not at ${PLAYWRIGHT}`;
  if (!existsSync(KEY_FILE)) return `no visitor key at ${KEY_FILE}`;

  try {
    const res = await fetch(new URL("/api/fly", PAGE), { signal: AbortSignal.timeout(5000) });
    const snap = await res.json();
    if (!snap.meta?.drivable) return `the indexer at ${PAGE} is not offering a drivable fly`;
    if (snap.meta?.as === "server" && !snap.meta?.drive) {
      return `the indexer at ${PAGE} has driving disabled`;
    }
  } catch (err) {
    return `no indexer at ${PAGE} (${err.message})`;
  }
  return null;
}

/**
 * Bundle `wallet.source.js` for the browser.
 *
 * It imports `@ckb-ccc/joy-id`, which touches `window` at module scope, so it cannot be imported
 * from Node at all — bundling is the only way to exercise the real module rather than a copy of
 * it. The entry is written to a temp directory so the test runner does not pick it up as a test,
 * and both paths are absolute because esbuild resolves relative to the entry file, not to the
 * working directory — a temp entry with a relative import resolves to nothing.
 */
async function buildHarness(esbuild) {
  const entry = join(tmpdir(), `fly-harness-entry-${process.pid}.js`);
  writeFileSync(
    entry,
    [
      'import * as ccc from "@ckb-ccc/core";',
      // The second import is not a convenience. The connector's wallet adapters are built on
      // their **own** nested copy of core — `@ckb-ccc/connector@1.3.0` depends on `ccc@1.3.0`,
      // which pins core 1.19.1, while this page is on 1.21.0 — so a signer the connector hands
      // out is not an instance of the `Transaction` this page builds. Importing the umbrella
      // here is the only way to get a signer from that other copy without installing it twice by
      // hand, and the second test below is what makes the mismatch visible.
      'import * as connectorCcc from "@ckb-ccc/ccc";',
      `import { createWallet } from ${JSON.stringify(join(DEPLOY, "public", "wallet.source.js"))};`,
      "globalThis.__flyTest = { ccc, connectorCcc, createWallet };",
    ].join("\n"),
  );

  const built = await esbuild.build({
    entryPoints: [entry],
    absWorkingDir: DEPLOY,
    // esbuild finds a bare import by walking up from the *importing file*, and the importing file
    // is in the temp directory — so `@ckb-ccc/core` is not reachable by that route. `nodePaths`
    // says where to look instead.
    nodePaths: [join(DEPLOY, "node_modules")],
    bundle: true,
    format: "iife",
    write: false,
  });
  return built.outputFiles[0].text;
}

/** Chromium's location, which playwright-core 1.49.1 cannot work out on its own. */
function chromiumPath() {
  return [
    process.env.CHROME_PATH,
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => p && existsSync(p));
}

describe("driving the fly from the browser", () => {
  /**
   * One click of "tick 64", through the real page, with a signer from the named copy of core.
   *
   * The whole reason this is a browser test is the page's own code: `wallet.drive()` fetches a
   * relative URL, so it has to run on the indexer's origin, and it is the code a visitor's click
   * runs rather than a re-implementation of it.
   *
   * @param {"ours"|"connectors"} whichCore `ours` is this page's core 1.21.0; `connectors` is the
   *   nested 1.19.1 that `@ckb-ccc/connector` builds its wallet adapters on.
   */
  async function tick64(whichCore) {
    const { chromium } = await import(PLAYWRIGHT);
    const esbuild = await import("esbuild");
    const harness = await buildHarness(esbuild);

    const browser = await chromium.launch({
      headless: true,
      // curl and Node read HTTPS_PROXY from the environment; a browser does not, and without this
      // the page cannot reach anything outside localhost.
      args: process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [],
      executablePath: chromiumPath(),
    });

    try {
      const page = await browser.newPage();
      const failures = [];
      page.on("pageerror", (e) => failures.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") failures.push(m.text());
      });

      // The real page, because `drive()` fetches a relative URL and has to share an origin with
      // the indexer. `networkidle` never fires — the page holds an SSE connection open — so wait
      // for something the app renders instead.
      await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForFunction(() => document.querySelector("#identity")?.children.length > 0, {
        timeout: 30000,
      });

      const before = await page.evaluate(() =>
        fetch("/api/fly")
          .then((r) => r.json())
          .then((d) => ({
            typeHash: d.watching,
            step: BigInt(d.current.state.step),
            energy: BigInt(d.current.state.energy),
          })),
      );

      await page.addScriptTag({ content: harness });
      const key = readFileSync(KEY_FILE, "utf8").trim();

      const result = await page.evaluate(
        async ({ key, rpc, whichCore }) => {
          const { ccc, connectorCcc, createWallet } = globalThis.__flyTest;
          const wallet = createWallet(rpc);
          // The private key stands in for the passkey a human would tap. Everything after it —
          // `completeFeeBy`, the action in witness 0, the sign, the broadcast — is the same code
          // for every signer, which is the property that makes this testable at all.
          const core = whichCore === "ours" ? ccc : connectorCcc;
          const client = new core.ClientPublicTestnet({ url: rpc, fallbacks: [] });
          const signer = new core.SignerCkbPrivateKey(client, key);
          // `adopt`, not `connect`: this is the entry the connector's picker uses, and the one
          // that skips `signer.connect()` because the connector already did it.
          await wallet.adopt({ name: whichCore, signer });
          try {
            const out = await wallet.drive({ kind: "tick", steps: 64 });
            return { ok: true, address: wallet.address(), txHash: out.txHash };
          } catch (err) {
            return { ok: false, error: String(err?.message ?? err) };
          }
        },
        { key, rpc: RPC, whichCore },
      );

      assert.ok(result.ok, `drive() failed: ${result.error}`);
      assert.match(result.txHash, /^0x[0-9a-f]{64}$/, "a transaction hash came back");
      assert.equal(failures.length, 0, `the page logged errors: ${failures.join("; ")}`);

      // The transition has to appear on chain, not merely be accepted by the node. The indexer
      // walks the fly's chain of state cells, so seeing it there is seeing the real thing.
      let after = before;
      for (let i = 0; i < 20 && after.step === before.step; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        after = await page.evaluate(() =>
          fetch("/api/fly")
            .then((r) => r.json())
            .then((d) => ({
              typeHash: d.watching,
              step: BigInt(d.current.state.step),
              energy: BigInt(d.current.state.energy),
            })),
        );
      }

      assert.equal(after.typeHash, before.typeHash, "the same organism");
      assert.equal(after.step, before.step + 64n, "the fly advanced exactly 64 steps");
      assert.equal(after.energy, before.energy - 64n, "and spent exactly 64 steps of life");
    } finally {
      await browser.close();
    }
  }

  it("pays, signs, broadcasts, and the chain shows the transition", async (t) => {
    const why = await unavailable();
    if (why) {
      t.skip(why);
      return;
    }
    await tick64("ours");
  });

  it("does the same with a signer built on the connector's own copy of core", async (t) => {
    // Two copies of `@ckb-ccc/core` are installed — this page's 1.21.0, and the 1.19.1 that
    // `@ckb-ccc/connector@1.3.0` pulls in through `ccc@1.3.0` — and the connector's picker hands
    // out signers from the second one. That is a real boundary: `wallet.drive()` builds the
    // transaction with one class and the wallet signs it with another.
    //
    // It holds because both directions of that boundary are shape-based rather than
    // `instanceof`-based, which was checked rather than assumed: `Transaction.from` returns a
    // foreign transaction unchanged only when it is *its own* class, and otherwise reads
    // `inputs`/`outputs`/`cellDeps`/`witnesses` off it and builds a fresh one — and
    // `Client.sendTransaction` normalises the same way. So a 1.19.1 signer signs a correct 1.19.1
    // copy of the 1.21.0 transaction, and the copy has the same shape back.
    //
    // Worth a live test rather than a comment, because the failure mode is not an exception: the
    // wrong transaction would be built, signed and broadcast, and the fly would not move.
    const why = await unavailable();
    if (why) {
      t.skip(why);
      return;
    }
    await tick64("connectors");
  });
});
