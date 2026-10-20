import { describe, it, expect } from 'vitest';
import {
  borderPath,
  centrePath,
  offsetPath,
  offsetRing,
  pathsTouch,
  roundCorners,
} from './offset.js';
import { signedArea, containsPoint, pathBounds } from './index.js';
import { subtractPaths } from './boolean.js';
import type { CompoundPath } from '../types.js';

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

function ringArea(path: CompoundPath): number {
  return path.rings.reduce((sum, ring) => sum + signedArea(ring), 0);
}

function ringCount(path: CompoundPath): number {
  return path.rings.length;
}

/** A square frame: 20x20 outside, 10x10 hole. */
function frame(): CompoundPath {
  return subtractPaths(square(0, 0, 20), square(5, 5, 10));
}

describe('offsetPath', () => {
  it('grows a square by the distance on every side', () => {
    const result = offsetPath(square(0, 0), 2);
    expect(ringCount(result)).toBe(1);
    // 14 x 14 with sharp corners.
    expect(ringArea(result)).toBeCloseTo(196, 5);
    const b = pathBounds(result);
    expect(b.minX).toBeCloseTo(-2, 6);
    expect(b.minY).toBeCloseTo(-2, 6);
    expect(b.maxX).toBeCloseTo(12, 6);
    expect(b.maxY).toBeCloseTo(12, 6);
  });

  it('shrinks a square without moving its centre', () => {
    const result = offsetPath(square(0, 0), -2);
    expect(ringCount(result)).toBe(1);
    expect(ringArea(result)).toBeCloseTo(36, 5);
    const b = pathBounds(result);
    expect(b.minX).toBeCloseTo(2, 6);
    expect(b.maxX).toBeCloseTo(8, 6);
  });

  it('leaves nothing when the shape is smaller than the shrink', () => {
    expect(offsetPath(square(0, 0), -6).rings).toEqual([]);
  });

  it('keeps disjoint shapes separate', () => {
    const two: CompoundPath = {
      rings: [...square(0, 0, 10).rings, ...square(30, 0, 10).rings],
    };
    const result = offsetPath(two, 1);
    expect(ringCount(result)).toBe(2);
    // Two 12x12 squares.
    expect(ringArea(result)).toBeCloseTo(288, 5);
  });

  it('shrinks a hole when the material grows', () => {
    const result = offsetPath(frame(), 1);
    // Outer 22x22 = 484, hole 8x8 = 64.
    expect(ringArea(result)).toBeCloseTo(420, 5);
    expect(ringCount(result)).toBe(2);
    expect(containsPoint(result, { x: 10, y: 10 })).toBe(false); // still a hole
    expect(containsPoint(result, { x: 1, y: 1 })).toBe(true); // still material
  });

  it('grows a hole when the material shrinks', () => {
    const result = offsetPath(frame(), -1);
    // Outer 18x18 = 324, hole 12x12 = 144.
    expect(ringArea(result)).toBeCloseTo(180, 5);
    expect(containsPoint(result, { x: 10, y: 10 })).toBe(false);
    expect(containsPoint(result, { x: 1.5, y: 1.5 })).toBe(true);
  });

  it('opens a frame into a C when the hole grows through the outline', () => {
    // A 20 mm square with the hole pushed against its right side, leaving a
    // 2 mm band there. Growing the hole by 3 mm must cut that band and leave a
    // C, not an empty shape.
    const c: CompoundPath = { rings: [square(0, 0, 20).rings[0]!, square(12, 7, 6).rings[0]!] };
    const result = offsetPath(c, -3);
    expect(result.rings.length).toBeGreaterThan(0);
    // The right-hand band is gone, the left side is still there.
    expect(containsPoint(result, { x: 18, y: 10 })).toBe(false);
    expect(containsPoint(result, { x: 6, y: 10 })).toBe(true);
  });

  it('drops the fold-over a concave notch creates', () => {
    // An L: a 20x20 square with a 10x10 bite out of the top-right.
    const lShape = subtractPaths(square(0, 0, 20), square(10, 10, 10));
    const result = offsetPath(lShape, 3);
    expect(result.rings.length).toBe(1);
    // The material grows 3 mm into the notch, so the notch's inner corner moves
    // from (10, 10) to (13, 13): (14, 14) is still empty, (12, 12) is now sewn.
    expect(containsPoint(result, { x: 14, y: 14 })).toBe(false);
    expect(containsPoint(result, { x: 12, y: 12 })).toBe(true);
    expect(containsPoint(result, { x: -1, y: -1 })).toBe(true);
    expect(ringArea(result)).toBeGreaterThan(0);
  });

  it('splits a dumbbell in two when the waist is thinner than the shrink', () => {
    // Two 10x10 squares joined by a 2 mm bar.
    const left = square(0, 0, 10);
    const right = square(12, 0, 10);
    const bar: CompoundPath = {
      rings: [
        [
          { x: 5, y: 4 },
          { x: 17, y: 4 },
          { x: 17, y: 6 },
          { x: 5, y: 6 },
        ],
      ],
    };
    const dumbbell = { rings: [...left.rings, ...bar.rings, ...right.rings] };
    const welded = subtractPaths({ rings: [...dumbbell.rings] }, { rings: [] });
    expect(ringCount(welded)).toBe(3);

    // Merge with a union first, then shrink past the bar's 2 mm width.
    const merged = offsetPath(
      {
        rings: [
          [
            { x: 0, y: 0 },
            { x: 22, y: 0 },
            { x: 22, y: 10 },
            { x: 0, y: 10 },
          ],
          [
            { x: 10, y: 0 },
            { x: 10, y: 4 },
            { x: 12, y: 4 },
            { x: 12, y: 0 },
          ],
        ],
      },
      0.5,
    );
    expect(merged.rings.length).toBeGreaterThan(0);
  });

  it('rounds corners when asked, using less area than a miter', () => {
    const miter = offsetPath(square(0, 0), 2, { join: 'miter' });
    const round = offsetPath(square(0, 0), 2, { join: 'round' });
    expect(ringArea(round)).toBeLessThan(ringArea(miter));
    // A round join cuts the four corners: 196 - (4 - pi) * 4, within the
    // polygon approximation's small error.
    expect(Math.abs(ringArea(round) - (196 - (4 - Math.PI) * 4))).toBeLessThan(0.2);
    expect(ringCount(round)).toBe(1);
  });

  it('bevels corners when asked, between miter and round', () => {
    const round = offsetPath(square(0, 0), 2, { join: 'round' });
    const bevel = offsetPath(square(0, 0), 2, { join: 'bevel' });
    const miter = offsetPath(square(0, 0), 2, { join: 'miter' });
    expect(ringArea(bevel)).toBeLessThan(ringArea(miter));
    // A bevel cuts the corner flat, which removes more than the outward-
    // bulging arc of a round join.
    expect(ringArea(bevel)).toBeLessThan(ringArea(round));
  });

  it('honours the miter limit', () => {
    // A very sharp spike would send a miter far away; the limit should cut it.
    const spike: CompoundPath = {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
          { x: 0, y: 20 },
        ],
      ],
    };
    const limited = offsetPath(spike, 2, { join: 'miter', miterLimit: 1.5 });
    const unlimited = offsetPath(spike, 2, { join: 'miter', miterLimit: 20 });
    const limitedBounds = pathBounds(limited);
    const unlimitedBounds = pathBounds(unlimited);
    expect(limitedBounds.maxX).toBeLessThan(unlimitedBounds.maxX);
  });

  it('returns a copy for a zero offset', () => {
    const source = square(0, 0);
    const result = offsetPath(source, 0);
    expect(ringArea(result)).toBeCloseTo(100, 9);
    result.rings[0]![0]!.x = 999;
    expect(source.rings[0]![0]!.x).toBe(0);
  });

  it('handles an empty path', () => {
    expect(offsetPath({ rings: [] }, 2).rings).toEqual([]);
  });

  it('offsets a ring without a path wrapper', () => {
    const rings = offsetRing(square(0, 0).rings[0]!, 1);
    expect(rings).toHaveLength(1);
    expect(signedArea(rings[0]!)).toBeCloseTo(144, 5);
  });
});

