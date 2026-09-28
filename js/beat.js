// Beat engine: clock, balls and the look-ahead scheduler (pure JS, no DOM).
//
// Musical time is counted in 16th notes ("pos"). The clock maps seconds to pos:
//   pos(t) = pos0 + (t - anchor) * bpm / 15        (bpm / 15 = 16ths per second)
// A tempo change re-anchors the clock at the current pos, so everything stays
// continuous and all lanes speed up or slow down together.
//
// A ball in a lane with cycle n (16ths, see lanes.js) is defined by its phase:
// the pos at which it hits the target. It hits at phase + k*n and is back at
// the top halfway between (where a pair's upper note is hit too). Its position is analytic (ballProgress), so
// the projector draws it from the same clock without any physics.
//
// Times passed in (`now`) are seconds on a clock shared by both windows:
// epochNow() = (performance.timeOrigin + performance.now()) / 1000.
//
// Echo + layers: every hit the wall plays is remembered for the last echoBars
// bars. Keep snapshots that into a layer (a loop of echoBars*16 steps) which
// the scheduler replays forever, whether or not its notes are still up.

import { NOTE_COLORS } from './colors.js';

export const BEAT_DEFAULTS = {
  bpm: 96,
  snap: true,
  maxBallsPerLane: 4,
  echoBars: 4, // 4/4 bars kept in the echo buffer
  lookahead: 0.1, // s scheduled ahead of now
  grace: 0.05, // s: a late tick still schedules hits this far in the past
  velocity: 0.8,
};
export const MIN_BPM = 30;
export const MAX_BPM = 240;

export function epochNow() {
  return (performance.timeOrigin + performance.now()) / 1000;
}

export function sixteenthSec(bpm) {
  return 60 / bpm / 4;
}

/** Clock state as sent to the projector -> pos at `now` (s). */
export function clockPos(clock, now) {
  return clock.running ? clock.pos0 + ((now - clock.anchor) * clock.bpm) / 15 : clock.pos0;
}

/**
 * 0 at the top, 1 when touching the target. Hits when pos = phase (mod n).
 * The ball falls for `fall` 16ths before each hit and climbs back for the rest.
 */
export function ballProgress(pos, phase, n, fall = n / 2) {
  const u = ((((pos - phase + fall) % n) + n) % n);
  return u < fall ? u / fall : 1 - (u - fall) / (n - fall);
}

/** Does a hit at `pos` sound? A pair only plays from its row to the end of the bar. */
export function inWindow(lane, pos) {
  return lane.upperId == null || ((pos % 16) + 16) % 16 >= (lane.step ?? 0) - 1e-6;
}

/**
 * Normalized y of a ball's centre. It turns round at the lane's ceiling (just
 * below a pair's upper note) and just above the target's top edge on a hit,
 * so it never lights the paper.
 * @param rN   ball radius as a fraction of the projector height
 * @param gapN gap left between the ball and both notes (same units)
 */
export function ballY(lane, phase, pos, rN, gapN = 0) {
  const y0 = lane.upperId != null ? lane.ceil + rN + gapN : Math.max(rN, lane.ceil);
  const y1 = Math.max(y0, lane.top - rN - gapN);
  return y0 + (y1 - y0) * ballProgress(pos, phase, lane.n, lane.upperId == null ? lane.step ?? lane.n / 2 : lane.n / 2);
}

// A note that leaves the wall hands its instrument to a note of the same colour
// that appears within this many seconds (picking a note up and moving it
// gives it a new tracker id).
export const MOVE_S = 10;

/** A kept layer's snapshot pos for `pos`: replays the kept window in a loop. */
export function ghostPos(ghost, pos) {
  return ghost.from + ((((pos - ghost.from) % ghost.L) + ghost.L) % ghost.L);
}

/** Is a hit at pos `p` (hits every n) the first of its loop of L 16ths? "Once" notes play only those. */
export function onceHit(p, n, L) {
  return Math.floor((p + 1e-6) / L) !== Math.floor((p - n + 1e-6) / L);
}

/**
 * Should a ball be drawn at `pos`? Always, unless every note its lane strikes
 * is a once note: then only the lane's first ball, on the way down to a once hit.
 */
