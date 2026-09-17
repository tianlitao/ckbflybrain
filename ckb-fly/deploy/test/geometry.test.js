/**
 * The arrow has to land on the wedge it belongs to.
 *
 * `flycore` accumulates the heading as a population vector over the compass ring, in a convention
 * where wedge 0 is due east and +y is north. The page draws the ring starting at the top instead,
 * and a canvas has +y pointing down. Get either of those wrong and the page still looks like a
 * page: the right cells light up, the ring draws them, and the arrow points at some other wedge.
 *
 * That is not hypothetical. Both halves used to live in `app.source.js` and disagreed by a quarter
 * turn — a cue at wedge 4 lit the ring correctly while the heading, whose `headY` was +10,898 and
 * so nearly due north, was drawn pointing south. It survived a full test suite, a deployment and a
 * screenshot review, because the only way to notice is to know which wedge should have lit up.
 *
 * So this test states that knowledge: for every wedge, the arrow drawn for a bump in that wedge
 * must land where that wedge is drawn.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WEDGES, toCanvas, wedgeAngle, wedgeDirection, wedgeOf } from "../public/geometry.source.js";

/** Where a wedge is drawn, as a unit vector in canvas space. */
function drawnWedge(w) {
  const a = wedgeAngle(w);
  return { x: Math.cos(a), y: Math.sin(a) };
}

describe("the ring's geometry", () => {
  it("puts the arrow on the wedge the bump is in", () => {
    for (let w = 0; w < WEDGES; w++) {
      const arrow = toCanvas(wedgeDirection(w).x, wedgeDirection(w).y);
      const drawn = drawnWedge(w);
      assert.ok(
        Math.abs(arrow.x - drawn.x) < 1e-9 && Math.abs(arrow.y - drawn.y) < 1e-9,
        `wedge ${w}: the arrow for a bump here lands at (${arrow.x.toFixed(3)}, ${arrow.y.toFixed(3)}) ` +
          `but the wedge is drawn at (${drawn.x.toFixed(3)}, ${drawn.y.toFixed(3)})`,
      );
    }
  });

  it("turns the ring rather than mirroring it", () => {
    // A reflection would also put *a* wedge under the arrow — the wrong one, and the ring would
    // read back to front. Rotations preserve orientation; reflections reverse it.
    const [a, b, c] = [0, 1, 2].map(drawnWedge);
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    assert.ok(cross > 0, "consecutive wedges must keep turning the same way");
  });

  it("matches the simulation's compass tables", () => {
    // `flycore`'s COS16/SIN16, scaled to 127 and rounded. The arrow is only meaningful if the
    // angle it is drawn from is the angle the simulation summed over.
    const COS16 = [125, 106, 71, 25, -25, -71, -106, -125, -125, -106, -71, -25, 25, 71, 106, 125];
    const SIN16 = [25, 71, 106, 125, 125, 106, 71, 25, -25, -71, -106, -125, -125, -106, -71, -25];
    for (let w = 0; w < WEDGES; w++) {
      const d = wedgeDirection(w);
      assert.equal(Math.round(d.x * 127), COS16[w], `COS16[${w}]`);
      assert.equal(Math.round(d.y * 127), SIN16[w], `SIN16[${w}]`);
    }
  });

  it("names the wedge a heading points at, for every wedge", () => {
    // The ring labels the wedge the bump is in and fills it, so the label and the highlight come
    // from `wedgeOf` while the ring itself comes from `wedgeAngle`. Round-tripping every wedge is
    // what keeps the number on the picture equal to the picture — including wedge 15, whose centre
    // is at 0.97 of a turn and so comes back from `atan2` as a *negative* angle.
    for (let w = 0; w < WEDGES; w++) {
      const d = wedgeDirection(w);
      assert.equal(wedgeOf(d.x, d.y), w, `a bump in wedge ${w} must be reported as wedge ${w}`);
    }
    // And a vector *past* a boundary belongs to the wedge beyond it, not to the one it left.
    // Measured from the centre and then pushed past the boundary, because right on it the answer
    // is a coin toss and pinning a coin toss is how a test becomes a liar.
    const half = Math.PI / WEDGES;
    for (let w = 0; w < WEDGES; w++) {
      const a = (w + 0.5) * ((Math.PI * 2) / WEDGES) + half * 1.1;
      assert.equal(wedgeOf(Math.cos(a), Math.sin(a)), (w + 1) % WEDGES, `just past wedge ${w}`);
    }
  });

  it("keeps the walk and the heading in the same frame", () => {
    // The fly walks along its heading (`pos += heading / |heading| · stride` in `flycore`), so a
    // position and a heading that point the same way in the model must still point the same way
    // once drawn — otherwise the ring and the walk plot disagree about which way it went.
    //
    // Both go through `toCanvas`, and what makes that sufficient is that it is a *rotation*: it
    // preserves the angle between two vectors, so agreement survives it. A reflection would too,
    // which is why the orientation check above matters as well.
    const heading = { x: 3, y: 1 };
    const walked = { x: 1.5, y: 0.5 }; // the same direction, half as far
    const drawnHeading = toCanvas(heading.x, heading.y);
    const drawnWalked = toCanvas(walked.x, walked.y);

    const cross = drawnHeading.x * drawnWalked.y - drawnHeading.y * drawnWalked.x;
    const dot = drawnHeading.x * drawnWalked.x + drawnHeading.y * drawnWalked.y;
    assert.ok(Math.abs(cross) < 1e-12, "the two must stay parallel");
    assert.ok(dot > 0, "and must stay pointing the same way, not reversed");
  });
});
