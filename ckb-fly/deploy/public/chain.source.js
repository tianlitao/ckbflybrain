/**
 * Reading the chain, from the page.
 *
 * # What changed, and why this module is the whole of it
 *
 * This page used to be a client of an indexer: `GET /api/fly` was the picture, `GET /api/events`
 * pushed each new transition, `GET /api/state` decoded a past one. The indexer existed for one
 * reason — recovering a fly's history means walking a chain of state cells, and something had
 * to do that walking — and for a second one that was never stated: it was the only thing that
 * could reach a node.
 *
 * Neither holds. A CKB node answers `get_cells`, `get_live_cell` and `get_transaction` over
 * plain JSON-RPC with `access-control-allow-origin: *`, so a page can walk the chain itself;
 * and `flywasm` is the same `flycore` the validator runs, compiled for wasm, so a page can
 * compute a successor state itself. What is left for a server is hosting four files.
 *
 * So the questions live here. They are the same four the server asked (`src/chain.js` is the
 * shared half — `readFlies`, `readChain`, `readChronicle`), and the answer is the same object
 * down to the field names, because a reader looking at this page and a reader looking at the
 * server's JSON must be looking at the same thing.
 *
 * # The index is small, and it has to be
 *
 * `readChain` walks *backwards* from the live cell, one `get_transaction` per transition. A fly
 * that has lived a thousand steps is a thousand round trips, and a page that did that on every
 * poll would hammer a public node and take a visible amount of time doing it. `stopAt` is the
 * answer and it is the server's answer too: the page keeps the transaction hashes it already
 * has, and a poll that finds nothing new costs one query instead of a thousand.
 *
 * That is why this module keeps state rather than being a set of pure functions. It is the
 * smallest thing that can be called an index, and unlike the server's it is allowed to be
 * thrown away: a reload starts again from the chain, which is the only source of truth anyway.
 *
 * # Polling, not a stream
 *
 * `GET /api/events` was a server-sent-events stream because a server can hold a connection
 * open. A static page cannot — there is nothing on the other end to hold it — so this polls.
 * The interval is the server's `INDEXER_POLL_MS`, and a refresh that finds nothing new does
 * one `get_cells` and one `get_transaction`.
 *
 * @module chain
 */

import * as ccc from "@ckb-ccc/core";

import { createClient, readChronicle, readFlies, worldScriptFor } from "../src/chain.js";
import { liveCells, readChain } from "../src/history.js";
import { circuitLayout, decodeArgs, economicsJson, paramsJson, paramsNamed } from "../src/fly.js";
import { ambiguity, describeBranches, driveAuthorization } from "../src/watch.js";

/**
 * Everything the page can read, kept in one mutable object.
 *
 * The same shape the server's index has, because it answers the same question. The one field
 * that is not the same is `flies`: the server keeps a map it refreshes on a slower beat, and
 * this rebuilds it every poll — the page has no second caller competing for the node, so the
 * simpler thing is also the correct one.
 */
function emptyIndex(selected) {
  return {
    selected,
    entries: [],
    byTx: new Map(),
    flies: new Map(),
    chronicle: null,
    collisions: [],
    error: null,
    updatedAt: null,
  };
}

/**
 * @param {object} options
 * @param {object} options.config the public half of a deployment record: `network` (an RPC
 *   URL), `params`, `economics`, `codeCells`, and the default `fly` to watch
 * @param {Uint8Array} options.table the connectome, from `flywasm` — see `sim.circuitTable()`
 * @param {number} [options.pollMs]
 * @param {number} [options.limit] how many transitions to recover at most
 */
