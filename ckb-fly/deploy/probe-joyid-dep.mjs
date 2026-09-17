/**
 * Which JoyID lock cell dep is actually live on preview testnet?
 *
 * Two published sources disagree, and both are installed on this machine:
 *
 *   @ckb-ccc/core's testnet table   -> 0x4a596d31…:0, depType "code"
 *   @joyid/ckb's own constants      -> 0x4dcf3f3b…:0, depType "depGroup"
 *
 * They agree on the lock's code hash, `0xd23761b3…` with hash_type `type`, which is the part
 * that matters for the script the fly would wear — but a code hash is only half a reference.
 * With `hash_type: type` the VM loads the dep cell and hashes its **type script**, so a valid
 * dep is a live cell whose type script hashes to that value; where it lives is the other half,
 * and a stale out point fails at the moment a transaction is built rather than at the moment
 * someone reads a table.
 *
 * So this resolves both claims against the chain: is the named cell live, does a dep group
 * expand, and does each member's type script hash to the JoyID lock code hash. Read-only.
 */
import * as ccc from "@ckb-ccc/core";

import { makeClient } from "./src/cli.js";

const JOYID_CODE_HASH = "0xd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac";

const CLAIMS = [
  {
    source: "@ckb-ccc/core testnet table",
    depType: "code",
    outPoint: {
      txHash: "0x4a596d31dc35e88fb1591debbf680b04a44b4a434e3a94453c21ea8950ffb4d9",
      index: 0,
    },
  },
  {
    source: "@joyid/ckb constants",
    depType: "depGroup",
    outPoint: {
      txHash: "0x4dcf3f3b09efac8995d6cbee87c5345e812d310094651e0c3d9a730f32dc9263",
      index: 0,
    },
  },
];

/** A dep group's payload: a little-endian count, then that many 36-byte out points. */
function parseOutPointList(data) {
  if (data.length < 4) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  if (data.length !== 4 + count * 36) {
    return null;
  }
  const refs = [];
  for (let i = 0; i < count; i += 1) {
    const at = 4 + i * 36;
    refs.push({
      txHash: ccc.hexFrom(data.slice(at, at + 32)),
      index: view.getUint32(at + 32, true),
    });
  }
  return refs;
}

const short = (h) => (typeof h === "string" ? `${h.slice(0, 12)}…` : String(h));

const client = await makeClient();
console.log(`rpc ${client.addressPrefix === "ckt" ? "preview testnet" : "?"}`);
console.log(`looking for a live dep whose type script hashes to ${short(JOYID_CODE_HASH)}\n`);

let usable = 0;

for (const claim of CLAIMS) {
  console.log(`${claim.source}`);
  console.log(`  claims ${short(claim.outPoint.txHash)}:${claim.outPoint.index} (${claim.depType})`);

  const cell = await client.getCell(claim.outPoint);
  if (!cell) {
    console.log("  ✗ that cell is spent or does not exist\n");
    continue;
  }
  console.log(`  ✓ the cell is live, ${ccc.bytesFrom(cell.outputData).length} bytes of data`);

  const refs = claim.depType === "depGroup"
    ? parseOutPointList(ccc.bytesFrom(cell.outputData))
    : [claim.outPoint];

  if (!refs) {
    console.log("  ✗ it does not decode as an out point list, so the depType is wrong\n");
    continue;
  }
  if (claim.depType === "depGroup") {
    console.log(`    expands to ${refs.length} member(s)`);
  }

  let matched = false;
  for (const ref of refs) {
    const member = await client.getCell(ref);
    if (!member) {
      console.log(`    ✗ member ${short(ref.txHash)}:${ref.index} is spent or missing`);
      continue;
    }
    const type = member.cellOutput.type;
    if (!type) {
      console.log(`    ·  member ${short(ref.txHash)}:${ref.index} has no type script`);
      continue;
    }
    const hash = ccc.Script.from(type).hash();
    const ok = hash === JOYID_CODE_HASH;
    console.log(
      `    ${ok ? "✓" : "✗"} member ${short(ref.txHash)}:${ref.index} ` +
        `type script ${short(hash)}${ok ? "  <- this is the JoyID lock" : ""}`,
    );
    matched ||= ok;
  }

  if (matched) {
    usable += 1;
    console.log("  => usable as it stands\n");
  } else {
    console.log("  => live, but nothing in it hashes to the JoyID lock code hash\n");
  }
}

console.log(
  usable === CLAIMS.length
    ? "both claims resolve — either can be used"
    : usable === 1
      ? "exactly one claim resolves — use that one, and do not copy the other"
      : "neither claim resolves — the JoyID lock is not where either source says",
);
