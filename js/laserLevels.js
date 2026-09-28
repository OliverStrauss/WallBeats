// Laser levels (see LASER_SPEC.md §5). World units at 16:9: x 0..1.78, y 0..1
// (the play area starts at y 0.16, below the HUD). minigames.js stretches x to
// the real projector aspect.
//
// emitters { x, y, ang (rad), aim } · targets { x, y, color } · walls [a, b] ·
// locks { a, b, color } · noNotes [x0, y0, x1, y1] · inventory { mirrors, filters: { color: n } }

export const LASER_LEVELS = [
  // 1. mirrors only, white beam
  {
    name: 'First bounce',
    emitters: [{ x: 0.04, y: 0.8, ang: 0, aim: false }],
    targets: [{ x: 0.9, y: 0.3, color: 'white' }],
    walls: [],
    locks: [],
    noNotes: [],
    inventory: { mirrors: 1, filters: {} },
    hint: 'one mirror, turned 45°',
  },
  {
    name: 'Two bounces',
    emitters: [{ x: 0.04, y: 0.3, ang: 0, aim: false }],
    targets: [{ x: 0.4, y: 0.85, color: 'white' }],
    walls: [[[0.1, 0.55], [1.2, 0.55]]],
    locks: [],
    noNotes: [],
    inventory: { mirrors: 2, filters: {} },
    hint: 'go round the end of the wall',
  },
  {
    name: 'Around the wall',
    emitters: [{ x: 0.04, y: 0.35, ang: 0, aim: true }],
    targets: [{ x: 1.5, y: 0.35, color: 'white' }],
    walls: [[[0.9, 0.16], [0.9, 0.65]]],
    locks: [],
    noNotes: [[0.7, 0.16, 1.1, 0.65]],
    inventory: { mirrors: 1, filters: {} },
    hint: 'aim under the wall',
  },
  // 2. filters: white into the colour a target needs
  {
    name: 'Paint it red',
    emitters: [{ x: 0.04, y: 0.55, ang: 0, aim: false }],
    targets: [{ x: 1.5, y: 0.55, color: 'red' }],
    walls: [],
    locks: [],
    noNotes: [],
    inventory: { mirrors: 0, filters: { red: 1 } },
    hint: 'a red strip across the beam',
  },
  {
    name: 'Blue corner',
    emitters: [{ x: 0.04, y: 0.8, ang: 0, aim: false }],
    targets: [{ x: 1.1, y: 0.3, color: 'blue' }],
    walls: [],
    locks: [],
    noNotes: [],
    inventory: { mirrors: 1, filters: { blue: 1 } },
    hint: 'filter, then bounce',
  },
  // 3. mixing
  {
    name: 'No orange allowed',
    emitters: [{ x: 0.04, y: 0.55, ang: 0, aim: false }],
    targets: [{ x: 1.5, y: 0.55, color: 'orange' }],
    walls: [],
    locks: [],
    noNotes: [],
    inventory: { mirrors: 0, filters: { red: 1, yellow: 1 } },
    hint: 'red + yellow = orange',
  },
  {
    name: 'Green from scratch',
    emitters: [{ x: 0.04, y: 0.8, ang: 0, aim: false }],
    targets: [{ x: 1.3, y: 0.3, color: 'green' }],
    walls: [],
    locks: [],
    noNotes: [],
    inventory: { mirrors: 1, filters: { blue: 1, yellow: 1 } },
    hint: 'blue + yellow = green',
  },
  // 4. locks
  {
    name: 'Red door',
    emitters: [{ x: 0.04, y: 0.55, ang: 0, aim: false }],
    targets: [{ x: 1.5, y: 0.55, color: 'purple' }],
    walls: [[[0.9, 0.16], [0.9, 0.42]], [[0.9, 0.68], [0.9, 1]]],
    locks: [{ a: [0.9, 0.42], b: [0.9, 0.68], color: 'red' }],
    noNotes: [],
    inventory: { mirrors: 0, filters: { red: 1, blue: 1 } },
    hint: 'red through the door, purple at the end',
  },
  // 5. two emitters
  {
    name: 'Split screen',
    emitters: [{ x: 0.04, y: 0.33, ang: 0, aim: false }, { x: 0.04, y: 0.8, ang: 0, aim: false }],
    targets: [{ x: 1.5, y: 0.33, color: 'red' }, { x: 1.5, y: 0.8, color: 'blue' }],
    walls: [[[0, 0.56], [1.78, 0.56]]],
    locks: [],
    noNotes: [],
    inventory: { mirrors: 0, filters: { red: 1, blue: 1 } },
    hint: 'one colour per beam',
  },
  {
    name: 'Crossfire',
    emitters: [{ x: 0.04, y: 0.33, ang: 0, aim: false }, { x: 0.04, y: 0.8, ang: 0, aim: false }],
    targets: [{ x: 1.5, y: 0.33, color: 'green' }, { x: 1.5, y: 0.8, color: 'orange' }],
    walls: [[[0, 0.56], [1.78, 0.56]]],
    locks: [],
    noNotes: [],
    inventory: { mirrors: 0, filters: { yellow: 2, blue: 1, red: 1 } },
    hint: 'green up top, orange below',
  },
];
