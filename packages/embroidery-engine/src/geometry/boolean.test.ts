import { describe, it, expect } from 'vitest';
import {
  booleanPath,
  combinePaths,
  explodePath,
  segmentIntersections,
  subtractPaths,
  unionPaths,
  weldPaths,
  xorPaths,
} from './boolean.js';
import { signedArea, containsPoint, pathBounds } from './index.js';
import type { CompoundPath } from '../types.js';

/** A square with its lower-left corner at (x, y). */
function square(x: number, y: number, size = 10): CompoundPath {
  return {
    rings: [
      [
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
      ],
    ],
  };
}

/**
 * Signed area of a whole path.
 *
 * Signed on purpose: holes wind the other way, so subtracting their area is
 * exactly what this should do. `areaOf` takes the absolute value, which would
 * make a hole add to the total and hide a winding bug.
 */
function ringArea(path: CompoundPath): number {
  return path.rings.reduce((sum, ring) => sum + signedArea(ring), 0);
}

function ringCount(path: CompoundPath): number {
  return path.rings.length;
}

describe('segmentIntersections', () => {
  it('finds a crossing and reports where on both segments', () => {
    const hits = segmentIntersections(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.point.x).toBeCloseTo(5, 9);
    expect(hits[0]!.point.y).toBeCloseTo(5, 9);
    expect(hits[0]!.t).toBeCloseTo(0.5, 9);
    expect(hits[0]!.u).toBeCloseTo(0.5, 9);
  });

  it('reports nothing for segments that do not reach', () => {
    expect(
      segmentIntersections({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 5 }, { x: 1, y: 5 }),
    ).toEqual([]);
  });

  it('treats a touching endpoint as a meeting', () => {
    const hits = segmentIntersections(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.point).toEqual({ x: 10, y: 0 });
  });

  it('finds both ends of a collinear overlap', () => {
    // The overlap runs from x=5 to x=10, not the whole of either segment.
    const hits = segmentIntersections(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 15, y: 0 },
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]!.point.x).toBeCloseTo(5, 9);
    expect(hits[1]!.point.x).toBeCloseTo(10, 9);
  });

  it('reports a single point for segments that touch at one end only', () => {
    const hits = segmentIntersections(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.point.x).toBeCloseTo(10, 9);
  });

  it('ignores parallel segments that do not lie on each other', () => {
    expect(
      segmentIntersections({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 }),
    ).toEqual([]);
  });
});

describe('union', () => {
  it('merges two overlapping squares into one outline of the right area', () => {
    // 10x10 squares offset by 5 in x: the union is 15x10 = 150.
    const result = unionPaths(square(0, 0), square(5, 0));
    expect(ringCount(result)).toBe(1);
    expect(ringArea(result)).toBeCloseTo(150, 6);
    // Every corner of the merged outline is inside it, and a point in the
    // overlap is too.
    expect(containsPoint(result, { x: 7, y: 5 })).toBe(true);
    expect(containsPoint(result, { x: -1, y: 5 })).toBe(false);
    expect(containsPoint(result, { x: 16, y: 5 })).toBe(false);
  });

  it('keeps disjoint squares as two rings', () => {
    const result = unionPaths(square(0, 0), square(50, 0));
    expect(ringCount(result)).toBe(2);
    expect(ringArea(result)).toBeCloseTo(200, 6);
  });

  it('does not duplicate the smaller square when it is wholly inside', () => {
    // The union of a shape and something inside it is the shape itself.
    const result = unionPaths(square(0, 0, 20), square(5, 5, 5));
    expect(ringCount(result)).toBe(1);
    expect(ringArea(result)).toBeCloseTo(400, 6);
  });

  it('merges squares that share an edge into one', () => {
    const result = unionPaths(square(0, 0, 10), square(10, 0, 10));
    expect(ringCount(result)).toBe(1);
    expect(ringArea(result)).toBeCloseTo(200, 6);
  });

  it('merges squares that touch at a single corner', () => {
    const result = unionPaths(square(0, 0, 10), square(10, 10, 10));
    // Two lobes joined at a point stay one connected region.
    expect(ringArea(result)).toBeCloseTo(200, 6);
  });
});

