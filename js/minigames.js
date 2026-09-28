// Mini games for the menu grid. Pure JS (no DOM); like Plinko they run in the
// control window and the projector draws each view() (render.js MINI_DRAW).
//
// World units as in plinko.js: y is 0..1 down the projector height, x is
// 0..A (aspect), so the projector draws the world at scale h. Everything is
// white, and render.js blacks out every note (plus a margin) after drawing, so
// no light ever lands on the paper.
//
// Input (control.js gameAction): move(±1) ← → / A D · press() Space / ↵ ·
// color(name) 1–6 · click(x, y) on the wall · reset() R.
// step(dt) returns sounds to play: { f, inst, v, delay, noteId?, color? }
// (a noteId also lights that note's halo and plays its instrument).

import { polyDist, inPoly } from './plinko.js';
import { freqOf } from './colors.js';

const TOP = 0.16; // play area starts below the HUD
const GAP = 0.012; // clearance kept from a note's paper
const C = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]; // C pentatonic blips
const tone = (f, inst = 'pluck', v = 0.6, delay = 0) => ({ f, inst, v, delay });
const WIN = [659.25, 783.99, 1046.5].map((f, i) => tone(f, 'bell', 0.7, 0.07 * i));
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

class Game {
  constructor({ aspect = 16 / 9, best = 0 } = {}) {
    this.A = aspect;
    this.best = best;
    this.notes = [];
    this.ev = [];
    this.t = 0;
    this.reset();
  }

  setNotes(notes) {
    this.notes = notes.map((n) => ({ id: n.id, color: n.color, pts: n.corners.map(([x, y]) => [x * this.A, y]) }));
  }

  /** Note whose paper is within r of (x, y), if any. */
  noteAt(x, y, r = 0) {
    return this.notes.find((n) => inPoly([x, y], n.pts) || polyDist([x, y], n.pts) < r);
  }

  sound(...s) {
    this.ev.push(...s);
  }

  hitNote(n) {
    this.sound({ ...tone(freqOf(n.color) ?? C[0], 'marimba', 0.7), noteId: n.id, color: n.color });
  }

  reset() {
    this.score = 0;
    this.over = false;
    this.start();
  }

  step(dt) {
    this.t += dt;
    if (!this.over) this.tick(Math.min(dt, 0.05));
    return this.ev.splice(0);
  }

  start() {}
  tick() {}
  move() {}
  color() {}
  press() {
    if (this.over) this.reset();
  }
  click() {
    this.press();
  }
  /** Mask capsules { a, b, r } (world units) over moving light, for vision. */
  mask() {
    return [];
  }
  draw() {
    return {};
  }
  view() {
    return { A: this.A, score: this.score, best: this.best, over: this.over, ...this.draw() };
  }
}

// ---------------------------------------------------------------- laser
// ← → aim (or click where to aim). Notes are mirrors; light up every target.

const EMIT = [0.02, 0.55];
const TARGET_R = 0.035;

/** Distance along ray p + t·d to segment ab, or Infinity. */
export function raySeg(p, d, a, b) {
  const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
  const den = d[0] * ey - d[1] * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const [wx, wy] = [a[0] - p[0], a[1] - p[1]];
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * d[1] - wy * d[0]) / den;
  return t > 1e-6 && u >= 0 && u <= 1 ? t : Infinity;
}

function segDist(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const L = dx * dx + dy * dy;
  const t = L ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

class Laser extends Game {
  start() {
    this.level = 0;
    this.ang = 0;
    this.mirrors = new Set();
    this.build();
  }

  build() {
    this.targets = [];
    this.solvedAt = null;
    for (let k = 0; k < 500 && this.targets.length < Math.min(5, this.level + 1); k++) {
      const p = [rand(0.35, 0.95) * this.A, rand(TOP + 0.05, 0.95)];
      if (this.targets.every((t) => dist(t.p, p) > 0.12) && !this.noteAt(...p, TARGET_R + 0.05)) this.targets.push({ p, lit: false });
    }
  }

  move(d) {
    this.ang = clamp(this.ang + d * 0.02, -1.4, 1.4);
  }

  click(x, y) {
    this.ang = clamp(Math.atan2(y - EMIT[1], x - EMIT[0]), -1.4, 1.4);
  }

  /** Beam polyline: bounces off notes (a gap short of the paper) and the top / bottom. */
  trace() {
    let p = EMIT;
    let d = [Math.cos(this.ang), Math.sin(this.ang)];
    const pts = [p];
    const hit = new Set();
    for (let k = 0; k < 16; k++) {
      let best = { t: Infinity };
      for (const n of this.notes) {
        n.pts.forEach((a, i) => {
          const b = n.pts[(i + 1) % n.pts.length];
          const t = raySeg(p, d, a, b);
          if (t < best.t) best = { t, n, a, b };
        });
      }
      const wallT = Math.min(d[1] < 0 ? (TOP - p[1]) / d[1] : d[1] > 0 ? (1 - p[1]) / d[1] : Infinity, d[0] < 0 ? -p[0] / d[0] : d[0] > 0 ? (this.A - p[0]) / d[0] : Infinity);
      if (best.t < wallT) {
        p = [p[0] + d[0] * Math.max(0, best.t - GAP), p[1] + d[1] * Math.max(0, best.t - GAP)];
        const len = Math.hypot(best.b[0] - best.a[0], best.b[1] - best.a[1]);
        const nrm = [-(best.b[1] - best.a[1]) / len, (best.b[0] - best.a[0]) / len];
        const dot = d[0] * nrm[0] + d[1] * nrm[1];
        d = [d[0] - 2 * dot * nrm[0], d[1] - 2 * dot * nrm[1]];
        hit.add(best.n);
        pts.push(p);
        continue;
      }
      p = [p[0] + d[0] * wallT, p[1] + d[1] * wallT];
      pts.push(p);
      if (p[1] > TOP + 1e-6 && p[1] < 1 - 1e-6) break; // left / right edge: the beam ends
      d = [d[0], -d[1]];
    }
    return { pts, hit };
  }

  tick() {
    const { pts, hit } = this.trace();
    this.beam = pts;
    for (const n of hit) if (!this.mirrors.has(n.id)) this.hitNote(n);
    this.mirrors = new Set([...hit].map((n) => n.id));
    for (const tg of this.targets) {
      const lit = pts.some((a, i) => i && segDist(tg.p, pts[i - 1], a) < TARGET_R);
      if (lit && !tg.lit) this.sound(tone(C[this.targets.indexOf(tg) % 6], 'bell', 0.7));
      tg.lit = lit;
    }
    if (this.solvedAt == null && this.targets.every((t) => t.lit)) {
      this.solvedAt = this.t;
      this.score = this.level + 1;
      if (this.score > this.best) this.best = this.score;
      this.sound(...WIN);
    }
    if (this.solvedAt != null && this.t - this.solvedAt > 1.5) {
      this.level++;
      this.build();
    }
  }

  reset() {
    super.reset();
    this.tick();
  }

  // ponytail: no mask for the beam (thin, white, moves only when aimed); add one if the camera ever sees it
  draw() {
    return {
      emit: EMIT, ang: this.ang, beam: this.beam || [EMIT], top: TOP,
      targets: this.targets.map((t) => ({ x: t.p[0], y: t.p[1], r: TARGET_R, lit: t.lit })),
      info: `LEVEL ${this.level + 1} · notes are mirrors · BEST ${this.best}`,
      banner: this.solvedAt != null ? ['ALL LIT!', 'next level…'] : null,
    };
  }
}

/** id → class. Order and names for the menu live in render.js GAMES. */
export const MINI_GAMES = { laser: Laser };
