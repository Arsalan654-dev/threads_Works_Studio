import { describe, it, expect } from 'vitest';
import {
  pickHoop,
  rotateObject,
  flipObjectX,
  scaleObject,
  usableField,
  boundsMidpoint,
} from './hooping.js';
import type { Hoop } from './types.js';

/** The seeded library, trimmed to the sizes the tests reason about. */
const LIBRARY: Hoop[] = [
  { id: 'h100', name: '100 x 100', width: 100, height: 100, shape: 'rect', safeMargin: 4 },
  { id: 'h126', name: '126 x 110', width: 126, height: 110, shape: 'rect', safeMargin: 4 },
  { id: 'h180', name: '180 x 130', width: 180, height: 130, shape: 'rect', safeMargin: 5 },
  { id: 'h200', name: '200 x 200', width: 200, height: 200, shape: 'rect', safeMargin: 5 },
  { id: 'cap', name: 'Cap frame', width: 80, height: 180, shape: 'rect', safeMargin: 5 },
];

describe('usableField', () => {
  it('subtracts the safe margin from both sides', () => {
    const field = usableField(LIBRARY[0]!);
    // 100 mm nominal with a 4 mm margin on each edge leaves 92 mm.
    expect(field.width).toBe(92);
    expect(field.height).toBe(92);
  });

  it('reports a non-positive field when the margin eats the hoop', () => {
    const swallowed: Hoop = {
      id: 'x',
      name: 'x',
      width: 8,
      height: 8,
      shape: 'rect',
      safeMargin: 4,
    };
    // Zero usable width - such a hoop must never be selectable.
    expect(usableField(swallowed).width).toBe(0);
  });
});

describe('pickHoop', () => {
  it('picks the smallest hoop a design fits in', () => {
    const fit = pickHoop({ width: 60, height: 60 }, LIBRARY);
    expect(fit?.hoop.id).toBe('h100');
    expect(fit?.rotated).toBe(false);
  });

  it('accounts for the safe margin, not the nominal size', () => {
    // 95 mm fits inside a nominal 100 mm hoop, but only 92 mm of it stitches.
    const fit = pickHoop({ width: 95, height: 60 }, LIBRARY);
    // It must skip the 100 hoop (92 usable) and reach for the next size up.
    expect(fit?.hoop.id).toBe('h126');
  });

  it('steps up to a larger hoop when the design outgrows the small one', () => {
    // 110 mm is wider than the 100 hoop's 92 mm usable field, so it must step
    // up. The 126x110 hoop leaves 118x102, which holds it directly - there is
    // no reason to jump all the way to 180x130.
    const fit = pickHoop({ width: 110, height: 100 }, LIBRARY);
    expect(fit?.hoop.id).toBe('h126');
    expect(fit?.rotated).toBe(false);
  });

  it('turns a tall narrow design when that beats a bigger hoop', () => {
    // A 165 x 65 bar fits the 180x130 hoop directly, but it also fits the cap
    // frame (usable 70x180) once turned a quarter turn - and the cap frame is
    // the smaller hoop by area. Rotation must be allowed to win here, because
    // choosing the larger frame would waste a hooping for no reason.
    const fit = pickHoop({ width: 165, height: 65 }, LIBRARY);
    expect(fit?.hoop.id).toBe('cap');
    expect(fit?.rotated).toBe(true);
  });

  it('picks a hoop that fits without turning when one exists', () => {
    // 70 x 170 fits the cap frame's usable 70x170 exactly, with no turn. A
    // rotated fit into 180x130 exists too, but it is both larger and turned,
    // so it must lose on both counts.
    const fit = pickHoop({ width: 70, height: 170 }, LIBRARY);
    expect(fit?.hoop.id).toBe('cap');
    expect(fit?.rotated).toBe(false);
  });

  it('refuses to rotate when the caller forbids it', () => {
    // Same design as above, but rotation is off: nothing in the library is
    // 170 mm deep except the cap frame and the 200 square.
    const fit = pickHoop({ width: 70, height: 170 }, LIBRARY, { allowRotation: false });
    // The cap frame is 180 deep, so it still fits without turning.
    expect(fit?.hoop.id).toBe('cap');
    expect(fit?.rotated).toBe(false);
  });

  it('prefers an unrotated fit between hoops of equal area', () => {
    // Both are 200x100 in area terms once margins are ignored; the design is
    // 150 x 80, which fits 180x130 directly and 200x200 directly too. The
    // smaller-area hoop must win, and it must not be a rotated one.
    const pair: Hoop[] = [
      { id: 'a', name: 'a', width: 180, height: 130, shape: 'rect', safeMargin: 5 },
      { id: 'b', name: 'b', width: 130, height: 180, shape: 'rect', safeMargin: 5 },
    ];
    const fit = pickHoop({ width: 150, height: 80 }, pair);
    // 180x130 fits directly; 130x180 only fits turned.
    expect(fit?.hoop.id).toBe('a');
    expect(fit?.rotated).toBe(false);
  });

  it('returns null when nothing in the library is large enough', () => {
    const fit = pickHoop({ width: 900, height: 900 }, LIBRARY);
    expect(fit).toBeNull();
  });

  it('ignores hoops whose margin leaves no stitching room', () => {
    const broken: Hoop[] = [
      { id: 'gone', name: 'gone', width: 6, height: 6, shape: 'rect', safeMargin: 4 },
    ];
    expect(pickHoop({ width: 1, height: 1 }, broken)).toBeNull();
  });

  it('handles a zero-size need by picking the smallest hoop', () => {
    // An empty design needs no room; it should still land in the smallest
    // frame rather than returning null.
    const fit = pickHoop({ width: 0, height: 0 }, LIBRARY);
    expect(fit?.hoop.id).toBe('h100');
  });

  it('is deterministic - the same input always gives the same hoop', () => {
    const need = { width: 80, height: 90 };
    const first = pickHoop(need, LIBRARY);
    const second = pickHoop(need, LIBRARY);
    expect(first?.hoop.id).toBe(second?.hoop.id);
    expect(first?.rotated).toBe(second?.rotated);
  });
});

