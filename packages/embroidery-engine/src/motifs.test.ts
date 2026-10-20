import { describe, it, expect } from 'vitest';
import {
  BUILTIN_MOTIFS,
  DEFAULT_MOTIF,
  MOTIF_MAX_POINTS,
  MOTIF_MAX_SIZE,
  MOTIF_MIN_SIZE,
  builtinMotifs,
  labelFor,
  motifProblem,
  normalizeMotif,
  resolveMotif,
  ringFromPointsText,
  ringFromSvgPath,
  selfIntersects,
} from './motifs.js';
import { boundsOf, signedArea } from './geometry/index.js';
import type { Ring } from './types.js';

/** A plain ring 10 mm across, wound counter-clockwise. */
const square = (size = 10): Ring => [
  { x: -size / 2, y: -size / 2 },
  { x: size / 2, y: -size / 2 },
  { x: size / 2, y: size / 2 },
  { x: -size / 2, y: size / 2 },
];

describe('built-in motif library', () => {
  it('ships every shape as a ring that can actually be sewn', () => {
    const motifs = builtinMotifs();
    expect(motifs.length).toBeGreaterThanOrEqual(5);
    for (const motif of motifs) {
      expect(motif.builtin).toBe(true);
      expect(motif.name).not.toBe('');
      expect(motifProblem(motif.points)).toBeNull();
    }
  });

  it('gives every built-in a distinct id', () => {
    const ids = builtinMotifs().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the library keys and the exported record in step', () => {
    expect(Object.keys(BUILTIN_MOTIFS).sort()).toEqual(
      builtinMotifs()
        .map((m) => m.id)
        .sort(),
    );
  });

  it('names shapes the way a picker would read them', () => {
    expect(labelFor(DEFAULT_MOTIF)).toBe('Star');
    expect(labelFor('hexagon')).toBe('Hexagon');
  });
});

describe('resolveMotif', () => {
  it('prefers a shape the design carries over a built-in id', () => {
    const own = square(12);
    expect(resolveMotif({ id: 'circle', points: own })).toBe(own);
  });

  it('falls back to the named built-in', () => {
    expect(resolveMotif({ id: 'circle' })).toBe(BUILTIN_MOTIFS.circle);
  });

  it('falls back to the default when the id is unknown', () => {
    // A document written by a build that had a motif this one does not must
    // still compile rather than throw.
    expect(resolveMotif({ id: 'shape-from-the-future' })).toBe(BUILTIN_MOTIFS[DEFAULT_MOTIF]);
    expect(resolveMotif(undefined)).toBe(BUILTIN_MOTIFS[DEFAULT_MOTIF]);
    expect(resolveMotif({ points: [] })).toBe(BUILTIN_MOTIFS[DEFAULT_MOTIF]);
  });

  it('ignores a carried shape that is not a ring', () => {
    expect(resolveMotif({ id: 'cross', points: [{ x: 0, y: 0 }] })).toBe(BUILTIN_MOTIFS.cross);
  });
});

