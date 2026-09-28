// Draws what the projector shows. Shared by projector.html and by the simulated
// camera (which "projects" the same picture onto its fake wall).
//
// Scene coordinates are projector-normalized (0..1). Pixel sizes are given at a
// 1600x900 reference and scaled by min(w/1600, h/900). Black background;
// white is the only UI colour apart from note-coloured hit halos and echo ticks, and nothing
// but halos, rings and tags is drawn near the notes, so vision stays clean.

import { clockPos, ballY, ghostPos, ballShown, inWindow } from './beat.js';
import { rateLabel, laneLabel } from './lanes.js';
import { centroid } from './tracker.js';
import { rgbOf, pitchOf } from './colors.js';
import { KEY_HELP } from './keys.js';

// Calibration dot centres, numbered 1..4 clockwise from top-left.
export const CALIB_DOTS = [
  [0.05, 0.05],
  [0.95, 0.05],
  [0.95, 0.95],
  [0.05, 0.95],
];

export const BALL_R = 15; // ball radius, px at the reference size
// The ball turns round this far above the target. Projected light must never
// touch the paper: the ball mask would cut into the note, the note would be
// detected smaller, the lane longer, and the mask would follow it in.
export const BALL_GAP = 8;
export const HALO_MS = 250;
export const HALO_PAD = 14; // halo polygon inflation, px at the reference size
export const HALO_MASK = [8, 32]; // band around a haloed note blanked for vision, px
export const HIGHLIGHT_MASK = 8; // half-width of the band blanked along the highlight box, px
export const TOAST_MASK = [640, 100]; // top-right w x h blanked for vision (toasts), px
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

export function refScale(w, h) {
  return Math.min(w / 1600, h / 900);
}

/** Ball radius and turn-round gap as fractions of the projector height. */
export function ballRadiusN(w, h) {
  return (BALL_R * refScale(w, h)) / h;
}
export function ballGapN(w, h) {
  return (BALL_GAP * refScale(w, h)) / h;
}

const white = (a) => `rgba(255,255,255,${a})`;

/**
 * @param scene.calib     show white border + numbered corner dots
 * @param scene.cross     [x,y] test crosshair or null
 * @param scene.notes     [{ id, corners: [[x,y] x4], color }]
 * @param scene.outlines  draw faint note outlines
 * @param scene.beat      'beat' message (see channel.js) or null
 * @param scene.halos     [{ noteId, color, at }] hit halos (at = s, epoch clock)
 * @param scene.ring      'ring' message or null
 * @param scene.echo      'echo' message or null
 * @param scene.toast     { key, text, at } or null
 * @param scene.now       s, epoch clock (see beat.js epochNow)
 * @param scene.mode      'menu' | 'beat' | 'plinko' | a mini game id (missing = beat)
 * @param scene.menu      { index } selected menu tile
 * @param scene.plinko    Plinko.view() (see plinko.js)
 * @param scene.game      { id, ...view() } of the mini game on (see minigames.js)
 */