describe('rotateObject', () => {
  const square = {
    path: {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
    },
  };

  it('turns a shape a quarter turn about a point', () => {
    // A 10x10 square at the origin, rotated 90 degrees about (0,0): the point
    // (10,0) swings round to (0,10).
    const turned = rotateObject(square, 90, { x: 0, y: 0 });
    const pts = turned.path.rings[0]!;
    expect(pts[1]!.x).toBeCloseTo(0, 9);
    expect(pts[1]!.y).toBeCloseTo(10, 9);
  });

  it('keeps the pivot point where it was', () => {
    const turned = rotateObject(square, 47, { x: 10, y: 0 });
    const pivot = turned.path.rings[0]![1]!;
    expect(pivot.x).toBeCloseTo(10, 9);
    expect(pivot.y).toBeCloseTo(0, 9);
  });

  it('swaps the extents of a non-square shape', () => {
    const bar = {
      path: {
        rings: [
          [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 10 },
            { x: 0, y: 10 },
          ],
        ],
      },
    };
    const turned = rotateObject(bar, 90, { x: 0, y: 0 });
    const xs = turned.path.rings[0]!.map((p) => p.x);
    const ys = turned.path.rings[0]!.map((p) => p.y);

    // A 40x10 bar becomes 10x40: the width and height trade places.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(40, 6);
  });

  it('is a no-op for a full turn', () => {
    const turned = rotateObject(square, 360, { x: 5, y: 5 });
    turned.path.rings[0]!.forEach((p, i) => {
      expect(p.x).toBeCloseTo(square.path.rings[0]![i]!.x, 6);
      expect(p.y).toBeCloseTo(square.path.rings[0]![i]!.y, 6);
    });
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(square);
    rotateObject(square, 30, { x: 0, y: 0 });
    expect(JSON.stringify(square)).toBe(before);
  });
});

