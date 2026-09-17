import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ccc from "@ckb-ccc/core";

const KEY_FILE = process.env.FLY_VISITOR_KEY_FILE ?? join(process.cwd(), ".key.visitor");
const key = readFileSync(KEY_FILE, "utf8").trim();
const client = new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/", fallbacks: [] });
const signer = new ccc.SignerCkbPrivateKey(client, key);
const addrObj = await signer.getAddressObjSecp256k1();
const address = addrObj.toString();
const balance = await client.getBalance(addrObj).catch((e) => `error: ${e.message}`);
console.log("address", address);
console.log("balance", String(balance), "shannons");
