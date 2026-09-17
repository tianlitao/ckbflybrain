/**
 * The front-end.
 *
 * Three things are drawn, and they are the three things the fly actually is:
 *
 * 1. **The ring.** 155 neurons, arranged where the connectome says they sit — compass cells
 *    on the outer ring, one arc per wedge of the ellipsoid body, everything else inside,
 *    grouped by cell type. Colour is membrane potential: warm is depolarised, cool is
 *    hyperpolarised, and a neuron drawn bright fired on the last step.
 * 2. **The heading.** The population vector of the compass ring, which is the fly's
 *    "thought" — the only thing this circuit is for.
 * 3. **The walk.** Where those headings have carried it, in 1/256th of a cell per unit.
 *
 * # There is no server behind this page
 *
 * Nothing here calls `/api/*`. The fly's state is read from a CKB node over JSON-RPC — CORS is
 * the node's own answer and it is `*` — and the successor state is computed by `flywasm`, which
 * is `flycore` compiled for wasm32: the same crate the on-chain validator runs, so this page
 * cannot disagree with the chain about what a tick produces. Driving is signed by the reader's
 * own wallet. `public/chain.source.js` is the reading half, `public/sim.source.js` the
 * computing half, `src/tx.js` the transaction they share with the CLI.
 *
 * What is left for a host is four files and the right `content-type` for one of them.
 *
 * Nothing is simulated here beyond that. Every number on the page came out of a cell on the
 * chain, decoded by the same Rust crate the type script runs. Between two states the page
 * interpolates, and the interpolation is labelled as such by the fact that it is smooth:
 * the chain's states are the frames that actually happened.
 */

import * as ccc from "@ckb-ccc/core";

import { WebComponentConnector } from "@ckb-ccc/connector";
import { CLOSED, closeConnector, openConnector, settledSigner, watchConnector } from "./connector.source.js";
import { appIcon, createWallet } from "./wallet.source.js";
import { createFeed } from "./chain.source.js";
import { loadSim } from "./sim.source.js";
import { createPrepare } from "./prepare.source.js";
import { decodeState } from "../src/fly.js";
import { toCanvas, wedgeAngle, wedgeOf } from "./geometry.source.js";
import {
  applyLanguage,
  initLanguage,
  locale,
  onLanguage,
  renderLanguageSwitch,
  t,
} from "./i18n-dom.source.js";

const DURATION = 600; // ms of interpolation between two on-chain states
const POLL_MS = 3000; // how often to look for a new transition, as the server used to

// ------------------------------------------------------------------ state

let snap = null; // the last snapshot, built by `feed` — see chain.source.js
let placed = null; // neuron positions, computed once per circuit
let pinned = null; // a past transition being inspected, decoded in full, or null for live
let anim = null; // { from, to, t0 } — the interpolation in progress
let drawn = null; // the state currently on screen, as the source of the next animation
let wallet = null; // the visitor's wallet, if any: see wallet.source.js
let connector = null; // CCC's own wallet picker, created once and kept — see renderWallet
let connectorWatch = null; // the handle that lets this page close it without being answered
let walletPick = 0; // which of the offered signers the reader chose
let feed = null; // the page's own index of the chain: see chain.source.js
let sim = null; // the dynamics, in wasm: see sim.source.js
let prepare = null; // the page's half of a click: see prepare.source.js
let poll = null; // the timer that replaces the server's event stream

// ------------------------------------------------------------------ reading

/**
 * The page's copy of the deployment record, written by `make build-front-end`.
 *
 * The page can discover *which* organisms exist by asking for the `flybrain` code, but it
 * cannot discover which code to look for — so this is the one thing that has to be handed to
 * it. It carries no key material; see `emit-public-config.mjs`.
 */
async function loadConfig() {
  const res = await fetch(new URL("./deployment.json", import.meta.url));
  if (!res.ok) {
    throw new Error(
      `cannot read the deployment (${res.status} ${res.statusText}). It is written by ` +
        "`make build-front-end`, and it has to sit beside this page.",
    );
  }
  return res.json();
}

async function loadSnapshot() {
  await feed.refresh();
  applySnapshot(feed.snapshot());
}

function applySnapshot(next) {
  const before = snap;
  snap = next;

  if (!placed || before?.circuit?.hash !== next.circuit?.hash) {
    placed = placeNeurons(next.circuit);
  }

  const to = next.current?.state ?? null;
  if (to) {
    anim = { from: drawn ?? to, to, t0: performance.now() };
  }
  drawn = to;

  renderIdentity();
  renderRoster();
  renderPanels();
  renderChronicle();
  renderTimeline();
  renderWallet();
  renderDrive();

  // The two canvases are not DOM, so the renderers above do not touch them. A new snapshot is the
  // one thing that certainly changes what they should show — even when the state did not move,
  // because arriving at the same state is news to nothing, but the first snapshot definitely is.
  invalidate();
}

/**
 * Polling, which is what replaced `GET /api/events`.
 *
 * The server could hold a connection open and push; a static page cannot, because there is
 * nothing on the other end to hold it. What made the stream cheap was not the transport but the
 * *incremental* walk behind it, and that survives: `chain.source.js` keeps the transaction
 * hashes it has already seen, so a poll that finds nothing new is two queries rather than one
 * per step of the fly's life.
 *
 * A hidden tab does not poll at all. A reader who left the page open overnight should not have
 * spent the night asking a public node whether anything happened, and the refresh on return
 * gives them the same picture a poll would have.
 */
function subscribe() {
  if (poll !== null) {
    return;
  }
  poll = setInterval(() => {
    if (!document.hidden) {
      loadSnapshot().catch(reportError);
    }
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadSnapshot().catch(reportError);
    }
  });
}

// ------------------------------------------------------------------ layout


/**
 * Where each neuron sits.
 *
 * The connectome says which wedge a compass cell belongs to and which of the six cell
 * types every neuron is. That is enough to lay the circuit out the way it is usually
 * drawn — the ring of the ellipsoid body outside, the tangential and delta-7 cells
 * inside — without inventing coordinates the biology does not have.
 */
function placeNeurons(circuit) {
  const { layout, wedges } = circuit;
  const TAU = Math.PI * 2;

  const outer = [];
  const byWedge = Array.from({ length: wedges }, () => []);
  const byType = new Map();

  layout.forEach((neuron, index) => {
    if (neuron.wedge !== 255) {
      byWedge[neuron.wedge].push(index);
    } else {
      if (!byType.has(neuron.type)) {
        byType.set(neuron.type, []);
      }
      byType.get(neuron.type).push(index);
    }
  });

  byWedge.forEach((members, wedge) => {
    // The wedge's *centre*, so a bump here and the arrow drawn for it agree — see `geometry`.
    const base = wedgeAngle(wedge, wedges);
    members.forEach((index, k) => {
      // A wedge's neurons fan out inside its own arc rather than stacking on one radius,
      // which is what makes the ring read as sixteen groups instead of one circle.
      const spread = members.length > 1 ? (k / (members.length - 1) - 0.5) * (TAU / wedges) * 0.75 : 0;
      outer.push({ index, angle: base + spread, ring: 0 });
    });
  });

  const innerTypes = [...byType.keys()].sort((a, b) => a - b);
  const inner = [];
  innerTypes.forEach((type, ring) => {
    const members = byType.get(type);
    members.forEach((index, k) => {
      // These cells have no wedge, so their angle carries no meaning and they are simply spread
      // evenly. Starting from the same phase as the outer ring keeps the two concentric with each
      // other rather than half a group out.
      inner.push({ index, angle: wedgeAngle(0, wedges) + (k / members.length) * TAU, ring: ring + 1 });
    });
  });

  return { outer, inner, innerTypes, wedges };
}

// ------------------------------------------------------------------ drawing

