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
import { LASER_LEVELS } from './laserLevels.js';

const TOP = 0.16; // play area starts below the HUD
const GAP = 0.012; // clearance kept from a note's paper
const C = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]; // C pentatonic blips
const tone = (f, inst = 'pluck', v = 0.6, delay = 0) => ({ f, inst, v, delay });
const WIN = [659.25, 783.99, 1046.5].map((f, i) => tone(f, 'bell', 0.7, 0.07 * i));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const maxMove = (a, b) => Math.max(...a.map((p, i) => dist(p, b[i])));

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
  tab() {}
  /** Mask capsules { a, b, r, soft? } (world units) over moving light, for vision. */
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
// Colour-light puzzle (LASER_SPEC.md). Square notes are mirrors, strips (a
// note cut in half) are filters that tint the beam. Light every target in its
// colour. ← → or a click aims the level's aimable emitters; Tab skips levels.

const TARGET_R = 0.035;
const SNAP = Math.PI / 36; // note edges snap to 5°
const MIRROR_MAX = 1.4; // long / short side below this: mirror
const FILTER_MIN = 1.7; // above this: filter; in between a note keeps its role
const STILL = 0.006; // a note moving less than this (world units) ...
const STILL_S = 0.4; // ... for this long freezes ...
const UNFREEZE = 0.02; // ... until it moves this far
const REF_A = 16 / 9; // levels are authored at 16:9
const PRIMARY = ['red', 'yellow', 'blue'];
const SECONDARY = { 'red+yellow': 'orange', 'blue+yellow': 'green', 'blue+red': 'purple' };

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

/** Beam colour after a filter (paint-wheel mixing), or null when blocked. */
export function mix(beam, filter) {
  if (beam === 'white' || beam === filter) return filter;
  if (PRIMARY.includes(beam) && PRIMARY.includes(filter)) return SECONDARY[[beam, filter].sort().join('+')];
  return null;
}

/** Rectangle through a quad's centre with its edges snapped to 5°: { pts, aspect }. */
export function snapNote(q) {
  const c = [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
  const w = (dist(q[0], q[1]) + dist(q[2], q[3])) / 2;
  const h = (dist(q[1], q[2]) + dist(q[3], q[0])) / 2;
  const th = Math.round(Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]) / SNAP) * SNAP;
  const [co, si] = [Math.cos(th), Math.sin(th)];
  const pts = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [c[0] + (x * co - y * si) / 2, c[1] + (x * si + y * co) / 2]);
  return { pts, aspect: Math.max(w, h) / Math.min(w, h) };
}

class Laser extends Game {
  start() {
    this.geo ??= new Map(); // note id -> { anchor, since, frozen, pts, aspect, role }
    this.level = 0;
    this.lit = new Set();
    this.build();
  }

  build() {
    const L = LASER_LEVELS[this.level];
    const k = this.A / REF_A;
    const P = ([x, y]) => [x * k, y];
    this.lv = {
      ...L,
      emitters: L.emitters.map((e) => ({ ...e, p: P([e.x, e.y]) })),
      targets: L.targets.map((t) => ({ ...t, p: P([t.x, t.y]), lit: false })),
      walls: L.walls.map(([a, b]) => ({ a: P(a), b: P(b) })),
      locks: L.locks.map((l) => ({ ...l, a: P(l.a), b: P(l.b) })),
      noNotes: L.noNotes.map(([x0, y0, x1, y1]) => [x0 * k, y0, x1 * k, y1]),
    };
    this.solvedAt = null;
  }

