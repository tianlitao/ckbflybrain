# Signers: what a wallet can and cannot do for this project

**Built (2026-09-17).** The signer layer exists and both candidate wallets are wired — the
one-line-swap property this note was written to protect is what made that possible, and it held:
`adapters()` in `deploy/public/wallet.source.js` is a two-line list. The shape chosen is §5's
option B in its honest form: **the server builds the transaction and the visitor's wallet signs
and pays**, so the page can be offered with no key on the server at all. What it does, what it
costs and the two traps it hit are in `deploy/README.md` under "Wallets".

**Decision recorded (2026-09-16): JoyID is deferred.** The target is an EVM or UTXO Global wallet,
and the signer layer should be written so that swapping in JoyID later is a one-line change rather
than a project. Everything runs against **preview testnet**; the local dev chain's node, miner and
indexer have been stopped.

This note replaces an earlier one that planned the JoyID integration. It is kept — and kept
detailed — because the research behind the decision is the useful part, and because one of its
findings contradicts the reason the decision was made.

Everything below was checked against the installed packages, against npm, and against preview
testnet. Commands are given so the claims can be re-run.

---

## 1. The constraint that decides the shape

`flylock` accepts every transaction, and the fly's type script pins **`output.lock == input.lock`**.
`contracts/flylock/src/main.rs` states the consequence in its own words:

> Because the type script pins `output.lock == input.lock`, the lock is chosen once, at genesis, and
> can never change. A deployer who wants a private fly simply creates the genesis cell under a
> `secp256k1_blake160` lock instead of this one, and the same type script enforces the rest.

Three things follow, and they are unchanged by which wallet is chosen:

1. **No contract change is needed.** The type script does not care which lock it sees. A wallet's
   lock is a *parameter*.
2. **A wallet cannot be added to a fly that exists.** The four organisms on preview testnet are not
   candidates; a wallet-locked fly would be a fifth.
3. **The work is in `createGenesis`**, which currently hardcodes `flylock` for both the state cell
   and the chronicle.

And one that is worth saying plainly: **the public fly does not need a wallet in order to be
driven.** `flylock` accepts anything, so "who may tick" is not a chain question for a public fly —
`INDEXER_ALLOW_DRIVE` and the server's ownership check are *policy*, not law. A wallet's value here
is not "let people drive the fly". It is one of the options in §5.

---

## 2. What CCC actually gives you

`@ckb-ccc/core` (1.21.0, installed) ships these **concrete** signers:

`SignerCkbPrivateKey`, `SignerCkbPublicKey`, `SignerCkbScriptReadonly`, `SignerCkbAlwaysSuccess`,
`SignerJsonRpc`, `SignerMultisigCkbPrivateKey`, `SignerMultisigCkbReadonly`,
`SignerNostrPrivateKey`, `SignerNostrPublicKeyReadonly`, `SignerDogePrivateKey`,
`SignerDogeAddressReadonly`, `SignerBtcPublicKeyReadonly`, `SignerEvmAddressReadonly`,
`SignerDummy`, `SignerAlwaysError`, `SignerOpenLink`.

Plus five **abstract** ones that a wallet package must subclass: `SignerEvm`, `SignerBtc`,
`SignerDoge`, `SignerNostr`, `SignerMultisig`.

There is **no JoyID signer and no UTXO Global signer in core.** Per-wallet support ships as sibling
packages, and both of the candidates exist:

| | `@ckb-ccc/utxo-global` | `@ckb-ccc/joy-id` |
|---|---|---|
| version | 1.2.3 | 1.2.3 |
| description | "Common Chains Connector's support for UTXO Global" | "Connector's support for JoyID" |
| depends on | `@ckb-ccc/core: 1.21.0` | `@ckb-ccc/core: 1.21.0`, `@joyid/ckb`, `@joyid/common` |
| entry point | `getUtxoGlobalSigners(client)` | `getJoyIdSigners(client, name, icon)` |
| mechanism | reads a provider injected at **`window.utxoGlobal`** | opens a **popup** and uses `postMessage` |
| also yields | BTC, DOGE signers | BTC, EVM, Nostr signers |

Both are pinned to **exactly the `@ckb-ccc/core` version installed here**, both are a factory
function returning `ccc.SignerInfo[]`, and **neither needs `@ckb-ccc/connector-react` or React**.

`SignerJsonRpc` is the generic path — any wallet that can hand the dapp a JSON-RPC *transport*
speaking `connect` / `sign_message` / `sign_transaction` (network ids `ckb-mainnet`, `ckb-testnet`)
works through it. But core provides no transport and no wallet discovery, which is precisely why the
`@ckb-ccc/connector` package carries libp2p, WebRTC and QR dependencies. Reaching a wallet through
core alone means bringing your own transport.

---

## 3. The finding that contradicts the reason for the decision

The decision was made on the understanding that JoyID is more complex, and that UTXO Global would be
simpler. **At the integration level that is not true.** Both are one package, one factory function,
no connector, no React, and a dependency on the exact core version already installed. Swapping JoyID
for UTXO Global saves no integration work at all — it changes which wallet the user has to have.