export function drawScene(ctx, w, h, scene) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const m = Math.min(w, h);

  if (scene.outlines && scene.notes) {
    ctx.strokeStyle = white(0.35);
    ctx.lineWidth = Math.max(1, m * 0.003);
    for (const n of scene.notes) {
      poly(ctx, n.corners.map(([x, y]) => [x * w, y * h]));
      ctx.stroke();
    }
  }

  if (scene.calib) {
    drawCalibration(ctx, w, h);
  } else if (scene.mode === 'menu') {
    drawMenu(ctx, w, h, scene);
  } else if (scene.mode === 'plinko') {
    if (scene.plinko) drawPlinko(ctx, w, h, scene);
  } else if (MINI_DRAW[scene.mode]) {
    if (scene.game?.id === scene.mode) drawMini(ctx, w, h, scene);
  } else if (scene.beat) {
    drawBeat(ctx, w, h, scene);
  }
  if (scene.mode && scene.mode !== 'beat' && scene.toast && scene.now - scene.toast.at < 1) drawToast(ctx, w, h, scene.toast);

  if (scene.cross) {
    const [cx, cy] = [scene.cross[0] * w, scene.cross[1] * h];
    const L = m * 0.05;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, m * 0.004);
    ctx.beginPath();
    ctx.moveTo(cx - L, cy);
    ctx.lineTo(cx + L, cy);
    ctx.moveTo(cx, cy - L);
    ctx.lineTo(cx, cy + L);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, L * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function poly(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawCalibration(ctx, w, h) {
  const m = Math.min(w, h);
  const bw = Math.max(6, m * 0.012);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = bw;
  ctx.strokeRect(bw / 2, bw / 2, w - bw, h - bw);

  const r = Math.max(6, m * 0.014);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(m * 0.06)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  CALIB_DOTS.forEach(([x, y], i) => {
    const px = x * w;
    const py = y * h;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    // number sits diagonally towards the centre so it never covers the dot
    const dx = x < 0.5 ? 1 : -1;
    const dy = y < 0.5 ? 1 : -1;
    ctx.fillText(String(i + 1), px + dx * m * 0.07, py + dy * m * 0.07);
  });
  ctx.font = `${Math.round(m * 0.025)}px sans-serif`;
  ctx.fillStyle = '#aaa';
  ctx.fillText('Calibrating: click dots 1-4 in the control window', w / 2, h / 2);
}

// ---------------------------------------------------------------- beat layers

function drawBeat(ctx, w, h, scene) {
  const b = scene.beat;
  const s = refScale(w, h);
  const now = scene.now;
  const pos = clockPos(b.clock, now);
  const notes = new Map((scene.notes || []).map((n) => [n.id, n]));
  const px = (p) => [p[0] * w, p[1] * h];
  const rN = ballRadiusN(w, h);
  const gN = ballGapN(w, h);
  const lanes = b.lanes || [];

  // ruler: the wall is one bar, a line every 1/8; a note on line k plays k/8 into the bar
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let k = 1; k <= 8; k++) {
    const yN = (k * (b.barH ?? 1)) / 8;
    if (yN > 1) break;
    const y = Math.min(h - 1, Math.round(yN * h)) + 0.5; // 1 bar = bottom edge
    const major = k % 2 === 0;
    ctx.fillStyle = white(major ? 0.09 : 0.04);
    ctx.fillRect(0, y - 0.5, w, 1);
    ctx.fillStyle = white(major ? 0.6 : 0.35);
    ctx.font = `${Math.round((major ? 15 : 12) * s)}px ${MONO}`;
    ctx.fillText(rateLabel(2 * k), 10 * s, y - 10 * s);
  }

  // lane bands + dashed centre lines, rate label at the top of each
  for (const lane of lanes) {
    const hi = lane.id === b.highlight;
    const x = lane.x * w;
    const lw = lane.w * w;
    const y0 = lane.ceil * h + (lane.upperId != null ? 6 * s : 0);
    const y1 = lane.top * h;
    if (y1 > y0) {
      ctx.fillStyle = white(hi ? 0.07 : 0.03);
      ctx.fillRect(x - lw / 2, y0, lw, y1 - y0);
      ctx.strokeStyle = white(0.22);
      ctx.lineWidth = Math.max(1, s);
      ctx.setLineDash([2 * s, 12 * s]);
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const count = lane.balls?.length || 0;
    ctx.fillStyle = white(0.85);
    ctx.font = `${Math.round(15 * s)}px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${laneLabel(lane, b.snap)}${count > 1 ? ` ×${count}` : ''}`, x + lw / 2 + 10 * s, y0 + 12 * s);
  }

  // highlight box around the selected note (either note of a pair)
  const hiNote = notes.get(b.focus ?? b.highlight);
  if (hiNote) {
    const { cx, cy, side } = highlightBox(hiNote.corners.map(px), s);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, 2.5 * s);
    roundRect(ctx, cx - side / 2, cy - side / 2, side, side, 18 * s);
    ctx.stroke();
  }

  // tags on every note that plays: "C4 · KICK", above a pair's upper note
  // (its ball comes from below), else below
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(15 * s)}px ${MONO}`;
  const uppers = new Set(lanes.map((l) => l.upperId));
  for (const note of notes.values()) {
    const pts = note.corners.map(px);
    const [cx] = centroid(pts);
    const ys = pts.map((p) => p[1]);
    const tagY = uppers.has(note.id) ? Math.min(...ys) - 22 * s : Math.max(...ys) + 22 * s;
    const muted = b.solo ? note.color !== b.solo : (b.mutes || []).includes(note.color);
    ctx.fillStyle = white(muted ? 0.35 : 0.8);
    const tag = `${pitchOf(note.color) ?? '?'} · ${(b.instruments?.[note.id] || 'bell').toUpperCase()}${(b.once || []).includes(note.id) ? ' · ONCE' : ''}${muted ? ' · MUTE' : ''}`;
    ctx.fillText(tag, cx, tagY);
  }

  // ghosts of kept layers whose notes are gone: dashed outlines that flash
  // white on each replayed hit (no colour, so vision never sees a note), and
  // dim balls replaying the kept loop
  for (const g of b.ghosts || []) {
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.setLineDash([6 * s, 6 * s]);
    for (const n of g.notes) {
      if (notes.has(n.id)) continue;
      const halo = (scene.halos || []).find((hl) => hl.noteId === n.id && now >= hl.at && now - hl.at < HALO_MS / 1000);
      ctx.strokeStyle = white(halo ? 0.9 - (0.6 * (now - halo.at) * 1000) / HALO_MS : 0.3);
      poly(ctx, n.corners.map(px));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = white(0.35);
    for (const lane of g.lanes) {
      if (notes.has(lane.targetId)) continue;
      for (const ball of lane.balls) {
        ctx.beginPath();
        ctx.arc(lane.x * w, ballY(lane, ball.phase, ghostPos(g, pos), rN, gN) * h, BALL_R * s * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // balls (+ a short trail on the side they came from)
  const trailDt = 0.035 * (b.clock.bpm / 15); // 35 ms in 16ths
  const once = new Set(b.once || []);
  for (const lane of lanes) {
    const x = lane.x * w;
    for (const [bi, ball] of (lane.balls || []).entries()) {
      if (b.clock.running && !ballShown(lane, bi, ball.phase, pos, once, 16 * (b.echoBars || 4))) continue;
      if (b.clock.running) {
        [12, 9, 6].forEach((r, i) => {
          ctx.fillStyle = white([0.35, 0.18, 0.08][i]);
          ctx.beginPath();
          ctx.arc(x, ballY(lane, ball.phase, pos - trailDt * (i + 1), rN, gN) * h, r * s, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      // a pair's ball bounces silently (dim) until its row, then plays to the end of the bar
      const live = !b.clock.running || inWindow(lane, pos);
      ctx.save();
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = live ? 24 * s : 0;
      ctx.fillStyle = white(live ? 1 : 0.35);
      ctx.beginPath();
      ctx.arc(x, ballY(lane, ball.phase, pos, rN, gN) * h, BALL_R * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawHalos(ctx, w, h, scene, notes);

  if (scene.ring?.open) drawRing(ctx, w, h, scene.ring, notes.get(scene.ring.noteId), now);
  if (scene.echo) drawEcho(ctx, w, h, scene.echo, b, pos);
  if (scene.toast && now - scene.toast.at < 1) drawToast(ctx, w, h, scene.toast);
  if (b.overlay) drawHelp(ctx, w, h);
}

function drawHalos(ctx, w, h, scene, notes) {
  const s = refScale(w, h);
  const now = scene.now;
  const px = (p) => [p[0] * w, p[1] * h];
  for (const halo of scene.halos || []) {
    const age = (now - halo.at) * 1000;
    const note = notes.get(halo.noteId);
    if (!note || age < 0 || age > HALO_MS) continue;
    const pts = inflate(note.corners.map(px), HALO_PAD * s);
    const [r, g, bl] = rgbOf(halo.color);
    ctx.save();
    ctx.globalAlpha = 1 - age / HALO_MS;
    ctx.strokeStyle = `rgb(${r},${g},${bl})`;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 60 * s;
    ctx.lineWidth = 4 * s;
    ctx.lineJoin = 'round';
    poly(ctx, pts);
    ctx.stroke();
    ctx.restore();
  }
}

/** Square highlight box around a note (px corners): centre and side, px. */
export function highlightBox(pts, s) {
  const [cx, cy] = centroid(pts);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const side = Math.max(58 * s, Math.max(...xs) - Math.min(...xs) + 12 * s, Math.max(...ys) - Math.min(...ys) + 12 * s);
  return { cx, cy, side };
}

/** Polygon grown outwards by `d` px (corners pushed along their bisector). */
export function inflate(pts, d) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1];
  if (area < 0) d = -d; // anticlockwise on screen: the normals below point inwards
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n];
    const c = pts[(i + 1) % n];
    const u1 = unit([p[0] - a[0], p[1] - a[1]]);
    const u2 = unit([c[0] - p[0], c[1] - p[1]]);
    // outward normals of both edges (clockwise on screen, y down)
    const n1 = [u1[1], -u1[0]];
    const n2 = [u2[1], -u2[0]];
    const bis = unit([n1[0] + n2[0], n1[1] + n2[1]]);
    const cos = Math.max(0.3, bis[0] * n1[0] + bis[1] * n1[1]);
    return [p[0] + (bis[0] * d) / cos, p[1] + (bis[1] * d) / cos];
  });
}

function unit([x, y]) {
  const L = Math.hypot(x, y) || 1;
  return [x / L, y / L];
}

// ---------------------------------------------------------------- instrument ring

function drawRing(ctx, w, h, ring, note, now) {
  if (!note) return;
  const s = refScale(w, h);
  const [cx, cy] = centroid(note.corners.map((p) => [p[0] * w, p[1] * h]));
  const N = ring.choices.length;
  const R = 135 * s;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(15 * s)}px ${MONO}`;
  ring.choices.forEach((name, i) => {
    let d = (((i - ring.index) % N) + N) % N;
    const a = -Math.PI / 2 + (d * 2 * Math.PI) / N;
    d = Math.min(d, N - d);
    const x = cx + R * Math.cos(a);
    const y = cy + R * Math.sin(a);
    const label = name.toUpperCase();
    if (d === 0) {
      const tw = ctx.measureText(label).width + 24 * s;
      ctx.fillStyle = '#fff';
      roundRect(ctx, x - tw / 2, y - 15 * s, tw, 30 * s, 15 * s);
      ctx.fill();
      ctx.fillStyle = '#000';
    } else {
      ctx.fillStyle = white([1, 0.75, 0.5, 0.3][Math.min(3, d)]);
    }
    ctx.fillText(label, x, y);
  });
  // countdown to the automatic commit
  const left = Math.max(0, Math.min(1, (ring.deadline - now) / (ring.timeout || 4)));
  ctx.lineWidth = Math.max(1.5, 3 * s);
  ctx.strokeStyle = white(0.2);
  ctx.beginPath();
  ctx.arc(cx, cy, 96 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = white(0.8);
  ctx.beginPath();
  ctx.arc(cx, cy, 96 * s, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = white(0.55);
  ctx.font = `${Math.round(13 * s)}px ${MONO}`;
  ctx.fillText('← → spin · ↵ or click to keep', cx, cy + R + 36 * s);
  ctx.restore();
}

// ---------------------------------------------------------------- echo strip

/** Weight of the grid line at a 16th step: 3 bar, 2 quarter, 1 eighth, 0 sixteenth. */
export function gridLevel(step) {
  return step % 16 === 0 ? 3 : step % 4 === 0 ? 2 : step % 2 === 0 ? 1 : 0;
}

/** Height of the echo strip from the bottom edge (label to beat numbers), px at the reference size. */
export function echoBandH(rows) {
  return 28 + 10 * Math.max(1, rows) + 30;
}

function drawEcho(ctx, w, h, echo, beat, pos) {
  const s = refScale(w, h);
  const x0 = 190 * s;
  const x1 = w - 190 * s;
  const steps = echo.bars * 16;
  const rows = echo.rows || [];
  const rowH = 6 * s;
  const gap = 4 * s;
  const bottom = h - 28 * s;
  const top = bottom - Math.max(1, rows.length) * (rowH + gap);
  const play = ((pos % steps) + steps) % steps;
  const xOf = (step) => x0 + (step / steps) * (x1 - x0);

  ctx.save();
  ctx.font = `${Math.round(12 * s)}px ${MONO}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = white(0.55);
  ctx.textAlign = 'left';
  ctx.fillText(`ECHO · LAST ${echo.bars} BARS`, x0, top - 10 * s);
  ctx.textAlign = 'right';
  ctx.fillText(`${beat.bpm} BPM · BAR ${Math.floor(play / 16) + 1}/${echo.bars}`, x1, top - 10 * s);
  // grid like a score: bar lines strongest, then quarters, 8ths, 16ths;
  // beat numbers 1-4 under each bar
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let st = 0; st <= steps; st++) {
    const g = gridLevel(st);
    const ext = [0, 0, 2, 6][g] * s;
    ctx.fillStyle = white([0.05, 0.1, 0.2, 0.45][g]);
    ctx.fillRect(Math.round(xOf(st)), top - ext, g === 3 ? 2 : 1, bottom - top + 2 * ext);
    if (g >= 2 && st < steps) {
      ctx.fillStyle = white(g === 3 ? 0.7 : 0.4);
      ctx.fillText(String(((st / 4) % 4) + 1), xOf(st), bottom + 8 * s);
    }
  }
  ctx.textBaseline = 'alphabetic';
  rows.forEach((row, r) => {
    const y = top + r * (rowH + gap);
    const [cr, cg, cb] = rgbOf(row.color);
    for (const hit of row.hits) {
      const ahead = !hit.kept && hit.step > play;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${hit.kept ? 0.95 : ahead ? 0.18 : 0.45})`;
      roundRect(ctx, xOf(hit.step) - 5 * s, y, 10 * s, rowH, 2 * s);
      ctx.fill();
    }
  });
  ctx.fillStyle = '#fff';
  ctx.fillRect(xOf(play) - 1.5 * s, top - 4 * s, 3 * s, bottom - top + 8 * s);
  ctx.restore();
}