/**
 * Where the rings sit, in canvas units, and the type face the canvas labels use.
 *
 * `ringRadius` is the one place a ring index becomes a distance. `placeNeurons` decides the index
 * and `drawRing` draws at the radius, and the two used to be numbers written out in both — a
 * literal `150` here and a literal `150` there, agreeing by luck until the labels needed a third
 * copy.
 */
const RING_OUTER = 250;
const RING_INNER = 150;
const RING_STEP = 52;
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

function ringRadius(ring) {
  return ring === 0 ? RING_OUTER : RING_INNER - (ring - 1) * RING_STEP;
}

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
}

const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function currentFrame(now) {
  if (!anim) {
    return { state: drawn, t: 1, flash: 0 };
  }
  const raw = Math.min(1, (now - anim.t0) / DURATION);
  const t = easeOut(raw);
  return {
    state: {
      ...anim.to,
      v: anim.to.v ? anim.to.v.map((v, i) => lerp(anim.from.v?.[i] ?? v, v, t)) : anim.to.v,
      posX: Math.round(lerp(Number(anim.from.posX), Number(anim.to.posX), t)),
      posY: Math.round(lerp(Number(anim.from.posY), Number(anim.to.posY), t)),
    },
    t: raw,
    flash: 1 - raw,
  };
}

