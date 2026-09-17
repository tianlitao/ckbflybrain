/**
 * The page's published config, checked against the record it was published from.
 *
 * `public/deployment.json` is a *copy* of a deployment record, and a copy is the one kind of
 * file that can be wrong while every test that reads it stays green: the page that loads it
 * finds a chain, asks that chain for cells, and gets an empty roster — which looks exactly
 * like a chain with no flies on it. The failure is not a crash, it is a page that works and
 * says nothing.
 *
 * So the check is `publicConfig(record) === published`, not "the published file parses". The
 * record is the authoritative description of a deployment; the published file must be what
 * that record says, and nothing else.
 *
 * Which record is answered from the *config* and not from the environment. A test run on a dev
 * chain has `CKB_RPC_URL` unset, so asking "which network am I on" would compare a preview
 * config against the dev chain's record and fail for a reason that has nothing to do with
 * either file. The config names its endpoint, and the endpoint names the network — the same
 * rule the deployer uses, imported from it rather than restated here.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

import { networkForRpc, recordPathFor } from "../src/cli.js";
import { PUBLIC_FIELDS, publicConfig } from "../src/public-config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLISHED = join(HERE, "..", "public", "deployment.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Both assertions skip rather than fail on a checkout that has never been deployed. */
function publishedOrSkip(t) {
  if (!existsSync(PUBLISHED)) {
    t.skip("no public/deployment.json — run `make build-front-end`");
    return null;
  }
  return readJson(PUBLISHED);
}

describe("the page's published config", () => {
  it("is what the record for its own chain says, and not a copy somebody edited", (t) => {
    const published = publishedOrSkip(t);
    if (!published) return;

    const recordPath = recordPathFor(networkForRpc(published.network));
    if (!existsSync(recordPath)) {
      t.skip(`no record at ${recordPath} for the chain this config names`);
      return;
    }
    assert.deepEqual(
      published,
      publicConfig(readJson(recordPath), published.network),
      `public/deployment.json has drifted from ${recordPath}; regenerate it`,
    );
  });

  it("carries nothing but the fields a page is allowed to be told", (t) => {
    const published = publishedOrSkip(t);
    if (!published) return;

    // The exact list, because this file is served by a web server. A field added here becomes
    // public the moment it is deployed, and the interesting ones — a key path, a deployer's
    // address — are added by someone thinking about the page and not about the server.
    assert.deepEqual(Object.keys(published), PUBLIC_FIELDS);
    assert.deepEqual(Object.keys(published.fly), ["instance", "typeHash", "typeScript", "lockScript"]);

    // The four code cells, named because a page can find an organism without being told — every
    // fly is a live cell wearing the `flybrain` code — but cannot tell which binary is the one
    // that validates it. This is the whole reason the file exists.
    assert.deepEqual(Object.keys(published.codeCells), [
      "flybrain",
      "flylock",
      "flyworld",
      "circuit",
    ]);
    for (const [name, cell] of Object.entries(published.codeCells)) {
      assert.match(cell.codeHash, /^0x[0-9a-f]{64}$/, `${name} carries no code hash`);
    }

    // And the endpoint has to be one: the page reads from it and the wallet signs against it, so
    // a config that names no chain would leave the two free to disagree.
    assert.match(published.network, /^https?:\/\//);
  });
});
