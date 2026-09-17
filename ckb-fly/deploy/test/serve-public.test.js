/**
 * The two refusals in `serve-public.sh`, which is the difference between a public deployment
 * and an expensive accident.
 *
 * Both checks exist because the configuration they reject is *invisible* until it has already
 * cost something:
 *
 *   * **`CKB_RPC_URL` unset.** The network is inferred from that URL, so a missing one is read
 *     as "a dev chain" — and the network selects the deployment record *and* the key file. On a
 *     public host the process then reads `deployment.json` and `.key`, which is either an
 *     immediate failure or, worse, a working server serving an organism nobody meant.
 *   * **`INDEXER_ALLOW_DRIVE=1`.** It exposes `POST /api/act`, which signs with the server's
 *     key, and nothing in this server rate-limits anything. One `feed` click moves the
 *     operator's CKB into a body the type script forbids ever emptying.
 *
 * Nothing here needs a chain, a node or a port: every one of these refusals happens before the
 * script does anything. That is why this file is a test rather than a paragraph in a README —
 * a guard nobody runs is a guard that stops working.
 *
 *     node --test test/serve-public.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "serve-public.sh");

/** Run the script with exactly these variables, inheriting nothing that could satisfy it. */
function run(env) {
  const base = { PATH: process.env.PATH, HOME: process.env.HOME };
  const result = spawnSync("/bin/sh", [SCRIPT], {
    env: { ...base, ...env },
    encoding: "utf8",
    timeout: 15_000,
  });
  return {
    status: result.status,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("serve-public.sh refuses the configurations that are invisible until they are expensive", () => {
  it("refuses to guess which chain, because a guess means the dev chain's files", () => {
    const { status, out } = run({});
    assert.notEqual(status, 0, "it must not start");
    assert.match(out, /CKB_RPC_URL is not set/);
    // The message has to name the consequence, not just the missing variable: "set this"
    // does not tell anyone why a default was refused.
    assert.match(out, /deployment\.json/);
  });

  it("refuses a loopback RPC, which is the same mistake spelled differently", () => {
    for (const rpc of ["http://127.0.0.1:8114", "http://localhost:8114", "http://[::1]:8114"]) {
      const { status, out } = run({ CKB_RPC_URL: rpc });
      assert.notEqual(status, 0, `${rpc} must be refused`);
      assert.match(out, /loopback address/);
    }
  });

  it("refuses to expose the server-signed endpoint", () => {
    const { status, out } = run({
      CKB_RPC_URL: "https://testnet.ckb.dev/",
      INDEXER_ALLOW_DRIVE: "1",
    });
    assert.notEqual(status, 0, "it must not start");
    assert.match(out, /INDEXER_ALLOW_DRIVE=1 is set/);
    // The two costs, named. A refusal that does not say what it is protecting is a refusal
    // that gets overridden without being read.
    assert.match(out, /feed/);
    assert.match(out, /rate-limits/);
    // And the way out, so the override is a decision rather than a hack.
    assert.match(out, /FLY_ALLOW_PUBLIC_DRIVE=yes/);
  });

  it("lets the override through, and fails for the *next* reason instead", () => {
    // The point is not that it starts — it is that it got past the drive guard. Pointing
    // FLYPLAN at nothing makes it stop at the next check, which proves the order.
    const { status, out } = run({
      CKB_RPC_URL: "https://testnet.ckb.dev/",
      INDEXER_ALLOW_DRIVE: "1",
      FLY_ALLOW_PUBLIC_DRIVE: "yes",
      FLYPLAN: "/nonexistent/flyplan",
    });
    assert.notEqual(status, 0);
    assert.doesNotMatch(out, /INDEXER_ALLOW_DRIVE=1 is set/, "the guard must have been satisfied");
    assert.match(out, /planner binary is missing/);
  });

  it("names the command that builds each missing artifact", () => {
    // Both are build products and neither is in git, so a fresh clone hits them. The check is
    // worth having only if the message says what to run — otherwise it is the same
    // "looked in …" error the server would have produced on its own.
    const { out } = run({
      CKB_RPC_URL: "https://testnet.ckb.dev/",
      FLYPLAN: "/nonexistent/flyplan",
    });
    assert.match(out, /make plan/);
  });
});
