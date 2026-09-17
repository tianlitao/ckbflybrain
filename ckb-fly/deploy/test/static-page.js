/**
 * Serve `public/` the way a static host would, for the tests that need a real browser.
 *
 * These tests used to point at the indexer on port 8898, because that was the only thing serving
 * the page. It is not any more: the page reads the chain itself, so what it needs is a directory
 * of files and a content type. That is a smaller thing to stand up and a more honest one — the
 * page under test is then the same bytes a CDN would serve, rather than whatever the indexer
 * happened to have in its own directory.
 *
 * The content types are not decoration. `WebAssembly.instantiateStreaming` refuses a module
 * served as anything but `application/wasm`, and `public/sim.source.js` falls back to
 * `arrayBuffer()` precisely because a static host that gets this wrong is the common case. Served
 * correctly here so that the fallback is not what makes a test pass.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

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
 * Whether there is a page to serve at all.
 *
 * Its own function rather than "call `startStaticPage` and see if it worked", because a server
 * that is started to answer a question and then never closed keeps a listen handle open — and
 * `node --test` does not exit while one is, so the run hangs *after* every test has passed.
 */
export function bundleExists() {
  return existsSync(join(ROOT, "app.js"));
}

/**
 * @returns {Promise<{url: string, close: () => Promise<void>}|null>} `null` when the bundle has
 *   not been built, which is a skip rather than a failure: `public/app.js` is deliberately not in
 *   the repository.
 */
export async function startStaticPage() {
  if (!bundleExists()) return null;

  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = join(ROOT, path === "/" ? "index.html" : path);
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(await readFile(file));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