function drawRing(now) {
  const canvas = document.getElementById("ring");
  const ctx = fit(canvas);
  const size = canvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const scale = size / 720;
  const R = RING_OUTER * scale;

  const { state, flash } = currentFrame(now);
  const params = snap.params;
  const radiusOf = (v) => {
    const magnitude = Math.min(1, Math.abs(v) / 2200);
    return (5 + magnitude * 9) * scale;
  };
  const theme = colors();

  const wedges = placed.wedges;
  const half = Math.PI / wedges;
  // Which wedge the bump is in, from the same table the arrows use — see `wedgeOf`. `null` when
  // there is no heading at all (a shock collapses it to (0, 0)), in which case nothing is filled.
  const bump =
    state && Math.hypot(state.headX, state.headY) > 1
      ? wedgeOf(state.headX, state.headY, wedges)
      : null;

  // ---- the sixteen wedges, first, as structure: a tick on every boundary and the wedge's number
  // outside it. Without these the ring is a ring of dots — nothing on the page said that the fly
  // has sixteen of anything, that `cue, wedge 4` lights exactly one of them, or that the
  // `(headX, headY)` in the timeline is an angle rather than two more numbers.
  ctx.strokeStyle = tint(theme.accent, 0.14);
  ctx.lineWidth = 1 * scale;
  for (let w = 0; w < wedges; w++) {
    const at = wedgeAngle(w, wedges) - half;
    const inner = (R - 22) * scale;
    const outer = (R + 26) * scale;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(at) * inner, cy + Math.sin(at) * inner);
    ctx.lineTo(cx + Math.cos(at) * outer, cy + Math.sin(at) * outer);
    ctx.stroke();
  }

  // ---- the wedge the bump is in, filled, *under* the memory arcs: the one thing about a ring
  // attractor that a reader can only get from the picture, and the answer to "where is it looking
  // right now". Filled from the ring outwards, so it reads as the same kind of object as the
  // history arc it sits under.
  const hist = state?.headingHist ?? [];
  const maxHist = Math.max(1, ...hist);
  const reachOf = (w) => (26 + (hist[w] / maxHist) * 34) * scale;
  if (bump !== null) {
    const base = wedgeAngle(bump, wedges);
    ctx.beginPath();
    ctx.arc(cx, cy, R + reachOf(bump), base - half, base + half);
    ctx.arc(cx, cy, R - 20 * scale, base + half, base - half, true);
    ctx.closePath();
    ctx.fillStyle = tint(theme.warm, 0.16);
    ctx.fill();
  }

  // ---- the heading histogram: where the fly has pointed, one arc per wedge. Under the neurons,
  // because it is the fly's memory rather than anything it is doing now.
  for (let w = 0; w < wedges; w++) {
    // `wedgeAngle`, so each arc sits exactly outside the wedge whose memory it is. This was the
    // third copy of the convention and the one furthest from the other two — it drew the histogram
    // half a wedge out of step with the neurons it brackets.
    const base = wedgeAngle(w, wedges);
    ctx.beginPath();
    ctx.arc(cx, cy, R + reachOf(w), base - half * 0.8, base + half * 0.8);
    ctx.strokeStyle = hist[w] > 0 ? tint(theme.warm, 0.5) : tint(theme.muted, 0.28);
    ctx.lineWidth = (hist[w] > 0 ? 5 : 2) * scale;
    ctx.stroke();
  }

  // ---- the wedge numbers, outside the arcs. The model's own names for the sixteen sectors, which
  // is what a cue's parameter, the physics above and the timeline are all counting in.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${12.5 * scale}px ${SANS}`;
  for (let w = 0; w < wedges; w++) {
    const base = wedgeAngle(w, wedges);
    const r = R + 80 * scale;
    if (w === bump) {
      // The wedge the fly is pointing at, in the accent the *state* is drawn in rather than in the
      // instrument colour: this one number is a fact about the fly, not chrome.
      ctx.fillStyle = theme.warm;
      ctx.shadowColor = tint(theme.warm, 0.7);
      ctx.shadowBlur = 10 * scale;
    } else {
      ctx.fillStyle = tint(theme.faint, 1);
    }
    ctx.fillText(String(w), cx + Math.cos(base) * r, cy + Math.sin(base) * r);
    ctx.shadowBlur = 0;
  }

  // ---- guide rings, from the radii the neurons are actually placed at. The list here used to be
  // four literal radii, one per ring the layout *could* produce; the connectome produces one inner
  // ring out of its six cell types, so three of those circles outlined empty space.
  ctx.strokeStyle = tint(theme.accent, 0.1);
  ctx.lineWidth = 1 * scale;
  for (const ring of new Set([0, ...placed.inner.map((n) => n.ring)])) {
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius(ring) * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---- the neurons
  const drawNeuron = ({ index, angle, ring }) => {
    const v = state?.v?.[index] ?? 0;
    const r = ringRadius(ring) * scale;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    const fired = state?.v?.[index] === params.reset;

    if (fired) {
      // A halo that fades with the animation, so a spike reads as "just now" rather than
      // as a permanent property of the neuron. The glow is what makes a spike visible from across
      // the page, which is the thing a reader is actually watching for.
      ctx.beginPath();
      ctx.arc(x, y, (9 + 7 * flash) * scale, 0, Math.PI * 2);
      ctx.fillStyle = tint(theme.warm, 0.16 + 0.3 * flash);
      ctx.fill();
      ctx.shadowColor = tint(theme.warm, 0.75);
      ctx.shadowBlur = (10 + 10 * flash) * scale;
    }

    ctx.beginPath();
    ctx.arc(x, y, radiusOf(v), 0, Math.PI * 2);
    // Three states, and the third is the one that was missing. Sampled off the deployed canvas
    // with the fly quiescent: almost every dot came out the same saturated cool, because "at rest"
    // is not `v === 0` in this model — the neurons with a negative engram sit on the floor
    // (`vMin`) most of the time, and colouring the floor as brightly as a driven inhibition leaves
    // the ring one colour with nothing to notice. So the *near-rest band* is grey: within a tenth
    // of the floor is "nothing is happening here", which is true, and it leaves the two accents for
    // the cells that are actually doing something.
    const floor = Math.max(1, Math.abs(params.vMin ?? 3000));
    if (Math.abs(v) < floor * 0.1) {
      ctx.fillStyle = tint(theme.faint, 0.9);
    } else if (v > 0) {
      const strength = Math.min(1, v / 1200);
      ctx.fillStyle = tint(theme.warm, 0.4 + 0.6 * strength);
    } else {
      const strength = Math.min(1, -v / floor);
      ctx.fillStyle = tint(theme.cool, 0.3 + 0.6 * strength);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 0.6 * scale;
    ctx.stroke();
  };

  placed.outer.forEach(drawNeuron);
  placed.inner.forEach(drawNeuron);

  // ---- the heading: the population vector of the compass ring, drawn as an arrow rather than as
  // a radius, so it reads as a direction. Its tip lands on the wedge the bump is in — the same
  // `wedgeOf` the fill above used, which is why the fill and the arrow cannot disagree.
  const hx = state?.headX ?? 0;
  const hy = state?.headY ?? 0;
  const magnitude = Math.hypot(hx, hy);
  if (magnitude > 1) {
    const length = Math.min(1, magnitude / 14000) * R * 0.92;
    // Through `toCanvas`, so the arrow lands on the wedge the bump is actually in.
    const dir = toCanvas(hx / magnitude, hy / magnitude);
    const tip = { x: cx + dir.x * length, y: cy + dir.y * length };
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = "round";
    ctx.shadowColor = tint(theme.accent, 0.6);
    ctx.shadowBlur = 8 * scale;
    ctx.stroke();

    const head = 13 * scale;
    const across = 6.5 * scale;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - dir.x * head + dir.y * across, tip.y - dir.y * head - dir.x * across);
    ctx.lineTo(tip.x - dir.x * head - dir.y * across, tip.y - dir.y * head + dir.x * across);
    ctx.closePath();
    ctx.fillStyle = theme.ink;
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    // No arrow is a fact, not a gap: the bump has been collapsed — which is exactly what `shock`
    // does, and what the fly's own dynamics do when life runs out — or it has never been cued at
    // all. An arrow that silently vanishes reads as a broken drawing, so the drawing says so.
    ctx.font = `${12 * scale}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = tint(theme.warm, 0.85);
    ctx.fillText(t("ring.noHeading"), cx, cy - 20 * scale);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 3 * scale, 0, Math.PI * 2);
  ctx.fillStyle = theme.ink;
  ctx.fill();

  // ---- what the middle is. The cells with no wedge are one type and there are 42 of them, and a
  // ring of forty-two dots in the centre of the picture says nothing at all until it says what it
  // is. Placed in the gap between the inner ring and the centre, where the only thing that can
  // reach it is the heading arrow — which is drawn over it when the fly is pointing straight up,
  // and that is the one case where the label is not what the reader is looking at.
  if (placed.inner.length > 0) {
    ctx.font = `${12 * scale}px ${SANS}`;
    ctx.fillStyle = tint(theme.faint, 1);
    ctx.fillText(
      t("ring.innerRing", { n: placed.inner.length }),
      cx,
      cy - (RING_INNER - 30) * scale,
    );
  }
}

function drawWalk(now) {
  const canvas = document.getElementById("walk");
  const ctx = fit(canvas);
  const size = canvas.width;
  const { state } = currentFrame(now);
  // Rotated into canvas space *before* the bounds are taken, so the plot is scaled to the path it
  // is about to draw rather than to the path in the other coordinate system.
  const settled = (snap.history ?? []).map((e) =>
    toCanvas(Number(e.state.posX), Number(e.state.posY)),
  );
  // The path is drawn through the interpolated point, but the *bounds* are taken from the chain's
  // own position — the settled one. Taking them from the animated point re-fit the whole plot on
  // every frame of a 600 ms transition, so the grid, the path and the dot all slid and rescaled
  // under the reader's eyes while the fly was doing nothing more than the last transition it was
  // asked to do. That is what "the picture keeps moving" was. Now the plot re-fits once, when a
  // transition arrives, and stays still in between.
  const anchor = snap.current?.state;
  const framePoint = anchor ? [toCanvas(Number(anchor.posX), Number(anchor.posY))] : [];
  const bounds = settled.length > 0 ? settled.concat(framePoint) : framePoint;
  const points = settled.concat(
    state ? [toCanvas(Number(state.posX), Number(state.posY))] : [],
  );

  if (points.length === 0) {
    return;
  }

  const xs = bounds.map((p) => p.x);
  const ys = bounds.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const span = Math.max(spanX, spanY, 256) * 1.3;
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const toPx = (p) => ({
    x: size / 2 + ((p.x - midX) / span) * size,
    y: size / 2 + ((p.y - midY) / span) * size,
  });

  const theme = colors();

  ctx.strokeStyle = tint(theme.accent, 0.09);
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const at = (i / 4) * size;
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, size);
    ctx.moveTo(0, at);
    ctx.lineTo(size, at);
    ctx.stroke();
  }

  ctx.beginPath();
  points.forEach((p, i) => {
    const { x, y } = toPx(p);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.strokeStyle = tint(theme.cool, 0.8);
  ctx.lineWidth = 2;
  ctx.stroke();

  points.slice(0, -1).forEach((p) => {
    const { x, y } = toPx(p);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = tint(theme.cool, 0.5);
    ctx.fill();
  });

  if (state) {
    const { x, y } = toPx({ x: Number(state.posX), y: Number(state.posY) });
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = theme.ink;
    ctx.shadowColor = tint(theme.cool, 0.8);
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/**
 * Painting, which happens when something changed and not before.
 *
 * This used to be `frame(now) { drawRing(now); drawWalk(now); requestAnimationFrame(frame); }` —
 * both canvases redrawn *every frame, forever*. Measured on the deployed page with the fly idle:
 * 848 redraws of each canvas in 8 seconds (≈106/s), and the pixel fingerprint identical from one
 * second to the next. Two full-canvas clears plus ~155 arcs and dots per frame is work nobody
 * asked for, on a page whose whole content is a picture of something that is not moving. And
 * `drawRing` called `getComputedStyle(document.body)` **twice per frame** — a forced style recalc
 * at 60 Hz — to read a colour it then discarded (`void ink`).
 *
 * So a frame is scheduled only when there is something to draw, and the loop keeps itself alive
 * only while an interpolation is actually in flight: an idle page paints zero times, and a
 * transition paints for its 600 ms and then stops.
 *
 * What counts as "something changed" is deliberately not "the snapshot differs". A poll that
 * finds nothing new still calls `applySnapshot`, and comparing 1,213 bytes of state to decide
 * whether to redraw would cost more than the redraw. `invalidate()` is called by the few places
 * that already know: a new snapshot, a pin, a language switch, a resize.
 */
let dirty = true; // something to draw
let painting = false; // a frame is scheduled or in flight
let palette = null; // `getComputedStyle` results, read once rather than once per frame

function invalidate() {
  dirty = true;
  if (painting) {
    return;
  }
  painting = true;
  requestAnimationFrame(paint);
}

function paint(now) {
  const animating = anim !== null && now - anim.t0 < DURATION;
  if (dirty || animating) {
    dirty = false;
    if (snap?.current) {
      drawRing(now);
      drawWalk(now);
    }
  }
  if (animating) {
    requestAnimationFrame(paint);
  } else {
    // The interpolation is over (or was never started). Dropping it here rather than in the
    // animation is what lets `currentFrame` report the settled state without a second flag.
    anim = null;
    painting = false;
  }
}

/**
 * The colours the drawing needs, read out of the stylesheet once.
 *
 * Read rather than written here, because the page's palette is the stylesheet's business: the
 * canvas had `#111`, `rgba(0,0,0,0.06)` and two hardcoded accent colours in it, which is a second
 * copy of the theme that no CSS change could reach. Read once per theme, not once per frame —
 * `getComputedStyle` forces a style recalculation, and this used to run at 60 Hz.
 */
function colors() {
  if (!palette) {
    const styles = getComputedStyle(document.body);
    const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    palette = {
      ink: read("--ink", "#e7f1f8"),
      muted: read("--muted", "#93a4b6"),
      faint: read("--faint", "#5c6c7e"),
      warm: read("--warm", "#ff7a3d"),
      cool: read("--cool", "#3fd0ff"),
      accent: read("--accent", "#6ff3ff"),
    };
  }
  return palette;
}

/**
 * A stylesheet colour at an alpha, for the canvas.
 *
 * CSS hands back hex (`#ff7a3d`) and a canvas wants `rgba()`. Anything that is not a hex string —
 * an `rgba()` the stylesheet already wrote that way — is returned untouched rather than mangled.
 */
function tint(colour, alpha) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour ?? "");
  if (!hex) {
    return colour;
  }
  const full =
    hex[1].length === 3
      ? hex[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : hex[1];
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}


// ------------------------------------------------------------------ panels

// Numbers follow the page's language, not the browser's: a reader who switched to Chinese gets
// Chinese grouping and separators, which is what the switch is for.
const fmt = (n) => Number(n).toLocaleString(locale());

/**
 * Rebuild an element's children only when what they show has changed.
 *
 * Every renderer used to start with `innerHTML = ""`, and every poll calls every renderer — so
 * three times a minute, whether or not anything had happened, the roster, the timeline and the
 * five Drive cards were replaced by identical copies of themselves. A screenshot cannot tell, and
 * a reader can, three ways:
 *
 *   * **A click that lands on a node the render just replaced does nothing at all.** This is not
 *     hypothetical: it is why the Drive cards occasionally had to be clicked twice, and why the
 *     roster row for the fly being watched sometimes ignored a click.
 *   * A text selection, a `:hover`, or a scroll position inside a list is thrown away.
 *   * The browser re-lays-out the page for no reason, every poll.
 *
 * `signature` is the string the renderer derives everything from. Unchanged means the DOM already
 * says the right thing, and leaving it alone is both cheaper and more correct than rebuilding it.
 *
 * @param {HTMLElement} el
 * @param {string} signature
 * @param {() => void} build
 */
function rebuild(el, signature, build) {
  if (el.dataset.sig === signature) {
    return;
  }
  el.dataset.sig = signature;
  el.innerHTML = "";
  build();
}

/** `el.innerHTML = html`, unless that is already what it says. Writing it again replaces every
 * child node with an identical copy, which is a rebuild the reader cannot see and a click cannot
 * survive. */
function setHtml(el, html) {
  if (el.innerHTML !== html) {
    el.innerHTML = html;
  }
}

/** `el.textContent = text`, unless that is already what it says. */
function setText(el, text) {
  if (el.textContent !== text) {
    el.textContent = text;
  }
}

function facts(list, target) {
  rebuild(target, `${locale()}|${JSON.stringify(list)}`, () => {
    for (const [label, value, className] of list) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      if (className) {
        dd.className = className;
      }
      target.append(dt, dd);
    }
  });
}