// ---------------------------------------------------------------- toast + help

function drawToast(ctx, w, h, toast) {
  const s = refScale(w, h);
  ctx.save();
  ctx.font = `${Math.round(15 * s)}px ${MONO}`;
  ctx.textBaseline = 'middle';
  const capW = ctx.measureText(toast.key).width + 16 * s;
  const textW = ctx.measureText(toast.text).width;
  const bw = capW + textW + 40 * s;
  const bh = 44 * s;
  const x = w - 24 * s - bw;
  const y = 24 * s;
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2 * s;
  roundRect(ctx, x, y, bw, bh, 10 * s);
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, x + 12 * s, y + 9 * s, capW, bh - 18 * s, 5 * s);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(toast.key, x + 12 * s + capW / 2, y + bh / 2);
  ctx.textAlign = 'left';
  ctx.fillText(toast.text, x + capW + 28 * s, y + bh / 2);
  ctx.restore();
}

function drawHelp(ctx, w, h) {
  const s = refScale(w, h);
  const lineH = 30 * s;
  const bw = 620 * s;
  const bh = (KEY_HELP.length + 2) * lineH;
  const x = (w - bw) / 2;
  const y = (h - bh) / 2;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2 * s;
  roundRect(ctx, x, y, bw, bh, 16 * s);
  ctx.fill();
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `${Math.round(15 * s)}px ${MONO}`;
  ctx.fillStyle = white(0.6);
  ctx.fillText('KEYS · ? TO CLOSE', x + 28 * s, y + lineH);
  KEY_HELP.forEach(([k, what], i) => {
    const ly = y + (i + 2) * lineH;
    ctx.fillStyle = '#fff';
    ctx.fillText(k, x + 28 * s, ly);
    ctx.fillStyle = white(0.7);
    ctx.fillText(what, x + 230 * s, ly);
  });
  ctx.restore();
}

