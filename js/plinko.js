// Plinko: balls drop from the top, bounce off a peg grid and the sticky notes
// (bumpers), and land in scoring slots at the bottom. Pure JS (no DOM).
//
// World units: y is 0..1 down the projector height, x is 0..aspect (so circles
// stay round). Positions sent to the projector are normalized back to 0..1.
// Notes are projector-normalized quads; pegs under a note are removed so no
// projected light lands on the paper (see render.js BALL_GAP).

export const SLOT_VALUES = [100, 25, 10, 5, 1, 5, 10, 25, 100];
const G = 3; // gravity, heights / s²
const STEP = 1 / 240; // physics substep, s
const PEG_R = 0.007;
const PEG_E = 0.5; // restitution off pegs
const NOTE_E = 1.05; // notes are bumpers: a little extra kick
const WALL_E = 0.4;
const SLOT_TOP = 0.86;
const FLOOR = 0.99;
const TRAIL_S = 0.6; // position history kept per ball (drawing + vision mask)
const MAX_BALLS = 40;

export class Plinko {
  constructor({ aspect = 16 / 9, ballR = 0.0167, gap = 0.009 } = {}) {
    this.A = aspect;
    this.r = ballR;
    this.gap = gap; // clearance kept between a ball and a note's paper
    this.balls = [];
    this.notes = [];
    this.score = 0;
    this.dropped = 0;
    this.aim = aspect / 2;
    this.popups = []; // [{ x, y, text, t }] "+25" at a slot
    this.nextId = 1;
    this.t = 0;
    this.buildBoard();
  }

  buildBoard() {
    const A = this.A;
    const n = SLOT_VALUES.length;
    this.slotW = A / n;
    // Staggered peg grid spanning wall to wall (half pegs on the walls).
    // dx / 4 < PEG_R + ball radius: no straight vertical channel, every drop
    // meets a peg within two rows. dx / 2 - PEG_R > ball diameter: no gap a
    // ball can wedge in.
    const cols = Math.ceil(A / (3.8 * (PEG_R + this.r)));
    const dx = A / cols;
    this.basePegs = [];
    for (let row = 0, y = 0.2; y < SLOT_TOP - 0.04; row++, y += 0.058) {
      for (let c = row % 2 ? 0.5 : 0; c <= cols; c++) this.basePegs.push({ x: c * dx, y, lit: 0 });
    }
    this.dividers = [];
    for (let i = 1; i < n; i++) this.dividers.push({ a: [i * this.slotW, SLOT_TOP], b: [i * this.slotW, FLOOR], r: 0.004 });
    this.setNotes(this.notes);
  }

  /** @param notes [{ id, corners: [[x,y] x4] normalized, color }] */
  setNotes(notes) {
    this.notes = notes.map((n) => ({ ...n, pts: n.corners.map(([x, y]) => [x * this.A, y]) }));
    const clear = PEG_R + this.gap * 2;
    this.pegs = this.basePegs.filter((p) => !this.notes.some((n) => inPoly([p.x, p.y], n.pts) || polyDist([p.x, p.y], n.pts) < clear));
  }

  setAim(x) {
    this.aim = Math.max(this.r, Math.min(this.A - this.r, x));
  }

  drop(x = this.aim) {
    if (this.balls.length >= MAX_BALLS) this.balls.shift();
    const jitter = (Math.random() - 0.5) * 0.004; // identical drops still differ
    this.balls.push({ id: this.nextId++, x: x + jitter, y: 0.06, vx: 0, vy: 0, scored: false, rest: 0, trail: [] });
    this.dropped++;
  }

  reset() {
    this.balls = [];
    this.popups = [];
    this.score = 0;
    this.dropped = 0;
  }

  /**
   * Advance dt seconds. Returns events for sound / halos:
   * { kind: 'peg'|'note'|'wall'|'ball', speed, x, noteId?, color? } and
   * { kind: 'slot', slot, value, x }.
   */
  step(dt) {
    const events = [];
    dt = Math.min(dt, 0.1); // a stalled tab must not tunnel balls through pegs
    for (let t = 0; t < dt - 1e-9; t += STEP) this.substep(Math.min(STEP, dt - t), events);
    this.t += dt;
    for (const p of this.pegs) p.lit = Math.max(0, p.lit - dt * 3);
    this.popups = this.popups.filter((p) => this.t - p.t < 1.2);
    for (const b of this.balls) {
      b.trail.push([b.x, b.y, this.t]);
      while (b.trail.length && this.t - b.trail[0][2] > TRAIL_S) b.trail.shift();
    }
    // landed balls fade out after a moment
    this.balls = this.balls.filter((b) => b.rest < 2.5);
    return events;
  }

