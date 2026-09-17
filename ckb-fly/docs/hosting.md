# Putting the page on the internet

Short version: the front-end is **not a static site**, so "put `public/` on a CDN" does not
work. It needs a backend, that backend must be a long-lived process on a machine that can run
a Rust binary, and **it does not need a private key**.

That last point is the one worth reading this for. `POST /api/prepare` computes the successor
and hands back an *unfinished* transaction for a visitor's wallet to pay for and sign, so a
server that only indexes and prepares holds no secret at all. That is the configuration to
deploy.

---

## Why the page needs a server

| what the page does | endpoint | needs |
|---|---|---|
| draw the ring, the walk, the chronicle | `GET /api/fly` | the index — a walk of the fly's cell chain |
| drive it with a visitor's wallet | `POST /api/prepare` | the **Rust planner** |
| drive it with the server's key | `POST /api/act` | a private key on the server, and `INDEXER_ALLOW_DRIVE=1` |
| follow it live | `GET /api/events` | a long-lived connection (SSE) |
| list every organism | `GET /api/flies` | the index |
| look at one past state | `GET /api/state?tx=` | the index |

Two of those cannot be moved into a browser:

- **The successor state.** The type script demands `output.data == simulate(input.data, action)`
  byte for byte, so whoever builds a transaction must run the dynamics. The only implementation
  allowed to be authoritative is `crates/flycore`, reached through the `flyplan` binary. The
  browser mirror in `src/fly.js` covers *encoding and decoding* — enough to read a state and
  build an action, deliberately not enough to run one.
- **The history.** CKB has no event log. A fly's past is a chain of state cells, recovered by
  walking backwards and reading each transaction's witness. That is the indexer.

---

## What has to be on the machine

```sh
# 1. the planner, which is a Rust binary and not an npm package
cd ckb-fly && make plan

# 2. the front-end bundle, which is a build product and is not in git
make build-front-end

# 3. the chain half
cd deploy && npm install

# 4. a deployment record for the network you are on
ls deployment.preview.json      # named for the network, and it must exist
```

Then:

```sh
CKB_RPC_URL=https://testnet.ckb.dev/ PORT=8899 node src/serve.js
```

| variable | default | what it decides |
|---|---|---|
| `CKB_RPC_URL` | `http://127.0.0.1:8114` | **must be set** — see below |
| `CKB_NETWORK` | inferred from the URL | which record and key are read |
| `PORT` | 8899 | what to listen on (loopback only, always) |
| `INDEXER_POLL_MS` | 3000 | how often to look for a new transition |
| `INDEXER_ALLOW_DRIVE` | unset | `1` exposes `POST /api/act`, which signs with a key |
| `FLY_STATE` | `deploy/deployment.<network>.json` | the record |

**`CKB_RPC_URL` defaults to a loopback address, and a loopback address means "a dev chain".**
The network is *inferred* from the URL, and the network selects both the record and the key
file. Leave it unset on a server and the process reads `deployment.json` and `.key` — the dev
chain's files — and fails, or worse, finds a stale dev record and serves a fly that is not the
one you meant.

**No key is needed**, and since `serve.js` was changed to allow it, none should be given: a
keyless server logs that it is indexing and preparing only, reports `drive: false`, keeps
`/api/prepare` open, and refuses `POST /api/act` with a message naming `/api/prepare`.

### Or let the script check it for you

`deploy/serve-public.sh` is the configuration above with the two expensive mistakes made
impossible, because both are invisible until they have already cost something:

- **A missing or loopback `CKB_RPC_URL`** is read as "a dev chain", which selects
  `deployment.json` and `.key` — the wrong record and the wrong key on a public host.
- **`INDEXER_ALLOW_DRIVE=1`** exposes `POST /api/act`, which signs with a key. It is refused
  unless `FLY_ALLOW_PUBLIC_DRIVE=yes` says so in the environment.

It also checks the two build products that are not in git and names the command for each:

```sh
CKB_RPC_URL=https://testnet.ckb.dev/ ./serve-public.sh
```

`test/serve-public.test.js` pins both refusals, and needs no chain — every one of them
happens before the script does anything.

Ready-made service definitions are in `deploy/hosting/`:

| file | for |
|---|---|
| `ckbfly-serve.service` | a Linux host, with the read-only hardening the keyless configuration allows |
| `com.ckbfly.serve.plist` | macOS, for the self-hosting case |
| `cloudflared.yml` | a Cloudflare Tunnel in front of either |

---

## The three shapes, and which one works

### A long-lived process behind a tunnel or reverse proxy — **this is the one**

`serve.js` is an ordinary Node process: it polls, holds an in-memory index, and fans out SSE.
It binds `127.0.0.1`, which is not a limitation to work around — it is exactly what a tunnel
or a same-host reverse proxy wants. Front-end and API share an origin, so **no CORS is
involved**, which matters because the server sends no CORS headers and would have to be
changed to serve a browser on a different origin.

Cloudflare Tunnel, nginx, Caddy, Tailscale Funnel — all fine. The host has to stay up; see
"two operational facts" below for why a host that restarts often is a bad fit.

### Cloudflare Workers (or Pages Functions) — **no, for three separate reasons**

Any one of them is enough, and none is a configuration problem:

