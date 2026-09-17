/**
 * Is `public/` fit to upload?
 *
 * `deploy/public/` is a static site now — no process of ours runs it — which means the thing
 * that used to catch a broken deployment at startup (`serve-public.sh`, which refused to start
 * without `CKB_RPC_URL` or a bundle) no longer runs at all. Uploading a directory cannot fail
 * loudly: the host accepts every file, and the damage shows up in a reader's browser as a page
 * that loads and then reads nothing.
 *
 * So the refusals moved here, ahead of the upload rather than inside the thing being uploaded.
 * Each one names the command that fixes it, because "looked in public/deployment.json and found
 * nothing" is what the browser says anyway, and saying it earlier is the only value added.
 *
 *   * **A dev chain in `deployment.json`.** The network is inferred from the RPC URL, so
 *     `127.0.0.1` means "the dev chain". A published config naming it is a page that reads
 *     nothing from a browser on the other side of the world, and says so only in the footer.
 *   * **The build products.** `app.js` and `flywasm.wasm` are not in git. Without them the page
 *     is an empty shell: it loads, finds no dynamics module, and reports a failure that reads
 *     like the chain is down.
 *
 *     node check-public.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { networkForRpc } from "./src/cli.js";
import { REQUIRED } from "./src/static-page.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");

/** Every reason `public/` cannot be published, each naming the command that fixes it. */
export function publishProblems(dir = PUBLIC) {
  const problems = [];

  const missing = REQUIRED.filter((name) => !existsSync(join(dir, name)));
  if (missing.length > 0) {
    problems.push(
      `${missing.map((f) => `public/${f}`).join(" and ")} ${missing.length > 1 ? "are" : "is"} missing.\n\n` +
        "Both are build products and neither is in git — the sources are. Build them:\n\n" +
        "    cd .. && make build-front-end",
    );
  }

  const configPath = join(dir, "deployment.json");
  if (!existsSync(configPath)) {
    problems.push(
      "public/deployment.json is missing.\n\n" +
        "It is the page's one static input: the chain to read and the code hashes to look for,\n" +
        "which cannot be discovered from the chain. Emit it:\n\n" +
        "    cd .. && CKB_RPC_URL=https://testnet.ckb.dev/ make publish-config",
    );
    return problems;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    problems.push(`public/deployment.json is not valid JSON (${err.message}).`);
    return problems;
  }

  const rpc = config?.network;
  if (typeof rpc !== "string" || rpc === "") {
    problems.push(
      "public/deployment.json has no `network`, so the page would not know which chain to read.",
    );
  } else if (networkForRpc(rpc) === "devnet") {
    // The published config is read by browsers that are not on this machine, where a loopback
    // address is a chain that does not exist. `emit-public-config.mjs` refuses to write one
    // unless CKB_RPC_URL says otherwise; this catches a config that was written that way on
    // purpose and then forgotten.
    problems.push(
      `public/deployment.json names a dev chain (${rpc}).\n\n` +
        "A published page is read by browsers that are not on this machine, and there is no dev\n" +
        "chain where they are — the page would load, read nothing, and say so only in the\n" +
        "footer. Point it at the real chain and emit it again:\n\n" +
        "    cd .. && CKB_RPC_URL=https://testnet.ckb.dev/ make publish-config",
    );
  }

  return problems;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const problems = publishProblems();
  if (problems.length > 0) {
    console.error(`refusing to publish:\n\n${problems.map((p) => `  * ${p}`).join("\n\n")}\n`);
    process.exit(1);
  }
  const { network, fly } = JSON.parse(readFileSync(join(PUBLIC, "deployment.json"), "utf8"));
  console.log(`public/ is publishable`);
  console.log(`  chain    ${network}`);
  console.log(`  fly      ${fly.typeHash}`);
  console.log(`  files    ${REQUIRED.concat("deployment.json").join(", ")}`);
}