// ---------------------------------------------------------------- game menu
// Wii-style channel grid. Empty tiles are slots for future games.

export const GAMES = [
  { id: 'beat', name: 'BEAT WALL', blurb: 'sticky notes make music' },
  { id: 'plinko', name: 'PLINKO', blurb: 'notes are power-ups · beat your best' },
  { id: 'laser', name: 'LASER', blurb: 'squares mirror · strips tint', keys: '← → or click aim · Tab level · R restart' },
];
const MENU_COLS = 4;
const MENU_ROWS = 3;

/** Menu tile rects, projector-normalized [{ x, y, w, h }], row by row. */
export function menuTiles(w, h) {
  const s = refScale(w, h);
  const pad = 28 * s;
  const gx = 110 * s;
  const top = 90 * s;
  const bottom = h - 170 * s;
  const tw = (w - 2 * gx - (MENU_COLS - 1) * pad) / MENU_COLS;
  const th = (bottom - top - (MENU_ROWS - 1) * pad) / MENU_ROWS;
  const out = [];
  for (let r = 0; r < MENU_ROWS; r++) {
    for (let c = 0; c < MENU_COLS; c++) out.push({ x: (gx + c * (tw + pad)) / w, y: (top + r * (th + pad)) / h, w: tw / w, h: th / h });
  }
  return out;
}