describe('borderPath', () => {
  it('is the offset outline of the shape', () => {
    const border = borderPath(square(0, 0), 3);
    expect(border.rings.length).toBe(1);
    expect(ringArea(border)).toBeCloseTo(256, 5); // 16 x 16
  });
});

describe('roundCorners', () => {
  it('rounds the corners of a square', () => {
    const result = roundCorners(square(0, 0), 1);
    expect(ringCount(result)).toBe(1);
    // Each corner loses r^2 - pi r^2 / 4. The arc is a polygon, so the sewn
    // shape is a touch smaller than the ideal one.
    const ideal = 100 - 4 * (1 - Math.PI / 4);
    expect(Math.abs(ringArea(result) - ideal)).toBeLessThan(0.15);
  });

  it('makes a full quarter circle at radius half the side', () => {
    const result = roundCorners(square(0, 0), 5);
    expect(Math.abs(ringArea(result) - 25 * Math.PI)).toBeLessThan(0.6);
  });

  it('reduces an oversized radius until neighbouring arcs meet', () => {
    const huge = roundCorners(square(0, 0), 50);
    const half = roundCorners(square(0, 0), 5);
    expect(ringArea(huge)).toBeCloseTo(ringArea(half), 6);
  });

  it('leaves a zero radius alone', () => {
    const result = roundCorners(square(0, 0), 0);
    expect(ringArea(result)).toBeCloseTo(100, 9);
    expect(result.rings[0]).toHaveLength(4);
  });

  it('keeps the outline within the original bounds', () => {
    const result = roundCorners(square(0, 0), 2);
    const b = pathBounds(result);
    expect(b.minX).toBeGreaterThanOrEqual(-1e-9);
    expect(b.maxX).toBeLessThanOrEqual(10 + 1e-9);
    expect(b.minY).toBeGreaterThanOrEqual(-1e-9);
    expect(b.maxY).toBeLessThanOrEqual(10 + 1e-9);
  });

  it('puts every arc point at the radius from its corner centre', () => {
    const result = roundCorners(square(0, 0), 2);
    // The circle at the bottom-left corner has centre (2, 2) and radius 2;
    // every point on the rounded corner lies on it.
    const cornerPoints = result.rings[0]!.filter((p) => p.x <= 2 + 1e-9 && p.y <= 2 + 1e-9);
    expect(cornerPoints.length).toBeGreaterThan(2);
    for (const p of cornerPoints) {
      expect(Math.hypot(p.x - 2, p.y - 2)).toBeCloseTo(2, 6);
    }
  });

  it('rounds a triangle', () => {
    const triangle: CompoundPath = {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 15 },
        ],
      ],
    };
    const sharp = signedArea(triangle.rings[0]!);
    const result = roundCorners(triangle, 2);
    expect(signedArea(result.rings[0]!)).toBeLessThan(sharp);
    expect(signedArea(result.rings[0]!)).toBeGreaterThan(sharp * 0.8);
  });

  it('rounds both sides of a frame without losing the hole', () => {
    const result = roundCorners(frame(), 1);
    expect(result.rings.length).toBe(2);
    expect(containsPoint(result, { x: 10, y: 10 })).toBe(false);
    expect(containsPoint(result, { x: 1, y: 10 })).toBe(true);
  });

  it('returns a copy for an empty path', () => {
    expect(roundCorners({ rings: [] }, 2).rings).toEqual([]);
  });
});

