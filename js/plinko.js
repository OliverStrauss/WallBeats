// Plinko: balls drop from the top, bounce off a sparse peg grid and the sticky
// notes, and land in scoring slots at the bottom. One slot is the bonus bucket
// (x5) and one the skull (-50); both move after the bonus scores and every
// BONUS_S. A star drifts over the board: touch it for +50. A round is
// ROUND_BALLS drops; the best round is kept. Puzzle mode instead fixes the drop
// point and asks for one slot with at most N notes on the wall (LEVELS).
// Pure JS (no DOM).
//
// Note colour = power (first touch per ball, except boost / warp):
//   red boost · blue warp to the next blue note · green split into 3 ·
//   yellow x2 score · purple magnet (pulls nearby balls) · orange sticky (1 s hold)
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
export const NOTE_LINE = 0.76; // notes reaching below this line are ignored (keeps the slots open)
export const PLINKO_TOP = 0.19; // top band masked out of note detection (HUD text reads as notes); first pegs at 0.22
const FLOOR = 0.99;
const TRAIL_S = 0.6; // position history kept per ball (drawing + vision mask)
const MAX_BALLS = 40;
const BONUS_X = 5;
const BONUS_S = 8; // bonus bucket moves this often, s
const BOOST = 2; // red: speed added along the hit edge, heights / s
const MAG = 2.5; // purple: pull at the note, heights / s² (< G, so no ball hovers under one)
const MAG_R = 0.25; // purple: pull range from the note centre
const STICK_S = 1;
const SKULL = -50;
const STAR = 50;
const STAR_R = 0.03;
const ROUND_BALLS = 10;
// Puzzle levels: drop at x (fraction of width), land in `slot` with at most `max` notes up.
export const LEVELS = [
  { x: 0.5, slot: 0, max: 1, hint: 'one note: push it to the far left' },
  { x: 0.92, slot: 3, max: 1, hint: 'one note, long way left' },
  { x: 0.08, slot: 8, max: 2, hint: 'two notes: across the whole board' },
  { x: 0.3, slot: 7, max: 2, hint: 'try a blue pair' },
  { x: 0.5, slot: 4, max: 0, hint: 'no notes, dead centre (luck counts)' },
  { x: 0.7, slot: 0, max: 1, hint: 'one note, one ball' },
];
const STALL_S = 20; // an unscored ball this old is removed (magnet / bumper traps)

export class Plinko {
  constructor({ aspect = 16 / 9, ballR = 0.0167, gap = 0.009, best = 0 } = {}) {
    this.A = aspect;
    this.r = ballR;
    this.gap = gap; // clearance kept between a ball and a note's paper
    this.balls = [];
    this.notes = [];
    this.score = 0;
    this.dropped = 0;
    this.aim = aspect / 2;
    this.bonus = 0;
    this.skull = 1;
    this.bonusT = 0;
    this.best = best;
    this.left = ROUND_BALLS;
    this.level = null; // puzzle level index, null = score mode
    this.solvedAt = null;
    this.star = { ph: Math.random() * 6, off: 0 }; // off: hidden until this.t
    this.popups = []; // [{ x, y, text, t }] "+25" at a slot
    this.nextId = 1;
    this.t = 0;
    this.buildBoard();
    this.moveBonus();
  }

  moveBonus() {
    const n = SLOT_VALUES.length;
    this.bonus = (this.bonus + 1 + Math.floor(Math.random() * (n - 1))) % n; // never the same slot
    this.skull = (this.bonus + 1 + Math.floor(Math.random() * (n - 1))) % n; // never the bonus slot
    this.bonusT = this.t + BONUS_S;
  }

  /** Round over: no balls left to drop and none still falling. */
  get over() {
    return this.level == null && this.left === 0 && this.balls.every((b) => b.scored);
  }