describe('motifProblem', () => {
  it('accepts a usable ring', () => {
    expect(motifProblem(square())).toBeNull();
  });

  it('names the real limit rather than a generic refusal', () => {
    expect(motifProblem(undefined)).toMatch(/no shape/i);
    expect(motifProblem([])).toMatch(/at least 3 points.*has 0/i);
    expect(
      motifProblem([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toMatch(/at least 3 points[\s\S]*has 2\./i);
    expect(
      motifProblem([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });

  it('rejects a ring that doubles back on itself', () => {
    // A bow tie: edges 0-1 and 2-3 cross, so the outline would sew a knot.
    const bowtie: Ring = [
      { x: -5, y: -5 },
      { x: 5, y: 5 },
      { x: 5, y: -5 },
      { x: -5, y: 5 },
    ];
    expect(selfIntersects(bowtie)).toBe(true);
    expect(motifProblem(bowtie)).toMatch(/cross itself/i);
    expect(motifProblem(square())).toBeNull();
  });

  it('rejects a point that is not a finite coordinate', () => {
    expect(
      motifProblem([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: Number.NaN, y: 10 },
      ]),
    ).toMatch(/finite/i);
  });

  it('holds the size limits to a range a machine can sew', () => {
    expect(MOTIF_MIN_SIZE).toBeGreaterThan(0);
    expect(MOTIF_MAX_SIZE).toBeGreaterThan(MOTIF_MIN_SIZE);
    // A whole range rather than a single usable size: too tight and only a
    // hand-drawn speck fits, too wide and nothing fits a hoop.
    expect(MOTIF_MAX_SIZE / MOTIF_MIN_SIZE).toBeGreaterThan(10);
  });

  it('rejects a shape smaller than the minimum', () => {
    expect(motifProblem(square(0.05))).toMatch(/at least/i);
  });

  it('rejects a shape larger than the maximum', () => {
    expect(motifProblem(square(MOTIF_MAX_SIZE + 20))).toMatch(/at most/i);
  });

  it('rejects a ring with too many points to store', () => {
    const tooMany: Ring = [];
    for (let i = 0; i < MOTIF_MAX_POINTS + 1; i++) {
      const a = (i / (MOTIF_MAX_POINTS + 1)) * Math.PI * 2;
      tooMany.push({ x: Math.cos(a) * 5, y: Math.sin(a) * 5 });
    }
    expect(motifProblem(tooMany)).toMatch(new RegExp(`${MOTIF_MAX_POINTS} points`));
  });

  it('rejects a shape thinner than the minimum in either direction', () => {
    // Wide enough across, but flat enough to be a line of thread rather than
    // a shape: a motif has to be at least a millimetre the short way too.
    const flat: Ring = [
      { x: -5, y: -0.0001 },
      { x: 5, y: -0.0001 },
      { x: 5, y: 0 },
      { x: -5, y: 0 },
    ];
    expect(motifProblem(flat)).toMatch(/at least/i);
    expect(motifProblem(square(0.05))).toMatch(/at least/i);
  });
});

describe('normalizeMotif', () => {
  it('sizes any shape to a unit box so scale means the same thing', () => {
    const ring = normalizeMotif(square(40));
    const box = boundsOf([ring]);
    expect(box.maxX - box.minX).toBeCloseTo(1, 9);
    expect(box.maxY - box.minY).toBeCloseTo(1, 9);
  });

  it('centres the shape on the origin', () => {
    const offset: Ring = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 110 },
      { x: 100, y: 110 },
    ];
    const ring = normalizeMotif(offset);
    const box = boundsOf([ring]);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(0, 9);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(0, 9);
  });

  it('winds every shape the same way', () => {
    const cw = [
      { x: -5, y: -5 },
      { x: -5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: -5 },
    ];
    const ccw = square();
    expect(signedArea(cw)).toBeLessThan(0);
    expect(signedArea(ccw)).toBeGreaterThan(0);
    // Both come back counter-clockwise, so a mirrored drawing is placed the
    // same as one drawn the other way round.
    expect(signedArea(normalizeMotif(cw))).toBeGreaterThan(0);
    expect(signedArea(normalizeMotif(ccw))).toBeGreaterThan(0);
  });

  it('preserves the shape rather than only its box', () => {
    const star = normalizeMotif(BUILTIN_MOTIFS.star);
    // A star has ten vertices and stays a star through normalization.
    expect(star).toHaveLength(BUILTIN_MOTIFS.star.length);
    // Every point is finite and the shape still spans a real area — a ring
    // collapsed to a point would normalize to garbage rather than a star.
    for (const p of star) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    const box = boundsOf([star]);
    expect(box.maxX - box.minX).toBeGreaterThan(0);
    // The outline still reads as a star, not as the box it was drawn in:
    // vertices alternate between the outer tips and the inner valleys.
    const radii = star.map((p) => Math.hypot(p.x, p.y));
    const max = Math.max(...radii);
    const min = Math.min(...radii);
    expect(min).toBeLessThan(max * 0.8);
  });
});

describe('ringFromSvgPath', () => {
  it('reads a polygon drawn with linetos', () => {
    const ring = ringFromSvgPath('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    expect(ring).not.toBeNull();
    expect(ring!).toHaveLength(4);
    expect(motifProblem(ring!)).toBeNull();
  });

  it('reads relative commands the same as absolute ones', () => {
    const absolute = ringFromSvgPath('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    const relative = ringFromSvgPath('M 0 0 l 10 0 l 0 10 l -10 0 Z');
    expect(relative).toHaveLength(4);
    // Both describe the same square: same size, same centre.
    const a = boundsOf([absolute!]);
    const b = boundsOf([relative!]);
    expect(b.maxX - b.minX).toBeCloseTo(a.maxX - a.minX, 6);
    expect(b.maxY - b.minY).toBeCloseTo(a.maxY - a.minY, 6);
  });

  it('reads horizontal and vertical linetos', () => {
    const ring = ringFromSvgPath('M 0 0 H 10 V 10 H 0 Z');
    expect(ring).not.toBeNull();
    expect(boundsOf([ring!]).maxX - boundsOf([ring!]).minX).toBeCloseTo(10, 9);
  });

  it('samples a cubic curve into enough points to be a ring', () => {
    // A closed D: two straight sides and one bowed-out curve, so the sampled
    // curve has to arc outward without the outline crossing back over it.
    const ring = ringFromSvgPath('M 1 1 L 9 1 C 13 5, 13 5, 9 9 L 1 9 Z');
    expect(ring).not.toBeNull();
    expect(ring!.length).toBeGreaterThan(4);
    expect(motifProblem(ring!)).toBeNull();
  });

  it('samples a quadratic curve', () => {
    const ring = ringFromSvgPath('M 0 0 Q 5 10 10 0 Z');
    expect(ring).not.toBeNull();
    expect(ring!.length).toBeGreaterThan(3);
  });

  it('collapses the point a close command repeats', () => {
    // Without collapsing, Z would leave the start point twice and the shape
    // would be reported as self-touching.
    const ring = ringFromSvgPath('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    const first = ring![0]!;
    const last = ring![ring!.length - 1]!;
    expect(Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9).toBe(false);
  });

  it('refuses a path it cannot read rather than returning part of one', () => {
    // Arcs are outside the covered subset.
    expect(ringFromSvgPath('M 0 0 A 5 5 0 0 1 10 10 Z')).toBeNull();
    expect(ringFromSvgPath('M 0 0')).toBeNull();
    expect(ringFromSvgPath('not a path')).toBeNull();
    expect(ringFromSvgPath('')).toBeNull();
    expect(ringFromSvgPath('L 1 2 M 0 0 L 5 0 Z')).toBeNull();
  });
});

describe('ringFromPointsText', () => {
  it('reads pasted coordinates separated by commas or spaces', () => {
    const fromCommas = ringFromPointsText('0,0 10,0 10,10 0,10');
    expect(fromCommas).toHaveLength(4);
    const fromNewlines = ringFromPointsText('0 0\n10 0\n10 10\n0 10');
    expect(fromNewlines).toHaveLength(4);
  });

  it('reads negative and decimal coordinates', () => {
    const ring = ringFromPointsText('-5.5, -2 5.5,-2 0,4');
    expect(ring).toHaveLength(3);
    expect(ring![0]).toEqual({ x: -5.5, y: -2 });
  });

  it('refuses fewer than three points', () => {
    expect(ringFromPointsText('0,0 10,0')).toBeNull();
    expect(ringFromPointsText('')).toBeNull();
    expect(ringFromPointsText('nothing here')).toBeNull();
  });
});
