/**
 * Build the browser entry points.
 *
 * `public/app.source.js` stays readable and is the file to edit. `public/app.js` is the browser
 * artifact served by a static host. Keeping those roles separate is deliberate: the page has bare
 * package imports (`@ckb-ccc/core` and the six wallet adapters) that a browser cannot resolve from
 * `node_modules` by itself, and the bundle is the seam that lets them be imported without a
 * hand-maintained import map.
 *
 * Two entries, because they are two sizes of job. `app.js` carries CCC and every wallet adapter —
 * 2.9 MB — because the page can drive the fly and therefore has to build, sign and send
 * transactions. `pages.js` is the dictionary and the language switch for the two prose pages, a
 * few tens of kilobytes, because a page that explains a ring attractor needs neither a wallet nor
 * a chain client.
 */
import { build } from "esbuild";

const entries = [
  { entryPoints: ["public/app.source.js"], outfile: "public/app.js" },
  { entryPoints: ["public/pages.source.js"], outfile: "public/pages.js" },
];

for (const { entryPoints, outfile } of entries) {
  const result = await build({
    entryPoints,
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs);
  const output = result.metafile.outputs[outfile];
  console.log(`bundled ${inputs.length} inputs -> ${outfile} (${output.bytes} bytes)`);
}
