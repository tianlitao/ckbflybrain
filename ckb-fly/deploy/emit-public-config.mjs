/**
 * Write the page's copy of the deployment.
 *
 * A one-line wrapper over `src/public-config.js`, which holds both the value and the reason it
 * exists. The network follows `CKB_RPC_URL` exactly as every other tool here does, and the record
 * is named for it — so pointing this at a dev chain writes a dev chain's config, which is what a
 * local page wants and is not what should be published.
 *
 *   CKB_RPC_URL=https://testnet.ckb.dev/ node emit-public-config.mjs
 *
 * # Why it refuses a dev chain unless you name one
 *
 * The default `CKB_RPC_URL` is a dev chain's, because that is what every other tool here defaults
 * to and what a local page wants. A *published* config is the opposite: it is read by browsers
 * that are not on this machine, and a config that names 127.0.0.1 is a page that reads nothing and
 * says so only in the footer. So the default is not allowed to produce one — say it explicitly, or
 * get told.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG, readDeployment } from "./src/cli.js";
import { publicConfig } from "./src/public-config.js";

if (CONFIG.network === "devnet" && !process.env.CKB_RPC_URL) {
  console.error(
    `refusing to publish a dev chain's config (${CONFIG.rpc});\n` +
      "set CKB_RPC_URL to the chain the page should read, e.g.\n" +
      "  CKB_RPC_URL=https://testnet.ckb.dev/ node emit-public-config.mjs",
  );
  process.exit(1);
}

const config = publicConfig(readDeployment(), CONFIG.rpc);

const out = join(dirname(fileURLToPath(import.meta.url)), "public", "deployment.json");
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);

console.log(`public/deployment.json <- ${CONFIG.statePath} (${CONFIG.network})`);
console.log(`  chain    ${config.network}`);
console.log(`  fly      ${config.fly.typeHash} (instance ${config.fly.instance})`);
console.log(`  flybrain ${config.codeCells.flybrain.codeHash}`);