describe('intersection', () => {
  it('returns only the overlap', () => {
    const result = booleanPath(square(0, 0), square(5, 0), 'intersection');
    expect(ringCount(result)).toBe(1);
    expect(ringArea(result)).toBeCloseTo(50, 6); // 5x10
    expect(containsPoint(result, { x: 7, y: 5 })).toBe(true);
    expect(containsPoint(result, { x: 2, y: 5 })).toBe(false);
  });

  it('is empty when the shapes do not meet', () => {
    expect(booleanPath(square(0, 0), square(50, 0), 'intersection').rings).toEqual([]);
  });

  it('returns the inner shape when one contains the other', () => {
    const result = booleanPath(square(0, 0, 20), square(5, 5, 5), 'intersection');
    expect(ringArea(result)).toBeCloseTo(25, 6);
  });

  it('is empty for a shared edge, which has no area', () => {
    const result = booleanPath(square(0, 0), square(10, 0), 'intersection');
    expect(ringArea(result)).toBeCloseTo(0, 6);
  });
});

describe('difference', () => {
  it('cuts a notch out of the first shape', () => {
    const result = subtractPaths(square(0, 0), square(5, 0));
    expect(ringArea(result)).toBeCloseTo(50, 6); // 5x10 left
    expect(containsPoint(result, { x: 2, y: 5 })).toBe(true);
    expect(containsPoint(result, { x: 7, y: 5 })).toBe(false);
  });

  it('leaves the first shape alone when the second misses it', () => {
    const result = subtractPaths(square(0, 0), square(50, 0));
    expect(ringCount(result)).toBe(1);
    expect(ringArea(result)).toBeCloseTo(100, 6);
  });

  it('makes a hole when the second is wholly inside', () => {
    const result = subtractPaths(square(0, 0, 20), square(5, 5, 5));
    // Outer 400 minus the hole 25.
    expect(ringArea(result)).toBeCloseTo(375, 6);
    expect(containsPoint(result, { x: 7, y: 7 })).toBe(false);
    expect(containsPoint(result, { x: 1, y: 1 })).toBe(true);
    expect(ringCount(result)).toBe(2);
  });

  it('is empty when the second covers the first', () => {
    const result = subtractPaths(square(5, 5, 5), square(0, 0, 20));
    expect(ringArea(result)).toBeCloseTo(0, 6);
  });
});

describe('xor', () => {
  it('keeps the parts only one shape covers', () => {
    const result = booleanPath(square(0, 0), square(5, 0), 'xor');
    // 150 union minus 50 overlap = 100.
    expect(ringArea(result)).toBeCloseTo(100, 6);
    expect(containsPoint(result, { x: 2, y: 5 })).toBe(true);
    expect(containsPoint(result, { x: 7, y: 5 })).toBe(false);
    expect(containsPoint(result, { x: 12, y: 5 })).toBe(true);
  });

  it('is the same as the union for disjoint shapes', () => {
    const result = xorPaths(square(0, 0), square(50, 0));
    expect(ringArea(result)).toBeCloseTo(200, 6);
  });
});

describe('holes and complex outlines', () => {
  it('subtracts from a shape that already has a hole', () => {
    // A 40x40 frame with a 20x20 hole, then punch a 5x5 hole in the frame.
    const frame = subtractPaths(square(0, 0, 40), square(10, 10, 20));
    expect(ringArea(frame)).toBeCloseTo(1200, 6);

    const punched = subtractPaths(frame, square(2, 2, 5));
    expect(ringArea(punched)).toBeCloseTo(1175, 6);
    expect(containsPoint(punched, { x: 4, y: 4 })).toBe(false); // new hole
    expect(containsPoint(punched, { x: 20, y: 20 })).toBe(false); // old hole
    expect(containsPoint(punched, { x: 35, y: 35 })).toBe(true); // still frame
  });

  it('unions a ring shape with a shape that bridges its hole', () => {
    const frame = subtractPaths(square(0, 0, 40), square(10, 10, 20));
    const bridge = square(15, 15, 10); // fills the middle of the hole
    const merged = unionPaths(frame, bridge);
    // The bridge does not reach the frame, so the hole shrinks but remains.
    expect(containsPoint(merged, { x: 20, y: 20 })).toBe(true);
    expect(containsPoint(merged, { x: 12, y: 20 })).toBe(false);
  });

  it('handles a triangle against a square', () => {
    const triangle: CompoundPath = {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 20 },
        ],
      ],
    };
    const result = booleanPath(triangle, square(0, 0, 10), 'intersection');
    expect(ringArea(result)).toBeGreaterThan(0);
    expect(containsPoint(result, { x: 5, y: 2 })).toBe(true);
    expect(containsPoint(result, { x: 15, y: 15 })).toBe(false);
  });
});

