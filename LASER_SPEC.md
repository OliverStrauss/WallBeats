# sticky-wall — Laser spec

Design for turning the Laser mini game (`js/minigames.js`) from "random targets,
notes are mirrors" into a colour-light puzzle. Decisions below were agreed on;
open questions are listed at the end. Build steps 1–4 are in `js/minigames.js`
and `js/laserLevels.js`.

## 1. Principles

1. **Notes are optics.** Every puzzle is solved by where real sticky notes are
   and which notes you use.
2. **Shape = role, colour = colour.** Square note → mirror. Strip (a note cut
   in half) → filter. Any colour can play either role.
3. **No light on the paper.** Unchanged: `drawMini` blacks out each note plus a
   `BALL_GAP` margin, so the beam appears to stop at the paper and leave from
   its edge.
4. **Stable over precise.** A beam that holds still beats one that follows
   every tracker wobble.

## 2. Notes as optics

### 2.1 Role from shape
- Aspect ratio from the note's four corners (long side / short side).
- **Mirror** below 1.4, **filter** above 1.7. Between the two, the note keeps
  its previous role (hysteresis), so it never flickers. A new note in the dead
  band counts as a mirror.

### 2.2 Mirrors
- Reflect off whichever edge the beam hits: `d' = d − 2(d·n)n`.
- **Any mirror reflects any beam colour.** Colour only matters for filters and
  targets.

### 2.3 Filters
- The beam passes straight through (enters one edge, leaves the opposite edge)
  and changes colour by paint-wheel mixing:

| Beam in | Filter | Beam out |
|---|---|---|
| white | any colour | that colour |
| primary (red, yellow, blue) | a different primary | the secondary (red+yellow = orange, yellow+blue = green, blue+red = purple) |
| any colour | same colour | unchanged |
| anything else (e.g. red + green) | | blocked, the beam ends |

## 3. Stability

- **Snap angles to 15°.** Each note's edge directions are rounded to the nearest
  15° before tracing (a small note's detected angle is off by a few degrees). This also makes levels designable.
- **Freeze still notes.** Once a note has moved less than a small threshold
  for about 400 ms, its geometry is locked until it moves clearly again.
- Not planned for now: smoothing the angle (EMA) and wider target radii. Add
  them if snapping and freezing are not enough on the real wall.

## 4. Showing colour

Coloured light reads as a note to the camera, so colour is shown carefully:

- The beam is drawn white with a **thin coloured core** in the beam's current
  colour. Targets get a coloured inner ring in the colour they need.
- The beam polyline and target rings are added to the **vision mask**, the same
  way halos (`HALO_MASK`) and the highlight box (`HIGHLIGHT_MASK`) are masked
  today, so detection never sees them.
- Test with the simulated camera's *Projector colour cast* option before trying
  it on the real wall.

## 5. Levels

Hand-made levels as JSON, in world units (x from 0 to aspect, y from 0 to 1),
so they plug straight into the laser view.

```json
{
  "name": "First bounce",
  "emitters": [{ "x": 0.02, "y": 0.55, "ang": 0, "aim": false }],
  "targets": [{ "x": 1.2, "y": 0.3, "color": "white" }],
  "walls": [[[0.8, 0.2], [0.8, 0.6]]],
  "locks": [{ "a": [1.4, 0.2], "b": [1.4, 0.5], "color": "red" }],
  "noNotes": [[0.0, 0.9, 1.78, 1.0]],
  "inventory": { "mirrors": 1, "filters": { "red": 1 } },
  "hint": "one mirror"
}
```

- **Emitters:** position, angle, and whether the player can aim it (`aim`).
  The level decides: pure note puzzles have a fixed emitter, others let you
  aim with ← → or a click on the wall.
- **Targets:** each needs one exact colour. A level is solved when all targets
  are lit at the same time.
- **Walls** absorb the beam. **Locks** only pass one colour.
- **No-note zones:** notes inside are ignored, like Plinko's line.
- **Inventory:** how many mirrors and which filters the level allows. Extra
  notes show a warning and are ignored.
- The existing banner hook shows "SOLVED!" and moves to the next level.

### 5.1 Progression
1. Mirrors only, white beam: one bounce, two bounces, around a wall.
2. Filters: turn white into the colour a target needs.
3. Mixing: "light the orange target, no orange allowed" (red then yellow).
4. Locks: the beam must be the right colour at the right point.
5. Two emitters, two target colours.

Levels 1–2 avoid the colour pairs the camera confuses most (orange and yellow,
blue and purple).

## 6. Tracer

```
beam = [], color = 'white', p = emitter, d = dir(ang)
repeat up to 32 times:
  hit = nearest of: note edges (inflated by the gap), walls, locks, screen edge
  push segment { from: p, to: hit.pt, color }
  mirror → reflect d
  filter → color = mix(color, note.color); stop if blocked; p = exit point
  lock   → stop unless color matches
  wall / screen edge → stop
  p = hit.pt + d · ε   (nudge off the surface)
targets lit = segments passing within the target radius in the matching colour
```

The view's beam changes from one point list to segments: `[{ pts, color }]`.

## 7. Build order

1. Tracer: mirrors only, white beam, 15° snapping, freezing still notes, one
   fixed JSON level. Test on the simulated camera.
2. Shape roles, then filters and the mixing table.
3. Level JSON loader, inventory limits, locks, walls, no-note zones, solved
   banner, first 8–10 levels.
4. Coloured beam core and target rings, with the vision mask.
5. Later, maybe: a level editor in the control window, and a small solver to
   check each level is solvable and count its minimum notes (for star ratings).

## 8. Open questions

Built with these defaults until decided otherwise:

- Does a lit target stop the beam, or does the beam pass through it?
  *Default: passes through.*
- Should players need to cut notes for filters, or is there another way to
  make a strip note (for example, two notes side by side)? *Default: cut notes;
  two notes side by side are two notes.*
- Is there a scoring or star system (fewest notes), or is solving enough?
  *Default: solving is enough; the score is the highest level solved.*
- Ignored notes (no-note zone, over the inventory) absorb the beam rather than
  let it through, so no light lands on their paper.