function renderIdentity() {
  const { identity, circuit } = snap;
  facts(
    [
      [t("identity.typeScript"), identity.typeHash],
      [t("identity.params"), identity.params],
      [t("identity.economics"), identity.economics],
      [t("identity.connectome"), circuit.hash],
      [t("identity.neurons"), t("identity.neuronsValue", { n: circuit.n, wedges: circuit.wedges })],
      [t("identity.chain"), snap.network],
    ],
    document.getElementById("identity"),
  );
}

function renderPanels() {
  const entry = displayedEntry();
  const s = entry?.state;
  if (!s) {
    return;
  }
  const econ = snap.economics;

  facts(
    [
      [t("life.step"), fmt(s.step)],
      [t("life.energy"), t("life.stepsOfLife", { n: fmt(s.energy) })],
      [
        t("life.alive"),
        s.alive ? t("life.yes") : t("life.dead"),
        s.alive ? "ok" : "bad",
      ],
      [t("life.generation"), fmt(s.generation)],
      [t("life.spikes"), t("life.spikesThisLife", { total: fmt(s.totalSpikes), life: fmt(s.lifeSpikes) })],
      [t("life.bornBlock"), fmt(s.bornBlock)],
      [t("life.stimulus"), describeStimulus(s)],
      [t("life.orientation"), `(${s.headX}, ${s.headY})`],
    ],
    document.getElementById("life"),
  );

  // The invariant the whole economics rests on, shown rather than asserted: the cell's
  // capacity must equal the body plus the value of the life it still holds.
  const required = BigInt(econ.bodyCapacity) + BigInt(s.energy) * BigInt(econ.backingPerStep);
  const held = entry.capacity === undefined ? null : BigInt(entry.capacity);
  facts(
    [
      [t("backing.perStep"), t("backing.shannons", { n: fmt(econ.backingPerStep) })],
      [t("backing.body"), `${fmt(Number(econ.bodyCapacity) / 1e8)} CKB`],
      [t("backing.life"), `${fmt(Number(BigInt(s.energy) * BigInt(econ.backingPerStep)) / 1e8)} CKB`],
      [t("backing.required"), `${fmt(Number(required) / 1e8)} CKB`],
      held === null
        ? [t("backing.held"), t("backing.notLiveCell")]
        : [
            t("backing.held"),
            `${fmt(Number(held) / 1e8)} CKB`,
            held === required ? "ok" : "bad",
          ],
    ],
    document.getElementById("backing"),
  );

  setText(
    document.getElementById("walk-caption"),
    s ? t("walk.captionAt", { x: s.posX, y: s.posY, n: snap.history.length }) : "",
  );}

function renderChronicle() {
  const w = snap.chronicle;
  const target = document.getElementById("chronicle");
  if (!w) {
    facts([[t("chronicle.record"), t("chronicle.none")]], target);
    return;
  }

  // Shannons to CKB, at eight decimals: a step of life is 0.0001 CKB, so rounding to
  // three would turn a tick's reward into a number that is merely the right shape.
  const ckb = (shannons) => {
    const n = Number(shannons) / 1e8;
    return n.toLocaleString(locale(), { maximumFractionDigits: 8 });
  };
  const net = BigInt(w.netCapacity);

  facts(
    [
      [
        t("chronicle.life"),
        w.alive ? t("chronicle.alive") : t("chronicle.dead"),
        w.alive ? "ok" : "bad",
      ],
      [t("chronicle.generation"), fmt(w.generation)],
      [t("chronicle.bornAtStep"), fmt(w.bornStep)],
      [t("chronicle.diedAtStep"), w.alive ? "—" : fmt(w.diedStep)],
      [
        t("chronicle.lastSighting"),
        t("chronicle.lastSightingValue", { step: fmt(w.step), energy: fmt(w.energy) }),
      ],
      [t("chronicle.sightings"), fmt(w.sightings)],
      [t("chronicle.fed"), `${ckb(w.totalAdded)} CKB`],
      [t("chronicle.released"), `${ckb(w.totalReleased)} CKB`],
      [
        t("chronicle.net"),
        `${net >= 0n ? "+" : "−"}${ckb(net < 0n ? -net : net)} CKB`,
        net >= 0n ? "ok" : "warm",
      ],
      [t("chronicle.stateHash"), `${w.stateHash.slice(0, 18)}…`],
    ],
    target,
  );
}
/**
 * The world: every organism on this chain.
 *
 * This is what the instance nonce buys. Each fly has its own type script, so asking for
 * cells that wear the flybrain *code* returns one row per organism rather than one row
 * for the species. Before the nonce existed this list could not be built at all: there
 * was no way to tell two flies apart.
 */