export function createFeed({ config, table, pollMs = 3000, limit = 500 }) {
  const client = createClient({ rpc: config.network });
  const paramsStruct = paramsNamed(config.params);
  const index = emptyIndex(config.fly.typeHash);

  let walletLock = null;
  let inFlight = null;
  let layout = null;
  let circuit = null;
  const listeners = [];

  // The roster needs an order that survives polls, and nothing in the data provides one: `rows`
  // comes back in cell order, but the chronicle queries below complete in whatever order the
  // network answers them, so the map behind `index.flies` is assembled in a different sequence on
  // every poll — and a list that reshuffles itself every three seconds is a list a reader cannot
  // point at ("which row was I looking at?"). A fly is numbered the first time the page sees it
  // and keeps that number for as long as the page is open; new organisms join at the end.
  const firstSeen = new Map();
  let seenCount = 0;

  /**
   * The connectome, checked against the one the fly says it is running.
   *
   * The table comes from the module the validator shares its source with, and the hash comes
   * from the chain — from the type script's args, which are part of the fly's identity. So this
   * is not a comparison of two local files; it is the page asking the chain which connectome
   * this organism was built from and refusing to draw a different one.
   *
   * A page that skipped this would draw a plausible ring for a fly whose dynamics run on a
   * different circuit — wrong in a way nothing else would catch, because the picture is the
   * only thing it produces.
   */
  function circuitFor(typeScript) {
    layout = layout ?? circuitLayout(table);
    const { circuitHash } = decodeArgs(typeScript.args);
    if (layout.hash !== circuitHash) {
      throw new Error(
        `this fly was built on connectome ${circuitHash}, but the dynamics module carries ` +
          `${layout.hash}. Refusing to draw a ring that is not this animal's.`,
      );
    }
    return layout;
  }

  /**
   * The facts about *this page and this chain* that the snapshot answers with.
   *
   * The server's version of this had to explain a key it held. This one has no key: the only
   * key that can ever move a fly here is the visitor's, so `drive` is "a wallet is connected"
   * and `drivable` is "that wallet satisfies this fly's lock". Both come from the same
   * `driveAuthorization` the refusal would, so the button state and the refusal cannot disagree
   * — which is the property that made this worth extracting rather than writing inline.
   */
  function diagnostics(lockScript) {
    const alwaysLockCodeHash = config.codeCells.flylock.codeHash;
    const auth = driveAuthorization({
      lockScript,
      myLock: walletLock,
      alwaysLockCodeHash,
      subject: walletLock ? "your wallet" : undefined,
    });

    return {
      updatedAt: index.updatedAt,
      error: index.error,
      // "Would anything sign a click" — and on this page the answer is a wallet or nothing.
      // There is no `INDEXER_ALLOW_DRIVE` here because there is no server key to gate: the
      // option that endpoint guarded does not exist in this build.
      drive: walletLock !== null,
      drivable: auth.allowed,
      // Which key `drivable` is about. Always the visitor's, or nobody's — and the page uses
      // this to decide whether a click is even attempted, so the two cannot drift apart.
      as: walletLock ? "wallet" : "none",
      // The page can always build a transaction, because `flywasm` is the same `flycore` the
      // validator runs. Kept as a field because the server answers with it and a page that
      // hardcoded the difference would be the one thing this module exists to prevent.
      prepare: true,
      lock: auth.lock,
      undrivableReason: auth.reason,
      collisions: index.collisions.map((collision) => ({
        typeHash: collision.typeHash,
        count: collision.count,
        cells: collision.cells.map((cell) => ({
          outPoint: cell.outPoint,
          instance: cell.instance,
          step: cell.state.step,
        })),
      })),
    };
  }

  function snapshot() {
    const current = index.entries.at(-1) ?? null;
    const selected = index.flies.get(index.selected) ?? null;
    const typeScript = selected?.script ?? ccc.Script.from(config.fly.typeScript);
    const lockScript = selected?.lock ?? ccc.Script.from(config.fly.lockScript);

    return {
      network: config.network,
      watching: index.selected,
      identity: {
        typeHash: index.selected,
        typeScript,
        lockScript,
        params: config.params,
        economics: config.economics,
        codeCells: config.codeCells,
      },
      circuit,
      params: paramsJson(config.params),
      economics: economicsJson(config.economics),
      chronicle: index.chronicle,
      roster: [...index.flies.values()]
        .sort(
          (a, b) =>
            (firstSeen.get(a.typeHash) ?? Number.MAX_SAFE_INTEGER) -
            (firstSeen.get(b.typeHash) ?? Number.MAX_SAFE_INTEGER),
        )
        .map((fly) => ({
        typeHash: fly.typeHash,
        instance: fly.instance,
        state: fly.state,
        chronicle: fly.chronicle,
        selected: fly.typeHash === index.selected,
        // The badge is not "the deployer holds this one" any more, because on this page there
        // is no deployer. It is the question a reader actually has: *can I move this one?* —
        // and it is answered by the same rule that will answer the click.
        owned: driveAuthorization({
          lockScript: fly.lock,
          myLock: walletLock,
          alwaysLockCodeHash: config.codeCells.flylock.codeHash,
        }).allowed,
      })),
      current,
      // Everything before the head. The newest transition is `current`, state and all, so
      // repeating it here would be a second copy of the same thing — and the two could
      // disagree if a client read them at different moments.
      history: index.entries.slice(0, -1),
      meta: { count: index.entries.length, ...diagnostics(lockScript) },
    };
  }

  /**
   * Bring the index up to date.
   *
   * Coalesced: a poll that arrives while one is running joins it rather than starting a second
   * walk. Two overlapping walks would both write `index.entries`, and the loser would append
   * history that the winner had already appended — which shows up as the same transition
   * twice in the timeline, not as an error.
   */
  function refresh() {
    if (!inFlight) {
      inFlight = walk().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  async function walk() {
    try {
      const rows = await readFlies(client, {
        codeCells: config.codeCells,
        params: config.params,
      });

      // Collected before anything is written, so that "two live cells wear this type script"
      // is a fact the roster can state rather than a cell that silently overwrote another.
      index.collisions = ambiguity(rows);

      const flies = new Map();
      await Promise.all(
        rows.map(async (row) => {
          // One query per organism, and they are independent, so they go together. The
          // chronicle's args are `version ‖ fly type hash`, so this identifies one chronicle
          // and no other — it is constructed, not searched for.
          const chronicle = await readChronicle(client, {
            codeCells: config.codeCells,
            flyTypeHash: row.typeHash,
          });
          flies.set(row.typeHash, { ...row, chronicle });
        }),
      );
      index.flies = flies;

      // Number any organism the page has not seen before. Assigned here rather than in the
      // snapshot so that the order is fixed by *discovery*, not by however the map happens to be
      // sitting when the reader asks for a picture of it.
      for (const typeHash of flies.keys()) {
        if (!firstSeen.has(typeHash)) {
          firstSeen.set(typeHash, seenCount++);
        }
      }

      // The watched organism can disappear: someone may have spent it and not yet committed
      // its successor, or the record may name a fly from another chain. Falling back to
      // whatever is there is better than a page that shows nothing and does not say why —
      // and `watching` in the snapshot tells the reader which one it ended up on.
      if (!index.flies.has(index.selected)) {
        const first = index.flies.keys().next().value;
        if (first === undefined) {
          throw new Error(
            `no organism wears the flybrain code cell ${config.codeCells.flybrain.codeHash} on ${config.network}`,
          );
        }
        select(first);
      }

      const row = index.flies.get(index.selected);
      circuit = circuitFor(row.script);

      const fresh = await readChain({
        client,
        head: { outPoint: row.outPoint },
        identity: {
          typeScript: row.script,
          typeHash: row.typeHash,
          lockScript: row.lock,
          params: config.params,
          paramsStruct,
          economics: config.economics,
          codeCells: config.codeCells,
        },
        limit,
        // Only the newest entry gets the per-neuron arrays; the rest are for a timeline. On an
        // incremental walk the previous head keeps the ones it already has, which is why this
        // is a flag and not a second pass.
        full: true,
        stopAt: index.byTx,
      });
      for (const entry of fresh) {
        index.entries.push(entry);
        index.byTx.set(entry.txHash, entry);
      }

      index.chronicle = row.chronicle;
      index.updatedAt = new Date().toISOString();
      index.error = null;
    } catch (err) {
      // Kept, not thrown. A poll that fails is a poll that will run again, and the previous
      // picture is more useful on screen than an empty page — with the error beside it, so
      // nobody has to guess whether the numbers are current.
      index.error = err.message;
    }

    for (const fn of listeners) {
      fn();
    }
    return index;
  }

  function select(typeHash) {
    if (typeHash === index.selected) {
      return;
    }
    index.selected = typeHash;
    // The history belongs to the organism, not to the page. Keeping it would put another fly's
    // life in the timeline under this one's name, and `byTx` would make the next walk stop at
    // a transaction that is not in this fly's past.
    index.entries = [];
    index.byTx = new Map();
    index.chronicle = null;
  }

  /**
   * The one live cell a transaction may spend, or a refusal.
   *
   * Read at the moment of spending, never from the roster. The roster is a picture and it is
   * allowed to be seconds old; the cell a transaction consumes is not, and spending a stale out
   * point produces a transaction the node rejects for a reason that points at the input rather
   * than at the age of the page's data.
   *
   * More than one live cell wearing the type script is a **branched** fly, and this refuses
   * rather than picking one. The type script validates a single transaction, so two
   * transactions that each consume a different predecessor are both valid and the chain has no
   * way to prefer one — which means the branches are permanent and choosing silently would
   * abandon the others without ever saying so. See `watch.js`.
   */
  async function spendable() {
    const row = index.flies.get(index.selected);
    if (!row) {
      throw new Error(
        `nothing is being watched, so there is nothing to spend. The roster has ${index.flies.size} organism(s).`,
      );
    }
    const cells = await liveCells(client, row.script);
    if (cells.length === 0) {
      throw new Error(
        `no live cell wears ${row.typeHash.slice(0, 12)}…. Either it has not been created yet, or its successor is not yet committed.`,
      );
    }
    if (cells.length > 1) {
      throw new Error(describeBranches(row.typeHash, cells.map((cell) => cell.outPoint)));
    }
    return cells[0];
  }

  /** The chronicle watching the selected fly, as a live cell, or `null` if it has none. */
  async function chronicleCell() {
    const row = index.flies.get(index.selected);
    if (!row) {
      return null;
    }
    // Constructed rather than searched for: the chronicle's args are `version ‖ fly type
    // hash`, so this identifies one chronicle and no other.
    const cells = await liveCells(
      client,
      worldScriptFor({ codeCells: config.codeCells, flyTypeHash: row.typeHash }),
    );
    return cells[0] ?? null;
  }

  return {
    client,
    snapshot,
    refresh,
    select,
    spendable,
    chronicleCell,
    watching: () => index.selected,
    /** The watched fly's type script, or the record's before the first successful read. */
    typeScript: () =>
      index.flies.get(index.selected)?.script ?? ccc.Script.from(config.fly.typeScript),
    onUpdate(fn) {
      listeners.push(fn);
    },
    /**
     * The visitor's lock, which is what `drivable` is about.
     *
     * Set here rather than passed to every call, because the answer has to change the moment a
     * wallet is connected or disconnected — and a snapshot built with a stale lock is a page
     * showing a decision about a key nobody is using.
     */
    setWalletLock(lock) {
      walletLock = lock;
    },
    walletLock: () => walletLock,
    /** The RPC URL, so the wallet can be pointed at the same chain. */
    rpc: config.network,
  };
}