describe('flipObjectX', () => {
  const square = {
    path: {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
    },
  };

  it('mirrors across a vertical line', () => {
    // Mirroring (0,0) across x = 0 lands on (0,0)... use an off-axis line so
    // the movement is visible: across x = 30, (0,0) -> (60,0).
    const flipped = flipObjectX(square, 30);
    const pts = flipped.path.rings[0]!;
    expect(pts[0]!.x).toBeCloseTo(60, 9);
    expect(pts[0]!.y).toBeCloseTo(0, 9);
    expect(pts[2]!.x).toBeCloseTo(50, 9);
    expect(pts[2]!.y).toBeCloseTo(10, 9);
  });

  it('keeps the shape in place when mirrored about its own centre', () => {
    // A 0..10 square mirrored about x = 5 occupies the same box - which is
    // exactly what "flip in place" means to a user pressing a flip button.
    const flipped = flipObjectX(square, 5);
    const xs = flipped.path.rings[0]!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(10, 9);
  });

  it('reverses the winding order', () => {
    // Mirroring flips traversal direction; a 0->10 walk becomes 10->0.
    const flipped = flipObjectX(square, 5);
    const pts = flipped.path.rings[0]!;
    expect(pts[0]!.x).toBeCloseTo(10, 9);
    expect(pts[1]!.x).toBeCloseTo(0, 9);
  });

  it('leaves Y untouched', () => {
    const flipped = flipObjectX(square, 123);
    flipped.path.rings[0]!.forEach((p, i) => {
      expect(p.y).toBe(square.path.rings[0]![i]!.y);
    });
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(square);
    flipObjectX(square, 5);
    expect(JSON.stringify(square)).toBe(before);
  });
});

describe('scaleObject', () => {
  const bar = {
    path: {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
    },
  };

  it('grows a shape outward from the pivot', () => {
    // Doubling a 0..40 bar about its own centre (20,0): the left edge walks
    // from 0 to -20, the right from 40 to 60.
    const grown = scaleObject(bar, 2, 2, { x: 20, y: 5 });
    const xs = grown.path.rings[0]!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-20, 9);
    expect(Math.max(...xs)).toBeCloseTo(60, 9);
  });

  it('keeps the pivot exactly fixed', () => {
    const grown = scaleObject(bar, 3.5, 0.25, { x: 40, y: 10 });
    const corner = grown.path.rings[0]![2]!;
    expect(corner.x).toBeCloseTo(40, 9);
    expect(corner.y).toBeCloseTo(10, 9);
  });

  it('stretches independently per axis', () => {
    const grown = scaleObject(bar, 2, 1, { x: 0, y: 0 });
    const ys = grown.path.rings[0]!.map((p) => p.y);
    // Width doubles, height does not move at all.
    expect(Math.max(...grown.path.rings[0]!.map((p) => p.x))).toBeCloseTo(80, 9);
    expect(Math.max(...ys)).toBeCloseTo(10, 9);
  });

  it('is a no-op for a 1x1 scale', () => {
    const same = scaleObject(bar, 1, 1, { x: 7, y: 3 });
    same.path.rings[0]!.forEach((p, i) => {
      expect(p.x).toBeCloseTo(bar.path.rings[0]![i]!.x, 9);
      expect(p.y).toBeCloseTo(bar.path.rings[0]![i]!.y, 9);
    });
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(bar);
    scaleObject(bar, 2, 2, { x: 0, y: 0 });
    expect(JSON.stringify(bar)).toBe(before);
  });
});

describe('boundsMidpoint', () => {
  it('returns the centre of a bounding box', () => {
    expect(boundsMidpoint({ minX: 0, minY: 0, maxX: 40, maxY: 20 })).toEqual({ x: 20, y: 10 });
  });
});