function renderRoster() {
  const roster = snap.roster ?? [];
  const list = document.getElementById("roster");
  const count = document.getElementById("roster-count");
  count.textContent =
    roster.length === 1 ? t("world.countOne") : t("world.count", { n: roster.length });

  // Everything a row is built from, so a poll that found nothing new leaves the rows — and the
  // click handlers on them — exactly where they were.
  const signature = [
    locale(),
    roster
      .map((fly) =>
        [
          fly.instance,
          fly.state.step,
          fly.state.energy,
          fly.state.alive,
          fly.state.generation,
          fly.state.totalSpikes,
          fly.chronicle?.sightings ?? "",
          fly.chronicle?.netCapacity ?? "",
          fly.selected,
          fly.owned,
        ].join(","),
      )
      .join(";"),
  ].join("|");

  rebuild(list, signature, () => {
    roster.forEach((fly, i) => {
      const c = fly.chronicle;
      const net = c ? BigInt(c.netCapacity) : null;
      const netCkb = net === null ? "—" : `${net < 0n ? "−" : "+"}${(Number(net < 0n ? -net : net) / 1e8).toLocaleString(locale(), { maximumFractionDigits: 4 })}`;
      const li = document.createElement("li");
      li.setAttribute("aria-current", String(fly.selected));
      li.innerHTML = `
      <span class="idx">${i + 1}</span>
      <span class="instance">${fly.instance}</span>
      ${
        fly.owned
          ? `<span class="owned" title="${t("roster.keyTitle")}">${t("roster.key")}</span>`
          : // An empty cell rather than no cell: the columns are fixed widths, so a row that
            // omits the badge shifts every value after it one column to the left and stops
            // lining up with the rows above and below it.
            "<span></span>"
      }
      <span class="label">${t("roster.step", { n: fmt(fly.state.step) })}</span>
      <span class="energy">${fmt(fly.state.energy)}</span>
      <span class="label">${t("roster.life", {
        state: fly.state.alive ? t("roster.alive") : t("roster.dead"),
        generation: fly.state.generation,
      })}</span>
      <span class="spikes">${t("roster.spikes", { n: fmt(fly.state.totalSpikes) })}</span>
      <span class="label">${
        c ? t("roster.sightings", { n: c.sightings }) : t("roster.noChronicle")
      }</span>
      <span class="net ${net === null ? "" : net < 0n ? "negative" : "positive"}">${netCkb} CKB</span>
    `;
      li.addEventListener("click", () => watch(fly));
      list.append(li);
    });
  });
}

/**
 * Switch the page to another organism.
 *
 * The history is thrown away rather than reused, because it belongs to the organism and not to
 * the page — keeping it would put another fly's life in the timeline under this one's name. The
 * `feed` does that in `select`, and the next walk recovers the new one's from the chain.
 */
async function watch(fly) {
  if (fly.selected) {
    return;
  }
  pinned = null;
  anim = null;
  drawn = null;
  // Before the snapshot, not after: `applySnapshot` redraws the Drive panel, and a refusal
  // from the previous fly would be sitting under the new fly's buttons for the moment in
  // between — which is the moment a reader is most likely to read it.
  clearAction();
  feed.select(fly.typeHash);
  try {
    await loadSnapshot();
    if (snap.meta.error) {
      reportError(new Error(snap.meta.error));
      return;
    }
    setStatus(t("status.watching", { instance: fly.instance, hash: fly.typeHash.slice(0, 12) }));
  } catch (err) {
    reportError(err);
  }
}
function describeStimulus(s) {
  const names = { 1: "cue", 2: "turnLeft", 3: "turnRight", 4: "shock" };
  if (!s.stimChannel) {
    return t("stimulus.none");
  }
  return t("stimulus.active", {
    name: names[s.stimChannel] ? t(`stimulus.${names[s.stimChannel]}`) : s.stimChannel,
    strength: s.stimStrength,
    until: s.stimUntil,
  });
}

function displayedEntry() {
  return pinned ?? snap.current;
}

function describeAction(action) {
  if (!action) {
    return { text: t("action.genesis"), detail: t("action.genesisDetail") };
  }
  switch (action.kind) {
    case "tick":
      return { text: t("action.tick"), detail: t("action.tickDetail", { n: action.steps }) };
    case "stimulate": {
      return {
        text: t("action.stimulate"),
        detail: t("action.stimulateDetail", {
          name: stimulusName(action.channel),
          param: action.param,
          strength: action.strength,
          n: action.steps,
        }),
      };
    }
    case "feed":
      return { text: t("action.feed"), detail: t("action.feedDetail", { n: fmt(action.steps) }) };
    case "resurrect":
      return {
        text: t("action.resurrect"),
        detail: t("action.resurrectDetail", { n: fmt(action.steps), block: action.bornBlock }),
      };
    default:
      return { text: action.kind, detail: "" };
  }
}

/** Channel number to the word the page uses for it. */
function stimulusName(channel) {
  const names = { 1: "cue", 2: "turnLeft", 3: "turnRight", 4: "shock" };
  return names[channel] ? t(`stimulus.${names[channel]}`) : channel;
}

function renderTimeline() {
  const list = document.getElementById("timeline");
  const all = [...(snap.history ?? []), snap.current].filter(Boolean);
  // `pinned` is in here because `aria-current` follows it: which row is being inspected is part of
  // what the list says, so pinning has to rebuild it even though no chain data moved.
  const signature = [
    locale(),
    pinned?.txHash ?? "",
    all
      .map((e) => [e.txHash, e.state.step, e.state.headX, e.state.headY, e.state.totalSpikes, e.blockNumber ?? ""].join(","))
      .join(";"),
  ].join("|");

  rebuild(list, signature, () => {
    all.forEach((entry, i) => {
      const s = entry.state;
      const a = describeAction(entry.action);
      const li = document.createElement("li");
      li.setAttribute(
        "aria-current",
        String((pinned?.txHash ?? snap.current?.txHash) === entry.txHash),
      );
      li.innerHTML = `
      <span class="idx">${i}</span>
      <span class="block">${t("timeline.block", { n: entry.blockNumber ?? "—" })}</span>
      <span class="action">${a.text} <em>${a.detail}</em></span>
      <span class="step">${t("timeline.step", { n: s.step })}</span>
      <span class="head">(${s.headX}, ${s.headY})</span>
      <span class="spikes ${s.totalSpikes > 0 ? "fired" : ""}">${t("roster.spikes", { n: s.totalSpikes })}</span>
    `;
      li.addEventListener("click", () => pin(entry));
      list.append(li);
    });
  });
}

/**
 * Show a past transition, decoded in full.
 *
 * No network call, and that is the point rather than an optimisation. A spent cell cannot be
 * asked for again — the chain keeps it, but nothing will tell you it was ever a fly — so the
 * 1,213 bytes of state are only recoverable while something is holding them, and `readChain`
 * holds them: every entry it walks past carries its own `stateHex`. That copy is the only one
 * that exists, which is why it is kept for every transition rather than for the newest.
 *
 * This used to be `GET /api/state?tx=…`, which was the server decoding hex it already had.
 */
function pin(entry) {
  if (entry.txHash === snap.current?.txHash) {
    pinned = null;
    drawn = snap.current?.state ?? null;
    anim = null;
    renderAll();
    return;
  }
  let state;
  try {
    state = decodeState(ccc.bytesFrom(entry.stateHex), { full: true });
  } catch (err) {
    reportError(new Error(t("status.cannotLoad", { tx: entry.txHash })));
    return;
  }
  const previous = drawn;
  pinned = { ...entry, state };
  drawn = state;
  anim = previous?.v ? { from: previous, to: state, t0: performance.now() } : null;
  renderAll();
}