What genuinely differs is the **browser constraints**, and they are worth knowing because they are
the things that will actually bite:

| | UTXO Global | JoyID |
|---|---|---|
| what the user needs | a **browser extension** | nothing installed — a JoyID web app and a passkey |
| popup | none | **every** connect and sign opens `window.open` |
| user gesture required | no | **yes** — a popup opened outside a click handler may be blocked |
| WebView / PWA standalone | works | **does not work**; returns `SignerAlwaysError` ("JoyID can only be used with standard browsers") |
| subkey path | n/a | requires the account to hold a **COTA cell** |
| runs in Node | **no** (needs the extension) | **no** (needs `window.open`, `localStorage`, `postMessage`) |

So the honest summary is: **JoyID is more constrained, not more work.** Both are browser-only, so
neither helps the keeper — see §6.

There is also a detail that removes any dependency-level saving: **`@ckb-ccc/core` depends on
`@joyid/ckb` directly** (`^1.1.4`), and its ESM dist imports it. Shipping CCC to a browser ships
JoyID's SDK whether or not JoyID is offered as a wallet.

When JoyID is picked up again, one thing is already checked: its lock's location on preview testnet.
Two published sources disagree — CCC's table names `0x4a596d31…:0` with `depType: "code"`, while
`@joyid/ckb`'s constants name `0x4dcf3f3b…:0` with `depType: "depGroup"` — and
`cd deploy && CKB_RPC_URL=https://testnet.ckb.dev/ node probe-joyid-dep.mjs` resolves both against
the chain. Both are correct and they are different things: CCC points at the lock binary (100,336
bytes), while the dep group expands to six members — that same lock plus the five algorithm binaries
it dispatches to. **Use the dep group; it is the self-contained reference.**

---

## 4. The real cost: the front-end has no build step

*(Resolved. The build step exists — `deploy/build.mjs`, esbuild, `make build-front-end` — and
`public/app.source.js` is bundled into the served `public/app.js`. Measured: **19 KB → 860 KB**,
which is CCC plus two wallet adapters. The analysis below is what predicted it, and it was right
about the shape and about the reason: the front-end stayed dependency-free until there was
something to depend on.)*

This is the finding that matters for scheduling, and it is the same for either wallet.

`deploy/public/app.js` is a plain ES module loaded by `index.html`. There is no bundler, no React,
and no import map. The question is therefore whether a browser can load the adapter as-is:

- `@ckb-ccc/utxo-global`'s ESM entry is **5,385 bytes** and imports **`@ckb-ccc/core` as a bare
  specifier** — one bare import, resolvable by an import map.
- `@ckb-ccc/core`'s ESM dist is **1.1 MB across 7 files**, and it imports a dozen bare specifiers of
  its own: `@joyid/ckb`, `@noble/ciphers`, `@noble/curves`, `@noble/hashes` (six subpaths), `bech32`,
  `bs58check`, `ethers`, `isomorphic-ws`, `uint8array-extras`.

An import map is *possible* — it would have to enumerate all of those plus their transitive
dependencies, including `ethers`. That is a bundler's job, maintained by hand. **The real work of any
wallet integration here is adding a front-end build step and serving a bundle**, and it is the same
work for UTXO Global and for JoyID.

One detail that only shows up when you import them: **the two adapters export namespaces, not
functions.** `@ckb-ccc/utxo-global`'s `dist/index.mjs` is `export { t as UtxoGlobal }`, so it is
`UtxoGlobal.getUtxoGlobalSigners(client)` and not `import { getUtxoGlobalSigners }`; JoyID is the
same with `JoyId`. §2 lists the entry points by their function names, which is how they are
documented, and the import is one level up from that.

---

## 5. The options, re-framed for a wallet

Before adding a browser wallet, the common foundation is now implemented: `deploy` and `genesis`
accept `--lock` and the type script's existing `output.lock == input.lock` rule does the rest.

```sh
node src/cli.js deploy --lock owner     # a private fly under the deploying key
node src/cli.js genesis --lock owner    # another private fly from existing code cells
node src/cli.js deploy                  # the public `flylock` default
```

`status` says whether the selected fly is public (`flylock`), private under this server's owner
key, or wearing somebody else's lock. Actions refuse before transaction construction when the
server's key cannot satisfy the lock. The browser reports the same reason and disables Drive.
The lock is recorded in `record.fly.lockScript`; no new contract or code cell is needed.

**Verified on preview testnet** (2026-09-16): a fifth organism exists there wearing the
deployer's own `secp256k1_blake160` lock, `lockKind` reports `owner`, and two clicks on the page
moved it `66 → 98 → 130` while the record's fly stayed at `160`. The first attempt at this
found the browser disagreeing with the server about the same organism — `drivable: false` with
the reason *"actions here would move the other fly"* while `POST /api/act` moved it — which is
recorded in `deploy/README.md` under "Two call sites, two answers to one question". The lock is
now the whole answer, in one function that both endpoints call.

### A. A private fly — the genesis lock becomes a parameter

