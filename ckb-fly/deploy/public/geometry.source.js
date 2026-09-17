/**
 * Where the ring is, and which way the fly points.
 *
 * This module exists because the two answers used to live in different functions that disagreed,
 * and the disagreement was invisible. `flycore`'s compass constants put wedge 0 due east and
 * increase the angle counter-clockwise, so the model's +y is north. The ring is drawn starting at
 * `-π/2` — wedge 0 at the top — which is a deliberate choice and a pure *rotation* of the model's
 * ring by a quarter turn. A canvas, meanwhile, has +y pointing down.
 *
 * So a model vector drawn straight onto a canvas lands a quarter turn from the wedge it belongs
 * to. Nothing about the page looked broken: a cue at wedge 4 lit the right cells, the ring drew
 * them, and the heading arrow simply pointed somewhere else — at the wedge 90° away. The only way
 * to see it is to know which wedge should have lit up, which is why it survived a full test suite
 * and a deployment.
 *
 * Keeping both halves here is what makes the property testable: `test/geometry.test.js` walks every
 * wedge and asserts that the arrow drawn for a bump in that wedge lands on the drawn wedge. Two
 * functions in one file could drift; these cannot, and the test says so.
 *
 * @module geometry
 */

/** Wedges in the ring attractor. Must match `flycircuit::WEDGES` and `flycore`'s `COS16`/`SIN16`. */
export const WEDGES = 16;

const TAU = Math.PI * 2;

/**
 * Where wedge `w` sits in the model: `(cos, sin)` of its centre, +y north.
 *
 * This is `flycore`'s `COS16`/`SIN16` in continuous form — the same angle the simulation
 * accumulates the population vector over. If it ever stops matching those tables, the arrow points
 * at a wedge the bump is not in.
 *
 * **The half is load-bearing.** `flycore` documents those tables as the cosine and sine of each
 * wedge *centre*, so wedge `w` sits at `(w + ½)` of a wedge, not at `w`. Using the boundary instead
 * puts the arrow half a wedge off — subtle enough to look like nothing, and it is checked against
 * the tables themselves below.
 *
 * @param {number} w
 * @param {number} [wedges]
 */
export function wedgeDirection(w, wedges = WEDGES) {
  const angle = ((w + 0.5) / wedges) * TAU;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * Where wedge `w` is *drawn*, as a canvas angle.
 *
 * `-π/2` puts wedge 0 at the top of the ring, which is how the ellipsoid body is usually drawn.
 * That is the whole of the difference from [`wedgeDirection`], and it is a rotation rather than a
 * reflection — so the ring is not mirrored, it is turned.
 *
 * @param {number} w
 * @param {number} [wedges]
 */
export function wedgeAngle(w, wedges = WEDGES) {
  return -Math.PI / 2 + ((w + 0.5) / wedges) * TAU;
}

/**
 * A model vector, in canvas coordinates.
 *
 * The inverse of the rotation [`wedgeAngle`] applies, so a vector pointing at a wedge and the
 * drawing of that wedge end up in the same place. Every model vector comes through here — the
 * heading and the walk both do, or they would disagree with each other about which way the fly
 * went.
 *
 * @param {number} x
 * @param {number} y
 */
export function toCanvas(x, y) {
  return { x: y, y: -x };
}
