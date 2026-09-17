# Putting the page on the internet

Short version: the front-end **is** a static site, and "put `public/` on a CDN" is the whole
deployment. There is no backend to run and **no private key anywhere in it** — not on the host,
not in the bundle, not in the config.

The page reads the chain itself (JSON-RPC), computes the successor state itself (`crates/flywasm`,
which is the same `flycore` the validator runs, compiled to `wasm32`), and builds the transaction
itself (`deploy/src/tx.js`). A wallet pays and signs. What is left for a host is: serve files.

That was not always true, and the reason it became true is worth stating, because it is the
reason the deployment is now this simple:

| what the page does | who does it now | who used to |
|---|---|---|
| read the fly, its history, every organism | the page, over JSON-RPC | `GET /api/fly`, `GET /api/flies`, `GET /api/state` |
| compute the successor state | `flywasm`, in the browser | `POST /api/prepare`, which shells out to `flyplan` |
| follow it live | the page polls every 3 s | `GET /api/events`, an SSE stream |
| pay, sign, broadcast | the reader's wallet | the same |

Two things made it possible:

- **The successor state moved into the browser.** The type script demands
  `output.data == simulate(input.data, action)` byte for byte, so whoever builds a transaction
  must run the dynamics — and the only implementation allowed to be authoritative is
  `crates/flycore`. It compiles to `wasm32-unknown-unknown` as `crates/flywasm`, and
  `make test-wasm` compares its answers to `flyplan`'s byte for byte, on inputs the contract
  accepts and on inputs it refuses. Same crate, third target: not a second source of truth.
- **The chain answers a browser directly.** `get_cells`, `get_live_cell` and `get_transaction`
  are ordinary JSON-RPC calls, and `testnet.ckb.dev` answers them with
  `access-control-allow-origin: *`. CKB has no event log — a fly's past is a chain of state cells
  recovered by walking backwards and reading each transaction's witness — but a walk is just
  repeated `get_transaction`, and a browser can do that.

The indexer that used to sit between the page and the chain is gone — deleted, not merely
disused. Nothing in this repository serves the page except a directory of files, and the two
things that used to need a running process are now `make check-public` (a pre-upload check, see
below) and the reader's own browser.

---

## What has to be published

```sh
# 1. the bundle: sources are in git, the product is not
cd ckb-fly && make build-front-end

# 2. the page's one static input, naming the chain and the code cells
#    (refuses a dev chain unless CKB_RPC_URL says so — see below)
CKB_RPC_URL=https://testnet.ckb.dev/ make publish-config
```

and then upload `deploy/public/`:

| file | what it is |
|---|---|
| `index.html`, `style.css` | the page |
| `app.js` | the bundle, ~2.8 MB, built by `build-front-end` |
| `flywasm.wasm` | the dynamics module, ~36 KB, copied out of the Rust build |
| `deployment.json` | **the chain, and the code hashes to look for** |

`deployment.json` is the only one with a story. A page can discover an organism — every fly is a
live cell wearing the `flybrain` code, so "find them all" is one query — but it cannot discover
*which code to look for*. A code cell's hash is a fact about a binary somebody deployed, and
nothing on the chain says "this is the CKB Fly build". So the page is told once, in a file, and
the file is generated from the deployment record rather than written by hand: a hand-maintained
copy drifts, and `test/public-config.test.js` fails when it does.

It carries no key material and nothing about the deployer, and the test asserts the exact field
list so that a future field cannot arrive quietly and be published.

---

## The two things a host has to get right

**Serve `.wasm` as `application/wasm`.** `WebAssembly.instantiateStreaming` refuses a module
served as anything else. `public/sim.source.js` falls back to `arrayBuffer()` — which works, and
is slower — so a host that gets this wrong degrades quietly rather than breaking. Cloudflare,
Netlify, GitHub Pages and nginx all get it right.

**Point it at a chain that answers with CORS.** The endpoint in `deployment.json` is read by a
browser on someone else's machine, so it must send `access-control-allow-origin`. `testnet.ckb.dev`
does. A node of your own needs `--rpc-allow-cors` or a proxy that adds the header.

Neither is a reason to run a process. Both are one line of host configuration.

---

