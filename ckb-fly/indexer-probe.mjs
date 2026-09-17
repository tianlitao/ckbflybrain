import * as ccc from "@ckb-ccc/core";
const say = (...a) => console.log("##", ...a);

const client = new ccc.ClientPublicTestnet(
  ccc.ClientPublicTestnet.resolveConfig({ url: "http://127.0.0.1:8114", fallbacks: [] }),
);

const head = { txHash: "0x8fdb719cc738135053025eea206c25ce8670bb3fc73c1061ea10143978a6f19e", index: 0 };
const flyTypeHash = "0x26028ec2032370ea6d8ffcdc50cc00805d808eaa23e556b12ea61e8a6e5a1317";

// What does getTransaction hand back?
const resp = await client.getTransaction(head.txHash);
say("response keys:", Object.keys(resp).join(", "));
say("status:", JSON.stringify(resp.status));
say("blockNumber:", resp.blockNumber);

const tx = resp.transaction;
say("inputs:", tx.inputs.length, "outputs:", tx.outputs.length, "witnesses:", tx.witnesses.length);
for (const [i, w] of tx.witnesses.entries()) {
  const wa = ccc.WitnessArgs.from(w);
  say(
    `  witness[${i}] lock=${wa.lock ? wa.lock.length : "-"} inputType=${wa.inputType ?? "-"}`,
  );
}

// Can we look up a spent cell? That is what walking the chain backwards requires.
const prev = await client.getCell(tx.inputs[0].previousOutput);
say("prev cell found:", !!prev, "type:", prev ? ccc.Script.from(prev.cellOutput.type).hash() : "-");
say("prev data length:", prev ? (prev.outputData.length - 2) / 2 : "-");