function renderAll() {
  renderPanels();
  renderChronicle();
  renderTimeline();
  // `renderDrive` belongs here, and its absence was a bug rather than an omission: it reads
  // `pinned`, and `pin`/`unpin` are the only callers of this function. Without it, `enabled =
  // mayDrive && !pinned` had a half that never took effect — a reader who pinned the fly's
  // birth still saw live Drive buttons, and clicking one would advance the *current* cell
  // while the page showed a past step. Acting on something other than what you are looking at
  // is the exact failure the ownership guard exists to prevent; this was the same failure, one
  // layer down.
  renderDrive();
  // Through `t`, not a literal. `renderAll` runs *after* `applyLanguage` when the reader
  // switches language, so anything hardcoded here wins over the dictionary — which is how the
  // ring's heading stayed "The ring" in Chinese. The keys were already in both dictionaries;
  // this line was simply not asking for them.
  document.getElementById("stage-title").textContent = pinned
    ? t("ring.headingAtStep", { step: pinned.state.step })
    : t("ring.heading");
  document.getElementById("unpin").hidden = !pinned;
  // `pin`/`unpin`/a language switch change what the canvases should show, and none of them goes
  // through `applySnapshot`. Anything that redraws the page redraws the picture too.
  invalidate();
}


/**
 * The visitor's wallet, in two places, because they are two different jobs.
 *
 * The **bar** sits at the top right and is the only thing that has to be found without looking
 * for it: the connect control, and once connected, enough to confirm which account is in play.
 * The first version of this put the control in the sidebar panel below "Walk" — the same code,
 * in the DOM, working — and the person it was built for could not find it. A connect button below
 * the fold is a connect button that does not exist.
 *
 * The **panel** carries the detail (the full address, the balance) and the sentence that says
 * what a click will do, and it lives next to the Drive buttons because that is where the reader
 * is when the question matters.
 *
 * Neither decides whether the buttons work. That is `meta.drivable`, which the page computes
 * from the same `driveAuthorization` a click would be refused by — so the button state and the
 * refusal cannot disagree. What this decides is which key that question is asked about, and it
 * is always the reader's own: there is no server key here to fall back on.
 */
function renderWallet() {
  const bar = document.getElementById("wallet-bar");
  const facts = document.getElementById("wallet-facts");
  const note = document.getElementById("wallet-note");
  if (!bar) {
    return;
  }

  // Built once the first snapshot has arrived, because the client needs the node URL the page
  // is reading — a wallet signing for one chain while the page reads another would produce
  // transactions that cannot resolve.
  if (!wallet && snap) {
    wallet = createWallet(feed.rpc);
    wallet.refresh();
    wallet.onChange(() => {
      // Before the snapshot, so `drivable` is answered about the key that just changed rather
      // than about the one before it.
      syncWalletLock()
        .then(() => loadSnapshot())
        .catch(reportError);
      renderWallet();
      renderDrive();
    });
  }
  const signers = wallet ? wallet.available() : [];
  const connected = wallet?.current() ?? null;

  // The picker is CCC's own connector: a Lit element that renders the wallet list and the modal.
  // Created once and never re-created, because it holds the connection.
  //
  // It lives on `document.body`, not in the bar, and starts hidden. The element *is* the modal —
  // with no signer it renders a full-screen wallet list — so mounting it visibly would cover the
  // fly the moment the page loaded, which on a page about watching a fly is the wrong first frame.
  // The bar carries a plain control and the connector appears behind it; the list itself is
  // entirely CCC's, and the wallets in it are whatever CCC ships adapters for.
  //
  // `clientOptions` is deliberately never set. The connector grows a network switcher when the
  // application supplies one, and this page has exactly one chain — the one it reads
  // (`feed.rpc`). A reader who moved the connector to another chain would be asked to sign for a
  // chain whose fly this page cannot see. Leaving it unset makes that control inert rather than
  // hidden, which is the version that cannot get out of step with the page.
  if (!connector && wallet) {
    connector = new WebComponentConnector();
    connector.client = wallet.client;
    connector.name = "CKB Fly";
    connector.icon = appIcon();
    closeConnector(connector);

    // What to do with a signer, from either of the two ways one arrives: the reader picked a
    // wallet, or the connector re-established the connection it remembers from last time.
    const adopt = (info) => {
      // Already driving with it. The connector reports its signer again every time the modal
      // closes, including closes that chose nothing.
      if (!info || wallet.current() === info.signer) {
        return;
      }
      wallet
        .adopt(info)
        // The lock changes what `meta.drivable` means, so the snapshot is re-read rather than
        // patched: one source of truth for the button state.
        .then(() => syncWalletLock())
        .then(() => loadSnapshot())
        .then(() => {
          setStatus(t("wallet.connected", { address: wallet.address().slice(0, 20) }), "ok");
          renderWallet();
          renderDrive();
        })
        .catch(reportError);
    };

    connectorWatch = watchConnector(connector, adopt);
    document.body.append(connector);

    // The connector keeps its own connection in `localStorage` and re-establishes it when it is
    // mounted — so a reader who connected once comes back connected. This page knows nothing
    // about that storage, and would otherwise show "connect a wallet" over a wallet that is
    // already connected, with the Drive panel refusing clicks for no visible reason.
    settledSigner(connector).then(adopt);
  }

  // The connect control is the one element on this page a reader is certainly going to click, and
  // it used to be replaced by an identical copy on every poll — a handler that dies between the
  // reader's pointer-down and pointer-up is a click that does nothing, on the button whose whole
  // job is to be clicked. Rebuilt only when what it says changes.
  rebuild(
    bar,
    [locale(), connected ? `${wallet.name() ?? ""}|${wallet.address()}` : ""].join("|"),
    () => {
      if (connected) {
        const label = document.createElement("span");
        label.className = "wallet-account";
        // Short, but long enough to recognise: the two ends of a bech32 address are what a reader
        // compares against their wallet.
        const address = wallet.address();
        label.textContent = `${wallet.name() ?? t("wallet.wallet")} · ${address.slice(0, 12)}…${address.slice(-6)}`;
        label.title = address;
        const button = document.createElement("button");
        button.className = "ghost";
        button.textContent = t("wallet.disconnect");
        button.addEventListener("click", async () => {
          // Both halves, and in this order. The connector holds its own copy of the connection and
          // writes it to `localStorage`, so disconnecting only here would leave the modal offering
          // a connected wallet and the next page load reconnecting it. Closing the modal is *our*
          // doing here, so the watch is told not to read it as a choice — see
          // `connector.source.js`.
          if (connector) {
            connectorWatch.muteNextClose();
            connector.disconnect();
          }
          await wallet.disconnect();
        });
        bar.append(label, button);
      } else {
        const button = document.createElement("button");
        button.className = "primary";
        button.textContent = t("wallet.connectOpen");
        button.addEventListener("click", () => {
          if (connector) {
            openConnector(connector);
          }
        });
        bar.append(button);
      }
    },
  );

  // One row, and it is the one a reader cannot get anywhere else: the full address.
  //
  // Two rows were removed from this list, and both because they were already said somewhere
  // better. The *wallet* is the label on the connect control in the masthead — `UTXO Global ·
  // ckt1qz…cvp6q4` — so "signs with" here was the same fact twice. The *balance* the reader
  // reported seeing as an empty row: this panel rebuilt itself on every poll, and the balance
  // arrived from a promise afterwards, so a row that landed in the wrong moment was wiped by the
  // next render. That is now impossible to get wrong by leaving the row out, which is what a page
  // that never needed it should have done. A wallet with nothing to pay a fee with still finds
  // out — from the click's own refusal, which is the moment the fee matters and the only moment
  // the page can be sure it is still true.
  //
  // The address is 63 characters of monospace and the reason this panel needed a layout fix; see
  // `.facts` in style.css.
  const address = wallet?.address() ?? null;
  rebuild(facts, [locale(), address ?? ""].join("|"), () => {
    const dt = document.createElement("dt");
    dt.textContent = t("wallet.address");
    const dd = document.createElement("dd");
    dd.textContent = address ?? t("wallet.none");
    facts.append(dt, dd);
  });

  // Two states, not three: the connector decides what is offerable now, so this page no longer
  // has an opinion about which wallets exist in this browser.
  //
  // `innerHTML`, because both sentences open with a bold lead like every other caption on the
  // page — and neither interpolates anything, which is the condition for this being safe. The
  // drive panel's `drive.disabled` is the counter-example: it interpolates the reason produced by
  // `driveAuthorization`, and goes in as text.
  setHtml(note, connected ? t("wallet.noteConnected") : t("wallet.noteOffered"));
}
/**
 * The fee rate the reader chose in CCC's own modal, or `undefined` for the page's own number.
 *
 * The connected view of the connector has a **Fee Rate** control, and it is reachable from this
 * page's own button — so a page that ignored it would offer a setting that silently does nothing,
 * which is worse than not offering it. The choice is written to the connector's client, a
 * `ClientWithFeeRate` wrapper the package does not export but which is what `client` returns at
 * runtime. `undefined` there means "Auto", and Auto is the rate `tx.js` already builds with, so
 * the fallback needs no special case.
 *
 * It is the reader's call because it is the reader's coins: the fee comes out of their change
 * output, and `completeFeeBy` is the step that decides how big it is.
 *
 * @returns {bigint|number|string|undefined}
 */
