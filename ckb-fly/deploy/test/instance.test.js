/**
 * The instance nonce, which is what makes two flies two organisms.
 *
 * Every fly's type script args carry an eight-byte instance field. Two flies that shared one
 * would share a type script, and then "find the cell wearing the fly's type script" returns
 * an arbitrary one of them: `status` reads the wrong organism, and a keeper driving both
 * ticks first one and then the other — the step counter going backwards, and nothing
 * erroring. The symptoms are quiet, which is why the property is pinned here rather than
 * left to review.
 *
 * This test exists because the bug was real: `genesis` used to inherit the instance from the
 * deployment record, so a second fly from the same genome was created with the first fly's
 * type script. Two live cells then wore the same script, and `status` on the second fly
 * reported the first one's state.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as ccc from "@ckb-ccc/core";

import { args, mintInstance } from "../src/plan.js";

/** The connectome commitment the ring attractor was built with. */
const CIRCUIT = "0xffbe0e7f28e1f0dd2cfaa01d1d221c502bf41c1fd519ebfe8d9b8203e7cedfc2";

/** Stands in for the flybrain code cell's data hash. Any fixed value does. */
const FLYBRAIN = "0x" + "11".repeat(32);

/** The type script a fly with this instance would wear. */
function typeHashFor(instance) {
  const planned = args({ instance, params: "v1", economics: "testnet", circuitHash: CIRCUIT });
  return ccc.Script.from({ codeHash: FLYBRAIN, hashType: "data1", args: planned.args }).hash();
}

describe("the instance nonce", () => {
  it("is eight bytes", () => {
    const instance = mintInstance();
    assert.match(instance, /^0x[0-9a-f]{16}$/, "eight bytes, lower-case hex");
  });

  it("is fresh every time it is asked for", () => {
    // Sixty-four bits of randomness, so a repeat would mean the generator is not being
    // called at all — which is exactly the shape of the bug this guards.
    const seen = new Set();
    for (let i = 0; i < 256; i++) {
      const instance = mintInstance();
      assert.ok(!seen.has(instance), `mintInstance repeated ${instance} after ${i} draws`);
      seen.add(instance);
    }
    assert.equal(seen.size, 256);
  });

  it("is what makes two flies two organisms", () => {
    // The property the whole field exists for: distinct instances must produce distinct type
    // scripts. If they did not, the chain would be unable to tell the flies apart.
    const hashes = new Set();
    for (let i = 0; i < 32; i++) {
      hashes.add(typeHashFor(mintInstance()));
    }
    assert.equal(hashes.size, 32, "32 flies must be 32 type scripts");
  });

  it("changes the type script even when everything else is identical", () => {
    // Same genome, same parameters, same prices, same connectome — one byte of nonce apart.
    // This is the case that a reused instance collapses into a single organism.
    const a = mintInstance();
    const b = mintInstance();
    assert.notEqual(a, b);
    assert.notEqual(
      typeHashFor(a),
      typeHashFor(b),
      "two flies from one genome must not share a type script",
    );
  });

  it("refuses to plan args without one", () => {
    // `args` requires it rather than defaulting, because a default would be a zero nonce and
    // two flies deployed without thinking about it would collide silently.
    assert.throws(() => args({ params: "v1", economics: "testnet", circuitHash: CIRCUIT }), /instance/);
  });
});