  /** Star position (world units) or null while hidden / over a note. */
  starAt() {
    if (this.level != null || this.t < this.star.off) return null;
    const t = this.t * 0.25 + this.star.ph;
    const p = [this.A / 2 + (this.A / 2 - 0.12) * Math.sin(t), 0.48 + 0.2 * Math.sin(t * 2.3)];
    // never light up the paper (vision would see a star-shaped note)
    const clear = STAR_R + this.gap * 2;
    return this.notes.some((n) => inPoly(p, n.pts) || polyDist(p, n.pts) < clear) ? null : p;
  }

  /** Puzzle mode on (level index) / off (null). Clears the board. */
  setLevel(i) {
    this.level = i == null ? null : ((i % LEVELS.length) + LEVELS.length) % LEVELS.length;
    this.solvedAt = null;
    this.balls = [];
    this.popups = [];
    if (this.level != null) this.aim = LEVELS[this.level].x * this.A;
    else this.reset();
  }

  buildBoard() {
    const A = this.A;
    const n = SLOT_VALUES.length;
    this.slotW = A / n;
    // Sparse staggered grid: one peg per slot width, rows alternate between
    // slot edges and slot centres. Open lanes are on purpose: good aim can
    // reach the bonus bucket, the notes decide the rest.
    const cols = n;
    const dx = A / cols;
    this.basePegs = [];
    for (let row = 0, y = 0.22; row < 4; row++, y += 0.12) {
      for (let c = row % 2 ? 0.5 : 0; c <= cols; c++) this.basePegs.push({ x: c * dx, y, lit: 0 });
    }
    this.dividers = [];
    for (let i = 1; i < n; i++) this.dividers.push({ a: [i * this.slotW, SLOT_TOP], b: [i * this.slotW, FLOOR], r: 0.004 });
    this.setNotes(this.notes);
  }

  /** @param notes [{ id, corners: [[x,y] x4] normalized, color }] */
  setNotes(notes) {
    const all = notes.map((n) => ({ ...n, pts: n.corners.map(([x, y]) => [x * this.A, y]) }));
    this.notes = all.filter((n) => n.pts.every(([, y]) => y <= NOTE_LINE));
    // pegs go from under every note, even ignored ones: no light on any paper
    const clear = PEG_R + this.gap * 2;
    this.pegs = this.basePegs.filter((p) => !all.some((n) => inPoly([p.x, p.y], n.pts) || polyDist([p.x, p.y], n.pts) < clear));
  }

  setAim(x) {
    if (this.level != null) return; // puzzle: the drop point is part of the level
    this.aim = Math.max(this.r, Math.min(this.A - this.r, x));
  }

  /** Drops a ball; returns false (and says why in a popup) when it cannot. */
  drop(x = this.aim) {
    if (this.level != null) {
      const lv = LEVELS[this.level];
      if (this.notes.length > lv.max) {
        this.popups.push({ x: 0.5, y: 0.14, text: `TAKE DOWN ${this.notes.length - lv.max} NOTE${this.notes.length - lv.max > 1 ? 'S' : ''}`, t: this.t });
        return false;
      }
      x = lv.x * this.A;
    } else if (this.over) {
      this.reset(); // Space after a round starts the next one
      return false;
    } else if (this.left === 0) return false;
    else this.left--;
    if (this.balls.length >= MAX_BALLS) this.balls.shift();
    const jitter = (Math.random() - 0.5) * 0.004; // identical drops still differ
    this.balls.push(this.ball(x + jitter, 0.06, 0, 0));
    this.dropped++;
    return true;
  }

  ball(x, y, vx, vy, from) {
    return { id: this.nextId++, x, y, vx, vy, scored: false, rest: 0, age: 0, trail: [], mult: from?.mult ?? 1, touched: new Set(from?.touched), split: !!from, stuck: 0, warp: 0 };
  }

  reset() {
    this.balls = [];
    this.popups = [];
    this.score = 0;
    this.dropped = 0;
    this.left = ROUND_BALLS;
    this.moveBonus();
  }

