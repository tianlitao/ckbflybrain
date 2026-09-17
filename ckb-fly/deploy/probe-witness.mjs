import * as ccc from "@ckb-ccc/core";
const say = (...a) => console.log("##", ...a);

const client = new ccc.ClientPublicTestnet(
  ccc.ClientPublicTestnet.resolveConfig({ url: "http://127.0.0.1:8114", fallbacks: [] }),
);

const head = { txHash: "0x8fdb719cc738135053025eea206c25ce8670bb3fc73c1061ea10143978a6f19e", index: 0 };
const tx = (await client.getTransaction(head.txHash)).transaction;
const raw = tx.witnesses[0];

// --- mol codec
try {
  const m = ccc.mol.WitnessArgs.fromBytes(raw);
  say("mol inputType opt:", JSON.stringify(m.inputType().toOpt()));
  say("mol lock opt:", JSON.stringify(m.lock().toOpt()));
} catch (e) {
  say("mol failed:", String(e.message).slice(0, 120));
}

// --- hand parse: WitnessArgs is a molecule table of three BytesOpt fields. A BytesOpt is
// an option of a byte vector, which molecule encodes as a bare Bytes: length 0 means None.
function readWitnessArgs(hex) {
  const b = Buffer.from(hex.slice(2), "hex");
  const u32 = (o) => b.readUInt32LE(o);
  const total = u32(0);
  if (total !== b.length) throw new Error(`WitnessArgs total ${total} != ${b.length}`);
  const [o0, o1, o2] = [u32(4), u32(8), u32(12)];
  const field = (from, to) => {
    if (from === to) return null;
    const len = u32(from);
    const start = from + 4;
    if (start + len > to) throw new Error("BytesOpt payload overruns its field");
    return hex.slice(0, 0) + "0x" + b.subarray(start, start + len).toString("hex");
  };
  return { lock: field(o0, o1), inputType: field(o1, o2), outputType: field(o2, total) };
}

const wa = readWitnessArgs(raw);
say("hand-parsed:", JSON.stringify(wa));