1. **No subprocesses.** `flyplan` is a Rust binary invoked with `execFileSync`. Workers run V8
   isolates: no filesystem, no `child_process`, no arbitrary executables. There is nowhere to
   put the planner.
2. **The index is a long-lived in-memory object.** It is built once and updated incrementally
   by a polling loop, and shared with SSE subscribers. A Worker is request-scoped, so this
   becomes Durable Objects plus a rewrite of `serve.js` — which also uses `node:http`,
   `node:fs` and `node:path`.
3. **Cold starts would re-walk the chain.** See below; on a serverless host every cold start is
   a cold start.

The honest serverless path, if you want one: **`flycore` compiles to
`wasm32-unknown-unknown`.** It is `no_std`, allocation-free, and its only dependency is
`flycircuit`, which is the same. Because it is *the same Rust*, running it in a Worker does not
create a second source of truth — that objection does not apply. What remains is the index and
the SSE fan-out, which still want Durable Objects. That is a project, not a config change.

### Cloudflare Pages for the static half only — **not on its own**

`public/` would upload fine, but a page with no `/api/*` draws nothing and drives nothing: it
is a canvas and five dead buttons. Splitting the two across origins also needs CORS, which the
server does not send.

---

## Two operational facts that decide where you host it

**The index is in memory, and a restart re-walks the whole life.** There is no cache on disk.
After a restart the first `refresh` walks backwards from the head, one `getTransaction` per
transition, up to a limit of 500. That is seconds of RPC calls for a long-lived fly, and it is
paid again on every restart. A host that restarts on deploy, on idle, or on a schedule is the
wrong host for this — which is most of the reason serverless does not fit.

**`get_transaction` is served from an in-memory index on the node, and is not an archive.** A
node answers `transaction: null, status: "unknown"` — as a *normal result* — for anything
committed before it started. `testnet.ckb.dev` is several instances behind a load balancer, so
the same query can answer differently, and the walk in `history.js` stops when it gets nothing.
The symptom is a **silently truncated** history: the page draws a fly whose life begins
somewhere in the middle, with no error anywhere.

Consequences:

- On a public RPC, the page can be missing early transitions. It will look like a short life,
  not like a fault.
- For a deployment you care about, **run your own CKB node** and point `CKB_RPC_URL` at it. The
  indexer then has an archive that outlives its own process.
- `node src/cli.js history` and `preflight-testnet.mjs` are read-only and worth running against
  whatever RPC you intend to use, before you rely on it.

---

## Security: the thing not to do

**Do not set `INDEXER_ALLOW_DRIVE=1` on a public host.**

That flag exposes `POST /api/act`, which signs with the server's key, and there is **no rate
limiting anywhere in this server** — no per-IP limit, no cap on actions per minute, nothing.
The two ways that is spent:

- **`feed` drains the operator.** Each click moves 1 CKB of the server's money into the fly's
  body, where the type script forbids ever removing it. Anyone who finds the page can do that
  as fast as they can click, and the money is gone.
- **`tick` is not a drain but it is a lever.** It pays the server — released capacity lands in
  its change — but it spends the fly's *life*, so the fly can be run to death by strangers.

With the flag off, the page is still fully usable: buttons are enabled for a visitor who
connects a wallet, and their click goes to `/api/prepare`, which signs nothing and spends
nothing of the operator's. That is the intended public configuration, and it is why a keyless
server is not a degraded one.

If you do want the server to sign on a public host, put a rate limiter and a spend cap in front
of `/api/act` at the proxy — and fund that key with an amount you are willing to lose.

---

## A worked example: Cloudflare Tunnel

```sh
# on the host, once
brew install cloudflared        # or the .deb / .rpm
cloudflared tunnel login
cloudflared tunnel create ckbfly

# run the server, loopback only, no key
cd ckb-fly/deploy
CKB_RPC_URL=https://testnet.ckb.dev/ PORT=8899 node src/serve.js

# and point the tunnel at it
cloudflared tunnel --url http://127.0.0.1:8899
```

`cloudflared` connects *out* to Cloudflare, so the host needs no inbound ports, no public IP and
no TLS certificate. The SSE stream survives the proxy because `serve.js` writes a comment frame
every 15 seconds, which keeps an idle connection from being reaped by an intermediary — that
keep-alive is not decoration.

Two Cloudflare-specific notes:

- Put **Cloudflare Access** in front of it if the fly is not meant to be public yet. It is one
  policy in the dashboard and it does not require the server to know anything.
- The server sends `cache-control: no-store` on **everything**, including the 2.8 MB
  `app.js` bundle, so every visit re-downloads it. That is deliberate for a page whose whole
  point is that its numbers are current, but it is worth knowing before you wonder why a CDN is
  not helping.

---

## What this does not give you

Named rather than left to be discovered:

- **No rate limiting.** Nothing in `serve.js` counts requests.
- **No CORS.** Same-origin only, by design; splitting the page from the API means adding it.
- **No caching.** `no-store` on static assets as well as on API responses.
- **One process.** The index lives in one process's memory, so running two servers means two
  indexes, two poll loops and two sets of SSE subscribers. There is no shared store.
- **No persistence.** Restart and the history is re-walked from the chain, which is correct but
  not instant, and which depends on the RPC having the transactions.
- **No authentication on reads.** Watching any fly is open to anyone, by design.
