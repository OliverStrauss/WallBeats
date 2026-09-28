# Wall-Beats
An AR based beat maker i thought of on a random thrusday. Uses computer vision to find sticky notes on my wall and make noises accordingly.
As a warning i have 0 musical background or prowess, so the interface makes sense to me sorry.
Watch the working demo here: (https://www.youtube.com/watch?v=X_fnuMzRjMM)

(Claude generated summary)

## Games

The wall opens on a Wii-style menu. Pick a game with **← →** and **Enter**,
by clicking a tile on the wall, or with the **Game** dropdown in the control
window. **M** (either window) returns to the menu.

- **Beat wall**: the sticky-note beat instrument described below.
- **Plinko**: **← →** aim, **Space** (or a click on the wall) drops a ball,
  **R** resets the score. Sticky notes become bouncy bumpers that play their
  pitch; pegs under a note are removed so no light lands on the paper.
  Physics lives in `js/plinko.js` and runs in the control window.

To add a game: add it to `GAMES` in `js/render.js`, draw it in `drawScene`,
and route its keys in `runAction` in `js/control.js`.

## How to play


- **The wall is one bar.** The ruler lines split it into 8 rows of 1/8, top
  to bottom. A note plays at its row: a note on line 3 plays 3/8 into the bar
  (*Bar height* sets the spacing; Snap rounds to the nearest line).
- **Lone note = once per bar.** Its ball leaves the top on every downbeat,
  reaches the note at its row and climbs back by the next downbeat.
- **Pair = loop region.** A note below another one that crosses the upper
  note's centre line pairs with it: the ball ping-pongs between them. It
  bounces silently (dim) until the upper note's row, then both notes play
  every gap until the end of the bar. E.g. upper note on 2/8 and a 1/8 gap:
  8ths from 2/8 to the end of the bar. Stacks of 3+ chain into pairs.
- **Once.** **O** (or the loop/once button in the Lanes panel) makes the
  selected note play only the first of its hits in each echo loop (4 bars).
- **Colour = pitch.** purple C4 · blue D4 · green E4 · yellow G4 · orange A4 ·
  red C5 (pentatonic, so any mix sounds fine).
- **Pair gap = loop rate.** Each *Pair gap per 1/8* of distance between the two
  notes is one more 1/8 note between hits: 2 units apart hits every 1/4 note.
  With **Snap** on (default) gaps round to whole 1/8s; off gives free rhythms.
- **More balls = more hits.** **B** adds a ball to the highlighted lane and
  spreads the lane's balls evenly over its cycle: a lane of quarter notes plays
  8ths with 2 balls, triplets with 3 and 16ths with 4.
- **Instruments.** Click a note on the wall (mouse on the projector window) or
  press **E** for the highlighted lane's target: a ring of instruments appears
  around it. **← →** spin, **↵** or a second click keeps, **Esc** cancels; it
  keeps the choice by itself after 4 s. Or pick it in the Lanes panel.
  bell · pluck · marimba · pad · bass · kick · tom, all at the note's pitch.
  Moving a note keeps its instrument (a note of the same colour placed within
  10 s of one taken down takes over its instrument).
- **Echo + Keep.** The strip at the bottom shows what the wall played in the
  last 4 bars. **K** keeps it as a loop that plays forever, even after you take
  the notes down, so you can build a beat in layers. **Z** undoes the last
  keep, **X** clears them all. Kept notes you take down stay on the wall as
  dashed outlines with dim balls replaying the loop; the outline flashes on
  each hit.

### Keys (either window)

| Key | Action |
|---|---|
| Space | Start / stop the clock |
| [ / ] | Tempo −/+ 2 BPM (hold ⇧ for ±10) |
| S | Snap on / off |
| Tab / ⇧Tab | Highlight next / previous lane (white box around its note, a pair's upper note) |
| B / ⇧B | Add / remove a ball in the highlighted lane |
| A / D | Nudge the highlighted lane left / right |
| O | Selected note: loop (every hit) / once (first hit of each echo loop) |
| E | Instrument ring on the highlighted lane's target |
| ← → ↵ Esc | Ring open: spin / keep / cancel |
| K / X / Z | Keep last 4 bars / clear kept / undo keep |
| 1–6 | Mute a colour (purple … red); ⇧1–6 solos it |
| R | Reset balls (1 per lane, on the downbeat) |
| F | Fullscreen (projector) |
| M | Game menu |
| ? | Show the keys on the wall |

Every key shows a short toast in the top-right corner of the wall.