function connectorFeeRate() {
  return connector?.client?.feeRate;
}

/**
 * Tell the page's index which key `drivable` is about.
 *
 * A snapshot built before this runs would answer about the previous key — or about nobody — and
 * the Drive panel would be showing a decision about a wallet the reader is not using. That is
 * the exact shape of the bug this field was introduced for on the server, where the answer was
 * about the *server's* key while the reader was about to sign with their own.
 */
async function syncWalletLock() {
  feed.setWalletLock(wallet ? await wallet.lock() : null);
}

function renderDrive() {
  const target = document.getElementById("drive");
  const note = document.getElementById("drive-note");
  const life = document.getElementById("drive-life");
  // Who signs a click. On this page there is exactly one answer — the reader's wallet — because
  // there is no server key to fall back on. `meta.drivable` is the same `driveAuthorization`
  // the click will be refused by, computed for that wallet's lock, so the button state and the
  // refusal cannot disagree.
  const byWallet = !!wallet?.current();
  const mayDrive = byWallet && snap.meta.drivable;
  const enabled = mayDrive && !pinned;

  // The state the buttons would act on, which is the displayed one rather than the live one —
  // pinning a past step disables them precisely because acting there is not what the reader is
  // looking at. The life readout follows the same rule, so the number above the buttons is always
  // the number a click would spend from.
  const s = displayedEntry()?.state ?? null;
  const alive = s?.alive !== false;
  if (life) {
    setText(life, s ? t("drive.lifeLeft", { n: fmt(s.energy) }) : "");
  }

  // What a step of life is worth, read from the same economics the Backing panel prints rather
  // than written into the label: the feed button's "+1 CKB" is 10,000 × `backingPerStep`, and if
  // that constant ever moves, a hardcoded "1" would become a lie in the one place a reader is
  // deciding whether to spend money.
  const perStep = BigInt(snap.economics?.backingPerStep ?? 0);
  const inCkb = (steps) => fmt(Number(BigInt(steps) * perStep) / 1e8);

  // Five cards, not five words. `tick 64` and `tick 32` differ by a digit and by how much of the
  // fly's life they spend; `cue` and `shock` are the same shape of transaction and completely
  // different experiments. The sub-line is where that difference lives, and it is why these are
  // laid out as cards with room for a second line instead of as a row of buttons.
  //
  // Every action the contract accepts is reachable from here: the four kinds (`tick`, `stimulate`,
  // `feed`, `resurrect`) and all four stimulus channels. `resurrect` was CLI-only until now, which
  // made death a one-way door on the page: a reader could watch a fly die and had no way to bring
  // it back, while the chain would have accepted it. `turn left` and `turn right` were missing for
  // a smaller reason — they were not in the first five — and they are the two actions that show
  // the ring doing its actual job, because they move the bump the way a real turning fly does.
  //
  // `when` is the contract's own rule, not a preference: a dead fly refuses everything except
  // `resurrect` (`ApplyError::Dead`), and a live one refuses `resurrect` (`NotDead`). Encoding that
  // in the card means the button a reader cannot use is the button that looks unusable, rather than
  // a button that builds a transaction the type script then rejects.
  const actions = [
    {
      label: t("drive.tick", { n: 64 }),
      sub: t("drive.subTick", { n: fmt(64) }),
      spec: { kind: "tick", steps: 64 },
      when: "alive",
    },
    {
      label: t("drive.tick", { n: 32 }),
      sub: t("drive.subTick", { n: fmt(32) }),
      spec: { kind: "tick", steps: 32 },
      when: "alive",
    },
    {
      label: t("drive.feed", { n: fmt(10000) }),
      sub: t("drive.subFeed", { n: fmt(10000), ckb: inCkb(10000) }),
      spec: { kind: "feed", steps: 10000 },
      when: "alive",
    },
    {
      label: t("drive.cue", { wedge: 4 }),
      // 544, not 32: the stimulus itself costs `strength × 128` steps on top of the steps it
      // simulates, which is the number the preview-testnet run measured. The card used to say 32,
      // which understated the price of the one action that is most interesting to click.
      sub: t("drive.subCue", { n: fmt(544) }),
      spec: { kind: "stimulate", channel: 1, param: 4, strength: 4, steps: 32 },
      when: "alive",
    },
    {
      label: t("drive.turnLeft"),
      sub: t("drive.subTurn", { n: fmt(544) }),
      spec: { kind: "stimulate", channel: 2, param: 0, strength: 4, steps: 32 },
      when: "alive",
    },
    {
      label: t("drive.turnRight"),
      sub: t("drive.subTurn", { n: fmt(544) }),
      spec: { kind: "stimulate", channel: 3, param: 0, strength: 4, steps: 32 },
      when: "alive",
    },
    {
      label: t("drive.shock"),
      sub: t("drive.subShock", { n: fmt(544) }),
      spec: { kind: "stimulate", channel: 4, param: 0, strength: 4, steps: 32 },
      when: "alive",
    },
    {
      label: t("drive.resurrect"),
      sub: t("drive.subResurrect", { n: fmt(10000) }),
      // A function, because `born_block` cannot be known until the click: it is a fact about the
      // chain at that moment, and the contract refuses a value earlier than the previous life's.
      // The block of the transition on screen is exactly that — the chain's position as of the
      // state this button acts on — and it needs no query, because the walk already read it.
      spec: () => ({
        kind: "resurrect",
        steps: 10000,
        bornBlock: snap.current?.blockNumber ?? 0,
      }),
      when: "dead",
    },
  ];

  // Nothing in a card depends on the fly's state except which of them the contract will accept, so
  // a poll that found no transition leaves the buttons, and their click handlers, untouched.
  rebuild(target, [locale(), enabled, alive, String(perStep)].join("|"), () => {
    for (const { label, sub, spec, when } of actions) {
      const usable = enabled && (when === "alive" ? alive : !alive);
      const button = document.createElement("button");
      button.className = "action";
      // Two spans rather than a `textContent` with a newline in it: the label and the cost have
      // different sizes and different colours, and a button is a flex/grid box only if it has
      // elements to lay out.
      const name = document.createElement("span");
      name.className = "action-label";
      name.textContent = label;
      const cost = document.createElement("span");
      cost.className = "action-sub";
      cost.textContent = sub;
      button.append(name, cost);
      button.disabled = !usable;
      button.addEventListener("click", async () => {
        button.disabled = true;
        // Which of them is in flight. There is only one path now, and it waits for the node to
        // *accept*, not to commit — the commit is the next poll's business, not the click's. During
        // that time all of them are grey and identical. The one that is running says so.
        button.setAttribute("aria-busy", "true");
        try {
          // Resolved here rather than at build time: `resurrect` needs the block the chain is at,
          // which is only true at the moment of the click.
          const resolved = typeof spec === "function" ? spec() : spec;
          // One path. The wallet signs and broadcasts, and the node answers as soon as it
          // accepts the transaction — so a click reports its own outcome in a second or two
          // rather than waiting for a commit. What the fly *becomes* is the prediction the page
          // computed, which is the same prediction the validator will recompute; the numbers
          // therefore arrive a moment before the chain agrees with them, and the next poll
          // replaces them with the chain's own.
          setAction(t("drive.asking", { kind: actionName(resolved.kind) }), "busy");
          const result = await wallet.drive(resolved, { feeRate: connectorFeeRate(), prepare });
          setAction(t("drive.sent", { tx: result.txHash }), "ok");
          await loadSnapshot();
        } catch (err) {
          // The click's own failure, said where the click was. It does not go to the footer: that
          // line answers "is the page connected", and a wallet the reader cancelled in a popup is
          // not an answer to that question.
          setAction(err.message, "bad");
        } finally {
          button.removeAttribute("aria-busy");
          // Recomputed, not reused. `mayDrive` was captured when this button was built, and the
          // reader can pin a past state while the transaction is in flight — which makes the
          // buttons ineligible for a second reason that this render never knew about. Reusing the
          // render-time answer would re-enable a button that `renderDrive` would have left
          // disabled, and the next click would act on a state the reader had navigated away from.
          button.disabled = !(wallet?.current() && snap.meta.drivable) || pinned !== null;
        }
      });
      target.append(button);
    }
  });

  // Two sentences now, not three: there is no server key on this page, so the only honest
  // explanations for these buttons are "your wallet signs" and "connect one". Both carry markup,
  // because they open with a bold lead like every other caption on the page. `drive.disabled` does
  // not: it interpolates a reason that came from the rule the click will be refused by, and a
  // computed string goes in as *text*. The rule is per-key and not per-element, which is why it is
  // written here rather than as a helper that takes whatever it is given.
  // Two branches write markup and one writes text, and `setHtml`/`setText` compare against what is
  // already there — so the note needs to know which of the two wrote last. Without that, the text
  // branch would see identical *text* and skip, leaving the previous branch's `<strong>` in place.
  const lead = (key) => {
    const html = t(key);
    if (note.dataset.mode !== "html") {
      note.dataset.mode = "html";
      note.innerHTML = html;
      return;
    }
    setHtml(note, html);
  };
  const plainly = (text) => {
    if (note.dataset.mode !== "text") {
      note.dataset.mode = "text";
      note.textContent = text;
      return;
    }
    setText(note, text);
  };

  if (!alive) {
    // Death comes first, because it is the only thing that changes *which* moves exist. A reader
    // looking at seven grey cards and one live one needs the sentence before the buttons.
    lead("drive.noteDead");
  } else if (mayDrive) {
    lead("drive.noteWallet");
  } else if (byWallet) {
    // The reader has a wallet and it is the wrong key for this organism. The sentence comes from
    // the same call the click would be refused by.
    plainly(t("drive.disabled", { reason: snap.meta.undrivableReason }));
  } else {
    // The only reason left on this page, and it is the honest one: nothing here can sign.
    lead("drive.noteConnect");
  }
}

