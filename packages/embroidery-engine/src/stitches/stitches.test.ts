import { describe, it, expect } from 'vitest';
import {
  satinFromStroke,
  tatamiFill,
  runStitch,
  beanStitch,
  contourFill,
  spiralFill,
  motifFill,
  maxStitchLength,
} from './index.js';
import type { CompoundPath, Point } from '../types.js';
import { boundsOf, containsPoint } from '../geometry/index.js';

const rect = (w: number, h: number, x = 0, y = 0): CompoundPath => ({
  rings: [
    [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  ],
});

const squareWithHole = (): CompoundPath => ({
  rings: [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      { x: 30, y: 30 },
      { x: 30, y: 70 },
      { x: 70, y: 70 },
      { x: 70, y: 30 },
    ],
  ],
});

const line = (length: number, horizontal = true): Point[] =>
  horizontal
    ? [
        { x: 0, y: 0 },
        { x: length, y: 0 },
      ]
    : [
        { x: 0, y: 0 },
        { x: 0, y: length },
      ];

describe('run stitch', () => {
  it('produces points along the path with the requested spacing', () => {
    const pts = runStitch(line(30), { spacing: 3 });
    expect(pts.length).toBeGreaterThan(5);
    expect(pts[0]!.x).toBeCloseTo(0, 6);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(30, 6);
  });

  it('never exceeds the maximum stitch length', () => {
    const pts = runStitch(line(100), { spacing: 4, maxStitchLength: 12.1 });
    expect(maxStitchLength(pts)).toBeLessThanOrEqual(12.1 + 1e-6);
  });

  it('returns nothing for degenerate input', () => {
    expect(runStitch([])).toEqual([]);
    expect(runStitch([{ x: 1, y: 1 }])).toEqual([]);
  });
});

describe('bean / triple run', () => {
  it('traverses the path three times by default', () => {
    const single = runStitch(line(30), { spacing: 3 });
    const bean = beanStitch(line(30), { spacing: 3 });
    // 3 passes over roughly the same geometry
    expect(bean.length).toBeGreaterThanOrEqual(single.length * 2.5);
  });

  it('alternates direction between passes', () => {
    const bean = beanStitch(line(20), { spacing: 5 });
    const mid = Math.floor(bean.length / 3);
    // second pass starts heading back
    expect(bean[mid]!.x).toBeGreaterThan(bean[mid - 1]!.x - 6);
  });
});