function drawMenu(ctx, w, h, scene) {
  const s = refScale(w, h);
  const sel = scene.menu?.index ?? 0;
  const pulse = 0.5 + 0.5 * Math.sin(scene.now * 4);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  menuTiles(w, h).forEach((t, i) => {
    const game = GAMES[i];
    const on = i === sel && game;
    const grow = on ? 8 * s : 0;
    const [x, y, tw, th] = [t.x * w - grow, t.y * h - grow, t.w * w + 2 * grow, t.h * h + 2 * grow];
    ctx.save();
    if (on) {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = (18 + 14 * pulse) * s;
    }
    ctx.fillStyle = white(game ? 0.07 : 0.025);
    ctx.strokeStyle = white(on ? 1 : game ? 0.45 : 0.12);
    ctx.lineWidth = (on ? 4 : 2) * s;
    roundRect(ctx, x, y, tw, th, 22 * s);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (!game) return;
    drawGameIcon(ctx, game.id, x + tw / 2, y + th * 0.4, Math.min(tw, th) * 0.28, scene.now);
    ctx.fillStyle = white(on ? 1 : 0.75);
    ctx.font = `bold ${Math.round(20 * s)}px ${MONO}`;
    ctx.fillText(game.name, x + tw / 2, y + th * 0.78);
    ctx.fillStyle = white(0.5);
    ctx.font = `${Math.round(12 * s)}px ${MONO}`;
    const best = scene.menu?.best?.[game.id];
    ctx.fillText(best ? `${game.blurb} · BEST ${best}` : game.blurb, x + tw / 2, y + th * 0.9);
  });
  // bottom bar: big clock like the Wii, hint underneath
  const d = new Date(scene.now * 1000);
  ctx.fillStyle = white(0.9);
  ctx.font = `${Math.round(54 * s)}px ${MONO}`;
  ctx.fillText(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), w / 2, h - 100 * s);
  ctx.fillStyle = white(0.5);
  ctx.font = `${Math.round(15 * s)}px ${MONO}`;
  ctx.fillText(`${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}  ·  ← → choose  ·  ↵ or click to play  ·  M back here`, w / 2, h - 50 * s);
  ctx.restore();
}