describe('combinePaths', () => {
  it('folds a list of shapes with one operation', () => {
    const result = combinePaths([square(0, 0), square(5, 0), square(10, 0)], 'union');
    // Three 10-wide squares stepping by 5: 20 wide, 10 tall.
    expect(ringArea(result)).toBeCloseTo(200, 6);
  });

  it('returns nothing for an empty list', () => {
    expect(combinePaths([], 'union').rings).toEqual([]);
  });

  it('copies the first shape rather than aliasing it', () => {
    const first = square(0, 0);
    const result = combinePaths([first], 'union');
    result.rings[0]![0]!.x = 999;
    expect(first.rings[0]![0]!.x).toBe(0);
  });
});

describe('weldPaths', () => {
  it('merges overlapping shapes into one path', () => {
    const result = weldPaths([square(0, 0), square(5, 0)]);
    expect(result).toHaveLength(1);
    expect(ringArea(result[0]!)).toBeCloseTo(150, 6);
  });

  it('keeps disjoint shapes separate', () => {
    const result = weldPaths([square(0, 0), square(50, 0)]);
    expect(result).toHaveLength(2);
  });

  it('keeps a hole with the region that contains it', () => {
    const result = weldPaths([square(0, 0, 40), square(10, 10, 20)]);
    // One region: the square, not a second path for the inner square.
    expect(result).toHaveLength(1);
    expect(ringArea(result[0]!)).toBeCloseTo(1600, 6);
  });

  it('handles an empty list', () => {
    expect(weldPaths([])).toEqual([]);
  });
});

describe('explodePath', () => {
  it('splits a path into one path per ring', () => {
    const frame = subtractPaths(square(0, 0, 40), square(10, 10, 20));
    const pieces = explodePath(frame);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) expect(piece.rings).toHaveLength(1);
  });

  it('copies the ring rather than aliasing it', () => {
    const source = square(0, 0);
    const pieces = explodePath(source);
    pieces[0]!.rings[0]![0]!.x = 999;
    expect(source.rings[0]![0]!.x).toBe(0);
  });
});

describe('robustness', () => {
  it('leaves bounds where the operation says they should be', () => {
    const result = unionPaths(square(0, 0), square(5, 0));
    const b = pathBounds(result);
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(15, 6);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(10, 6);
  });

  it('produces rings with no repeated closing point', () => {
    const result = unionPaths(square(0, 0), square(5, 0));
    for (const ring of result.rings) {
      expect(ring.length).toBeGreaterThanOrEqual(3);
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      expect(Math.abs(first.x - last.x) + Math.abs(first.y - last.y)).toBeGreaterThan(1e-6);
    }
  });

  it('is idempotent: union with itself changes nothing', () => {
    const shape = square(0, 0);
    const once = unionPaths(shape, shape);
    expect(ringArea(once)).toBeCloseTo(100, 6);
    const twice = unionPaths(once, once);
    expect(ringArea(twice)).toBeCloseTo(100, 6);
  });

  it('treats an empty shape as the identity for union', () => {
    expect(ringArea(unionPaths({ rings: [] }, square(0, 0)))).toBeCloseTo(100, 6);
    expect(ringArea(unionPaths(square(0, 0), { rings: [] }))).toBeCloseTo(100, 6);
  });

  it('treats an empty shape as empty for intersection', () => {
    expect(booleanPath({ rings: [] }, square(0, 0), 'intersection').rings).toEqual([]);
  });

  it('copes with a rotated square overlapping an axis-aligned one', () => {
    // A diamond centred to the right of the square, so only part of the
    // square lies inside it — an exact-fit case would pass even if the
    // intersection code did nothing at all.
    const rotated: CompoundPath = {
      rings: [
        [
          { x: 12, y: -5 },
          { x: 22, y: 5 },
          { x: 12, y: 15 },
          { x: 2, y: 5 },
        ],
      ],
    };
    const common = booleanPath(square(0, 0), rotated, 'intersection');
    expect(ringArea(common)).toBeGreaterThan(0);
    expect(ringArea(common)).toBeLessThan(100);
    // A point near the right edge is inside both; one near the left is not.
    expect(containsPoint(common, { x: 9, y: 5 })).toBe(true);
    expect(containsPoint(common, { x: 1, y: 5 })).toBe(false);
  });

  it('does not lose a thin sliver of overlap', () => {
    const thin = booleanPath(square(0, 0), square(9.5, 0), 'intersection');
    expect(ringArea(thin)).toBeCloseTo(5, 6); // 0.5 wide x 10 tall
  });
});
