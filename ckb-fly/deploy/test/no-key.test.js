/**
 * A server started with no key — which is the configuration a public deployment wants.
 *
 * `POST /api/prepare` signs nothing: it computes the successor (which only the Rust planner
 * knows how to do) and hands the unfinished transaction back for a *visitor's* wallet to pay
 * for and sign. So a server whose only job is to index and prepare does not need a private key
 * at all, and requiring one would mean putting a key on a public host to satisfy a check that
 * never reads it.
 *
 * Two things had to be true for that configuration to be usable, and neither was:
 *
 *   * **It could not start.** `startIndex` resolved the server's own lock unconditionally, so
 *     a missing key threw during boot and the process died before serving anything. A read-only
 *     deployment was impossible for a reason that had nothing to do with reading.
 *   * **`drive` did not mean what its own comment said.** It was `INDEXER_ALLOW_DRIVE` alone,
 *     documented as "whether this server would sign at all" — but a server with no key would
 *     not sign, and it still said `true`. The page reads `drive && drivable`, so with a public
 *     organism (whose `flylock` admits everyone, making `drivable` true regardless) five buttons
 *     were enabled and every click failed inside the transaction builder with "no key for
 *     preview": a message about a missing file, for a problem about a configuration.
 *
 * So this test asserts the *pair*, because the bug lived in the gap between them: the lock
 * admits anyone (true, and not enough), and this process holds no key (also true, and the half
 * that was missing). `prepare` must stay open — a server that refuses both paths is not a
 * read-only server, it is a broken one.
 *
 * It spawns its own server, so it is independent of whatever is on 8898. It skips when the
 * chain is unreachable or the planner is not built, and it *fails* rather than skips when the
 * server dies complaining about a key — that is the regression, and a skip would hide it.
 *
 *     node --test test/no-key.test.js
 *
 * Environment: `CKB_RPC_URL` (default `https://testnet.ckb.dev/`), `FLY_NO_KEY_PORT` (8894).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SERVE = join(HERE, "..", "src", "serve.js");

const RPC = process.env.CKB_RPC_URL ?? "https://testnet.ckb.dev/";
const PORT = Number(process.env.FLY_NO_KEY_PORT ?? 8894);
const BASE = `http://127.0.0.1:${PORT}`;

/** The path is the point: it must not exist, or the server would find a key after all. */
const NO_SUCH_KEY = join(HERE, "..", ".no-such-key-for-this-test");

let child = null;
let skipReason = null;
let stderr = "";

async function reachable() {
  if (!existsSync(join(ROOT, "target", "debug", "flyplan")) && !existsSync(join(ROOT, "target", "release", "flyplan"))) {
    return "the planner is not built (run `make plan`)";
  }
  if (existsSync(NO_SUCH_KEY)) {
    return `${NO_SUCH_KEY} exists, so this test would not be testing a missing key`;
  }
  // One cheap RPC round trip, so an offline machine skips instead of waiting out the boot
  // window and then reporting a chain problem as a server problem.
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "get_tip_block_number", params: [] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return `the chain at ${RPC} answered ${res.status}`;
  } catch (err) {
    return `no chain at ${RPC} (${err.message})`;
  }
  return null;
}

async function boot() {
  child = spawn(process.execPath, [SERVE], {
    cwd: join(HERE, ".."),
    env: {
      ...process.env,
      // A key that cannot be read, and no fallback: `CKB_PRIVATE_KEY` is deleted rather than
      // left alone, because it would win over the file and quietly give the server a key.
      CKB_PRIVATE_KEY: undefined,
      FLY_KEY_FILE: NO_SUCH_KEY,
      CKB_RPC_URL: RPC,
      PORT: String(PORT),
      // The operator *has* opted in, so `drive: false` cannot be explained by that alone.
      INDEXER_ALLOW_DRIVE: "1",
      INDEXER_POLL_MS: "60000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return false;
    }
    try {
      const res = await fetch(`${BASE}/api/fly`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        return true;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

describe("a server with no key", () => {
  before(async () => {
    skipReason = await reachable();
    if (skipReason) {
      return;
    }
    const up = await boot();
    if (up) {
      return;
    }
    // Down. Which reason it went down for decides whether this is a skip or the bug: a key
    // complaint is the regression this file exists for, and skipping on it would be a test
    // that cannot fail. Anything else is the chain's problem, not the server's.
    skipReason = /no key for|CKB_PRIVATE_KEY/.test(stderr)
      ? null
      : `the server did not come up (${stderr.trim().split("\n").pop() ?? "no output"})`;
    if (skipReason === null) {
      assert.fail(
        `a server started with FLY_KEY_FILE pointing at a missing file must still serve; it exited with: ${stderr.trim()}`,
      );
    }
  });

  after(() => {
    child?.kill("SIGTERM");
  });

  it("says it cannot sign, and says so even with INDEXER_ALLOW_DRIVE set", async (t) => {
    if (skipReason) {
      return t.skip(skipReason);
    }
    const meta = (await (await fetch(`${BASE}/api/fly`)).json()).meta;

    assert.equal(meta.drive, false, "no key, so this server would not sign at all");
    assert.equal(meta.as, "server");

    // The other half, and the reason the two have to be reported separately: the organism's
    // lock admits anyone, which is a fact about the chain and true whether or not this process
    // holds a key. Reported alone it enables buttons that cannot work.
    assert.equal(meta.drivable, true, "flylock admits everyone — that is about the lock");
    assert.equal(meta.lock, "flylock");
  });

  it("keeps the visitor's path open, because that is the whole point", async (t) => {
    if (skipReason) {
      return t.skip(skipReason);
    }
    const meta = (await (await fetch(`${BASE}/api/fly`)).json()).meta;
    assert.equal(meta.prepare, true, "prepare signs nothing, so a keyless server must still offer it");

    // Offered, not merely advertised: a request with no `address` is refused for that reason
    // and no other, which is what proves the endpoint ran.
    const res = await fetch(`${BASE}/api/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "tick", steps: 32 }),
    });
    assert.equal(res.status, 400, "a prepare with no address is a bad request, not an unavailable one");
    const body = await res.json();
    assert.match(body.error, /address is required/);
  });

  it("refuses to sign, naming the endpoint that works instead", async (t) => {
    if (skipReason) {
      return t.skip(skipReason);
    }
    const res = await fetch(`${BASE}/api/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "tick", steps: 32 }),
    });
    assert.equal(res.status, 503, "unavailable, not forbidden — the operator did opt in");
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /without a key/);
    // The message has to point somewhere, or an operator reads "cannot sign" and stops.
    assert.match(body.error, /\/api\/prepare/);
  });
});
