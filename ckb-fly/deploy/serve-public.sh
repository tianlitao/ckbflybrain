#!/usr/bin/env sh
#
# Run the indexer as a public server.
#
# This is the configuration `docs/hosting.md` argues for: no key, loopback only, an explicit
# RPC, and nothing on the process that can sign. It is a script rather than three lines in a
# README because two of those are easy to get wrong in a way that stays invisible until it is
# expensive:
#
#   * **`CKB_RPC_URL` unset means "a dev chain".** The network is *inferred* from the URL, and
#     the network selects both the deployment record and the key file. A public host that
#     forgets it reads `deployment.json` and `.key` — the dev chain's files — and then either
#     fails or, worse, serves an organism that is not the one that was meant.
#
#   * **`INDEXER_ALLOW_DRIVE=1` exposes `POST /api/act`**, which signs with the server's key.
#     Nothing in this server rate-limits anything, and one `feed` click moves the operator's
#     CKB into a body the type script forbids ever emptying. It is refused here unless the
#     environment says, in so many words, that you meant it.
#
# Usage:
#
#     ./serve-public.sh                    # start
#     PORT=9000 ./serve-public.sh          # somewhere else
#     CKB_RPC_URL=https://... ./serve-public.sh
#
# Environment:
#
#     CKB_RPC_URL              required, and must not be a loopback address
#     PORT                     default 8899
#     INDEXER_POLL_MS          default 3000
#     INDEXER_ALLOW_DRIVE      refused; see above
#     FLY_ALLOW_PUBLIC_DRIVE   set to `yes` to get past that refusal
#     FLY_STATE, FLYPLAN       as in `src/serve.js` and `src/plan.js`

set -eu

cd "$(dirname "$0")"

say() { printf '%s\n' "$*" >&2; }
die() { say "refusing to start: $*"; exit 1; }

# ---------------------------------------------------------------- the two dangerous ones

RPC="${CKB_RPC_URL:-}"

if [ -z "$RPC" ]; then
  die "CKB_RPC_URL is not set.

  It has no useful default here. The network is inferred from this URL, and a loopback URL
  means \"a dev chain\", which selects deployment.json and .key — the wrong record and the
  wrong key on a public host. Say which chain you mean:

      CKB_RPC_URL=https://testnet.ckb.dev/ ./serve-public.sh"
fi

case "$RPC" in
  http://127.0.0.1* | http://localhost* | http://\[::1\]*)
    die "CKB_RPC_URL is a loopback address ($RPC).

  That is read as \"a dev chain\", so this process would look for deployment.json and .key
  rather than the files for the network you deployed to. On a public host, point it at the
  real chain — ideally a node of your own, because a public RPC can truncate the history
  (see docs/hosting.md)."
    ;;
esac

if [ "${INDEXER_ALLOW_DRIVE:-}" = "1" ] && [ "${FLY_ALLOW_PUBLIC_DRIVE:-}" != "yes" ]; then
  die "INDEXER_ALLOW_DRIVE=1 is set.

  That exposes POST /api/act, which signs with this server's key. Nothing in this server
  rate-limits anything, so on a public host that is a wallet button for the whole internet:
  one 'feed' click moves 1 CKB of your money into the organism's body, where the type script
  forbids ever removing it.

  Leave it off — the page is still fully usable, because a visitor who connects a wallet
  drives the organism through POST /api/prepare, which signs nothing and spends nothing of
  yours. If you have put a rate limiter and a spend cap in front of /api/act and still want
  this, set FLY_ALLOW_PUBLIC_DRIVE=yes to say so."
fi

# ---------------------------------------------------------------- the build artifacts
#
# Both of these are build products and neither is in git, so a fresh clone fails on them.
# Checked here because the error `serve.js` produces otherwise names a path inside the
# repository rather than the command that creates it.

if [ ! -x "${FLYPLAN:-../target/debug/flyplan}" ] && [ ! -x "${FLYPLAN:-../target/release/flyplan}" ]; then
  die "the planner binary is missing.

  The successor state must come from the same Rust the validator runs, so the server shells
  out to \`flyplan\` and cannot start without it. Build it:

      cd .. && make plan"
fi

if [ ! -f public/app.js ]; then
  die "public/app.js is missing.

  It is the bundle the page actually loads, and it is deliberately not in git — the sources
  are. Build it:

      cd .. && make build-front-end"
fi

# ---------------------------------------------------------------- what it is about to do
#
# Printed before the server's own output, so a log file says which configuration was in
# effect even if the process died during its first poll.

PORT="${PORT:-8899}"
say "ckb-fly indexer, public configuration"
say "  rpc        $RPC"
say "  listen     http://127.0.0.1:$PORT  (loopback; put a tunnel or proxy in front)"
say "  polling    ${INDEXER_POLL_MS:-3000} ms"
if [ -n "${CKB_PRIVATE_KEY:-}" ] || [ -f "${FLY_KEY_FILE:-.key.preview}" ]; then
  say "  key        found, and unused: drive is off, so nothing will be signed with it"
else
  say "  key        none, which is what this configuration wants"
fi
say ""

exec node src/serve.js