  /**
   * Advance dt seconds. Returns events for sound / halos:
   * { kind: 'peg'|'note'|'wall'|'ball', speed, x, noteId?, color?, power? } and
   * { kind: 'slot', slot, value, x, bonus, skull? } and { kind: 'star', value, x }.
   */
  step(dt) {
    const events = [];
    dt = Math.min(dt, 0.1); // a stalled tab must not tunnel balls through pegs
    for (let t = 0; t < dt - 1e-9; t += STEP) this.substep(Math.min(STEP, dt - t), events);
    this.t += dt;
    if (this.t > this.bonusT && this.level == null) this.moveBonus();
    if (this.solvedAt != null && this.t - this.solvedAt > 1.5) this.setLevel(this.level + 1);
    for (const p of this.pegs) p.lit = Math.max(0, p.lit - dt * 3);
    this.popups = this.popups.filter((p) => this.t - p.t < 1.2);
    for (const b of this.balls) {
      b.trail.push([b.x, b.y, this.t]);
      while (b.trail.length && this.t - b.trail[0][2] > TRAIL_S) b.trail.shift();
    }
    // landed balls fade out after a moment
    this.balls = this.balls.filter((b) => b.rest < 2.5 && (b.scored || b.age < STALL_S));
    if (this.over) this.best = Math.max(this.best, this.score);
    return events;
  }