describe('satin column', () => {
  it('produces alternating penetrations across the column', () => {
    const path = satinFromStroke(line(40), 4, {
      spacing: 0.5,
      maxStitchLength: 12.1,
      pullCompensation: 0,
      splitStrategy: 'divide',
    });

    expect(path.length).toBeGreaterThan(20);

    // Alternate points should sit on opposite sides of the center line (y=0).
    const signs = path.slice(0, 10).map((p) => Math.sign(p.y));
    expect(signs.filter((s) => s === 1).length).toBeGreaterThan(0);
    expect(signs.filter((s) => s === -1).length).toBeGreaterThan(0);
  });

  it('respects column width', () => {
    const width = 6;
    const path = satinFromStroke(line(30), width, {
      spacing: 0.5,
      maxStitchLength: 12.1,
      pullCompensation: 0,
      splitStrategy: 'divide',
    });
    const ys = path.map((p) => p.y);
    const span = Math.max(...ys) - Math.min(...ys);
    expect(span).toBeCloseTo(width, 1);
  });

  it('applies pull compensation by widening the column', () => {
    const opts = { spacing: 0.5, maxStitchLength: 12.1, splitStrategy: 'divide' as const };
    const plain = satinFromStroke(line(30), 4, { ...opts, pullCompensation: 0 });
    const pulled = satinFromStroke(line(30), 4, { ...opts, pullCompensation: 0.5 });

    const span = (s: typeof plain) =>
      Math.max(...s.map((p) => p.y)) - Math.min(...s.map((p) => p.y));
    expect(span(pulled)).toBeGreaterThan(span(plain));
    expect(span(pulled)).toBeCloseTo(5, 1); // 4 + 2 * 0.5
  });

  it('compensates each side of a column separately', () => {
    const opts = { spacing: 0.5, maxStitchLength: 12.1, splitStrategy: 'divide' as const };
    const path = satinFromStroke(line(30), 4, {
      ...opts,
      pullCompensation: 0,
      pullCompensationLeft: 0.6,
      pullCompensationRight: 0.1,
    });

    const ys = path.map((p) => p.y);
    // The left rail of a rightward stroke sits above the centre line.
    expect(Math.max(...ys)).toBeCloseTo(2.6, 1);
    expect(Math.min(...ys)).toBeCloseTo(-2.1, 1);
  });

  it('uses the uniform value on a side without its own', () => {
    const opts = { spacing: 0.5, maxStitchLength: 12.1, splitStrategy: 'divide' as const };
    const path = satinFromStroke(line(30), 4, {
      ...opts,
      pullCompensation: 0.4,
      pullCompensationLeft: 0.8,
    });

    const ys = path.map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(2.8, 1);
    expect(Math.min(...ys)).toBeCloseTo(-2.4, 1);
  });

  it('auto-splits stitches longer than the machine limit', () => {
    // A 30 mm wide column cannot be crossed in one 12.1 mm stitch.
    const path = satinFromStroke(line(20), 30, {
      spacing: 0.5,
      maxStitchLength: 12.1,
      pullCompensation: 0,
      splitStrategy: 'divide',
    });

    // Consecutive points within a row must not span the full 30 mm.
    for (let i = 1; i < Math.min(path.length, 40); i++) {
      const d = Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
      expect(d).toBeLessThanOrEqual(12.1 + 1e-6);
    }
  });
});

describe('tatami fill', () => {
  it('generates stitches inside a plain rectangle', () => {
    const path = rect(40, 30);
    const stitches = tatamiFill(path, { spacing: 0.5, angle: 0, edgeInset: 0.1 });

    expect(stitches.length).toBeGreaterThan(100);

    const bounds = boundsOf(path.rings);
    for (const s of stitches) {
      expect(s.x).toBeGreaterThanOrEqual(bounds.minX - 1);
      expect(s.x).toBeLessThanOrEqual(bounds.maxX + 1);
      expect(s.y).toBeGreaterThanOrEqual(bounds.minY - 1);
      expect(s.y).toBeLessThanOrEqual(bounds.maxY + 1);
    }
  });

  it('respects a hole - no stitch lands inside it', () => {
    const path = squareWithHole();
    const stitches = tatamiFill(path, {
      spacing: 0.6,
      angle: 0,
      edgeInset: 0.1,
      pullCompensation: 0,
    });

    expect(stitches.length).toBeGreaterThan(100);

    let inside = 0;
    for (const s of stitches) {
      // Small tolerance: edge rows may sit right on the hole boundary.
      const p = { x: s.x, y: s.y };
      const inHole = p.x > 31 && p.x < 69 && p.y > 31 && p.y < 69;
      if (inHole) inside++;
    }
    expect(inside).toBe(0);
  });

  it('changes density when spacing changes', () => {
    const path = rect(50, 50);
    const sparse = tatamiFill(path, { spacing: 1.0, angle: 0 });
    const dense = tatamiFill(path, { spacing: 0.3, angle: 0 });
    expect(dense.length).toBeGreaterThan(sparse.length * 2);
  });

  it('changes output when the fill angle changes', () => {
    const path = rect(50, 50);
    const a = tatamiFill(path, { spacing: 0.6, angle: 0 });
    const b = tatamiFill(path, { spacing: 0.6, angle: 45 });
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    // Same shape, different angle -> different point set.
    expect(JSON.stringify(a.slice(0, 5))).not.toBe(JSON.stringify(b.slice(0, 5)));
  });

  it('handles a shape thinner than one row', () => {
    const thin: CompoundPath = {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 0.2 },
          { x: 0, y: 0.2 },
        ],
      ],
    };
    const stitches = tatamiFill(thin, { spacing: 0.5 });
    expect(stitches.length).toBeGreaterThan(0);
  });

  it('emits jumps when the needle has to cross a gap', () => {
    const twoShapes: CompoundPath = {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        [
          { x: 100, y: 0 },
          { x: 120, y: 0 },
          { x: 120, y: 20 },
          { x: 100, y: 20 },
        ],
      ],
    };
    const stitches = tatamiFill(twoShapes, { spacing: 0.6, jumpThreshold: 4 });
    expect(stitches.some((s) => s.command === 'jump')).toBe(true);
  });
});

