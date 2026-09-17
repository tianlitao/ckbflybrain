/**
 * Serve `public/` the way a real static host would.
 *
 * # Why this is the whole server
 *
 * The page used to be a client of an indexer, and that indexer was also the thing that served
 * it: `GET /api/fly`, `GET /api/events`, `POST /api/prepare`, `POST /api/act`. None of those
 * exist any more. The page reads the chain over JSON-RPC itself, computes the successor state
 * with `flywasm`, and builds its own transaction — so what it needs from a host is a directory
 * of files and a content type. That is what is left of `serve.js`.
 *
 * # The content types are not decoration
 *
 * `WebAssembly.instantiateStreaming` refuses a module served as anything but
 * `application/wasm`, and `public/sim.source.js` falls back to `arrayBuffer()` precisely
 * because a static host that gets this wrong is the common case. Served correctly here so that
 * the fallback is not what makes a test pass.
 *
 * Usage:
 *
 *     node src/static-page.js              # http://127.0.0.1:8899/
 *     PORT=9000 node src/static-page.js
 *
 * Both `public/app.js` and `public/flywasm.wasm` are build products and neither is in git, so
 * a fresh clone has neither. The CLI names the command that creates them rather than 404-ing on
 * the first request, which is the error you would otherwise get from inside the repository.
 *
 * @module static-page
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
};

/**
 * What has to have been built before the page can be served at all.
 *
 * `flywasm.wasm` is in the list for the same reason `app.js` is: both come from
 * `make build-front-end`, and a page with only one of them is a page that loads and then does
 * nothing, which is worse than one that refuses to start.
 *
 * `pages.js` is the same argument one step further out. It is the bundle for the two prose pages
 * (`about.html`, `guide.html`), it is not in git either, and without it those two pages render as
 * a masthead and nothing else — every one of their paragraphs is filled by the dictionary at load
 * time. A deployment that quietly lost it would still serve the fly, which is exactly why nothing
 * would notice.
 */
export const REQUIRED = ["app.js", "pages.js", "flywasm.wasm"];

/** @param {string} [dir] */
export function missingArtifacts(dir = PUBLIC_DIR) {
  return REQUIRED.filter((name) => !existsSync(join(dir, name)));
}

/**
 * Whether there is a page to serve.
 *
 * Its own function rather than "call `startStaticPage` and see if it worked", because a server
 * that is started to answer a question and then never closed keeps a listen handle open — and
 * `node --test` does not exit while one is, so the run hangs *after* every test has passed.
 */
export function bundleExists() {
  return missingArtifacts().length === 0;
}

/**
 * @param {object} [options]
 * @param {number} [options.port] `0` picks a free port, which is what the browser tests want
 * @param {string} [options.host]
 * @param {string} [options.root]
 * @returns {Promise<{url: string, close: () => Promise<void>}|null>} `null` when the bundle has
 *   not been built, which is a skip rather than a failure: `public/app.js` is deliberately not
 *   in the repository.
 */
export async function startStaticPage({ port = 0, host = "127.0.0.1", root = PUBLIC_DIR } = {}) {
  if (missingArtifacts(root).length > 0) return null;

  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
    const file = join(root, path === "/" ? "index.html" : path);
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(await readFile(file));
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const { port: bound } = server.address();
  return {
    url: `http://${host}:${bound}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Run as `node src/static-page.js` rather than imported. */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const missing = missingArtifacts();
  if (missing.length > 0) {
    console.error(
      `refusing to start: ${missing.map((f) => `public/${f}`).join(" and ")} ${missing.length > 1 ? "are" : "is"} missing.\n\n` +
        "Both are build products and neither is in git — the sources are. Build them:\n\n" +
        "    cd .. && make build-front-end\n",
    );
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 8899);
  const page = await startStaticPage({ port });
  console.log(`ckb-fly page, static`);
  console.log(`  serving   ${PUBLIC_DIR}`);
  console.log(`  listen    ${page.url}  (loopback; the page reads the chain itself)`);
  console.log("");
}
