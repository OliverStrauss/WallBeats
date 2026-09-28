// Lanes from sticky notes (pure JS, no DOM).
//
// The wall is one bar, top to bottom, in 8 rows of 1/8 (`barH` of wall height
// per bar). A note's row (`step`, 16ths into the bar) is when it plays.
// A *lone* note's ball leaves the top of the wall on every downbeat, reaches the
// note at its row and climbs back by the next downbeat: it plays once per bar.
// Two notes stacked so the lower one crosses the upper one's centre line form a
// *pair*, a loop region: the ball ping-pongs between them and both notes play
// every gap (1/8 per `unit`), from the upper note's row to the end of the bar.
// Stacks of 3+ chain into pairs top to bottom.
//
// Everything is in projector-normalized coordinates (0..1).

import { centroid } from './tracker.js';

export const LANE_DEFAULTS = {
  unit: 0.1, // normalized gap per 1/8 note between pair hits
  barH: 1, // wall height per bar: 8 rows of barH/8
  snap: true, // rows snap to 1/8s; pair gaps to 1, 2, 4, 8 1/8s (cycles divide the bar)
  minWidth: 0.0375, // lane width clamp: 2x ball diameter (30 px at 1600 wide)
  minN: 0.25, // shortest un-snapped gap, in 1/8s
  offsets: {}, // { laneId: dx } fine-tune nudges (A / D)
};

// Where the vertical line at `x` crosses the polygon: [top y, bottom y], or null.
export function spanAt(poly, x) {
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    if ((x0 - x) * (x1 - x) > 0) continue; // edge entirely on one side
    let ys;
    if (x0 === x1) ys = [y0, y1];
    else ys = [y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)];
    for (const y of ys) {
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return top === Infinity ? null : [top, bottom];
}

export function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The note under a point (for clicks on the wall), or null. */
export function noteAt(notes, pt) {
  return notes.find((n) => pointInPoly(pt, n.corners)) ?? null;
}

/**
 * @param notes [{ id, corners: [[x,y] x4], color }] tracked notes
 * @param opts  see LANE_DEFAULTS
 * @returns lanes sorted left to right:
 *   { id, x, w, upperId, upperColor, ceil, targetId, color, top, d, n, step }
 *   step = 16ths into the bar at which the lane starts playing (its top note's row).
 *   Pair: id = upper note id, ceil = upper note's bottom edge, n = cycle in
 *   16ths (bottom hit at phase, top hit at phase + n/2).
 *   Lone: id = the note's id, upperId = null, ceil = 0 (top of the wall),
 *   n = 16, one bar (hits at phase + k*n, see beat.js).
 */
export function buildLanes(notes, opts = {}) {
  const o = { ...LANE_DEFAULTS, ...opts };
  const width = (n) => {
    const xs = n.corners.map((p) => p[0]);
    return Math.max(Math.max(...xs) - Math.min(...xs), o.minWidth);
  };
  // row of a top edge at y, in 16ths into the bar: 0, 2 ... 14 with Snap on
  const stepAt = (y) => {
    const t = (16 * y) / o.barH;
    return o.snap ? 2 * Math.min(7, Math.max(0, Math.round(t / 2))) : Math.min(15, Math.max(0, t));
  };
  const lanes = [];
  const paired = new Set();
  for (const u of notes) {
    const [ux, uy] = centroid(u.corners);
    const x = ux + (o.offsets[u.id] || 0);
    const uSpan = spanAt(u.corners, x);
    if (!uSpan) continue;
    let best = null;
    for (const f of notes) {
      if (f === u || centroid(f.corners)[1] <= uy) continue;
      const s = spanAt(f.corners, x);
      if (s && (!best || s[0] < best.top)) best = { note: f, top: s[0] };
    }
    if (!best) continue;
    paired.add(u.id).add(best.note.id);
    const d = Math.max(0, best.top - uSpan[1]);
    lanes.push({
      id: u.id, x, w: width(u),
      upperId: u.id, upperColor: u.color ?? null, ceil: uSpan[1],
      targetId: best.note.id, color: best.note.color ?? null, top: best.top,
      d, n: 4 * lengthIn8ths(d, o), step: stepAt(uSpan[0]),
    });
  }
  for (const f of notes) {
    if (paired.has(f.id)) continue;
    const x = centroid(f.corners)[0] + (o.offsets[f.id] || 0);
    const top = spanAt(f.corners, x)?.[0] ?? Math.min(...f.corners.map((p) => p[1]));
    lanes.push({
      id: f.id, x, w: width(f),
      upperId: null, upperColor: null, ceil: 0,
      targetId: f.id, color: f.color ?? null, top,
      d: top, n: 16, step: stepAt(top),
    });
  }
  return lanes.sort((a, b) => a.x - b.x || a.id - b.id);
}

// Pair gap -> time between consecutive hits (top or bottom), in 1/8 notes.
export function lengthIn8ths(d, opts = {}) {
  const o = { ...LANE_DEFAULTS, ...opts };
  const n = d / o.unit;
  return o.snap ? pow2(n, 0, 3) : Math.max(o.minN, n);
}

// Nearest power of two (log scale) between 2^lo and 2^hi: 3 -> 4, 2.5 -> 2.
// Only these keep a lane's cycle a divisor of 1-2 bars, so the pattern
// is the same every bar; 3/8 or 3/16 cycles drift against the bar line.
const pow2 = (x, lo, hi) => 2 ** Math.min(hi, Math.max(lo, Math.round(Math.log2(Math.max(x, 1e-9)))));

/** One-way travel time of a pair's ball, in 16ths (the time between its hits). */
export function oneWay(lane) {
  return lane.n / 2;
}

/** "@ 3/8" for a lone note, "1/8 from 1/4" for a pair (every 1/8, from 2/8 into the bar). */
export function laneLabel(lane, snap = true) {
  const at = lane.step ? rateLabel(lane.step, snap) : '0';
  return lane.upperId == null ? `@ ${at}` : `${rateLabel(oneWay(lane), snap)} from ${at}`;
}

// "1/4", "3/16", "1", "≈0.37" ... for n 16ths.
export function rateLabel(n, snap = true) {
  if (n == null) return '—';
  if (!snap || !Number.isInteger(n)) return `≈${(n / 16).toFixed(2)}`;
  let num = n;
  let den = 16;
  while (num % 2 === 0 && den > 1) {
    num /= 2;
    den /= 2;
  }
  return den === 1 ? String(num) : `${num}/${den}`;
}