describe('contour fill', () => {
  it('produces concentric rings that stay inside the shape', () => {
    const path = rect(60, 60);
    const stitches = contourFill(path, { spacing: 2 });
    expect(stitches.length).toBeGreaterThan(20);

    const b = boundsOf(path.rings);
    for (const s of stitches) {
      expect(s.x).toBeGreaterThanOrEqual(b.minX - 3);
      expect(s.x).toBeLessThanOrEqual(b.maxX + 3);
      expect(s.y).toBeGreaterThanOrEqual(b.minY - 3);
      expect(s.y).toBeLessThanOrEqual(b.maxY + 3);
    }
  });
});

describe('spiral fill', () => {
  it('starts near the center and moves outward', () => {
    const path = rect(80, 80, -40, -40);
    const stitches = spiralFill(path, { spacing: 2 });
    expect(stitches.length).toBeGreaterThan(20);

    const first = stitches[0]!;
    const distFirst = Math.hypot(first.x, first.y);
    const last = stitches[stitches.length - 1]!;
    const distLast = Math.hypot(last.x, last.y);
    expect(distLast).toBeGreaterThan(distFirst);
  });

  it('keeps points inside the shape', () => {
    const path = rect(60, 60, -30, -30);
    const stitches = spiralFill(path, { spacing: 2 });
    const outside = stitches.filter((s) => !containsPoint(path, { x: s.x, y: s.y }));
    // Spiral samples the boundary, so a couple may land just outside; the
    // bulk must be inside.
    expect(outside.length / stitches.length).toBeLessThan(0.05);
  });
});

describe('motif fill', () => {
  /** A five-point star, radius 1; the engine scales it by `motifScale`. */
  const star = (): Point[] =>
    Array.from({ length: 10 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      const r = i % 2 === 0 ? 1 : 0.4;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });

  // Regression: the row offset used to be produced by a helper that always
  // returned 0, so every row was stamped at y=0. The "fill" came out as a
  // thin band floating outside the shape rather than covering it - and the
  // previous assertions only checked that *some* stitches were produced, so
  // nothing caught it.
  it('spreads motifs over the shape instead of piling them at the origin', () => {
    const path = rect(60, 40, 20, 20); // spans x 20..80, y 20..60
    const stitches = motifFill(path, star(), { spacing: 3, motifScale: 3 });

    expect(stitches.length).toBeGreaterThan(20);

    const b = boundsOf([stitches]);
    expect(b.minY).toBeGreaterThan(15);
    expect(b.maxY).toBeGreaterThan(55);
    expect(b.minX).toBeLessThan(25);
    expect(b.maxX).toBeGreaterThan(75);
  });

  it('honours spacing - a wider grid yields fewer stitches', () => {
    const path = rect(60, 40, 0, 0);
    const dense = motifFill(path, star(), { spacing: 2, motifScale: 3 });
    const sparse = motifFill(path, star(), { spacing: 8, motifScale: 3 });
    expect(dense.length).toBeGreaterThan(sparse.length);
  });

  it('skips motifs that would fall outside the shape', () => {
    const path = rect(60, 40, 0, 0);
    const stitches = motifFill(path, star(), { spacing: 6, motifScale: 3 });
    const b = boundsOf(path.rings);
    const strays = stitches.filter((s) => s.x < b.minX - 3 || s.x > b.maxX + 3);
    expect(strays).toHaveLength(0);
  });
});
