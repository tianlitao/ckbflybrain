/**
 * Read a fly the way the page will, and print what came back.
 *
 * This is the rehearsal for the browser: every function it calls is the one the page calls,
 * from the same module (`src/chain.js`). The only difference is the transport — Node's
 * `fetch` here, the browser's there — and the whole point of CORS being open on the public
 * RPC is that there is no other difference.
 *
 *   node probe-read.mjs [deployment.preview.json]
 *
 * It prints the roster, one organism's whole life and its chronicle. If it runs, a page can.
 */
import { readFileSync } from "node:fs";

import { createClient, readFlies, readFly } from "./src/chain.js";

const record = JSON.parse(readFileSync(process.argv[2] ?? "deployment.preview.json", "utf8"));
const client = createClient({ rpc: record.network });

console.log(`network   ${record.network}`);
console.log(`params    ${record.params}, economics ${record.economics}`);
console.log(`fly       ${record.fly.typeHash}`);
console.log();

// ---------------------------------------------------------------- every organism

const rows = await readFlies(client, { codeCells: record.codeCells, params: record.params });
console.log(`--- organisms ---`);
console.log(`found ${rows.length}`);
for (const row of rows) {
  console.log(
    `  ${row.typeHash.slice(0, 18)}…  instance ${row.instance}` +
      `  ${row.outPoint.txHash.slice(0, 12)}:${row.outPoint.index}` +
      `  step ${String(row.state.step).padStart(6)}  energy ${String(row.state.energy).padStart(9)}` +
      `  ${row.state.alive ? "alive" : "DEAD "}  spikes ${row.state.totalSpikes}`,
  );
}
console.log();

// ---------------------------------------------------------------- one fly's life

const { cells, entries, chronicle } = await readFly({
  client,
  deployment: record,
  typeScript: record.fly.typeScript,
  typeHash: record.fly.typeHash,
  full: true,
});

console.log(`--- head ---`);
console.log(`live cells wearing the fly's type script: ${cells.length}`);
if (cells.length > 1) {
  console.log("  ! this organism is branched; moving one branch would abandon the others");
}

console.log(`\n--- history ---`);
console.log(`${entries.length} transitions, oldest first`);
for (const entry of entries) {
  const a = entry.action;
  const what = a
    ? a.kind === "stimulate"
      ? `${a.kind} ch${a.channel} p${a.param} s${a.strength} ×${a.steps}`
      : `${a.kind} ${a.steps}`
    : "genesis";
  console.log(
    `  block ${String(entry.blockNumber).padStart(9)}  step ${String(entry.state.step).padStart(6)}` +
      `  energy ${String(entry.state.energy).padStart(9)}  ${entry.state.alive ? "alive" : "DEAD "}` +
      `  ${what.padEnd(28)}  v[0..3] ${(entry.state.v ?? []).slice(0, 4).join(",") || "—"}`,
  );
}
console.log();

// ---------------------------------------------------------------- the chronicle

console.log(`--- chronicle ---`);
if (!chronicle) {
  console.log("  none");
} else {
  console.log(`  ${chronicle.outPoint.txHash.slice(0, 14)}:${chronicle.outPoint.index}  capacity ${chronicle.capacity}`);
  console.log(`  ${JSON.stringify(chronicle, null, 1).replace(/\n/g, "\n  ")}`);
}