/**
 * The action's name, for a sentence like "asking your wallet to sign tick…".
 *
 * Derived from the same keys the timeline uses, so the verb a reader clicks and the verb they
 * later find in the timeline are the same word — in both languages.
 */
function actionName(kind) {
  const key = `action.${kind}`;
  const name = t(key);
  return name === key ? kind : name;
}

/**
 * Paint a status line: its text, and which of the three things it is.
 *
 * The state is a `data-` attribute rather than a class because it is read as a state by the
 * stylesheet — the dot pulses while something is in flight, turns green when it worked and red
 * when it did not. The colour goes on the dot and not on the words: a whole sentence in `--bad`
 * at 12.5px is the hardest thing on the page to read, and it is the one sentence a reader
 * actually has to read carefully.
 *
 * @param {HTMLElement} el
 * @param {string} text
 * @param {"busy"|"ok"|"bad"} state
 */
function paintStatus(el, text, state) {
  el.textContent = text;
  el.dataset.state = state;
  el.hidden = false;
}

/**
 * The page's own health: is it connected, did the node answer, how many transitions it read.
 *
 * It lives in the footer because it is about the page rather than about anything the reader did,
 * and it is deliberately *not* where a click's outcome goes.
 */
function setStatus(text, state = "busy") {
  paintStatus(document.getElementById("status"), text, state);
}

/** The reader's own click, reported next to the buttons that made it. */
function setAction(text, state = "busy") {
  paintStatus(document.getElementById("drive-status"), text, state);
}

/**
 * Forget the last click's outcome.
 *
 * Called when the page switches to a different organism. A refusal left over from the previous
 * fly is a sentence about *this* fly that is not true of it, and the one place a reader will
 * believe it is the panel they are about to press a button in.
 */
function clearAction() {
  const el = document.getElementById("drive-status");
  el.textContent = "";
  el.hidden = true;
}

function reportError(err) {
  setStatus(err.message, "bad");
}

// ------------------------------------------------------------------ start

document.getElementById("unpin").addEventListener("click", () => {
  pinned = null;
  drawn = snap.current?.state ?? null;
  anim = null;
  renderAll();
});

// The first frame, and the two things that invalidate a picture that is already on screen: the
// canvases are sized from their layout box, so a resize (or a font that reflows the page) needs a
// redraw, and `colors()` caches values read out of CSS that a theme change replaces.
invalidate();
new ResizeObserver(() => invalidate()).observe(document.getElementById("ring"));
new ResizeObserver(() => invalidate()).observe(document.getElementById("walk"));
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  palette = null;
  invalidate();
});

// The language is applied before the first read, so nothing has to be redrawn to be correct,
// and the switch is drawn from the language that was just chosen.
initLanguage();
applyLanguage();
renderLanguageSwitch();
// Everything drawn in JavaScript is redrawn by its own renderer: this module knows what it
// drew and the dictionary does not.
onLanguage(() => {
  renderIdentity();
  renderRoster();
  renderAll();
  // `renderWallet` is not part of `renderAll`, because `renderAll` is what pin/unpin redraw and
  // the wallet does not depend on which step is being looked at. It does depend on the language —
  // every label in the bar and the panel comes from `t` — so it has to be listed here, and its
  // absence is why the connect control stayed in the old language after a switch.
  renderWallet();
});

/**
 * Load the three things a page needs before it can show anything, then start reading.
 *
 * In this order, and each one is a real dependency rather than a preference:
 *
 * 1. **The deployment**, because it names the chain and the code to look for.
 * 2. **The dynamics module**, because the connectome it carries is what the ring is drawn from
 *    — and because `createFeed` checks that connectome against the one the fly's type script
 *    says it runs before it will produce a picture at all.
 * 3. **The feed**, which reads the chain.
 * 4. **The builder**, `createPrepare({ feed, sim })`, which is the page's half of a click. It is
 *    created here rather than at module scope because it needs the other three to exist.
 *
 * A failure in any of them leaves the page with nothing to draw, so it is reported in the
 * footer and the poll never starts — a page that retried forever against a missing file would
 * be a page that looks broken and says nothing.
 */
async function start() {
  const config = await loadConfig();
  sim = await loadSim();
  feed = createFeed({ config, table: sim.circuitTable(), pollMs: POLL_MS });
  prepare = createPrepare({ feed, sim });

  await loadSnapshot();
  setStatus(
    snap.meta.error
      ? t("status.nodeError", { error: snap.meta.error })
      : t("status.read", {
          n: snap.meta.count,
          time: new Date(snap.meta.updatedAt).toLocaleTimeString(locale()),
        }),
    snap.meta.error ? "bad" : "ok",
  );
  subscribe();
}

start().catch(reportError);
