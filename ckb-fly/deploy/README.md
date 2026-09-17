# Deploying, driving and watching the fly

This directory is everything that talks to a chain. Three jobs, one npm install:

| | what | entry point |
|---|---|---|
| **Deploy and drive** | build, sign and send transactions; keep a record of what was deployed | `src/cli.js` |
| **Keep alive** | tick on a schedule, feed when the fly runs low, retry when someone else got there first | `src/keeper.js` |
| **Index** | recover a fly's whole life from the chain | `src/history.js` — used by the CLI, and by the page through `public/chain.source.js` |
| **Show** | a page that draws the ring attractor, the heading and the walk, and reads the chain itself | `public/` |

The neural work is not here. It is in `crates/flyplan`, a host binary over `flycore` — the
same crate the on-chain validator runs.

| | what | where |
|---|---|---|
| `crates/flyplan` | state + action → the bytes a transaction must carry | Rust, over `flycore` |
| `deploy/` | build, sign, send, index, serve | JavaScript, over [CCC](https://github.com/ckb-devrel/ccc) |

The split is not tidiness. A CKB transaction has to carry the **exact** successor state and
the **exact** capacity the economics allows — the type script compares both for equality —
so whoever builds a transaction must compute the next state, and the only implementation of
the dynamics allowed to be authoritative is the crate the validator runs. `deploy/` asks
`flyplan` for the state, the witness, the args and the capacity, and spends its own code on
the chain half. A JavaScript reimplementation of the simulation would be a second source of
truth for the one thing the whole port is about.

---

## Running it

```sh
cd deploy
npm install
node src/cli.js key     # on a real network: makes a key and says where to fund it
node src/cli.js plan    # what a deployment would create, and what it would cost
```

`key` matters on anything but a dev chain. A deployment's code cells are locked by the
deploying key, so it has to be one nobody else has — and the dev chain's key is published in
`resource/specs/dev.toml`. The deployer therefore **refuses to use it on any other network**,
rather than quietly locking someone's testnet funds to a key the whole world has. Resolution
order is `CKB_PRIVATE_KEY`, then `FLY_KEY_FILE` (default `deploy/.key.<network>`, or
`deploy/.key` on a dev chain), then the dev key, and the last one only on a dev chain.

The record is named the same way: `deploy/deployment.json` on a dev chain,
`deploy/deployment.<network>.json` anywhere else. Both defaults are keyed to the network
because the alternative was a trap that cost 151,325 CKB to discover — see
[A record belongs to one network](#a-record-belongs-to-one-network).

```text
  address   ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfzqfc9ys2rv2wg8avksdhh9slpmxje32s2cj47p
  network   preview  (https://testnet.ckb.dev/)
  balance   300,000 CKB

  a first deployment locks:
    flybrain code cell         64,965 CKB
    flylock code cell          20,797 CKB
    flyworld code cell         50,437 CKB
    connectome table           15,126 CKB
    the fly                     1,600 CKB
    its chronicle               1,000 CKB
    total                     153,925 CKB  (all refundable in principle)

  The address has no CKB yet. The faucet gives 300,000 per address per month, so one
  claim covers this. It asks for a GitHub login, which is the one step of this that a
  program cannot do for you.

  Claim at  https://faucet.nervos.org/  then run `node src/cli.js balance`.
```

The cost is computed from the artifacts rather than written down — a number in a message is a
number that goes stale, and the flybrain binary grew by 168 bytes the moment the args gained
an instance field.

`plan` touches no network. It prints the fly's identity — the two code hashes, the
connectome commitment, the type script hash, and every capacity — which is worth reading
before any of it is committed to a chain.

```sh
node src/cli.js deploy              # public fly: flylock accepts any transaction
node src/cli.js deploy --lock owner    # private fly: only this key's secp256k1 lock accepts it
node src/cli.js status              # read the fly, including public/private lock kind
node src/cli.js history             # recover its whole life from the chain
node src/cli.js tick 64
node src/cli.js stimulate 1 4 4 32  # channel 1 (cue), wedge 4, strength 4, 32 steps
node src/cli.js feed 10000
node src/cli.js resurrect 10000 1234
node src/cli.js adopt               # rebuild a lost record from the live code cells
node src/cli.js genesis --lock owner # another private fly from the same code cells
npm run keeper                      # keep it alive, and keep a ledger of what that cost
npm run build:front-end              # bundle app.source.js into the served public/app.js
```

`--lock` is permanent: the type script requires every successor to wear the same lock as its
predecessor. It accepts three forms:

| value | meaning |
|---|---|
| `flylock` | default; anyone may advance the fly, because the permissive lock accepts every transaction |
| `owner` | the deploying key's own `secp256k1_blake160` lock; a private fly |
| `<codeHash>:<hashType>:<args>` | any lock script, including a wallet lock; `hashType` is `data`, `data1`, `data2` or `type` |

A wallet lock is therefore a genesis choice, not a setting that can be added to an existing
fly. The current server can only sign `flylock` or a private fly wearing the same owner lock;
for a different lock it refuses before building a transaction. The page reports the same fact,
so a private fly that this server deployed but cannot sign for does not show misleading Drive
buttons. A future UTXO Global or JoyID signer belongs in the browser-side signing layer, not in
this Node keeper.

`adopt` exists because `deploy` sends the four code cells and only *then* writes the record —
it cannot know the transaction hash before the chain assigns it — so anything that fails in
between leaves the cells on chain and the record unwritten. Since the cells are referenced by
`code_hash` and `hash_type: data1`, i.e. by the hash of their contents, a lost record is
recoverable from the artifacts on disk. `adopt` finds the live cells by hashing their data,
which doubles as proof they are still unspent, and refuses if any artifact has zero or two
matches rather than guessing.

Each deployment mints a random eight-byte **instance** nonce, and it is part of the fly's
type script args. That is what makes two flies with the same genome two organisms rather
than one: without it they would share a type script, "find the cell wearing the fly's type
script" would find an arbitrary one of them, and a keeper driving both would tick first one
and then the other — the step counter going backwards, and nothing erroring. `flyplan args`
requires `--instance` for the same reason: a default would be a zero nonce, and the mistake
is silent.

Channels are `1` cue, `2` turn left, `3` turn right, `4` shock. `tick` and `stimulate`
take 1..=64 steps, because that is what the parameters allow; `stimulate`'s step count is
simulated *after* the stimulus is armed, so `stimulate(1, 4, 4, 32)` is "steer, then run 32
steps" in one transaction. It has to be one transaction: a state cell can only be consumed
once per version.

### Watching it

```sh
npm run serve                        # http://127.0.0.1:8899
```

`npm run serve` is a static file server over `public/` — `src/static-page.js`, and all of it.
There is no indexer: the page reads the chain itself over JSON-RPC, computes the successor
state with `flywasm`, and builds its own transaction, so there is nothing left for a server
to do but hand over files. It exists for development and for reading the page from this
machine; a public deployment uploads `public/` to any static host and runs nothing.

To *move* the fly from the page, connect a wallet: you pay, you sign, and the page never sees
your key. The server has no key of its own, so there is no flag that would let it spend one.

The page lists every organism on the chain and lets you watch any of them. Discovery is by
**code hash with a prefix match on the args**, which is the only search that can express "any
fly" — each fly has a different type script, so there is no single script to look up. (The
indexer does not support `script_search_mode: "partial"`; `"prefix"` with an empty args
prefix does the job.) The chronicle is then found the other way round: its args are exactly
`version ‖ fly type hash`, so a prefix match on those 33 bytes identifies one fly's chronicle
and no other's.

The page draws the ring of 155 neurons (compass cells outside, one arc per wedge of the
ellipsoid body; the rest inside, grouped by cell type), the population vector that is the
fly's heading, and the path those headings have carried it along. Colour is membrane
potential. Between two on-chain states the page interpolates — the chain's states are the
frames that actually happened, and the smoothing between them is the only thing on the page
that is not literally from a cell.

**Nothing on this page signs anything.** Every move is paid for and signed by the reader's own
wallet; the only key that ever appears in a process here is the one the CLI and the keeper use
from `deploy/.key.<network>`, and the page cannot reach it.

### Configuration

| variable | default | meaning |
|---|---|---|
| `CKB_RPC_URL` | `http://127.0.0.1:8114` | the node |
| `CKB_PRIVATE_KEY` | — | who pays, and who owns the code cells. An explicit choice, always used |
| `FLY_KEY_FILE` | `deploy/.key.<network>` (`deploy/.key` on a dev chain) | the file `node src/cli.js key` writes |
| `CKB_NETWORK` | inferred: `devnet` for a loopback RPC, else `preview` | which system scripts to use |
| `FLY_MODE` | `release` | `build/release/` or `build/debug/` |
| `FLY_PARAMS` | `v1` | `v1` (bit-exact with BSC mainnet), `v2`, `sim` |
| `FLY_ECON` | `testnet` | `testnet` (0.0001 CKB per step of life), `free` |
| `FLY_ENERGY` | `1000000` | steps of life the newborn fly starts with |
| `FLY_STATE` | `deploy/deployment.<network>.json` (`deploy/deployment.json` on a dev chain) | where the deployment record goes |
| `FLYPLAN` | `target/{debug,release}/flyplan` | the planner binary |
| `PORT` | `8899` | what `npm run serve` listens on |
| `KEEPER_INTERVAL_MS` | `5000` | how long the keeper waits between ticks |
| `KEEPER_STEPS` | `64` | steps per tick |
| `KEEPER_FEED_BELOW` | `200000` | feed when the fly has fewer steps of life than this |
| `KEEPER_FEED_AMOUNT` | `1000000` | steps of life to buy when it does |
| `KEEPER_MAX_TICKS` | unlimited | stop after this many ticks |
| `KEEPER_RESURRECT` | unset | set to `1` to let the keeper revive a dead fly |
| `KEEPER_DRY_RUN` | unset | set to `1` to decide and report without sending |

`CKB_NETWORK=preview` is what a real deployment uses; the same code path works against
testnet because the well-known scripts' code hashes are properties of the binaries and are
identical on every chain.

`CKB_RPC_URL` is the only variable a testnet run needs to set. Everything else follows from
it, including the two paths above — which is deliberate, because a relative `FLY_STATE` is
resolved against the *current directory* rather than the project root, and the commands are
normally run from `deploy/`. `FLY_STATE=deploy/deployment.preview.json` therefore means
`deploy/deploy/deployment.preview.json`. That is a real path nobody has, and it was
discovered only after a transaction had been sent (see below).

### The keeper

```sh
npm run keeper
KEEPER_MAX_TICKS=10 npm run keeper     # ten ticks, then a ledger
```

A tick releases `backing_per_step` for every step it advances, and feeding costs exactly the
same per step bought. So **a keeper's reward is exactly the life it burns** — it is a
conduit, not an income — and the ledger says so rather than dressing it up:

```text
ledger
  ticks         6
  released      0.0384 CKB  (taken from the fly)
  added         0 CKB  (put back)
  net           0.0384 CKB
  fees paid     0.0001431 CKB  (6 transactions)
  margin        0.0064 CKB released per tick against 0.00002385 CKB of fee (profitable by 268×)
```

The fee is measured from the transactions the keeper sent, not from its balance. A balance
measures everything a key did — on a dev chain the mining reward is paid to the same key,
which made the first version of this report a rise of 601,318 CKB in seventeen seconds.

That margin was measured on a dev chain and then again on preview testnet, where it came out
at the same `0.00002385 CKB` per action. CKB charges by transaction *size*, not by a gas
price, so a keeper's economics can be established locally and are expected to hold on mainnet.
The only variable left is how much someone is willing to feed.

**It retries, because it has to.** A cell is a UTXO: the same version of the fly can be spent
once, so two keepers cannot both tick it. One wins; the other is rejected. That is the model
working, so the rejection is counted and the loop re-reads.

There are two shapes of that rejection, and telling them apart is what keeps the keeper alive:

```text
Resolve failed Unknown(OutPoint(0x…))                              ← the winner already committed
PoolRejectedDuplicatedTransaction: … already exists in transaction_pool   ← still in the pool
```

The second one is easy to mistake for a real failure, and is worth understanding: a transaction
is a deterministic function of the cell it spends, the action and the fee, so **two keepers
ticking the same fly build byte-identical transactions and the same hash**. Run three keepers
against one fly and the rejections split between the two — mostly duplicates, a few resolve
failures — depending only on whether the winner's transaction had committed yet. Both mean
"re-read and try again".

They were not always treated that way. Counting a duplicate as a failure is what made two of
three keepers give up after ten passes, and `consecutiveFailures` did not reset on success, so
its "too many failures in a row" message was reporting a lifetime total. Both are fixed, the
two kinds are counted separately, and the split is itself the diagnostic: all duplicates means
the keepers agree and are merely racing, while many lost races means they disagree and are
competing for different successors.

`KEEPER_RESURRECT=1` lets it revive a dead fly, which is off by default because that means
buying a life it cannot get back. A pass that resurrects ends there — the feeding and the ticking
happen on the next one — so a single run against a dead organism shows all three branches in
order: `resurrected: generation 1, 2 CKB bought`, then `fed 20,000 steps for 2 CKB`, then a tick.
The ledger's `added` counts both purchases (`4 CKB`) because it is the capacity that moved, and
`net` is `released − added` rather than a balance delta — which is the whole reason the fee is
measured from the transactions instead.

### The chronicle

`flyworld` guards a second cell per fly — a **chronicle** — and the deployer updates it in
the *same transaction* as every transition. That is not an optimisation; it is the only way
the design works. The chronicle is not told what the fly did, it is required to look at the
fly, and the only moment the fly is present to be looked at is the moment it moves.

So `deploy`, `tick`, `feed`, `stimulate` and `resurrect` all build transactions with the fly
and the chronicle as inputs and outputs, and `flyplan world-sight` computes the successor
chronicle from the fly's output state and the fly's capacities on both sides. If the
deployer and the contract ever disagree about that record, every transaction is refused —
which is why `test/world.test.js` pins the round trip.

`status` prints it:

```text
chronicle at 0x10c2f971ae512f7d69b903cd95804af65b044f92fadb925e8198bb909d906c15:1
  capacity      1,000 CKB (it never changes)
  life          alive, generation 0
  born at step  0
  last sighting step 192, energy 1008784
  sightings     7
  fed           1 CKB
  released      0.122 CKB
  net           +0.878 CKB (people have fed it more than tickers took)
```

### What it writes

`deployment.json` — or `deployment.<network>.json` off a dev chain — records the code cells'
out points and code hashes, the fly's type script and lock, its current state cell, its
chronicle, and a log of every action applied. It is chain state, not source: the out points
exist on one chain and nowhere else.

A reader of the record needs only the fly's **identity** from it — the type script, and from that
its hash — and then finds the current cell by asking the chain and walks backwards from there.
So the page can be pointed at a fly this machine did not create, as long as it knows the type
script hash; that is what `public/deployment.json` is for, and it is why the page can watch any
organism on the chain rather than only the one the record names.

---

## The event layer, and why it is not a log

Upstream, the live view, the replay and the death record were all built on three EVM
events: `Ticked`, `Fed`, `Stimulated`. The migration plan flagged their loss as the most
under-estimated piece of the port, and the worry was justified — there is no event log on
CKB, and no amount of wishing produces one.

The replacement is not a log. It is the chain. **A fly is a chain of state cells**: each
transition consumes one and creates its successor, so walking backwards from the current
cell through each transaction's fly input recovers the entire life, in order, with no gaps
and no way to lie about it.

The action comes back too, and for free. It is in the witness — and a witness is not a
claim about what happened, it is the *input the type script validated* before it agreed to
the transition. So a history entry is not the indexer's reading of what a transaction
meant; it is the same parse the contract performed. `flyplan decode-action` enforces that
by refusing anything the contract would have refused, which means the indexer is
structurally unable to report an action the fly would have rejected.

Two implementation notes worth keeping:

- **The fly input is found, not assumed.** It is the input whose previous cell wears the
  fly's type script. The deployer happens to put it at index 0, but the protocol promises
  only that the group has exactly one member, and an indexer that assumes more than the
  protocol promises is an indexer that breaks on someone else's transaction.
- **The walk stops at a known transaction.** That is what makes the index incremental:
  after the first read, a new tick costs one RPC call rather than a re-walk of the whole
  life.

```sh
node src/cli.js history
```

```text
  #  block    action                                   step   energy      spikes  head
   0      409  genesis (no fly consumed)                    0    1000000       0  (0, 0)
   1      416  tick(64)                                    64     999936       0  (0, 0)
   2      428  feed(10000)                                 64    1009936       0  (0, 0)
   3      434  stimulate(ch 1, p 4, str 4, 32 steps)       96    1009392     279  (-2446, 11821)
   4      437  tick(32)                                   128    1009360     533  (-835, 11896)
   5      444  tick(32)                                   160    1009328     533  (0, 0)
   6      447  stimulate(ch 4, p 0, str 4, 32 steps)      192    1008784     816  (0, 0)
```

Nothing in that table was emitted by anything. Every row is a state cell that exists, and
an action that a validator read.

### There is no API

There used to be one — `GET /api/fly`, `GET /api/flies`, `GET /api/state`, `GET /api/events`,
`POST /api/act`, `POST /api/prepare` — and it is deleted, not deprecated. A server that answers
those questions is a process somebody has to keep alive, and there is nothing left for it to
know:

| what a reader asks for | who answers it now |
|---|---|
| identity, circuit, prices, the current state, the whole history | `public/chain.source.js`, over JSON-RPC |
| every organism on the chain | the same, by code hash — see above |
| one past state, decoded on demand | `src/fly.js`'s `decodeState`, in the browser |
| a new transition, as it happens | the page polls every 3 s |
| the successor state | `flywasm`, in the browser — the same `flycore`, third target |
| an unsigned transaction to sign | `public/prepare.source.js` over `src/tx.js`, in the browser |

One row on that list has a story the others do not. `get_cells` does not return cell data, and a
spent cell can never be fetched again, so every history entry carries the `stateHex` it was
decoded from. That copy is the only one that will ever exist, and it is what makes "show me step
41" a purely local operation — measured in a browser, pinning a past state issues **no network
requests at all**.

The races below were measured against the old endpoints and are unchanged, because they are
properties of a public organism on a UTXO chain rather than of whoever served the page. A
**public** organism is a UTXO: two visitors clicking the same button at the same
moment do not both get their wish, and one of them does not get an error either. Measured in two
browser tabs on preview testnet, `tick 32` clicked simultaneously:

```text
visitor A (won)  → 200 after 21.3s   ok: true,  txHash 0x8168c845…, the fly advanced 32 steps
visitor B (lost) → 200 after  4.3s   ok: true,  duplicate: true, applied: true — no txHash
   "another visitor asked for exactly this, so the identical transaction is already on its
    way — a transaction is a function of the cell, the action and the fee, so two identical
    clicks are the same transaction. Nothing was lost; the organism will move when it is
    committed."
```

A transaction is a deterministic function of the cell it spends, the action and the fee, so **two
identical clicks are one transaction** and the node rejects the second as a duplicate. That is
not a failure and the loser was *already getting what they asked for* — before this was handled,
they were shown `PoolRejectedDuplicatedTransaction: Transaction(Byte32(0x…)) already exists in
transaction_pool` and told their click had failed.

The other race is the opposite, and it does not look like a race at all. Two *different* actions
build two different transactions from the same state cell; the node sees the second as a
replacement of the first and answers with a fee complaint — verbatim, from the second browser tab
in the same run:

```text
client  → refused: PoolRejectedRBF: RBF rejected: Tx's current fee is 2385,
                    expect it to >= 5962 to replace old txs
```

Nothing in that sentence mentions a cell, a race or another visitor, and it is the loser being
told their transaction did not happen. Classified as `fatal` — which it was, until this was
measured — it also **stopped a keeper the first time a visitor clicked on a fly it was minding**:
ten of these in a row read as "too many failures" and the keeper exited while the fly was
perfectly healthy. `RBF` is now in the lost-race patterns in `src/send.js`, so the visitor is told
what happened (`409`, `lost: true`, naming the organism and saying actions are not queued) and the
keeper keeps its hands on a fly that is being ticked by people.

Both kinds are answered as soon as the node has spoken, and the chain re-walk is *not* awaited:
walking a fly takes about twenty seconds, and making somebody wait that long to be told "someone
else got there first" is a worse page than one whose step counter catches up a few seconds later
through the poll. Measured: awaiting it turned an instant answer into 23s.

`meta` on a snapshot carries `drive` (a wallet is connected at all — the page has no key of its
own to ask this about), `drivable` (`driveAuthorization`: the lock the watched organism wears is
one that wallet can satisfy, which is the same rule the click is refused by, so the button state
and the answer cannot disagree), `as` (whose key that answer is about: `"wallet"`, or `"none"`
when no wallet is connected — there is no `"server"` any more), `prepare` (this page can always
build a transaction, because `flywasm` is the same `flycore` the validator runs), and
`collisions` — the type scripts worn by more than one live cell, which should always be empty.
See "A fly can branch" below. `count` is *transitions*, and `roster` is the organisms, because
one word for two quantities is how a client ends up reporting the wrong number.

---

## Wallets: a visitor signs, and nobody else can

A page that drives a public organism with a server's key is a page that needs a funded key on the
server, and every visitor spends it. There is no such key here, so there is no such choice: **the
page builds the transaction and the visitor's own wallet pays for and signs it.** The move button
is greyed out when no wallet is connected, and the reason it gives is that — on this page there
is nothing that can sign.

**The connect control is at the top right of the page**, above the identity table, and that
placement is the part of this that took a second attempt. The first version was correct and
unfindable: the panel was in the sidebar, below "Walk" and above "Drive" — in the DOM, wired up,
working — and the person it was built for looked at the page and said there was no wallet
connection on it at all. A dapp's connect button is a convention because it has to be found
without being looked for. The masthead is also a **grid with a bounded second column** rather than
a wrapping flex row, for a related reason: the identity table's widest row is a 64-character hash
with `word-break: break-all`, whose max-content width is enormous, and a wrapping row gives that
width to the column and pushes the whole thing — button included — onto a line of its own.

Why the split falls there, and why it used to fall differently: the successor state is the output
of the Rust simulation, and recomputing it in JavaScript would put a second implementation of the
one thing this port is about on the far side of a network boundary, where it can disagree with the
type script about what a tick produces — and the disagreement would arrive as a rejected
transaction with no explanation. So it was the server's job, because the server could shell out
to `flyplan`. It is the browser's job now, because `flycore` compiles to `wasm32` as
`crates/flywasm` and `make test-wasm` compares its answers to `flyplan`'s byte for byte. Same
crate, third target: not a second source of truth. The wallet still does only the part that needs
a private key.

### The contract between the two halves

`createPrepare` in `public/prepare.source.js` returns an **unfinished** transaction — no fee
inputs, no signature — and the page does exactly four things with it. All four are in
`public/wallet.source.js`, and three of them are not optional:

```js
const tx = ccc.Transaction.fromBytes(prepared.tx);   // ← not `from`, see below
await tx.completeFeeBy(signer, BigInt(prepared.feeRate));   // the visitor pays, change is theirs
tx.setWitnessArgsAt(prepared.flyInputIndex, { inputType: prepared.action });   // ← again, after
const signed = await signer.signTransaction(tx);     // the wallet signs
```

* **The action witness is set twice, by design.** It lives in witness 0's `inputType`, and
  `completeFeeBy` adds the payer's inputs and change — which can rewrite the witness list. Set it
  before (so the size estimate includes it) *and* after. A transaction whose witness list was
  rebuilt and not re-set is accepted by the node and refused by the type script for a reason
  (`MissingWitness`) that says nothing about what happened.
* **`flyInputIndex` is 0 and named anyway.** The contract reads the action from witness 0 of its
  *input group*, and that group must have exactly one member.
* **The signed transaction is checked against the unsigned one before it is sent.** Inputs,
  outputs and cell deps are what a signature must not change; only the witnesses may differ. A
  wallet that returns a *different* transaction — a bare transfer, an empty one, the same one
  with the action dropped — is refused, and nothing is broadcast. The alternative is a
  transaction nobody can explain, which this project has already had once.

### The trap that cost this its first attempt: `Transaction.from` accepts anything

CCC has two decoders, and handing the wrong one a hex string does not fail:

| call | on the same 2,090-byte prepared transaction |
|---|---|
| `Transaction.fromBytes(hex)` | **2 inputs, 2 outputs, 1 witness** — correct |
| `Transaction.from(hex)` | **0 inputs, 0 outputs, 0 witnesses** — a valid, empty transaction |

`from` takes a `TransactionLike` *object*; a string has no `inputs` key, so it builds an empty
transaction and returns it. The first attempt at this flow fed that empty transaction to
`completeFeeBy`, which dutifully added one input and one change output, signed a bare transfer,
and sent it — and the node rejected it for its fee rate, which is the *best* outcome available to
that mistake. Two of the three guards above were written because of it: a wallet adapter that
decodes its own wallet's reply the same way would be wrong in exactly this way, one layer down,
and the page now refuses rather than broadcasting.

### What it costs, measured on preview testnet

A visitor with a funded wallet drove the public organism with `POST /api/prepare` and a
signature, and the whole point is in the last two lines:

```text
prepare      200, a 2,090-byte transaction, step 321 → 353 predicted
signed       the visitor's key; inputs 2 → 3 after the fee, outputs 2 → 3
committed    0x649df93c49ea05219ba2892e09f6edc89b4b391930109f5ce62db6abe21afec8
             the fly is at step 353, exactly as predicted

deployer     −0.00000000 CKB      ← the server's key is not in the transaction at all
visitor      +0.00317615 CKB      ← 32 steps released 320,000 shannons; the fee was 2,385
```

**Ticking pays the ticker**, so a visitor driving the public fly costs the operator nothing and
is mildly profitable for the visitor. That is not a quirk of this page: it is the same economics
the keeper measures, and the reason the keeper is a break-even conduit rather than a business.

Two consequences worth stating plainly:

* There is no server key to authorise any more, and no flag that would turn one on. The wallet
  path is the only path, and the Drive panel's note says so when no wallet is connected.
* A wallet-driven click returns as soon as the node *accepts* the transaction rather than waiting
  for it to commit (the server-signed path used to wait, measured at 21–61 s). The page's status
  line says what happened to the click.

### Which wallets

Both CCC per-wallet adapters are wired, and the list is filtered to signers that can sign a
**CKB** transaction — `info.signer.type === ccc.SignerType.CKB`. Without that filter the page
offers JoyID's BTC, EVM and Nostr signers and UTXO Global's BTC and DOGE ones, which are real
signers for other chains and produce a failure deep inside fee completion, or a signature over
the wrong preimage, if they are picked from a list that does not say so.

| adapter | needs | in a browser with nothing installed |
|---|---|---|
| `@ckb-ccc/utxo-global` | the extension (`window.utxoGlobal`) | returns an empty list — it checks for the provider and returns `[]` rather than throwing |
| `@ckb-ccc/joy-id` | nothing: a popup and a passkey | one CKB signer, offered immediately |

Adding a third is one line in `adapters()` in `public/wallet.source.js`, which is what makes the
"UTXO Global now, JoyID later" decision in [`../docs/signers.md`](../docs/signers.md) a decision
about which wallet a reader must have rather than about how much work it is.

The front-end is now **bundled** (`make build-front-end`, esbuild): `public/app.source.js` is the
file to edit, `public/app.js` is served, and `public/wallet.source.js` is where the wallet lives.
`app.js` went from 19 KB to 860 KB, because that is what CCC plus two wallet adapters weigh — the
build step `signers.md` predicted this would need, and the reason the page could stay
dependency-free until there was something to depend on.

---

## A dev chain

Nothing here needs a public network. A local chain is faster, free, and the only place to
test a change to the contracts.

```sh
# One-off: build a node and initialise a chain.
git clone --depth 1 --branch v0.209.0 https://github.com/nervosnetwork/ckb <somewhere>
cargo build --release --manifest-path <somewhere>/Cargo.toml
<somewhere>/target/release/ckb init --chain dev -C .devnet/node

# Every time: a node and a miner, in two terminals.
<somewhere>/target/release/ckb run   -C .devnet/node
<somewhere>/target/release/ckb miner -C .devnet/node
```

The dev chain pre-funds the key in `CKB_PRIVATE_KEY`'s default with 200 million CKB and
mines instantly, so `deploy` finishes in seconds.

**Both processes have to be running, and the failure is quiet.** `ckb run` does not mine;
mining is `ckb miner`, and if it stops — a closed terminal, a restarted shell — the node
keeps serving RPC and simply stops advancing. The symptom is a frozen tip with a non-empty
transaction pool, and every `waitTransaction` then hangs until its timeout. If something
times out against a dev chain, check the miner before checking the transaction:

```sh
curl -s -X POST http://127.0.0.1:8114 -H 'Content-Type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"tx_pool_info","params":[]}'
# tip_number stops moving and pending stays above zero
```

**The system scripts have to be discovered, not hardcoded.** `ckb init` bakes a timestamp
into the genesis cell, so the genesis block — and with it every system cell's out point —
differs on every machine. They are still findable: CKB's genesis contains one **dep group**
per well-known script, a cell whose data is the list of out points that script needs, and
`devChainScripts()` reads block 0 for them. It identifies which script each group serves by
the hash of the type script on the cells it points at — these cells are created with
`create_type_id = true`, so their `code_hash` is the hash of the **type script**, not of the
binary sitting in the cell. Hashing the data gives a plausible-looking value that matches
nothing; that was the first attempt.

---

## Preview testnet

The same code path, with one variable set. Nothing else is needed: the record and the key are
named for the network, and `CKB_RPC_URL` is what decides the network.

```sh
cd deploy
export CKB_RPC_URL=https://testnet.ckb.dev/

node src/cli.js key         # once: writes .key.preview and prints where to fund it
node preflight-testnet.mjs  # read-only: is the testnet path usable at all?
node src/cli.js deploy      # code cells, connectome table, first fly, chronicle
node src/cli.js status
```

`make preflight-testnet` runs the same check from the project root, so it sits next to
`make test-deploy` where someone looking for "how do I know this is ready" will find it.

`preflight-testnet.mjs` exists because of the one part of a testnet deployment that a dev
chain never exercises. `makeClient` borrows CCC's published testnet script table on every
network, but on a dev chain it *overwrites* the entries it cares about with out points read
out of block 0. On preview testnet the published table is used verbatim — out points and all
— so nothing checks that those out points still name live cells. A table entry is a claim
about a chain and cannot verify itself, and if one has rotted the failure lands after
funding. The preflight resolves the table against the chain, expands each dep group, and
confirms every cell it needs is live; it signs nothing and spends nothing.

**What is deployed there now** (2026-09-16), as a second independent verification of the
contracts — the first being the dev chain, and the reason it is worth having is that a dev
chain cannot check `hash_type` version selection at all:

```text
code cells       0x323509d1afda40a9d5d293488ee01554754b4850504e6c26fcdfd05c177449ad
  flybrain :0    0xff084a22b36c277697fedcbf0608bc9fe1081490284e283a776906933511223e
  flylock  :1    0x21211c3239a581f5ce6cb0e8d7b0f9adc77d22a98f63b102f8b92a93bb8c0f96
  flyworld :2    0x1c7478b15a9324d4478696929f866173bd218af5e2cb656d5203706acca11cae
  circuit  :3    0x291b9c167eca0c1001bdb11433eaea3b7383c3606ed3bfce63fb99e2fec552f2

genesis          0x69720eef168bfcdf2ee13be5fbbf21967dba2eb96e669138663903efe2a89dfc
  instance       0xa50e649a0fc87886
  type hash      0xceb14a928be0a296729989f789df565d2538d1f50c921f63b5cf43fcc75fd80f
  born block     22435791

tick(64)         0x7e4ad2ab3b95332a97d2b5bcce26ba7e3e74c9c0c766d8d828c615bc091e2ec2
  block          22435801
  step 0 → 64, energy 1000000 → 999936, released 640,000 shannons

second genesis   0x98111b300362610540a559c6771b6f52c3a61e871de9fb0073ad398d5ebdebbe
  instance       0xf60b8eb12f37b168      (a different organism from the same code cells)
  type hash      0x6419b09932761d52b0b85a301a2ebc81ff0cffc2c3865a3250b9943964668351
  born block     22436222

short-lived      0x1beeb7f85c1ccd2a005745fc1fb18bf6c8c15b14935ca512f1c9d648c904441b
  instance       0x1e58354fa9252974      (born with FLY_ENERGY=8, died, resurrected)
one-step         0x172c6e7011c360a1ad41c101124e6bf29311e0af458c7fa97d51c679af179533
  instance       0x45fd983252165b6f      (born with FLY_ENERGY=1, ticked to death and left dead)
```

The last two exist only as test subjects — a fly that takes 15,610 ticks to die is not a fly you
can check a death path with. They are real organisms on the chain, with their own type scripts and
chronicles, and nothing marks them as throwaway; the `instance` nonce is what keeps them from
being confused with the main one, which is the same mechanism that makes the roster work.

The tick is the part that matters. The contracts are built with `+zba,+zbb,+zbc,+zbs` and
declared `hash_type: data1`, and the only way to prove the node agrees is to make it execute
them: a wrong hash type produces `MemWriteOnExecutablePage`, not a wrong answer. A dev chain
cannot do that check, because `ckb-testtool` and the deployer's own dev-chain setup run the
newest VM regardless of what the script declares. A committed tick on preview testnet is
evidence, not a re-run of `--version`.

**Everything else that had only ever run on a dev chain was then run there too.** The point of
a second chain is that it disagrees with the first in the ways that matter, and it did:

| what | where | result |
|---|---|---|
| keeper, 4 ticks | preview testnet | `0.00002385 CKB` of fee per action against `0.0064 CKB` released — **268×**, the same margin the dev chain measured |
| keeper feeding | preview testnet | bought `20,000` steps for exactly `2 CKB`, then ticked in the same pass — the ledger's `added` is the capacity that moved, not a balance delta |
| keeper resurrecting | preview testnet | `KEEPER_RESURRECT=1` revived a dead organism (`generation 0 → 1`, `born at step 1`) and fed it on the next pass; one run exercised all three branches |
| three keepers raced | preview testnet | the identical transaction, repeatedly: `PoolRejectedDuplicatedTransaction` |
| second organism | preview testnet | roster of 2, `collisions: []`, each with its own history (960 vs 0) |
| switching | preview testnet | 5 organisms and one `key` badge; after a switch `watchingOwn` is `false` and the buttons are still live, because watching is unrestricted and is not what decides whether a button works |
| a private fly | preview testnet | an organism created by `genesis --lock owner`: it wears this server's own `secp256k1_blake160` lock and it is in **no record**. `lock: "owner"`, `drivable: true`, and two browser clicks moved it `66 → 98 → 130` while the record's fly stayed at `160` |
| one rule, two call sites | preview testnet | the same organism, before the fix: `drivable: false` with the reason *"actions here would move the other fly"*, while `POST /api/act` moved it. Five disabled buttons that worked, explained by two claims that were both false |
| two visitors, one button | preview testnet | two browser tabs clicking `tick 32` together: one `accepted 0x8168c845…`, the other `200 duplicate` with *"another visitor asked for exactly this"* — and the fly advanced **once**, because two identical clicks are one transaction |
| two visitors, two buttons | preview testnet | the same two tabs clicking `tick 32` and `tick 64`: the loser got `PoolRejectedRBF: … expect it to >= 5962 to replace old txs` — a fee complaint standing in for a lost race, which is also what stopped a keeper the first time a visitor clicked on a fly it was minding |
| a visitor's wallet | preview testnet | `POST /api/prepare` → the visitor's own key signed and paid → the fly went `321 → 353` (exactly the predicted transition, tx `0x649df93c…`), **the deployer's balance moved by `−0.00000000 CKB`**, and the visitor *gained* `0.00317615 CKB` |
| the wallet path with no key on the server | preview testnet | the same flow against an indexer started **without** `INDEXER_ALLOW_DRIVE`: `POST /api/act` answered `403` while the page's buttons were live and a wallet-signed click committed |
| the page, in a browser, with a stubbed wallet | preview testnet | no extension exists here, so `window.utxoGlobal` was faked and the real page ran: connect → address → live buttons → prepare → fee → sign. A wallet returning the transaction unchanged was broadcast and the node refused it at `Inputs[2].Lock` — the payer's own input, meaning everything about the fly's part verified; a wallet returning a hex, which the adapter cannot decode, was refused by the page and **nothing was sent** |
| the page itself | preview testnet | in a browser: 5 rows, one `key` badge, every panel's number equal to the chain's, and the drive guard correct in each of its reasons |
| `stimulate` | preview testnet | the simulation itself ran on chain: **213 neurons fired**, the head moved to `(-1207, 10898)`, 544 steps of life spent (32 of movement + 512 for a strength-4 stimulus) |
| `feed` | preview testnet | `+10,000` steps of life for exactly `+100,000,000` shannons, step and spikes unchanged — capacity moves *into* the cell, the opposite direction to a tick |
| death | preview testnet | body capacity lands on `150,000,000,000` — `body_capacity` to the shannon — and the chronicle records `died at step 8` without being told |
| resurrection | preview testnet | `generation 0 → 1`, `born at step 8`, `died at step` cleared, **and step stays at 8** — the two lives are comparable because time does not move |
| three refusals | preview testnet | a dead fly refuses `tick` (`Dead`) and `resurrect 0` (`BadBornBlock`); the keeper stops with "the fly is dead at step 1" and spends nothing |
| a branched fly | dev chain | refused by `liveCell`, and by the keeper, naming all three branches before either spent anything |

The branched-fly row is on the dev chain because that is where a permanently branched fly
exists to test against — `0x9d97272c…`, three live cells, unrepairable. Pointing a record at it
is a two-line probe and it is worth having: it is the one refusal that has to work at startup,
because a keeper that chose a branch would look perfectly healthy.

Three of the rows are worth their own paragraph.

**A private fly is not the same kind of thing as a public one, and until now the page could not
tell you which it was looking at.** `genesis --lock owner` produced an organism wearing this
server's own `secp256k1_blake160` lock — the same lock the code cells wear — and because
`genesis` writes exactly one fly into the record and that record already held another one, the
new organism exists on chain with **no record at all**: it is not what `status` describes, not
what the keeper ticks, and not what any CLI command addresses. It can be seen (the roster
enumerates by code hash and instance) and, it turns out, it could be moved — `POST /api/act`
answered `200` and advanced it. What it could not do was *show a button*. See the bite below.

**Fees do not depend on the network.** The keeper's per-action fee on testnet came out at
0.00002385 CKB against 0.0064 CKB released — a 268× margin, which is the number the dev chain
produced too. CKB charges by transaction *size*, not by a gas price, so this is not a
coincidence: it means a keeper's economics can be measured locally and will hold on mainnet,
and the only variable is how much someone is willing to feed.

**A race between two identical keepers does not look like a race.** A transaction is a
deterministic function of the cell it spends, the action and the fee — so two keepers ticking
the same fly build *byte-identical* transactions and the same hash. The second one to arrive is
not told "that cell is spent", it is told `PoolRejectedDuplicatedTransaction`. Run three
keepers against one fly and the rejections split: mostly duplicates (the winner's transaction
still in the pool) and a few `Resolve failed Unknown(OutPoint(…))` (the winner already
committed). Both mean the same thing and neither is an error — but the first version counted
both as failures and stopped after ten, so **two of three keepers gave up mid-experiment**. That
is fixed: `classifySendError` separates them, the ledger counts them separately, and
`consecutiveFailures` resets on success — it never did, so its "too many failures in a row"
message was reporting a lifetime total.

The `collisions: []` above is the load-bearing detail of the roster test. Two organisms from the
same genome share every byte of their *code* and differ only in the eight-byte `instance` nonce
inside their type-script args — so they are two type scripts, not two cells wearing one, and the
branch detector correctly stays silent. If the nonce were inherited rather than minted, the
roster would show one organism with two live cells and `collisions` would say so. That is the
regression `test/instance.test.js` pins, and this is what it looks like from the outside.

**And the page was checked in a browser, not over HTTP.** Every panel's number was compared
against the API the page was built from — `life = energy × backing/step`, `required = body +
life`, `held = required` reported as `ok`, `net = fed − released`, the roster's net, the
timeline's row count — because the panels are 12px text and `0.096` and `0.0064` are one glyph
apart. Reading a screenshot cannot answer a question like that; the first attempt at it
concluded there was a discrepancy, and there was not.

The browser run did find one thing, and it was not visible over HTTP at all. The drive buttons
are disabled for three reasons — this server cannot sign, it cannot sign *for this instance*, or
the reader has pinned a past state — and `renderDrive` computes all three. But `renderDrive` was
called from the snapshot path and not from `renderAll`, which is what `pin`/`unpin` call. So
`enabled = mayDrive && !pinned` had a half that never took effect: pinning the fly's birth left
live Drive buttons on screen, and clicking one would have advanced the *current* cell while the
page showed a past step. The transaction would have been valid and the reader's model of it
wrong — the same failure as the ownership bug, one layer down.

The shape of that mistake is worth naming, because a code review does not catch it: **a renderer
is a function of module state, so every state change has to call every renderer that reads it.**
Splitting "re-render everything" from "re-render after a fetch" is reasonable, but the split has
to be drawn by *what each renderer reads*, not by which code path felt like it needed a repaint.

**A refusal is only as specific as the check that fires first.** Asking a *live* fly to
`resurrect` with `bornBlock: 0` is refused — but with `NotDead`, not `BadBornBlock`. The contract
checks that there is something to resurrect before it checks the block number, and that ordering
is the whole answer to "why did it say that". It is not a defect: both refusals are correct and
both happen before a transaction is built, because the planner runs the same `flycore` the
validator does. It does mean a refusal is evidence about *one* check, so a claim like "the
contract rejects a backwards `bornBlock`" has to be made on a fly that is actually dead — which
is why the row above is tested the way it is, on a one-step organism built for the purpose.

---

## Seven things that will bite

### `hash_type: "data"` silently pins the script to CKB-VM 0

`"data"` and `"data1"` both identify a code cell by `blake2b256` of its contents, so both
give a code hash you can reproduce by rebuilding. They do not give you the same machine:

| hash type | CKB-VM | ISA | writable segments |
|---|---|---|---|
| `data` | 0 | `IMC` | marked frozen |
| `data1` | 1 | `IMC` + bit manipulation | writable |
| `data2` | 2 | `IMC` + bit manipulation | writable |

The contracts are built with `-C target-feature=+zba,+zbb,+zbc,+zbs`. On VM 0 those
instructions are not decoded at all, so the script's control flow goes somewhere it should
not and the node reports:

```text
VM Internal Error: MemWriteOnExecutablePage
```

The error names a *write*, which sends you looking at the heap. It is really an instruction
fetch from a page that is not executable — `check_permission` returns the same code for
both directions of a W^X mismatch. The deployer uses `data1`, and says why in a comment, so
the next person does not have to find this again.

**`ckb-testtool` cannot catch it.** It runs the newest VM and does not implement CKB's
`select_version`, which is the function that maps `hash_type` to a VM version. A
`hash_type: "data"` deployment passes all 21 CKB-VM integration tests and then fails on the
first real node.

### Capacity is not the serialization

CKB charges `8 + data + (lock.args + 33) + (type.args + 33)`, counting the payload and not
the encoding around it. The state cell serializes to 1,459 bytes of molecule and occupies
1,384 — the table headers, offset words, length prefixes and alignment padding are free.
Modelling the padded form instead asks for capacity the fly does not need;
`occupiedCapacity()` in `src/fly.js` implements the rule the node uses, and a live node
accepted its output.

### A fly can branch, and a branch cannot be removed

"A fly is a chain of state cells" only holds while each fly has **exactly one live cell**. The
type script cannot enforce that: it validates one transaction, and two transactions can each
consume a *different* predecessor wearing the same type script. Both are valid, both commit,
and now there are two live cells claiming to be the same organism — and the next tick branches
it again.

You do not have to do anything wrong to get here. Every tool that resolves "the fly" from a
type script is *silently picking one*:

- `findSingletonCellByType` returns whichever cell the indexer orders first;
- a roster keyed by type hash keeps whichever cell it saw last, so `/api/flies` reports one
  branch while `status` and the indexer's own history report another;
- a tick then spends the branch nobody was looking at.

The symptom is not an error. It is a page that disagrees with `status`, and a step counter
that goes *backwards* when a tick lands on a less advanced branch.

This deployer no longer picks. `liveCells()` enumerates, `liveCell()` refuses when there is
more than one (so `tick`, `feed`, `stimulate`, `resurrect` and `genesis` all stop with a
message naming every branch), the indexer reports the collision in `meta.collisions` and on
its log, and `status` — which is read-only — describes the branches and prints the most
advanced one rather than refusing to say anything.

**It is not repairable by spending the extras.** The type script requires exactly one
successor wearing the same script, so consuming a branch *moves it forward*; it never removes
it. A branched fly is branched for good, and the fix is a fresh instance — a new deployment,
whose `instance` nonce gives it a type script of its own — not a cleanup.

The way to avoid it is the way this chain got here: every fly must be created with a fresh
`instance` nonce. That is what `plan.mintInstance()` is for, and
`test/instance.test.js` is the regression test that pins it.

### A record belongs to one network

A deployment record describes one fly on one chain. The same genome deployed to a dev chain
and to preview testnet is two different organisms at two different out points, and a record
that means "the dev chain" on Monday and "preview testnet" on Tuesday — with the difference
carried by an environment variable someone has to remember — is a record that gets
overwritten by the next deployment. The loss is silent: the file stays valid, the fly it
names exists, it is just a different fly.

This is not hypothetical. A `deploy` was run against preview testnet with
`FLY_STATE=deploy/deployment.preview.json` set, from inside `deploy/`. The path resolved
against the current directory, so it meant `deploy/deploy/deployment.preview.json` — and
because `deploy` writes the record *after* sending the code cells (it cannot know the
transaction hash before the chain assigns it), the failure landed on the write, 151,325 CKB
already committed. The cells were fine and `adopt` recovered them, but the capacity was gone
and the record did not exist for the ninety seconds it took to notice.

Both paths are now named for the network and default to an absolute path, so a testnet run
needs only `CKB_RPC_URL`. `assertStateWritable()` also checks the directory before a single
transaction is built, which converts this whole class of mistake from "discovered after
spending" into "discovered before".

### `get_transaction` forgets

CKB's `get_transaction` is served from an index that lives **in memory and is not
persisted**. A node returns `transaction: null, status: "unknown"` for any transaction
committed before it started — while still reporting `result` rather than an error, so a
caller sees a well-formed empty answer. Public nodes are load balanced across instances that
have restarted at different times, so the same query answers differently minute to minute:

```text
$ curl -s … -d '{"method":"get_transaction","params":["0x323509d1…"]}' https://testnet.ckb.dev/
  transaction present | status committed      ← through the sandbox proxy
$ node … client.getTransaction("0x323509d1…")
  undefined                                   ← direct, a different backend
```

So nothing that has to work after a restart may depend on it. `adopt` searches for the live
code cells instead — strictly stronger, because the indexer only returns live cells, so a
successful adoption is also a proof that nothing has been spent. `sendAndWait` still uses it
immediately after sending, which is exactly when the index is populated.

The same asymmetry is worth knowing about when debugging: in this environment `curl` honours
`HTTPS_PROXY` and Node does not, so the two can be talking to different nodes and disagreeing
without either being wrong.

### An error that cannot clear itself

The poll loop catches its own failures and puts the message in `index.error`, which a snapshot
serves as `meta.error` and the page renders as "the node reported: …". That part is right. The
clearing was not: `index.error = null` lived inside `refresh`, *after* the chain walk, and
`refresh` returns early when the head has not moved.

So the only thing that could clear the message was a successful **walk** — and an idle fly never
walks. One transient RPC failure while the watched organism happened to be sitting still left the
page reporting an unreachable node indefinitely, while the node was answering every request. An
error that cannot clear itself is worse than no error at all, because it teaches the reader to
ignore the field.

The fix is one line in the poll loop — a poll that succeeds *without walking* is still a poll
that succeeded — and it lives in `src/watch.js`, where the page's poll and the CLI's share it. It
was verified by making a node fail on demand, since a public one will not: a small proxy in front
of `testnet.ckb.dev` that can be told to answer 500. The sequence
`null → "injected failure" → null → "injected failure" → null` is the whole claim, and the
tell that it is the *right* scenario is that `meta.updatedAt` never changes across it. That is
the idle-fly condition, and it is exactly the one that used to stick.

The property is now pinned by `test/watch.test.js` instead, which needs no node: the shape of the
bug is reproduced as "a refresh that reads, reads, and does not walk", and a test that skipped it
would pass against the code that shipped. The proxy harness is not in the repository any more —
it existed to drive the indexer, and there is no indexer.

### Two call sites, two answers to one question

The drive buttons are disabled for a reason the page *decides* on, and a click is refused for the
reason the builder decides on. Those are one question, and it used to be answered in two places —
`/api/fly` filled `meta.drivable`, and `POST /api/act` sent or refused — with different rules:

| | `/api/fly` | `POST /api/act` |
|---|---|---|
| the lock is one this key can sign for | required | required |
| the watched organism is the one the record selects | required | **not consulted** |

So there was an organism for which the page said *no* and the server said *yes*: an
`owner`-locked fly that is not the record's fly. That is what a record of its own produces —
one record names one fly, and this one was not it — and it is how the organism measured below
came to exist, wearing this server's own lock with no record on disk naming it anywhere.

```text
GET  /api/fly?type=0xf158ed61…   →  drivable: false, lock: "owner"
   "this server can only drive the organism it deployed (0x6419b099…), and the page is
    watching 0xf158ed61…. Watching another fly is fine; moving it needs a key that its lock
    accepts."                              ← the lock is this server's own key
POST /api/act {"kind":"tick","steps":1}  → 200, tx 0xc49d5550…, the watched fly: 65 → 66
                                             the record's fly: 160 → 160
```

Both halves of that message were false. The server *does* hold the key — the fly's lock is its
own `secp256k1_blake160` lock, byte for byte — and an action here does *not* move the other fly,
which is the whole point of the repair it was quoting. In the browser it was five greyed-out
buttons and the same sentence, above a fly that two clicks then moved to step 130.

The ownership test was not wrong when it was written; it was a proxy. `POST /api/act` used to
build its transaction from the deployment record and never look at what the page was watching,
so "watched must equal the record's fly" stood for "the action will move what is on screen".
Once `handleAct` began passing the watched organism and `applyAction` began resolving the cell
from *that* organism's type script, the proxy stopped standing for it and started contradicting
it. The proof that it had stopped meaning anything is in what was left for it to fire on: a
private fly, the one case where the server demonstrably holds the key. Public `flylock` flies
had already been exempted from it, so the two rules only ever came apart on a fly whose lock the
record cannot describe — and neither endpoint's tests covered the case where they did.

What is left is `driveAuthorization`, whose only inputs are the organism's lock and the key that
would sign. There is deliberately no `drivable(watched, owned)` exported any more: a rule that
answers this question from the record is not a helper to have lying around, and the test asserts
the name is gone rather than merely unused. The endpoints that used to call it from two places are
gone too, so the page now has it easier than the server did: `meta.drivable` and the click are the
same call on the same object, and the only key they can ever be about is the reader's wallet — a
page that could disagree with itself about whether a button works would need a second wallet to
do it.

The shape of the mistake generalises, and it is not "the check was wrong": **a decision made in
two places is two decisions.** `driveAuthorization` had no test of its own — the two functions
it composed each had one — so nothing could notice that its two callers disagreed.

---

## Tests

```sh
make test-deploy     # from the project root: builds flyplan, then runs `npm test`
```

`test/golden.test.js` pins `src/fly.js` — the JavaScript mirror the browser will need,
which cannot shell out to Rust — against values produced by `flyplan golden`. Two
implementations of one format is a standing invitation for them to disagree, and a
disagreement would not fail loudly: it would produce a transaction the type script refuses,
or a state cell that decodes to something plausible and wrong. It found a real bug on its
first run.

Three suites exist because their subject fails *silently*:

- `test/watch.test.js` — the three ways a page can watch one organism and move another, all of
  which produce a successful transaction and a page that does not change.
- `test/instance.test.js` — the nonce that makes two flies from one genome two organisms. Its
  absence is invisible until you count the type scripts.
- `test/send.test.js` — what a rejected send means, and what to say about it. Pinned because the
  classification is matched on the node's message text, which is the only thing available and
  therefore the part that will rot first; because getting it wrong stopped two keepers out of
  three; and because the page now answers a visitor with a sentence derived from it, so a
  silent change here becomes a lie on screen. It began as `test/keeper.test.js` and moved when
  the page became its second caller — the same move `classifySendError` itself made, into
  `src/send.js`.

`src/send.js` holds no state and starts nothing, which is the same reason `src/watch.js` exists:
a rule its callers both need should not be reachable only through a module that begins doing
something the moment it is imported. `src/keeper.js` still guards its `main()` the way `src/cli.js`
does — importing the keeper must not start one — and that guard is what let the classification be
tested from `keeper.test.js` in the first place; once the page became its second caller, the honest
place for it was its own module.

**The wallet layer has no unit tests, and that is a gap rather than a decision.** `wallet.source.js`
cannot be imported outside a browser: both adapters read `window` (UTXO Global's factory does so
unguarded, and throws in Node), and the thing under test is a *signature ceremony* that no headless
runner can complete. What exists instead is a real browser run per change — `window.utxoGlobal`
faked, the real page, the real server, the real chain — plus a rehearsal of the same four steps in
Node with a real key, which is where the `Transaction.from`/`fromBytes` mistake was caught. Both are
described in the verification table above. The rule that the two halves share — whose key may move
which organism — *is* unit-tested, in `watch.test.js`, because it is the part that has been got
wrong twice.
