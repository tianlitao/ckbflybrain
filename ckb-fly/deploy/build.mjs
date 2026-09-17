/**
 * Build the browser entry point.
 *
 * `public/app.source.js` stays readable and is the file to edit. `public/app.js` is the browser
 * artifact served by `serve.js`. Keeping those roles separate is deliberate: the page currently
 * has no third-party imports, but a wallet adapter will have bare package imports and the browser
 * cannot resolve those from `node_modules` by itself. The bundle is the seam that lets a future
 * `getUtxoGlobalSigners(client)` or `getJoyIdSigners(client, name, icon)` be imported without a
 * hand-maintained import map.
 *
 * No wallet is included by this build. The bundle is infrastructure, not a wallet decision.
 */
import { build } from "esbuild";

const result = await build({
  entryPoints: ["public/app.source.js"],
  outfile: "public/app.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
  metafile: true,
});

const inputs = Object.keys(result.metafile.inputs);
const output = result.metafile.outputs["public/app.js"];
console.log(`bundled ${inputs.join(", ")} -> public/app.js (${output.bytes} bytes)`);