  substep(dt, events) {
    const r = this.r;
    for (const b of this.balls) {
      b.vy += G * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      for (const p of this.pegs) {
        const s = collide(b, [p.x, p.y], [p.x, p.y], PEG_R + r, PEG_E);
        if (s > 0.15) {
          b.vx += (Math.random() - 0.5) * 0.1 * s; // real pegs are imperfect; no ball balances on top
          p.lit = 1;
          events.push({ kind: 'peg', speed: s, x: p.x / this.A, y: p.y });
        }
      }
      for (const n of this.notes) {
        let hit = 0;
        n.pts.forEach((a, i) => (hit = Math.max(hit, collide(b, a, n.pts[(i + 1) % n.pts.length], r + this.gap, NOTE_E))));
        if (hit > 0.1) events.push({ kind: 'note', speed: hit, noteId: n.id, color: n.color, x: b.x / this.A });
      }
      for (const d of this.dividers) collide(b, d.a, d.b, d.r + r, WALL_E);
      if (b.x < r) wall(b, 'x', r, 1);
      if (b.x > this.A - r) wall(b, 'x', this.A - r, -1);
      if (b.y > FLOOR - r) {
        wall(b, 'y', FLOOR - r, -1);
        b.vx *= 0.98;
      }
      if (!b.scored && b.y > SLOT_TOP + r) {
        b.scored = true;
        const slot = Math.max(0, Math.min(SLOT_VALUES.length - 1, Math.floor(b.x / this.slotW)));
        const value = SLOT_VALUES[slot];
        this.score += value;
        this.popups.push({ x: ((slot + 0.5) * this.slotW) / this.A, y: SLOT_TOP - 0.03, text: `+${value}`, t: this.t });
        events.push({ kind: 'slot', slot, value, x: b.x / this.A });
      }
      if (b.scored) b.rest += dt; // time since landing
    }
    // ball-ball: equal masses, push apart and swap normal velocity
    // ponytail: O(n²) over <= MAX_BALLS, use a grid if MAX_BALLS grows a lot
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i];
        const c = this.balls[j];
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= 2 * r || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (2 * r - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        c.x += nx * push;
        c.y += ny * push;
        const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rel >= 0) continue;
        const k = -rel * 0.9; // (1 + e) / 2 with e = 0.8
        a.vx -= nx * k;
        a.vy -= ny * k;
        c.vx += nx * k;
        c.vy += ny * k;
        if (-rel > 0.3) events.push({ kind: 'ball', speed: -rel, x: a.x / this.A });
      }
    }
  }

  /** What the projector draws (normalized coords). */
  view() {
    const A = this.A;
    return {
      balls: this.balls.map((b) => ({ id: b.id, x: b.x / A, y: b.y, a: Math.min(1, 2.5 - b.rest), trail: b.trail.map(([x, y]) => [x / A, y]) })),
      pegs: this.pegs.map((p) => [p.x / A, p.y, +p.lit.toFixed(2)]),
      slots: SLOT_VALUES,
      slotTop: SLOT_TOP,
      floor: FLOOR,
      aim: this.aim / A,
      score: this.score,
      dropped: this.dropped,
      popups: this.popups.map((p) => ({ ...p, age: this.t - p.t })),
      r: this.r,
    };
  }
}

// Circle b vs capsule a-c of combined radius R: push out, bounce with
// restitution e. Returns the normal impact speed (0 if no contact).
function collide(b, a, c, R, e) {
  const [qx, qy] = closest([b.x, b.y], a, c);
  const dx = b.x - qx;
  const dy = b.y - qy;
  const d = Math.hypot(dx, dy);
  if (d >= R || d === 0) return 0;
  const nx = dx / d;
  const ny = dy / d;
  b.x = qx + nx * R;
  b.y = qy + ny * R;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0;
  b.vx -= (1 + e) * vn * nx;
  b.vy -= (1 + e) * vn * ny;
  b.vx *= 0.995; // a touch of friction so balls settle
  return -vn;
}

function wall(b, axis, at, dir) {
  b[axis] = at;
  const v = axis === 'x' ? 'vx' : 'vy';
  if (b[v] * dir < 0) b[v] *= -WALL_E;
}

function closest([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
  return [ax + t * dx, ay + t * dy];
}

function polyDist(p, pts) {
  return Math.min(...pts.map((a, i) => {
    const q = closest(p, a, pts[(i + 1) % pts.length]);
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  }));
}

function inPoly([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