`genesis` takes a lock (default `flylock`, or `secp256k1_blake160`, or a wallet's). State cell and
chronicle both wear it, and only a signature it accepts can advance the fly.

- **Buys:** a fly that is genuinely someone's. Upstream's `FlyBrain` is public and unownable; this is
  the CKB-native way to make an owned one, with no contract work.
- **Costs:** the owner must sign every transition, so the keeper cannot keep it alive.
- **Touches:** `createGenesis`, the deployment record (store which lock), `deploymentCost`, `status`,
  and the front-end's drive panel.
- **Testable with no wallet at all.** `secp256k1_blake160` exercises the whole path except the wallet
  ceremony. This is the first step, and it is independent of JoyID versus UTXO Global.

### B. A browser signer for the public fly

The page signs the tick itself, so the server holds no key for driving.

- **Buys:** it deletes a class of bug. Watching one organism and moving another was a real defect
  here — a `200`, a real transaction hash, and the fly on screen never moving — and the fix was a
  server-side ownership check plus a serialising gate. If the reader's own signature decides what
  moves, that whole surface disappears, along with `INDEXER_ALLOW_DRIVE`.
- **Costs:** it needs the build step from §4, and it needs the successor state. That state is the
  output of the neural simulation, and `flyplan` is a Rust binary; the JS mirror in
  `deploy/src/fly.js` is golden-tested for **encoders only**, not for the dynamics. A browser-side
  simulation would be a second source of truth for the one thing this port is about.
- **The honest form of B** is therefore narrow: **the server computes the unsigned transaction and
  the browser only signs it.** One implementation of the dynamics, no server key. This is the shape
  to build if B is chosen.

### C. A wallet as the code-cell lock

The code cells are locked by the deployer's `secp256k1`; that lock only matters for recovering the
~151,325 CKB they hold, once. **Not worth doing** — listed so it can be ruled out.

---

## 6. The keeper

A wallet-locked fly **cannot** be kept alive by the current keeper: the keeper runs in Node, and both
candidate wallets are browser-only. The options are:

- **Accept it.** A private fly needs a human. The keeper already knows how to refuse — it stops with
  a message when the fly is dead — and it should stop the same way when the lock is one it cannot
  satisfy.
- **Authorise a subkey** (JoyID only, and it needs a COTA cell). It makes the keeper's authority
  granted and revocable, which is better than a raw key in a file, at the cost of making JoyID's
  aggregator a dependency of the keeper's availability. Deferred with JoyID.

---

## 7. What I would do, and in what order

1. **The genesis lock parameter, with `secp256k1_blake160`.** No wallet, no WebAuthn, no build step,
   no new dependency. It makes "a private fly" expressible — a capability the contract already
   supports — and it exercises every part of option A except the ceremony. Verifiable on a dev chain
   in minutes. **Done, and verified on preview testnet** — see §5. The one thing it does not do is
   give the private fly a *record*: `genesis` writes one fly into the record, so a second organism
   created this way is on the chain with nothing on disk naming it. The page can watch and drive it
   (that is what the fifth testnet organism is), the CLI cannot address it, and a `record`-from-the-chain
   command would be the honest way to fix that rather than hand-writing a record.
2. **The front-end build step, and the signer layer written against CCC's `SignerInfo` contract** —
   a list of `{ name, icon, signer }` from a factory. Written that way, `getUtxoGlobalSigners` and
   `getJoyIdSigners` are both one-line swaps, which is what makes "UTXO Global now, JoyID later" true
   rather than aspirational. This step is required for either wallet, so it is not wasted by the
   decision. **Done** — `deploy/build.mjs`, and `adapters()` in `public/wallet.source.js`.
3. **Wire UTXO Global**, and a wallet-locked fly on preview testnet. **Half done**: UTXO Global is
   wired, and the wallet path is verified end to end on preview testnet with a real key
   (`prepare` → sign → commit, deployer ±0). What is *not* done is the wallet-locked fly: the four
   `flylock` organisms stay public, and a fifth one wearing a wallet's lock would need a `genesis`
   that the wallet signs, which is a different flow from driving an existing fly.
4. **JoyID later**, when its constraints are acceptable — most likely for a dapp that only ever runs
   in a normal browser tab, which this page does. **Wired already**, because it cost one line and
   it is the only wallet that needs nothing installed — which makes it the one every reader without
   an extension can actually use.

## 8. What is still needed from you

- **Which wallet you actually have.** Both are wired and the page lists whatever the browser
  offers, but only you can say whether that list contains something you can sign with. If it does
  not, the page says so rather than failing silently.
- **Whether the wallet ceremony survives contact with a real extension.** Everything except the
  ceremony is verified on preview testnet; a real UTXO Global install is the one part no headless
  run can fake. If it trips the guard in `wallet.source.js` ("the wallet returned a different
  transaction … Nothing was sent"), the reply shape is the thing to look at — see the
  `Transaction.from` trap in `deploy/README.md`, which is exactly that failure one layer down.
- **Which chain.** The UTXO Global extension supports testnet, so this is about which wallet account
  you want to use and whether real CKB is involved.
