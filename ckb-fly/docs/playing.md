# Playing with the fly

The README explains how the port works. This file explains what you can actually *do* —
which moves exist, what each one costs, who pays whom, and where the rules refuse you.

There is no game server, no token and no operator. Everything below is a transaction.

---

## The one rule everything follows

A fly is **one cell**. Its whole nervous system — 155 neurons, 6,522 synapses, the compass
heading, the position, the energy — is the 1,213 bytes of that cell's data.

Advancing the fly means **consuming that cell and creating its successor**. The type script
then checks one thing:

```text
output.data == simulate(input.data, action)
```

byte for byte. The action is declared in the witness, and the validator recomputes the
successor and compares.

Three consequences shape every move you can make:

1. **You cannot act without paying.** The successor is not "whatever you write down"; it is
   the output of the same Rust the validator runs.
2. **A version of the fly can be spent once.** Two transactions cannot both build on the same
   state. That is why "steer it, then run 32 steps" is *one* action — `stimulate` arms the
   stimulus and advances in the same transaction, because there is no second transaction to do
   the advancing in.
3. **Everything is public.** The action is in the witness of a transaction anyone can read, so
   the fly's history is not a log somebody kept — it is the chain of cells.

---

## Two ways to play

| | what you need | how you act |
|---|---|---|
| **The page** | a browser; a wallet only if you want to pay for the move yourself | five buttons in the Drive panel, in the right-hand column below Walk |
| **The CLI** | a funded CKB key | `node src/cli.js <command>` from `deploy/` |

The page is the same five moves with a drawing attached. The CLI can do everything the page
can plus `deploy`, `genesis`, `resurrect` and `adopt`.

```sh
cd deploy
npm run serve                          # http://127.0.0.1:8899 — watch, and read
```

`npm run serve` is a static file server and nothing more: the page reads the chain itself and
builds its own transactions, so there is no server key to expose and no flag to turn one on. To
*move* the fly from the page, connect a wallet in the Drive panel — you pay, you sign, and the
page never sees your key.

---

## The five moves

| move | what it does | what it costs | who ends up with the money |
|---|---|---|---|
| `tick 64` | runs the nervous system 64 steps | 64 steps of life | **you** — 0.0064 CKB leaves the cell as your change |
| `tick 32` | the same, half as far | 32 steps of life | you — 0.0032 CKB |
| `feed 10,000` | buys 10,000 steps of life | 1 CKB | the fly — the capacity is locked into its body |
| `cue, wedge 4` | lights a landmark, then runs 32 steps | 32 steps + 512 steps | the fly (life, not capacity) |
| `shock` | an aversive pulse, then 32 steps | 32 steps + 512 steps | the fly |
| `resurrect` *(CLI only)* | starts a new life | the life you buy + the fee | the fly |

### `tick` — run the simulation

`tick <steps>`, with `1 <= steps <= 64`. 64 is the maximum the parameters allow
(`max_steps`), and it is also the rational choice: CKB charges by transaction *size*, not by
cycles, so a 64-step tick costs no more to submit than a 1-step tick. The page offers 64 and
32 because they are different experiments — one long stride versus two short ones — not
because 32 is cheaper.

A tick spends one step of life per step simulated. When the last step is spent, **the fly
dies** — a tick can kill it, and that is the correct behaviour rather than an edge case.

What you get back: the capacity that backed the life you consumed. The cell shrinks by exactly
`steps x backing_per_step`, and that value lands in your change output. **Ticking pays the
ticker.**

### `feed` — buy life

`feed <steps>`. The capacity moves *into* the state cell: `+10,000` steps is exactly
`+100,000,000` shannons, and the step counter and spike count do not change at all. Nothing
about the fly's state moves except its life and its body's capacity.

Feeding is the opposite direction to ticking, and it is the only move that is purely
altruistic. There is no token to burn: upstream sent `$FLY` to `0x…dEaD` to make a burn
measurable, but a CKB cell already has a native measurable quantity, so feeding locks CKB into
the body. The type script forbids destroying the body, so that capacity can never be recovered
— burned, but *verifiably* burned, and the fly is visibly richer by exactly that amount.

