import { describe, it, expect } from 'vitest';
import { mergeShortStitches, type LengthPoint } from './minlength.js';

const SEW = 'stitch' as const;
const JUMP = 'jump' as const;
const TRIM = 'trim' as const;

/** Points spaced `step` mm apart along a straight line. */
function line(count: number, step: number, command: StitchLike = SEW): LengthPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: i * step, y: 0, command }));
}

type StitchLike = typeof SEW | typeof JUMP | typeof TRIM;

describe('mergeShortStitches', () => {
  it('returns the input untouched when the minimum is zero or nonsense', () => {
    const pts = line(5, 0.05);
    expect(mergeShortStitches(pts, 0)).toBe(pts);
    expect(mergeShortStitches(pts, -1)).toBe(pts);
    expect(mergeShortStitches(pts, Number.NaN)).toBe(pts);
    expect(mergeShortStitches(pts, Number.POSITIVE_INFINITY)).toBe(pts);
  });

  it('leaves a well-spaced run alone', () => {
    const pts = line(6, 3);
    const out = mergeShortStitches(pts, 0.3);
    expect(out).toHaveLength(6);
    expect(out).toEqual(pts);
  });

  it('collapses a run of sub-minimum steps into the spacing asked for', () => {
    // 21 points at 0.05 mm = 1.0 mm of travel. With a 0.3 mm floor the run
    // should come out around four penetrations, not twenty.
    const out = mergeShortStitches(line(21, 0.05), 0.3);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the first and last point of a run exactly where they were', () => {
    const pts = line(21, 0.05); // spans 0 .. 1.0 mm
    const out = mergeShortStitches(pts, 0.3);
    expect(out[0]!.x).toBeCloseTo(0, 9);
    expect(out[out.length - 1]!.x).toBeCloseTo(1, 9);
  });

  it('never drops more than the minimum can justify', () => {
    // Every emitted point must be at least `minLength` from the one before
    // it, apart from the final point of a run which is always kept.
    const pts = Array.from({ length: 40 }, (_, i) => ({
      x: (i % 7) * 0.04,
      y: i * 0.04,
      command: SEW,
    }));
    const min = 0.25;
    const out = mergeShortStitches(pts, min);
    for (let i = 1; i < out.length - 1; i++) {
      const d = Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.y - out[i - 1]!.y);
      expect(d).toBeGreaterThanOrEqual(min - 1e-9);
    }
  });

  it('preserves the command of every point it keeps', () => {
    const pts: LengthPoint[] = [
      { x: 0, y: 0, command: SEW },
      { x: 0.05, y: 0, command: SEW },
      { x: 2, y: 0, command: SEW },
    ];
    const out = mergeShortStitches(pts, 0.3);
    for (const p of out) expect(p.command).toBe(SEW);
  });

  it('treats a jump as a hard barrier', () => {
    // Two short runs separated by a jump must each keep their own start:
    // collapsing across the jump would delete the move the machine makes.
    const pts: LengthPoint[] = [
      { x: 0, y: 0, command: SEW },
      { x: 0.05, y: 0, command: SEW },
      { x: 0.1, y: 0, command: SEW },
      { x: 50, y: 0, command: JUMP },
      { x: 50, y: 0, command: SEW },
      { x: 50.05, y: 0, command: SEW },
      { x: 50.1, y: 0, command: SEW },
    ];
    const out = mergeShortStitches(pts, 0.3);

    const jumpIndex = out.findIndex((p) => p.command === JUMP);
    expect(jumpIndex).toBeGreaterThan(0);
    // A stitch sits on both sides of the jump - the run before it and the run
    // after it each still begin.
    expect(out[jumpIndex - 1]!.command).toBe(SEW);
    expect(out[jumpIndex + 1]!.command).toBe(SEW);
    expect(out[jumpIndex + 1]!.x).toBeCloseTo(50, 9);
  });

  it('treats a trim as a hard barrier', () => {
    const pts: LengthPoint[] = [
      { x: 0, y: 0, command: SEW },
      { x: 0.05, y: 0, command: SEW },
      { x: 10, y: 0, command: TRIM },
      { x: 10, y: 0, command: SEW },
      { x: 10.05, y: 0, command: SEW },
    ];
    const out = mergeShortStitches(pts, 0.3);
    expect(out.some((p) => p.command === TRIM)).toBe(true);
    // The stitch after the trim survives even though it is short on its own.
    expect(out[out.length - 1]!.x).toBeCloseTo(10.05, 9);
  });

  it('handles an empty list and a single point', () => {
    expect(mergeShortStitches([], 0.3)).toEqual([]);
    const one: LengthPoint[] = [{ x: 5, y: 5, command: SEW }];
    expect(mergeShortStitches(one, 0.3)).toEqual(one);
  });

  it('does not mutate its input', () => {
    const pts = line(21, 0.05);
    const before = JSON.stringify(pts);
    mergeShortStitches(pts, 0.3);
    expect(JSON.stringify(pts)).toBe(before);
  });

  it('is deterministic', () => {
    const pts = line(50, 0.07);
    expect(JSON.stringify(mergeShortStitches(pts, 0.4))).toBe(
      JSON.stringify(mergeShortStitches(pts, 0.4)),
    );
  });

  it('shrinks a stitch count monotonically as the floor rises', () => {
    const pts = line(200, 0.2);
    let previous = Number.POSITIVE_INFINITY;
    for (const min of [0.1, 0.3, 0.6, 1.0, 2.0]) {
      const count = mergeShortStitches(pts, min).length;
      expect(count).toBeLessThanOrEqual(previous);
      previous = count;
    }
  });
});