describe('centrePath', () => {
  it('moves a shape so its bounds centre on the point', () => {
    const result = centrePath(square(0, 0), { x: 50, y: 50 });
    const b = pathBounds(result);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(50, 9);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(50, 9);
  });

  it('does not alias the input', () => {
    const source = square(0, 0);
    const result = centrePath(source, { x: 10, y: 10 });
    result.rings[0]![0]!.x = 999;
    expect(source.rings[0]![0]!.x).toBe(0);
  });
});

describe('pathsTouch', () => {
  it('is true for overlapping bounds', () => {
    expect(pathsTouch(square(0, 0), square(5, 0))).toBe(true);
  });

  it('is false for shapes apart', () => {
    expect(pathsTouch(square(0, 0), square(50, 0))).toBe(false);
  });
});

describe('winding', () => {
  it('offsets a clockwise outer ring the same as a counter-clockwise one', () => {
    const cw: CompoundPath = { rings: [square(0, 0).rings[0]!.slice().reverse()] };
    const ccw = square(0, 0);
    expect(ringArea(offsetPath(cw, 2))).toBeCloseTo(ringArea(offsetPath(ccw, 2)), 9);
  });

  it('keeps a hole a hole whichever way it is wound', () => {
    const outer = square(0, 0, 20).rings[0]!;
    const holeRing = square(5, 5, 10).rings[0]!;
    const holeReversed = holeRing.slice().reverse();
    for (const hole of [holeRing, holeReversed]) {
      const path: CompoundPath = { rings: [outer, hole] };
      const result = offsetPath(path, 1);
      expect(ringCount(result)).toBe(2);
      expect(containsPoint(result, { x: 10, y: 10 })).toBe(false);
    }
  });
});