Feeding a **dead** fly is refused (`FeedWhileDead`). Upstream's `_feed()` has no `alive` check:
it takes the tokens, adds energy, and the fly reverts every tick anyway. On the EVM that was a
wasted token; here it would be irreversible coin destruction, so the port refuses instead of
quietly taking the money.

### `stimulate` — steer it

`stimulate <channel> <param> <strength> <steps>`. Four channels, matching `FlyBrain.sol`:

| ch | name | what it drives | `param` |
|---|---|---|---|
| 1 | `cue` | EPG / EPGt neurons of one wedge — a visual landmark | the wedge, `0..=15` |
| 2 | `turn left` | left-side PEN neurons — angular velocity | ignored |
| 3 | `turn right` | right-side PEN neurons | ignored |
| 4 | `shock` | every Δ7 neuron — a noxious stimulus that collapses the bump | ignored |

The page's two stimulus buttons are:

- **`cue, wedge 4`** — holds a landmark in wedge 4 and runs 32 steps. This is the move that
  makes the fly *walk*: the cue pushes the compass bump toward one wedge, the bump's population
  vector becomes the heading, and the fly moves along it.
- **`shock`** — drives all 42 Δ7 neurons, which collapses the bump. The heading goes to
  `(0, 0)` and the fly stops moving. Aversive, and visible immediately in the ring.

**Being steered costs life, and the stimulus is not free.** The charge is
`strength x 128` steps — 512 steps for the strength-4 buttons, on top of the 32 steps actually
simulated. These steps are spent but *not* simulated: the fly pays for the steering without
moving forward. `stimulate(1, 4, 4, 32)` therefore costs 544 steps, which is the number the
preview-testnet run measured on chain.

Two details worth knowing:

- `strength` runs `1..=255`. A maximal stimulus costs 32,640 steps of life — 3.264 CKB — and
  because it is charged through the same `spend_life` a tick uses, **an expensive stimulus can
  kill the fly**. The page's buttons use strength 4; the CLI lets you use any.
- The charge is in **life**, not capacity. An earlier version charged it in capacity, which has
  to come out of the very capacity backing the remaining life — the arithmetic admits no
  solution for a fly that is backed exactly. Charging in life keeps
  `capacity == body + energy x backing` true for every action, by induction, with no case
  analysis.

### `resurrect` — begin again