## The one operational fact that still bites

**`get_transaction` is served from an in-memory index on the node, and is not an archive.** A node
answers `transaction: null, status: "unknown"` — as a *normal result*, not an error — for anything
committed before it started. `testnet.ckb.dev` is several instances behind a load balancer, so the
same query can answer differently depending on which one you reached, and the walk stops when it
gets nothing.

The symptom is a **silently truncated** history: the page draws a fly whose life begins somewhere
in the middle, with no error anywhere. It looks like a short life, not like a fault.

Consequences:

- On a public RPC the page can be missing early transitions. Nothing will say so.
- For a deployment you care about, **run your own CKB node** and put its URL in
  `deployment.json`. Then the history is as long as the node has been up.
- `node src/cli.js history` and `preflight-testnet.mjs` are read-only and worth running against
  whatever RPC you intend to publish, before you rely on it.

Note that this is now the *reader's* browser doing the walk, on every visit: a long-lived fly is
one `get_transaction` per transition, capped at 500. It is seconds of RPC calls against a public
endpoint, and it is paid per reader rather than once per server.

---

## Security: what there is left to leak

Nothing, and that is the point. There is no key on the host, no key in the bundle, no key in
`deployment.json`, and no endpoint that signs. A visitor's click is paid for from their own wallet
and signed by it; the page never sees their key.

What is still true, and is by design rather than a gap:

- **A public fly can be driven by anyone.** Its lock is `flylock`, which accepts every
  transaction. That is what "public" means here, and it is why the old
  `INDEXER_ALLOW_DRIVE` warning no longer applies: there is no operator's money to drain, because
  there is no operator in the loop.
- **Watching is open.** Anyone can watch any fly, and always could.
- **A private fly is still private.** Its lock is an ordinary `secp256k1_blake160` chosen at
  genesis, and the lock is fixed for the organism's life — the type script pins
  `output.lock == input.lock`. Such a fly is watchable by everyone and advanceable by whoever
  holds that key.

---

## A worked example: Cloudflare Pages

```sh
cd ckb-fly && make build-front-end
CKB_RPC_URL=https://testnet.ckb.dev/ make publish-config

# then either `wrangler pages deploy deploy/public`, or connect the repo and set:
#   build command:   cd ckb-fly && make build-front-end
#   output directory: ckb-fly/deploy/public
```

Two notes:

- `make publish-config` needs `CKB_RPC_URL` in the build environment, because a dev chain's
  address is the default and a published config that names `127.0.0.1` is a page that reads
  nothing. It refuses rather than writing one. In CI the record (`deployment.preview.json`) also
  has to be available, which for a private deployment means a secret — it names out points, not
  keys, but it is chain state you may not want public.
- Put **Cloudflare Access** in front of it if the fly is not meant to be public yet. One policy in
  the dashboard, and the page needs to know nothing.

Unlike the old server, a static deployment *can* be cached: everything in `public/` is immutable
for a given build except `deployment.json`, which changes only when you redeploy. Set a long
`max-age` on `app.js` and `flywasm.wasm`, and `no-store` on `deployment.json`.

---

## What this does not give you

Named rather than left to be discovered:

- **No server-side rate limiting**, because there is no server. A public fly can be ticked as
  fast as someone can click, and it can be run to death. That is a property of a public organism
  on a public chain, not of the hosting.
- **No archive.** See "the one operational fact" above. This is the one that will surprise you.
- **No authentication on reads.** Watching any fly is open to anyone, by design.

---

## Checking `public/` before you upload it

Uploading a directory cannot fail: the host accepts every file, and the bill is paid by a reader
whose browser opens a page that loads and then reads nothing. So the two checks that used to run
when the indexer started — it refused to boot without a bundle, and without a chain that was not
a dev chain — now run before the upload instead:

```sh
cd ckb-fly && make check-public
```

It refuses a `deployment.json` naming a loopback address, and missing `app.js` / `flywasm.wasm`,
and each refusal names the command that fixes it. `indexer` is not one of its complaints,
because there is no longer anything to keep alive.

The `keeper` is also not part of hosting: it is a standalone process (`node src/keeper.js`) that
talks to the chain directly and has never needed the page's host.