  substep(dt, events) {
    const r = this.r;
    const born = [];
    const blues = this.notes.filter((n) => n.color === 'blue');
    for (const b of this.balls) {
      b.age += dt;
      b.warp = Math.max(0, b.warp - dt);
      if (b.stuck > 0) {
        b.stuck -= dt; // orange: held still on the paper, then falls
        continue;
      }
      for (const n of this.notes) {
        if (n.color !== 'purple') continue;
        const [cx, cy] = centre(n.pts);
        const d = Math.hypot(cx - b.x, cy - b.y);
        if (d > 0 && d < MAG_R) {
          const a = MAG * (1 - d / MAG_R) * dt;
          b.vx += ((cx - b.x) / d) * a;
          b.vy += ((cy - b.y) / d) * a;
        }
      }
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
        let edge = 0;
        n.pts.forEach((a, i) => {
          const s = collide(b, a, n.pts[(i + 1) % n.pts.length], r + this.gap, NOTE_E);
          if (s > hit) [hit, edge] = [s, i];
        });
        if (hit > 0.1) events.push({ kind: 'note', speed: hit, noteId: n.id, color: n.color, x: b.x / this.A, power: this.power(b, n, edge, blues, born) });
      }
      const star = this.starAt();
      if (star && Math.hypot(b.x - star[0], b.y - star[1]) < STAR_R + r) {
        const v = STAR * b.mult;
        this.score += v;
        this.popups.push({ x: star[0] / this.A, y: star[1] - 0.05, text: `★ +${v}`, t: this.t });
        events.push({ kind: 'star', value: v, x: star[0] / this.A });
        this.star = { ph: Math.random() * 6, off: this.t + 1.5 };
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
        const px = ((slot + 0.5) * this.slotW) / this.A;
        if (this.level != null) {
          const win = slot === LEVELS[this.level].slot && this.solvedAt == null;
          if (win) this.solvedAt = this.t;
          this.popups.push({ x: px, y: SLOT_TOP - 0.03, text: win ? 'SOLVED' : 'miss', t: this.t, slot });
          events.push({ kind: 'slot', slot, value: 0, x: b.x / this.A, bonus: win });
        } else {
          const bonus = slot === this.bonus;
          const value = slot === this.skull ? SKULL * b.mult : SLOT_VALUES[slot] * b.mult * (bonus ? BONUS_X : 1);
          this.score += value;
          this.popups.push({ x: px, y: SLOT_TOP - 0.03, text: value < 0 ? `${value}` : `+${value}`, t: this.t, slot });
          events.push({ kind: 'slot', slot, value, x: b.x / this.A, bonus, skull: value < 0 });
          if (bonus) this.moveBonus();
        }
      }
      if (b.scored) b.rest += dt; // time since landing
    }
    for (const c of born) {
      if (this.balls.length >= MAX_BALLS) break;
      this.balls.push(c);
    }
    // ball-ball: equal masses, push apart and swap normal velocity
    // ponytail: O(n²) over <= MAX_BALLS, use a grid if MAX_BALLS grows a lot
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i];
        const c = this.balls[j];
        if (a.stuck > 0 || c.stuck > 0) continue;
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

  // Note power on a hit (ball b just bounced off edge `edge` of note n).
  // Returns the power's name for the event, or undefined.
  power(b, n, edge, blues, born) {
    const first = !b.touched.has(n.id);
    b.touched.add(n.id);
    const pop = (text) => this.popups.push({ x: centre(n.pts)[0] / this.A, y: Math.min(...n.pts.map((p) => p[1])) - 0.04, text, t: this.t });
    switch (n.color) {
      case 'red': {
        // shoot the ball along the edge it hit, the way it was already going
        const [a, c] = [n.pts[edge], n.pts[(edge + 1) % n.pts.length]];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        const ex = (c[0] - a[0]) / L;
        const ey = (c[1] - a[1]) / L;
        const dir = b.vx * ex + b.vy * ey < 0 ? -1 : 1;
        b.vx += ex * BOOST * dir;
        b.vy += ey * BOOST * dir;
        return 'boost';
      }
      case 'blue': {
        if (blues.length < 2 || b.warp > 0) return undefined;
        const to = blues[(blues.indexOf(n) + 1) % blues.length];
        const [cx] = centre(to.pts);
        b.x = Math.max(this.r, Math.min(this.A - this.r, cx));
        b.y = Math.max(...to.pts.map((p) => p[1])) + this.r + this.gap + 0.005; // out the bottom
        b.vx *= 0.5;
        b.vy = Math.max(0.3, Math.abs(b.vy));
        b.warp = 0.3;
        b.trail = []; // a trail across the jump would mask the wall between the notes
        b.touched.add(to.id);
        pop('WARP');
        return 'warp';
      }
      case 'green':
        if (b.split || !first) return undefined;
        b.split = true;
        for (const k of [-1, 1]) born.push(this.ball(b.x, b.y, b.vx + k * 0.6, b.vy, b));
        pop('SPLIT');
        return 'split';
      case 'yellow':
        if (!first) return undefined;
        b.mult *= 2;
        pop(`×${b.mult}`);
        return 'double';
      case 'orange':
        if (!first) return undefined;
        b.stuck = STICK_S;
        b.vx = b.vy = 0;
        return 'stick';
      default:
        return undefined;
    }
  }

  /** What the projector draws (normalized coords). */
  view() {
    const A = this.A;
    return {
      balls: this.balls.map((b) => ({ id: b.id, x: b.x / A, y: b.y, a: Math.min(1, 2.5 - b.rest), mult: b.mult, stuck: b.stuck, trail: b.trail.map(([x, y]) => [x / A, y]) })),
      pegs: this.pegs.map((p) => [p.x / A, p.y, +p.lit.toFixed(2)]),
      slots: SLOT_VALUES,
      bonus: this.level == null ? this.bonus : null,
      skull: this.level == null ? this.skull : null,
      skullValue: SKULL,
      star: (() => {
        const p = this.starAt();
        return p && { x: p[0] / A, y: p[1], r: STAR_R };
      })(),
      left: this.left,
      best: this.best,
      over: this.over,
      puzzle: this.level == null ? null : { n: this.level + 1, of: LEVELS.length, ...LEVELS[this.level], notes: this.notes.length, solved: this.solvedAt != null },
      bonusX: BONUS_X,
      bonusLeft: Math.max(0, (this.bonusT - this.t) / BONUS_S),
      slotTop: SLOT_TOP,
      noteLine: NOTE_LINE,
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
export function collide(b, a, c, R, e) {
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

export function centre(pts) {
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

function wall(b, axis, at, dir) {
  b[axis] = at;
  const v = axis === 'x' ? 'vx' : 'vy';
  if (b[v] * dir < 0) b[v] *= -WALL_E;
}

export function closest([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
  return [ax + t * dx, ay + t * dy];
}

export function polyDist(p, pts) {
  return Math.min(...pts.map((a, i) => {
    const q = closest(p, a, pts[(i + 1) % pts.length]);
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  }));
}

export function inPoly([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