function drawGameIcon(ctx, id, cx, cy, R, now) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = white(0.8);
  ctx.lineWidth = Math.max(1, R * 0.04);
  if (id === 'beat') {
    // a note square with a ball bouncing on it
    const bounce = Math.abs(Math.sin(now * 3));
    ctx.strokeRect(cx - R * 0.35, cy + R * 0.35, R * 0.7, R * 0.5);
    ctx.beginPath();
    ctx.arc(cx, cy + R * 0.2 - bounce * R * 0.9, R * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'plinko') {
    // peg triangle with a ball zig-zagging down
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c <= r; c++) {
        ctx.beginPath();
        ctx.arc(cx + (c - r / 2) * R * 0.45, cy - R * 0.6 + r * R * 0.4, R * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const t = (now * 0.6) % 1;
    ctx.beginPath();
    ctx.arc(cx + Math.sin(t * Math.PI * 4) * R * 0.2, cy - R * 0.9 + t * R * 1.8, R * 0.12, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'laser') {
    // beam bouncing off a mirror into a target
    ctx.beginPath();
    ctx.moveTo(cx - R, cy + R * 0.3);
    ctx.lineTo(cx, cy - R * 0.5);
    ctx.lineTo(cx + R, cy + R * 0.3);
    ctx.stroke();
    ctx.fillRect(cx - R * 0.15, cy - R * 0.72, R * 0.3, R * 0.12);
    ctx.beginPath();
    ctx.arc(cx + R * 0.9, cy + R * 0.3, R * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- plinko

// The no-notes line, and an animation around each note showing its power.
// Everything stays outside the paper (light on a note changes its colour to
// the camera) and white (coloured light is a note to the camera).
function drawPowers(ctx, w, h, scene, p) {
  const s = refScale(w, h);
  const t = scene.now;
  const lineY = p.noteLine * h;
  ctx.save();
  ctx.strokeStyle = white(0.35);
  ctx.lineWidth = 2 * s;
  ctx.setLineDash([10 * s, 8 * s]);
  ctx.beginPath();
  ctx.moveTo(0, lineY);
  ctx.lineTo(w, lineY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = white(0.45);
  ctx.font = `${Math.round(12 * s)}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('no notes below this line', w - 16 * s, lineY - 6 * s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const n of scene.notes || []) {
    const pts = n.corners.map(([x, y]) => [x * w, y * h]);
    const [cx, cy] = centroid(pts);
    const out = Math.max(...pts.map(([x, y]) => Math.hypot(x - cx, y - cy))) + 16 * s; // ring just off the paper
    const bx = cx;
    const by = cy - out - 16 * s; // badge above the note
    ctx.strokeStyle = white(0.8);
    ctx.fillStyle = white(0.8);
    ctx.lineWidth = 2 * s;
    if (n.corners.some(([, y]) => y > p.noteLine)) {
      // ignored: dashed outline and a hint
      ctx.setLineDash([6 * s, 6 * s]);
      poly(ctx, inflate(pts, HALO_PAD * s));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'left';
      ctx.fillText('✕ move above the line', cx + out, cy);
      ctx.textAlign = 'center';
      continue;
    }
    switch (n.color) {
      case 'blue': // portal: three arms swirling in towards the note
        for (let k = 0; k < 3; k++) {
          const a0 = t * 2.5 + (k * Math.PI * 2) / 3;
          ctx.beginPath();
          for (let u = 0; u <= 1.001; u += 0.1) {
            const a = a0 + u * 2;
            const r = out + (1 - u) * 26 * s;
            ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
          }
          ctx.stroke();
        }
        break;
      case 'yellow': // star badge, twinkling sparkles on the ring
        star(ctx, bx, by, 12 * s * (1 + 0.15 * Math.sin(t * 5)), t * 0.8);
        ctx.fill();
        for (let k = 0; k < 4; k++) {
          const a = t * 0.7 + (k * Math.PI) / 2;
          const tw = 0.5 + 0.5 * Math.sin(t * 6 + k * 2);
          star(ctx, cx + out * Math.cos(a), cy + out * Math.sin(a), 5 * s * tw, 0);
          ctx.fill();
        }
        break;
      case 'green': { // split: one stem into three branches, dots racing up them
        const L = 14 * s;
        ctx.beginPath();
        ctx.moveTo(bx, by + L);
        ctx.lineTo(bx, by);
        for (const dx of [-1, 0, 1]) {
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + dx * L, by - L);
        }
        ctx.stroke();
        const u = (t * 1.2) % 1;
        for (const dx of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.arc(bx + dx * L * u, by - L * u, 2.5 * s, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'red': // boost: chevrons shooting outwards off all four sides
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          const u = (t * 1.5 + k * 0.25) % 1;
          const r = out + u * 22 * s;
          const [ux, uy] = [Math.cos(a), Math.sin(a)];
          const [x, y] = [cx + ux * r, cy + uy * r];
          const c = 7 * s;
          ctx.strokeStyle = white(0.9 * (1 - u));
          ctx.beginPath();
          ctx.moveTo(x - ux * c - uy * c, y - uy * c + ux * c);
          ctx.lineTo(x, y);
          ctx.lineTo(x - ux * c + uy * c, y - uy * c - ux * c);
          ctx.stroke();
        }
        break;
      case 'purple': // magnet: field rings closing in on the note
        for (let k = 0; k < 3; k++) {
          const u = (t * 0.6 + k / 3) % 1;
          ctx.strokeStyle = white(0.6 * u);
          ctx.beginPath();
          ctx.arc(cx, cy, out + (1 - u) * 70 * s, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case 'orange': { // sticky: goo dripping off the bottom, a hold timer badge
        const bottom = Math.max(...pts.map(([, y]) => y)) + 10 * s;
        for (let k = 0; k < 3; k++) {
          const u = (t * 0.7 + k / 3) % 1;
          ctx.fillStyle = white(0.8 * (1 - u));
          ctx.beginPath();
          ctx.arc(cx + (k - 1) * out * 0.45, bottom + u * 30 * s, 3.5 * s * (1 - 0.4 * u), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(bx, by, 10 * s, 0, Math.PI * 2);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 7 * s * Math.cos(t * 3), by + 7 * s * Math.sin(t * 3));
        ctx.stroke();
        break;
      }
      default:
    }
  }
  ctx.restore();
}

/** Five-point star path centred on (x, y), outer radius R, turned by `a`. */
function star(ctx, x, y, R, a) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const b = -Math.PI / 2 + (k * Math.PI) / 5 + a;
    const r = k % 2 ? R * 0.45 : R;
    ctx.lineTo(x + r * Math.cos(b), y + r * Math.sin(b));
  }
  ctx.closePath();
}

function drawPlinko(ctx, w, h, scene) {
  const p = scene.plinko;
  const s = refScale(w, h);
  const br = p.r * h;
  ctx.save();

  // aim: dropper arrow, ghost ball and a faint guide down to the first pegs
  const ax = p.aim * w;
  ctx.strokeStyle = white(0.15);
  ctx.lineWidth = Math.max(1, s);
  ctx.setLineDash([3 * s, 9 * s]);
  ctx.beginPath();
  ctx.moveTo(ax, 0.06 * h + br);
  ctx.lineTo(ax, 0.18 * h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = white(0.7);
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(ax, 0.06 * h, br, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(ax - 10 * s, 0.06 * h - br - 16 * s);
  ctx.lineTo(ax + 10 * s, 0.06 * h - br - 16 * s);
  ctx.lineTo(ax, 0.06 * h - br - 4 * s);
  ctx.fill();

  // pegs, glowing when hit
  for (const [x, y, lit] of p.pegs) {
    ctx.save();
    if (lit > 0) {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 20 * s * lit;
    }
    ctx.fillStyle = white(0.4 + 0.6 * lit);
    ctx.beginPath();
    ctx.arc(x * w, y * h, (0.007 * h) * (1 + 0.5 * lit), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // slots: dividers, floor, values; a slot flashes when a ball lands in it
  const n = p.slots.length;
  const sw = w / n;
  const flash = new Array(n).fill(0);
  for (const pop of p.popups) if (pop.slot != null) flash[pop.slot] = Math.max(flash[pop.slot], 1 - pop.age / 0.6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pulse = 0.5 + 0.5 * Math.sin(scene.now * 6);
  const target = p.puzzle ? p.puzzle.slot : p.bonus;
  const midY = ((p.slotTop + p.floor) / 2) * h;
  for (let i = 0; i < n; i++) {
    const sh = (p.floor - p.slotTop) * h;
    // bonus / puzzle target pulses; the bar drains until the bonus moves. White
    // only: a coloured block of light is a sticky note to the camera.
    if (i === target) {
      ctx.fillStyle = white(0.1 + 0.12 * pulse);
      ctx.fillRect(i * sw, p.slotTop * h, sw, sh);
      ctx.fillStyle = '#fff';
      if (i === p.bonus) ctx.fillRect(i * sw, p.slotTop * h, sw * p.bonusLeft, 4 * s);
    }
    if (flash[i] > 0) {
      ctx.fillStyle = white(0.18 * flash[i]);
      ctx.fillRect(i * sw, p.slotTop * h, sw, sh);
    }
    const big = p.slots[i] >= 25;
    let label = p.puzzle ? '' : String(p.slots[i]);
    if (i === p.bonus) label = `★ ${p.slots[i]}×${p.bonusX}`;
    if (i === p.skull) label = `☠ ${p.skullValue}`;
    if (p.puzzle && i === target) label = '★ GOAL';
    const hot = i === target || i === p.skull;
    ctx.fillStyle = hot ? '#fff' : white(big ? 0.9 : 0.5); // coloured text reads as a note to the camera
    ctx.font = `${big || hot ? 'bold ' : ''}${Math.round((big || hot ? 22 : 17) * s)}px ${MONO}`;
    ctx.fillText(label, (i + 0.5) * sw, midY);
  }
  ctx.strokeStyle = white(0.5);
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    ctx.moveTo(i * sw, p.slotTop * h);
    ctx.lineTo(i * sw, p.floor * h);
  }
  ctx.moveTo(0, p.floor * h);
  ctx.lineTo(w, p.floor * h);
  ctx.stroke();

  drawHalos(ctx, w, h, scene, new Map((scene.notes || []).map((nt) => [nt.id, nt])));
  drawPowers(ctx, w, h, scene, p);

  // drifting star: touch it for points (white, so the camera never takes it for a note)
  if (p.star) {
    const R = p.star.r * h;
    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = (14 + 10 * pulse) * s;
    ctx.fillStyle = '#fff';
    star(ctx, p.star.x * w, p.star.y * h, R, scene.now);
    ctx.fill();
    ctx.restore();
  }

  // balls with a fading trail
  for (const b of p.balls) {
    const tr = b.trail.slice(-8);
    tr.forEach(([x, y], i) => {
      ctx.fillStyle = white((0.25 * b.a * (i + 1)) / tr.length);
      ctx.beginPath();
      ctx.arc(x * w, y * h, br * (0.4 + (0.5 * (i + 1)) / tr.length), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 24 * s;
    // gold once a yellow note doubled it; an orange-held ball shows its countdown ring
    ctx.fillStyle = b.mult > 1 ? `rgba(255,216,74,${b.a})` : white(b.a);
    ctx.beginPath();
    ctx.arc(b.x * w, b.y * h, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (b.stuck > 0) {
      ctx.strokeStyle = '#ffa040';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(b.x * w, b.y * h, br + 5 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.stuck);
      ctx.stroke();
    }
    if (b.mult > 1) {
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.round(br * 1.1)}px ${MONO}`;
      ctx.fillText(`${b.mult}`, b.x * w, b.y * h);
    }
  }

  // "+25" popups rising out of the slot
  for (const pop of p.popups) {
    ctx.fillStyle = white(Math.max(0, 1 - pop.age / 1.2));
    ctx.font = `bold ${Math.round((26 + 10 * Math.min(1, pop.age * 4)) * s)}px ${MONO}`;
    ctx.fillText(pop.text, pop.x * w, (pop.y - pop.age * 0.06) * h);
  }

  // HUD: score top-left, controls top-centre (top-right is the toast)
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = white(0.55);
  ctx.font = `${Math.round(13 * s)}px ${MONO}`;
  ctx.fillText(p.puzzle ? 'PLINKO · PUZZLE' : 'PLINKO · SCORE', 24 * s, 20 * s);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(40 * s)}px ${MONO}`;
  ctx.fillText(p.puzzle ? `${p.puzzle.n}/${p.puzzle.of}` : String(p.score), 24 * s, 38 * s);
  ctx.fillStyle = white(0.55);
  ctx.font = `${Math.round(13 * s)}px ${MONO}`;
  if (p.puzzle) {
    const z = p.puzzle;
    ctx.fillText(`PUZZLE ${z.n}/${z.of} · NOTES ${z.notes}/${z.max} · ${z.hint}`, 24 * s, 84 * s);
  } else {
    ctx.fillText(`BALLS LEFT ${p.left} · BEST ${p.best}`, 24 * s, 84 * s);
  }
  ctx.fillStyle = white(0.4);
  ctx.fillText(p.puzzle ? 'SPACE drop · Tab next level · R restart · S score mode · M menu' : '← → aim · SPACE drop · R new round · S puzzles · M menu', 24 * s, 104 * s);
  ctx.fillText('red boost · blue warp · green split · yellow ×2 · purple magnet · orange sticky', 24 * s, 124 * s);

  // round over / solved banner, text only up by the dropper
  const banner = p.over ? [`ROUND OVER · ${p.score}`, p.score >= p.best && p.score > 0 ? 'NEW BEST!' : `BEST ${p.best} · SPACE or R to play again`] : p.puzzle?.solved ? ['SOLVED!', 'next level…'] : null;
  if (banner) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(56 * s)}px ${MONO}`;
    ctx.fillText(banner[0], w / 2, 0.12 * h);
    ctx.fillStyle = white(0.8);
    ctx.font = `${Math.round(18 * s)}px ${MONO}`;
    ctx.fillText(banner[1], w / 2, 0.12 * h + 44 * s);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- mini games
// Views come in world units (y 0..1 of the height, x 0..aspect), so the game is
// drawn under ctx.scale(h, h); `u` is one reference px in world units. White only, and every note is
// blacked out afterwards so no light lands on the paper.

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

const MINI_DRAW = {
  // Coloured light reads as a note to the camera: beam, locks and target rings
  // are white with a thin coloured core, and masked for vision (Laser.mask).
  laser(ctx, v, u) {
    const rgb = (c) => `rgb(${rgbOf(c).join(',')})`;
    const line = ([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.strokeStyle = white(0.2);
    ctx.lineWidth = 2 * u;
    line([[0, v.top], [v.A, v.top]]);
    ctx.setLineDash([6 * u, 6 * u]);
    ctx.strokeStyle = white(0.25);
    for (const [x0, y0, x1, y1] of v.zones) ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = white(0.8);
    for (const pts of v.off) {
      poly(ctx, inflate(pts, HALO_PAD * u));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = white(0.7);
    ctx.lineWidth = 6 * u;
    for (const w of v.walls) line([w.a, w.b]);
    for (const l of v.locks) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 7 * u;
      line([l.a, l.b]);
      ctx.strokeStyle = rgb(l.color);
      ctx.lineWidth = 3 * u;
      line([l.a, l.b]);
    }
    for (const t of v.targets) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * u;
      circle(ctx, t.x, t.y, t.r);
      ctx.stroke();
      ctx.strokeStyle = rgb(t.color);
      circle(ctx, t.x, t.y, t.r * 0.7);
      ctx.stroke();
      if (t.lit) {
        ctx.fillStyle = '#fff';
        circle(ctx, t.x, t.y, t.r * 0.45);
        ctx.fill();
      }
    }
    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 6 * u * ctx.getTransform().d; // device px (not scaled by the transform): keep it inside the beam mask at any size
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4 * u;
    for (const s of v.beams) line(s.pts);
    ctx.restore();
    ctx.lineWidth = 1.5 * u;
    for (const s of v.beams) {
      if (s.color === 'white') continue;
      ctx.strokeStyle = rgb(s.color);
      line(s.pts);
    }
    ctx.fillStyle = '#fff';
    for (const e of v.emitters) {
      ctx.save();
      ctx.translate(...e.p);
      ctx.rotate(e.ang);
      ctx.fillRect(-14 * u, -8 * u, 24 * u, 16 * u);
      ctx.restore();
    }
  },
};

function drawMini(ctx, w, h, scene) {
  const v = scene.game;
  const s = refScale(w, h);
  const game = GAMES.find((g) => g.id === v.id);
  ctx.save();
  ctx.scale(h, h);
  MINI_DRAW[v.id](ctx, v, s / h);
  ctx.restore();

  // no light on the paper: black out each note and a margin round it
  ctx.fillStyle = '#000';
  for (const n of scene.notes || []) {
    poly(ctx, inflate(n.corners.map(([x, y]) => [x * w, y * h]), BALL_GAP * s));
    ctx.fill();
  }
  drawHalos(ctx, w, h, scene, new Map((scene.notes || []).map((n) => [n.id, n])));

  // HUD like Plinko: name, big score, info, keys (top-right is the toast)
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = white(0.55);
  ctx.font = `${Math.round(13 * s)}px ${MONO}`;
  ctx.fillText(game.name, 24 * s, 20 * s);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(40 * s)}px ${MONO}`;
  ctx.fillText(String(v.score), 24 * s, 38 * s);
  ctx.fillStyle = white(0.55);
  ctx.font = `${Math.round(13 * s)}px ${MONO}`;
  ctx.fillText(v.info ?? `BEST ${v.best}`, 24 * s, 84 * s);
  ctx.fillStyle = white(0.4);
  ctx.fillText(`${game.keys} · M menu`, 24 * s, 104 * s);
  const banner = v.banner ?? (v.over ? [`GAME OVER · ${v.score}`, v.score >= v.best && v.score > 0 ? 'NEW BEST!' : 'SPACE or R to play again'] : null);
  if (banner) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(56 * s)}px ${MONO}`;
    ctx.fillText(banner[0], w / 2, 0.3 * h);
    ctx.fillStyle = white(0.8);
    ctx.font = `${Math.round(18 * s)}px ${MONO}`;
    ctx.fillText(banner[1], w / 2, 0.3 * h + 44 * s);
  }
  ctx.restore();
}
