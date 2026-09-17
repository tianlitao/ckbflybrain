/**
 * The files on disk that only a Node process can read.
 *
 * `src/fly.js` is the encoding core, and it is meant to run in a browser — its own module
 * comment says so ("this module exists for the half of the project that cannot shell out to
 * Rust: the browser"). These five exports are the part that cannot: they read
 * `build/release/*` and the connectome table off the filesystem. Living in `fly.js` they made
 * every browser-facing importer drag in `node:fs`, `node:url` and `node:path`, which is
 * exactly the import that stops a page from being bundled.
 *
 * So they live here, and the dependency points one way: this file imports `fly.js`, and
 * `fly.js` imports nothing from Node.
 *
 * A browser needs none of it. On chain the contracts are named by out point and code hash,
 * and the code hashes are already written down in `deployment.json`.
 *
 * @module artifacts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { keccak256 } from "./fly.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root — the `ckb-fly/` directory. */
export const PROJECT_ROOT = join(HERE, "..", "..");

function readArtifact(rel) {
  return new Uint8Array(readFileSync(join(PROJECT_ROOT, rel)));
}

/** The `flybrain` type script binary, stripped, from `build/release/`. */
export function flybrainBinary(mode = "release") {
  return readArtifact(join("build", mode, "flybrain"));
}

/** The `flylock` lock script binary, stripped. */
export function flylockBinary(mode = "release") {
  return readArtifact(join("build", mode, "flylock"));
}

/** The `flyworld` type script binary, stripped. */
export function flyworldBinary(mode = "release") {
  return readArtifact(join("build", mode, "flyworld"));
}

/** The 15,065-byte connectome table. */
export function circuitTable() {
  return readArtifact(join("crates", "flycircuit", "data", "circuit.bin"));
}

/** keccak256 of the connectome — the value that goes in the args, and on BSC's `circuitHash()`. */
export function circuitHash() {
  return keccak256(circuitTable());
}
