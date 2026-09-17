/**
 * A JSON-RPC proxy in front of a real node, that can be told to start failing.
 *
 * # Why this exists
 *
 * The indexer catches its own poll failures and reports them through `meta.error`, which the
 * page renders as "the node reported: …". Whether that message can *clear itself* is a property
 * worth testing, and the failure that matters is a transient one: an RPC hiccup while the
 * watched organism happens to be sitting still. That is the case that used to leave the message
 * on screen for good — see "An error that cannot clear itself" in the README.
 *
 * A public node will not fail on demand, so this stands in front of one:
 *
 * ```sh
 * node flaky-rpc.mjs &                       # forwards to https://testnet.ckb.dev/
 * curl 127.0.0.1:8119/__fail                 # from now on every POST answers 500
 * curl 127.0.0.1:8119/__ok                   # forward again
 * curl 127.0.0.1:8119/__state                # how many were forwarded and how many refused
 * ```
 *
 * And the indexer under test, pointed at it:
 *
 * ```sh
 * CKB_NETWORK=preview CKB_RPC_URL=http://127.0.0.1:8119 INDEXER_POLL_MS=1500 \
 *   PORT=8897 node src/serve.js
 * ```
 *
 * `CKB_NETWORK` has to be explicit, and that is not obvious: the network is normally *inferred*
 * from the RPC URL, and a loopback URL means "a dev chain" — which changes which system-script
 * table is used, and which deployment record the server reads. Behind a proxy on localhost, an
 * inferred devnet would silently point the indexer at the wrong chain's fly.
 *
 * The tell that the test is exercising the right scenario is that `meta.updatedAt` does **not**
 * change across the sequence. `updatedAt` is only written when a chain walk happens, and an idle
 * organism never walks — so a constant `updatedAt` is exactly the condition under which the old
 * code could never clear the error.
 *
 * @module flaky-rpc
 */

import { createServer } from "node:http";

/** Where the requests go when they are not being refused. */
const UPSTREAM = process.env.UPSTREAM ?? "https://testnet.ckb.dev/";

/** What to listen on. Deliberately not a port the deployer or the indexer uses. */
const PORT = Number(process.env.PROXY_PORT ?? 8119);

let failing = false;
const counts = { forwarded: 0, refused: 0 };

const server = createServer((req, res) => {
  if (req.method === "GET") {
    switch (req.url) {
      case "/__fail":
        failing = true;
        return void res.writeHead(200).end("failing\n");
      case "/__ok":
        failing = false;
        return void res.writeHead(200).end("forwarding\n");
      case "/__state":
        return void res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ failing, ...counts }));
      default:
        return void res.writeHead(404).end("no such control\n");
    }
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    if (failing) {
      counts.refused += 1;
      res.writeHead(500, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          error: { code: -32000, message: "injected failure" },
        }),
      );
      return;
    }
    try {
      const upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: Buffer.concat(chunks),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      counts.forwarded += 1;
      res.writeHead(upstream.status, { "content-type": "application/json" }).end(body);
    } catch (err) {
      counts.refused += 1;
      res.writeHead(502, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          error: { code: -32000, message: err.message },
        }),
      );
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`flaky-rpc on http://127.0.0.1:${PORT} -> ${UPSTREAM}`);
  console.log(`  GET /__fail   start refusing every POST`);
  console.log(`  GET /__ok     forward again`);
  console.log(`  GET /__state  counts`);
});