export function ballShown(lane, ballIndex, phase, pos, once, L) {
  const strikes = [[0, lane.targetId]];
  if (lane.upperId != null) strikes.push([lane.n / 2, lane.upperId]);
  if (strikes.some(([, id]) => !once.has(id))) return true;
  if (ballIndex > 0) return false;
  return strikes.some(([off]) => {
    const ph = phase + off;
    const next = ph + Math.ceil((pos - ph) / lane.n) * lane.n;
    return next - pos <= lane.n / 2 && onceHit(next, lane.n, L);
  });
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A lone ball leaves the top of the wall on the downbeat and hits at its row.
// A pair's ball hits the upper note at the upper note's row (bottom half a cycle before).
export function startPhase(lane) {
  const step = lane.step ?? (lane.upperId == null ? lane.n / 2 : 0);
  return lane.upperId == null ? step : step - lane.n / 2;
}

export class BeatEngine {
  constructor(opts = {}) {
    this.o = { ...BEAT_DEFAULTS, ...opts };
    this.bpm = this.o.bpm;
    this.snap = this.o.snap;
    this.running = false;
    this.anchor = 0; // s: when pos was pos0
    this.pos0 = 0;
    this.base = 0; // pos where all lanes last started in step (see _ballsToTop)
    this.horizon = 0; // pos up to which hits have been scheduled
    this.lanes = []; // from buildLanes()
    this.balls = new Map(); // laneId -> [{ id, phase }] in the order added
    this.nextBall = 1;
    this.instruments = new Map(); // noteId -> instrument id
    this.noteColors = new Map(); // noteId -> colour, as of the last syncNotes
    this.firstSeen = new Map(); // noteId -> s
    this.moved = []; // instruments of notes that left: [{ color, instrument, at }]
    this.mutes = new Set(); // colour names
    this.solo = null; // colour name or null
    this.once = new Set(); // noteIds that play once per loop instead of every hit
    this.echo = []; // live hits played: [{ pos, color, instrument, velocity, noteId }]
    this.layers = []; // kept loops: [{ L, events: [{ step, color, instrument, velocity, noteId }] }]
  }

  setOptions(opts) {
    Object.assign(this.o, opts);
  }

  // ---------------------------------------------------------------- clock

  pos(now) {
    return clockPos(this, now);
  }

  /** Seconds at which the clock reaches `pos` (while running). */
  timeAt(pos) {
    return this.anchor + ((pos - this.pos0) * 15) / this.bpm;
  }

  clock() {
    return { running: this.running, bpm: this.bpm, anchor: this.anchor, pos0: this.pos0 };
  }

  start(now) {
    if (this.running) return;
    this.pos0 = Math.ceil(this.pos0 / 16 - 1e-9) * 16; // restart on a bar line: rows are times in the bar
    this.anchor = now;
    this.running = true;
    this.horizon = this.pos0;
    this._ballsToTop();
  }

  stop(now) {
    if (!this.running) return;
    this.pos0 = this.snap ? Math.ceil(this.pos(now)) : this.pos(now);
    this.anchor = now;
    this.running = false;
    this._ballsToTop();
  }

  /** First ball of every lane back at the top at the current pos, so all lanes restart in step. */
  _ballsToTop() {
    this.base = this.pos0;
    for (const l of this.lanes) {
      const [first] = this.ballsOf(l.id);
      if (first) first.phase = this.pos0 + startPhase(l);
      this._space(l.id);
    }
  }

  toggle(now) {
    if (this.running) this.stop(now);
    else this.start(now);
    return this.running;
  }

  setBpm(bpm, now) {
    this.pos0 = this.pos(now);
    this.anchor = now;
    this.bpm = clamp(Math.round(bpm), MIN_BPM, MAX_BPM);
    return this.bpm;
  }

  // ---------------------------------------------------------------- lanes + balls

  /** Lanes from buildLanes(). New lanes get one ball; vanished lanes lose theirs. */
  setLanes(lanes) {
    const ids = new Set(lanes.map((l) => l.id));
    const old = new Map(this.lanes.map((l) => [l.id, `${l.n}/${l.step}/${l.upperId}`]));
    for (const id of [...this.balls.keys()]) if (!ids.has(id)) this.balls.delete(id);
    for (const l of lanes) {
      const list = this.balls.get(l.id);
      if (!list) this.balls.set(l.id, [this._ball(this.base + startPhase(l))]);
      // cycle or row changed (note moved): back in step with the bar
      else if (old.has(l.id) && old.get(l.id) !== `${l.n}/${l.step}/${l.upperId}`) list[0].phase = this.base + startPhase(l);
    }
    this.lanes = lanes;
    for (const l of lanes) this._space(l.id);
  }

  lane(id) {
    return this.lanes.find((l) => l.id === id);
  }

  ballsOf(laneId) {
    return this.balls.get(laneId) || [];
  }

  _ball(phase) {
    return { id: this.nextBall++, phase };
  }

  /**
   * A lane's k balls spread evenly over its cycle, after the first ball:
   * a lane of quarter notes plays 8ths with 2 balls, triplets with 3, 16ths with 4.
   * Not snapped: 3 balls on a 4-16th cycle are off the 16th grid on purpose.
   */
  _space(laneId) {
    const list = this.ballsOf(laneId);
    const n = this.lane(laneId)?.n ?? 4;
    list.forEach((b, i) => (b.phase = list[0].phase + (i * n) / list.length));
  }

  /** Add a ball; the lane's balls are respaced evenly (see _space). */
  addBall(laneId) {
    const list = this.balls.get(laneId);
    if (!list || list.length >= this.o.maxBallsPerLane) return null;
    const ball = this._ball(list[0].phase);
    list.push(ball);
    this._space(laneId);
    return ball;
  }

  /** Remove the most recently added ball (a lane keeps at least one). */
  removeBall(laneId) {
    const list = this.balls.get(laneId);
    if (!list || list.length <= 1) return false;
    list.pop();
    this._space(laneId);
    return true;
  }

  /** One ball per lane, back at its start (see startPhase). */
  resetBalls() {
    for (const l of this.lanes) this.balls.set(l.id, [this._ball(this.base + startPhase(l))]);
  }

  // ---------------------------------------------------------------- instruments

  instrumentOf(noteId) {
    return this.instruments.get(noteId) ?? 'bell';
  }

  setInstrument(noteId, id) {
    this.instruments.set(noteId, id);
  }

  /**
   * Tracked notes changed. Instruments of notes that left are held for
   * MOVE_S s and go to a new note of the same colour (a moved note).
   */
  syncNotes(notes, now) {
    const ids = new Set(notes.map((n) => n.id));
    for (const [id, instrument] of this.instruments) {
      if (ids.has(id)) continue;
      this.instruments.delete(id);
      const color = this.noteColors.get(id);
      if (color) this.moved.push({ color, instrument, at: now });
    }
    for (const id of [...this.firstSeen.keys()]) if (!ids.has(id)) this.firstSeen.delete(id);
    for (const n of notes) if (!this.firstSeen.has(n.id)) this.firstSeen.set(n.id, now);
    this.moved = this.moved.filter((m) => now - m.at < MOVE_S);
    for (const n of notes) {
      if (this.instruments.has(n.id) || now - this.firstSeen.get(n.id) > MOVE_S) continue;
      const i = this.moved.findLastIndex((m) => m.color === n.color);
      if (i >= 0) this.instruments.set(n.id, this.moved.splice(i, 1)[0].instrument);
    }
    this.noteColors = new Map(notes.map((n) => [n.id, n.color]));
  }

  /** Toggle a note between loop (every hit) and once (first hit of each loop). */
  toggleOnce(noteId) {
    if (this.once.has(noteId)) this.once.delete(noteId);
    else this.once.add(noteId);
    return this.once.has(noteId);
  }

  // ---------------------------------------------------------------- mute / solo

  audible(color) {
    return this.solo ? color === this.solo : !this.mutes.has(color);
  }

  toggleMute(color) {
    if (this.mutes.has(color)) this.mutes.delete(color);
    else this.mutes.add(color);
    return this.mutes.has(color);
  }

  toggleSolo(color) {
    this.solo = this.solo === color ? null : color;
    return this.solo;
  }

  // ---------------------------------------------------------------- scheduler

  /**
   * Call every ~25 ms. Returns the hits that fall between the last call and
   * now + lookahead, each once, with its exact time:
   *   [{ time, pos, laneId, ballId, noteId, color, instrument, velocity, kept }]
   * Lane hits are recorded in the echo buffer; kept layers replay here too.
   */
  tick(now) {
    if (!this.running) return [];
    const from = Math.max(this.horizon, this.pos(now - this.o.grace));
    const to = this.pos(now + this.o.lookahead);
    if (to <= from) return [];
    const hits = [];
    for (const lane of this.lanes) {
      // bottom hit at the phase; a pair's upper note half a cycle later
      const strikes = [{ off: 0, noteId: lane.targetId, color: lane.color }];
      if (lane.upperId != null) strikes.push({ off: lane.n / 2, noteId: lane.upperId, color: lane.upperColor });
      for (const st of strikes) {
        if (!this.audible(st.color)) continue;
        const once = this.once.has(st.noteId);
        this.ballsOf(lane.id).forEach((ball, bi) => {
          if (once && bi > 0) return;
          const ph = ball.phase + st.off;
          for (let p = ph + Math.ceil((from - ph) / lane.n) * lane.n; p < to; p += lane.n) {
            if (p < from || !inWindow(lane, p) || (once && !onceHit(p, lane.n, this.loopSteps()))) continue;
            hits.push({
              time: this.timeAt(p),
              pos: p,
              laneId: lane.id,
              ballId: ball.id,
              noteId: st.noteId,
              color: st.color,
              instrument: this.instrumentOf(st.noteId),
              velocity: this.o.velocity,
              kept: false,
            });
          }
        });
      }
    }
    for (const h of hits) this.echo.push({ pos: h.pos, color: h.color, instrument: h.instrument, velocity: h.velocity, noteId: h.noteId });
    this.layers.forEach((layer, li) => {
      for (const ev of layer.events) {
        if (!this.audible(ev.color)) continue;
        for (let p = ev.step + Math.ceil((from - ev.step) / layer.L) * layer.L; p < to; p += layer.L) {
          if (p < from) continue;
          hits.push({ time: this.timeAt(p), pos: p, layer: li, noteId: ev.noteId, color: ev.color, instrument: ev.instrument, velocity: ev.velocity, kept: true });
        }
      }
    });
    this.horizon = to;
    const keepFrom = to - 2 * 16 * Math.max(this.o.echoBars, 1);
    if (this.echo.length && this.echo[0].pos < keepFrom) this.echo = this.echo.filter((e) => e.pos >= keepFrom);
    return hits.sort((a, b) => a.time - b.time);
  }

  // ---------------------------------------------------------------- echo + layers

  loopSteps() {
    return 16 * this.o.echoBars;
  }

  /** Snapshot the last echoBars bars into a layer. Returns it, or null if silent. */
  keep() {
    const L = this.loopSteps();
    const events = this.echo
      .filter((e) => e.pos > this.horizon - L && e.pos <= this.horizon)
      .map((e) => ({ step: (((e.pos % L) + L) % L), color: e.color, instrument: e.instrument, velocity: e.velocity, noteId: e.noteId }));
    if (!events.length) return null;
    const layer = { L, events };
    this.layers.push(layer);
    return layer;
  }

  undoKeep() {
    return this.layers.pop() ?? null;
  }

  clearLayers() {
    const n = this.layers.length;
    this.layers = [];
    return n;
  }

  /**
   * 'echo' message: one row per pitch present (highest first), hits on the
   * 1/16 grid of the loop. Live hits are from the last loop up to now.
   */
  echoView(now) {
    const L = this.loopSteps();
    const posNow = this.pos(now);
    const play = ((posNow % L) + L) % L;
    const grid = (p) => ((Math.round(p) % L) + L) % L;
    const byColor = new Map();
    const add = (color, hit) => {
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push(hit);
    };
    for (const layer of this.layers) for (const ev of layer.events) add(ev.color, { step: grid(ev.step), v: ev.velocity, kept: true });
    for (const e of this.echo) if (e.pos > posNow - L && e.pos <= posNow) add(e.color, { step: grid(e.pos), v: e.velocity, kept: false });
    const rows = [...NOTE_COLORS]
      .reverse()
      .filter((c) => byColor.has(c.name))
      .map((c) => ({ pitch: c.pitch, color: c.name, hits: byColor.get(c.name) }));
    return { bars: this.o.echoBars, playheadStep: Math.floor(play), rows };
  }
}
