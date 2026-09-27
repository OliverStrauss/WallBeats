# Wall-Beats
An AR based beat maker i thought of on a random thrusday. Uses computer vision to find sticky notes on my wall and make noises accordingly.
As a warning i have 0 musical background or prowess, so the interface makes sense to me sorry.
Watch the working demo here: (https://www.youtube.com/watch?v=X_fnuMzRjMM)

(Claude generated summary)
## How to play


- **Every note gets a ball.** A lone note's ball drops from the top of the
  wall and climbs back. The ruler lines on the wall show the fall time, 1/8
  to 1 bar (*Lone fall per bar* sets the spacing); with Snap on it rounds to
  the nearest line. All balls leave the top on the downbeat, so only notes at
  the same height hit together; lower notes hit later and less often.
- **Pairs ping-pong.** A note below another one that crosses the upper note's
  centre line pairs with it: the ball bounces between them and both play.
  Stacks of 3+ chain into pairs top to bottom.
- **Colour = pitch.** purple C4 · blue D4 · green E4 · yellow G4 · orange A4 ·
  red C5 (pentatonic, so any mix sounds fine).
- **Pair gap = rhythm.** Each *Pair gap per 1/8* of distance between the two
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
| E | Instrument ring on the highlighted lane's target |
| ← → ↵ Esc | Ring open: spin / keep / cancel |
| K / X / Z | Keep last 4 bars / clear kept / undo keep |
| 1–6 | Mute a colour (purple … red); ⇧1–6 solos it |
| R | Reset balls (1 per lane, on the downbeat) |
| F | Fullscreen (projector) |
| ? | Show the keys on the wall |

Every key shows a short toast in the top-right corner of the wall.