  // Snapped, frozen geometry and a role for every note (LASER_SPEC.md §2.1, §3).
  setNotes(notes) {
    super.setNotes(notes);
    const geo = new Map();
    for (const n of this.notes) {
      let g = this.geo.get(n.id);
      if (!g || maxMove(n.pts, g.anchor) > (g.frozen ? UNFREEZE : STILL)) g = { anchor: n.pts, since: this.t, frozen: false, role: g?.role };
      if (!g.frozen) {
        Object.assign(g, snapNote(n.pts));
        g.frozen = this.t - g.since >= STILL_S;
      }
      g.role = g.aspect < MIRROR_MAX ? 'mirror' : g.aspect > FILTER_MIN ? 'filter' : g.role ?? 'mirror';
      Object.assign(n, { pts: g.pts, role: g.role });
      geo.set(n.id, g);
    }
    this.geo = geo;
  }

  /** Sets n.off (why it's ignored) on notes in a no-note zone or past the inventory; returns the usage line. */
  sortNotes() {
    const inv = this.lv.inventory;
    const used = { mirrors: 0 };
    for (const n of [...this.notes].sort((a, b) => a.id - b.id)) {
      const [cx, cy] = [(n.pts[0][0] + n.pts[2][0]) / 2, (n.pts[0][1] + n.pts[2][1]) / 2];
      const key = n.role === 'mirror' ? 'mirrors' : n.color;
      const max = n.role === 'mirror' ? inv.mirrors : inv.filters[n.color] ?? 0;
      n.off = null;
      if (cy < TOP || this.lv.noNotes.some(([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1)) n.off = 'note in a no-note zone';
      else if ((used[key] ?? 0) >= max) n.off = max ? `only ${max} ${n.role === 'mirror' ? 'mirror' : `${n.color} filter`}${max > 1 ? 's' : ''}` : `no ${n.role === 'mirror' ? 'mirrors' : `${n.color} filters`}`;
      else used[key] = (used[key] ?? 0) + 1;
    }
    const parts = [...(inv.mirrors ? [`MIRRORS ${used.mirrors}/${inv.mirrors}`] : []), ...Object.entries(inv.filters).map(([c, m]) => `${c.toUpperCase()} ${used[c] ?? 0}/${m}`)];
    return parts.join(' · ');
  }

  move(d) {
    for (const e of this.lv.emitters) if (e.aim) e.ang = clamp(e.ang + d * 0.02, -1.4, 1.4);
  }

  click(x, y) {
    for (const e of this.lv.emitters) if (e.aim) e.ang = clamp(Math.atan2(y - e.p[1], x - e.p[0]), -1.4, 1.4);
  }

  press() {} // no game over

  tab(d) {
    this.level = clamp(this.level + d, 0, LASER_LEVELS.length - 1);
    this.build();
  }

  /** One emitter's beam (LASER_SPEC.md §6): segments [{ pts: [a, b], color }] and the notes it touched. */
  trace(e, notes) {
    let p = e.p;
    let d = [Math.cos(e.ang), Math.sin(e.ang)];
    let color = 'white';
    const segs = [];
    const hit = new Set();
    for (let k = 0; k < 32; k++) {
      let best = {
        t: Math.min(d[1] < 0 ? (TOP - p[1]) / d[1] : d[1] > 0 ? (1 - p[1]) / d[1] : Infinity, d[0] < 0 ? -p[0] / d[0] : d[0] > 0 ? (this.A - p[0]) / d[0] : Infinity),
        kind: 'edge',
      };
      const test = (a, b, x) => {
        const t = raySeg(p, d, a, b);
        if (t < best.t) best = { t, a, b, ...x };
      };
      for (const n of notes) n.pts.forEach((a, i) => test(a, n.pts[(i + 1) % 4], { kind: n.off ? 'off' : n.role, n }));
      for (const w of this.lv.walls) test(w.a, w.b, { kind: 'wall' });
      for (const l of this.lv.locks) test(l.a, l.b, { kind: 'lock', l });
      const at = (t) => [p[0] + d[0] * t, p[1] + d[1] * t];
      const onNote = best.n != null; // ignored notes absorb it: no light on paper
      const q = at(onNote ? Math.max(0, best.t - GAP) : best.t); // the beam stops a gap short of the paper
      segs.push({ pts: [p, q], color });
      if (onNote && !best.n.off) hit.add(best.n);
      if (best.kind === 'mirror') {
        const len = dist(best.a, best.b);
        const nrm = [-(best.b[1] - best.a[1]) / len, (best.b[0] - best.a[0]) / len];
        const dot = d[0] * nrm[0] + d[1] * nrm[1];
        d = [d[0] - 2 * dot * nrm[0], d[1] - 2 * dot * nrm[1]];
        p = q;
      } else if (best.kind === 'filter') {
        color = mix(color, best.n.color);
        if (!color) break;
        const pts = best.n.pts;
        const out = Math.max(...pts.map((a, i) => raySeg(p, d, a, pts[(i + 1) % 4])).filter(Number.isFinite)); // far edge
        p = at(out + GAP);
      } else if (best.kind === 'lock' && best.l.color === color) {
        p = at(best.t + 1e-6);
      } else break;
    }
    return { segs, hit };
  }

  tick() {
    this.usage = this.sortNotes();
    this.beams = [];
    const hit = new Set();
    for (const e of this.lv.emitters) {
      const b = this.trace(e, this.notes);
      this.beams.push(...b.segs);
      for (const n of b.hit) hit.add(n.id);
    }
    for (const n of this.notes) if (hit.has(n.id) && !this.lit.has(n.id)) this.hitNote(n);
    this.lit = hit;
    this.lv.targets.forEach((tg, i) => {
      // ponytail: a lit target lets the beam through (spec open question); stop it here if levels need that
      const lit = this.beams.some((s) => s.color === tg.color && segDist(tg.p, ...s.pts) < TARGET_R);
      if (lit && !tg.lit) this.sound(tone(C[i % 6], 'bell', 0.7));
      tg.lit = lit;
    });
    if (this.solvedAt == null && this.lv.targets.every((t) => t.lit)) {
      this.solvedAt = this.t;
      this.score = Math.max(this.score, this.level + 1);
      this.best = Math.max(this.best, this.score);
      this.sound(...WIN);
    }
    if (this.solvedAt != null && this.t - this.solvedAt > 1.5 && this.level < LASER_LEVELS.length - 1) {
      this.level++;
      this.build();
    }
  }

  reset() {
    super.reset();
    this.tick();
  }

  /** Vision mask over the coloured light: beam, target rings, locks. */
  mask() {
    // soft: a note dropped across the beam is still seen whole (vision.js softBlockers)
    const out = this.beams.map((s) => ({ a: s.pts[0], b: s.pts[1], r: 0.004, soft: true })); // × ballPad, still inside the gap
    for (const t of this.lv.targets) out.push({ a: t.p, b: t.p, r: TARGET_R * 0.75 });
    for (const l of this.lv.locks) out.push({ a: l.a, b: l.b, r: 0.006 });
    return out;
  }

  draw() {
    const lv = this.lv;
    const last = this.level === LASER_LEVELS.length - 1;
    const off = this.notes.filter((n) => n.off);
    return {
      top: TOP,
      emitters: lv.emitters.map((e) => ({ p: e.p, ang: e.ang, aim: e.aim })),
      beams: this.beams,
      targets: lv.targets.map((t) => ({ x: t.p[0], y: t.p[1], r: TARGET_R, color: t.color, lit: t.lit })),
      walls: lv.walls,
      locks: lv.locks.map(({ a, b, color }) => ({ a, b, color })),
      zones: lv.noNotes,
      off: off.map((n) => n.pts),
      info: `LEVEL ${this.level + 1}/${LASER_LEVELS.length} · ${lv.name.toUpperCase()} · ${lv.hint}${this.usage ? ` · ${this.usage}` : ''}${off.length ? ` · IGNORED: ${off[0].off}` : ''}`,
      banner: this.solvedAt != null ? (last ? ['ALL SOLVED!', 'R to start again'] : ['SOLVED!', 'next level…']) : null,
    };
  }
}

/** id → class. Order and names for the menu live in render.js GAMES. */
export const MINI_GAMES = { laser: Laser };