`resurrect <steps> <bornBlock>`. Valid only while dead, and only with `steps > 0`. See
[Death, and coming back](#death-and-coming-back).

---

## The price list

`FLY_ECON=testnet` (the default). One step of life is 10,000 shannons.

| | value | CKB |
|---|---|---|
| 1 step of life | 10,000 shannons | 0.0001 |
| body capacity | 1,500 CKB | 1,500 |
| a newborn fly (`FLY_ENERGY=1000000`) | 1,000,000 steps + body | 1,600 |
| `tick 64` releases | 640,000 shannons | 0.0064 |
| `feed 10,000` costs | 100,000,000 shannons | 1 |
| a strength-4 stimulus costs | 512 steps | 0.0512 |
| a maximal stimulus (strength 255) costs | 32,640 steps | 3.264 |
| a chronicle | 1,000 CKB, and it never changes | 1,000 |
| measured fee, per action | 2,385 shannons | 0.00002385 |

`required_capacity(energy) = body_capacity + energy * backing_per_step`, and the body is
1,500 CKB against a state cell that actually occupies 1,384 — the state serializes to 1,459
bytes of molecule, and the headers, offsets and padding are free. `FLY_ECON=free` exists for
testing and charges nothing.

**The fee does not depend on the network.** CKB charges by transaction size, so the same
0.00002385 CKB per action came out on a dev chain and on preview testnet. That means a
player's economics can be measured locally and are expected to hold on mainnet.

---

## The loop: ticking pays, feeding costs

Put the two together and the whole economy is one sentence:

> A tick releases exactly as much per step as a feed costs per step. **A ticker's reward is
> exactly the life it burns** — it is a conduit, not an income — and a feeder is a donor.

The keeper's measured ledger, on a dev chain and again on preview testnet:

```text
ledger
  ticks         6
  released      0.0384 CKB  (taken from the fly)
  added         0 CKB  (put back)
  net           0.0384 CKB
  fees paid     0.0001431 CKB  (6 transactions)
  margin        0.0064 CKB released per tick against 0.00002385 CKB of fee (profitable by 268x)
```

A 268x margin sounds like a business until you notice what it is made of: the ticker is paid
out of the fly's life, and the fly's life was bought by somebody else. Somebody has to be the
donor. That is the tension the whole design rests on, and it is why the keeper is a break-even
conduit rather than a player with an edge — and why the only real variable is how much someone
is willing to feed.

A visitor driving the public fly with their own wallet, measured on preview testnet:

```text
deployer     -0.00000000 CKB      <- the server's key is not in the transaction at all
visitor      +0.00317615 CKB      <- 32 steps released 320,000 shannons; the fee was 2,385
```

So ticking a public fly costs the operator nothing and is mildly profitable for whoever
clicks.

---

## Death, and coming back

A fly dies when its energy reaches zero. It is not a special event with its own transaction —
it is what `spend_life` does when the last step goes, so a tick, a stimulus, anything that
spends the last step kills it.

A dead fly refuses everything except `resurrect`:

| action on a dead fly | answer |
|---|---|
| `tick` | `Dead` |
| `stimulate` | `Dead` |
| `feed` | `FeedWhileDead` — upstream would take the money and give nothing |
| `resurrect` | the only thing that works |

`resurrect <steps> <bornBlock>` needs three things: the fly must be dead (`NotDead` otherwise),
`steps` must be non-zero (`ZeroAmount`), and `bornBlock` must not be earlier than the previous
life's (`BadBornBlock`). Equal is allowed — two lives may begin in the same block. `bornBlock`
is otherwise cosmetic; it is monotonic so the lineage cannot lie about when a life began.

Two things about the result are worth stating plainly:

- **`generation` goes up by one, and `step` does not reset.** A fly that died at step 8 and was
  resurrected with 10,000 steps is at step 8 with 10,000 steps of life. Time does not move
  backwards, so the two lives are directly comparable — which is the whole reason to record a
  generation at all.
- **`resurrect(0)` is refused.** Upstream's version burns the full price and then dies again on
  the very next tick. A resurrection has to produce a fly that can take at least one step.

---

## Whose fly is it

Every fly's state cell wears a lock, and **the type script pins `output.lock == input.lock`**.
So the lock is chosen at `genesis` and is permanent — a wallet lock is not a setting you can add
to an existing fly, it is a decision about which fly to create.

| `--lock` | meaning | who can move it |
|---|---|---|
| `flylock` *(default)* | the permissive lock; accepts every transaction | **anyone** |
| `owner` | the deploying key's own `secp256k1_blake160` lock | only that key |
| `<codeHash>:<hashType>:<args>` | any lock at all, including a wallet's | whoever the lock accepts |

The default is permissive for a reason that is worth being explicit about: upstream, anyone may
call `tick()`. All the rules live in the type script, so "who is allowed to advance the fly" was
never a chain-level question. On CKB the lock decides it, and `flylock` chooses "nobody is
excluded" — which is what makes the public fly a commons.

What that means in play:

- **A public fly is a commons.** Anyone may tick it, and the ticker is paid for it. The keeper
  is not privileged; it is just the most patient player. Two visitors clicking the same button
  is a normal event, not an error (see below).
- **A private fly is private in one direction only.** Its lock stops anyone else from moving
  it, but its state is still public — the page can watch it, the roster lists it, and its whole
  history is on chain.
- **A server can only sign for locks it holds.** The indexer can drive a `flylock` fly and a fly
  wearing its own `owner` lock. For any other lock it refuses **before** building a transaction
  and says so, and the page reports the same fact so it does not show buttons that would not
  work. A wallet-locked fly is driven from the browser instead: the server computes the
  successor, the visitor's wallet signs and pays.

---

## Watching it

The page draws four things, and only one of them is not literally from a cell:

- **The ring** — 155 neurons. The compass cells sit outside, one arc per wedge of the ellipsoid
  body; the rest are inside, grouped by cell type. Colour is membrane potential. You can **pin**
  any past step and the whole page follows you there; the drive buttons go dead while you are
  pinned, because acting there is not what you are looking at.
- **Walk** — where the headings have carried the fly, in 1/256th of a cell. It only moves when
  the compass bump is strong enough to trust: the population vector's magnitude has to average
  `walk_threshold` per step, and then the fly walks `16/256` of a cell per step along it. A
  collapsed bump means the fly stands still, which is what a shock looks like.
- **Backing** — `required = body + life x backing`, against `held`. They should be equal; the
  panel says `ok` when they are.
- **Chronicle** and **Life so far** — see below.

Between two on-chain states the page interpolates. **That smoothing is the only thing on the
page that is not from a cell.** The chain's states are the frames that actually happened.

The roster lists every organism on the chain, because discovery is by *code hash*, not by type
script — each fly has a different type script, so there is no single script to look up. Click a
row to watch that fly. A `key` badge means this server holds the key for that organism, which is
a fact worth reporting and deliberately **not** part of whether the buttons work.

---

## The chronicle: a record that has to look

Each fly has a second cell — a **chronicle** — updated in the *same transaction* as every
transition. That is not an optimisation, it is the only way the design works: the chronicle is
not *told* what the fly did, it is required to **look at the fly**, and the only moment the fly
is present to be looked at is the moment it moves.

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

`net = fed - released`, and it is a statement about *this* fly that no third party can assert:
the contract compares its own record against the fly's output state and capacities, and refuses
the transaction if they disagree. Upstream's `FlyWorld.sol` let an operator assign those fields,
which is a promise; here it is a mechanism.

A fly deployed before the chronicle existed simply shows `none — this fly was deployed before
the chronicle existed`. Nothing is invented to fill the gap.

---

## Two players, one button

A state cell is a UTXO, so two people cannot both act on the same version. There are two shapes
of that, and they mean opposite things:

**The same action, twice.** A transaction is a deterministic function of the cell it spends, the
action and the fee, so two identical clicks build **byte-identical transactions and the same
hash**. The node rejects the second as a duplicate. Measured in two browser tabs on preview
testnet, `tick 32` clicked simultaneously:

```text
visitor A (won)  -> 200 after 21.3s   ok: true,  txHash 0x8168c845…, the fly advanced 32 steps
visitor B (lost) -> 200 after  4.3s   ok: true,  duplicate: true, applied: true — no txHash
```

The loser was *already getting what they asked for*. The page says so rather than reporting a
failure, and the fly advances once — because two identical clicks are one transaction.

**Different actions, at the same moment.** Two different actions build two different
transactions from the same cell, and the node treats the second as a replacement:

```text
PoolRejectedRBF: RBF rejected: Tx's current fee is 2385,
                 expect it to >= 5962 to replace old txs
```

Nothing in that sentence mentions a cell, a race or another visitor. It is the loser being told
their transaction did not happen. The page classifies it as `raced` and names the organism,
because a lost race and a broken transaction are not the same thing — and getting this wrong
once stopped a keeper the first time a visitor clicked on a fly it was minding.

---

## The keeper: the player who never sleeps

```sh
npm run keeper
KEEPER_MAX_TICKS=10 npm run keeper     # ten ticks, then a ledger
```

| variable | default | what it decides |
|---|---|---|
| `KEEPER_INTERVAL_MS` | 5000 | how long it waits between ticks |
| `KEEPER_STEPS` | 64 | steps per tick |
| `KEEPER_FEED_BELOW` | 200000 | feed when life falls under this |
| `KEEPER_FEED_AMOUNT` | 1000000 | steps of life to buy when it does |
| `KEEPER_MAX_TICKS` | unlimited | stop after this many ticks |
| `KEEPER_RESURRECT` | unset | `1` lets it revive a dead fly — off by default, because that is buying a life it cannot get back |
| `KEEPER_DRY_RUN` | unset | `1` decides and reports without sending |

A pass that resurrects ends there — the feeding and the ticking happen on the next pass — so a
single run against a dead organism shows all three branches in order:

```text
resurrected: generation 1, 2 CKB bought
fed 20,000 steps for 2 CKB
tick
```

**It retries, because it has to.** It loses races to visitors and to other keepers, which is the
model working, so a rejection is counted and the loop re-reads. The two kinds of rejection are
counted separately, and the split is itself the diagnostic: all duplicates means the keepers
agree and are merely racing; many lost races means they disagree and are competing for different
successors.

---

## Starting your own

```sh
cd deploy
node src/cli.js key          # writes deploy/.key.<network>; on a real network, fund it
node src/cli.js plan         # what a deployment would create, and what it costs — no network
node src/cli.js deploy       # code cells, connectome table, first fly, chronicle
node src/cli.js status
node src/cli.js history      # recover its whole life from the chain
```

A first deployment locks:

```text
  flybrain code cell         64,965 CKB
  flylock code cell          20,797 CKB
  flyworld code cell         50,437 CKB
  connectome table           15,126 CKB
  the fly                     1,600 CKB
  its chronicle               1,000 CKB
  total                     153,925 CKB  (all refundable in principle)
```

The code cells dominate the bill and are **shared**: `genesis` mints another organism from the
same deployed code for 2,600 CKB. That is what the `instance` nonce is for — every genesis mints
a fresh eight-byte nonce into the fly's type-script args, which is what makes two flies from one
genome two organisms rather than one. Without it they would share a type script, "find the cell
wearing the fly's type script" would find an arbitrary one, and a keeper driving both would tick
first one and then the other with the step counter going backwards and nothing erroring.

On preview testnet the faucet gives 300,000 CKB per address per month, so one claim covers a
first deployment. It asks for a GitHub login, which is the one step a program cannot do for you.
`node preflight-testnet.mjs` is read-only and worth running first: it resolves the published
script table against the chain and confirms every cell it needs is live, because a table entry is
a claim about a chain and cannot verify itself.

---

## What you cannot do

The honest list, because most of these are deliberate:

- **Change the lock.** `output.lock == input.lock` is pinned by the type script. A different lock
  means a different fly.
- **Repair a branched fly.** A type script validates one transaction, so two transactions can
  each consume a *different* predecessor wearing the same script — and then there are two live
  cells claiming to be one organism. The contract requires exactly one successor, so consuming a
  branch *moves it forward*; it never removes it. The fix is a fresh instance, not a cleanup.
  Every tool that resolves "the fly" from a type script used to silently pick one; they now
  enumerate and refuse, naming every branch.
- **Feed a corpse, or resurrect a living fly.**
- **Act twice on one version.** Not a rule anyone enforces — the cell is gone.
- **Drive a fly whose lock your key cannot satisfy.** Watching is unrestricted; moving is not.
- **Skip the simulation.** There is no "set the state to X". The output must equal
  `simulate(input, action)` exactly.
- **Add a token.** There is none, and the economics is 24 bytes of parameters and one capacity
  comparison. No supply schedule, no pool, no slippage, no approvals, and no way for a third
  party to change the rules by moving a pool.
- **Make it a mind.** This is 155 neurons — an ellipsoid-body compass and the Δ7 cells, with a
  per-neuron engram bias. It has a heading, it walks, it can be startled, and its dynamics are
  bit-exact with the same connectome running on BSC. It is not a brain, and the project does not
  claim it is.

---

## Cheat sheet

```sh
# the page
npm run serve                              # watch; connect a wallet to drive

# the CLI
node src/cli.js status
node src/cli.js history
node src/cli.js tick 64
node src/cli.js tick 32
node src/cli.js feed 10000
node src/cli.js stimulate 1 4 4 32         # cue, wedge 4, strength 4, 32 steps
node src/cli.js stimulate 4 0 4 32         # shock
node src/cli.js stimulate 2 0 4 32         # turn left
node src/cli.js resurrect 10000 1234
npm run keeper

# another organism from the same code cells
node src/cli.js genesis --lock owner
```

Read next: [`../deploy/README.md`](../deploy/README.md) for the transaction layer and the
measured preview-testnet runs, [`../README.md`](../README.md) for the design, and
[`signers.md`](signers.md) for the wallet decision.
