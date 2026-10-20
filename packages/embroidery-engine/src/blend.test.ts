import { describe, it, expect } from 'vitest';
import { planBlend, canBlend, normalizeFillAngle } from './blend.js';
import type { BlendTarget } from './blend.js';
import { DEFAULT_PARAMS } from './index.js';
import type { StitchParameters, StitchType } from './types.js';

/** A target with a chosen stitch type, angle and row pitch. */
function target(
  id: string,
  spacing: number,
  angle = 45,
  stitchType: StitchType = 'tatami',
): BlendTarget {
  return {
    id,
    params: { ...DEFAULT_PARAMS, stitchType, spacing, angle } as StitchParameters,
  };
}

describe('normalizeFillAngle', () => {
  it('wraps an angle into the half-turn a fill repeats over', () => {
    // A fill at 270 degrees covers the same rows as one at 90.
    expect(normalizeFillAngle(270)).toBe(90);
    expect(normalizeFillAngle(180)).toBe(0);
    expect(normalizeFillAngle(-45)).toBe(135);
    expect(normalizeFillAngle(45)).toBe(45);
  });
});

describe('planBlend', () => {
  it('leaves a lone object untouched', () => {
    // Nothing to blend with, so the plan must not silently re-aim or thin a
    // single fill - that would change work the user did not ask to change.
    const plan = planBlend([target('a', 0.45, 30)]);
    expect(plan.adjustments).toHaveLength(1);
    expect(plan.adjustments[0]!.angle).toBe(30);
    expect(plan.adjustments[0]!.spacing).toBe(0.45);
    expect(plan.densityFraction).toBe(1);
  });

  it('halves the coverage of each of two fills', () => {
    // Two fills sharing one area should each cover half of it, so the row
    // pitch doubles. Stacking two full-density fills would instead double the
    // stitch count and pucker the fabric.
    const plan = planBlend([target('a', 0.45), target('b', 0.45)]);

    expect(plan.densityFraction).toBe(0.5);
    expect(plan.adjustments[0]!.spacing).toBeCloseTo(0.9, 6);
    expect(plan.adjustments[1]!.spacing).toBeCloseTo(0.9, 6);
  });

  it('splits coverage three ways for three fills', () => {
    const plan = planBlend([target('a', 0.4), target('b', 0.4), target('c', 0.4)]);

    expect(plan.densityFraction).toBeCloseTo(1 / 3, 6);
    // 0.4 pitch shared by three fills.
    expect(plan.adjustments[0]!.spacing).toBeCloseTo(1.2, 6);
  });

  it('spreads the angles so no two fills run the same way', () => {
    // Fills at the same angle lay rows on top of each other and read as
    // stripes, not a blend, so the plan must walk each one around the dial.
    const plan = planBlend([target('a', 0.45, 45), target('b', 0.45, 45)]);

    expect(plan.adjustments[0]!.angle).toBe(45);
    // Two fills are a quarter turn apart.
    expect(plan.adjustments[1]!.angle).toBe(135);
  });

  it('keeps the first fill angle as the base', () => {
    // Blending must not silently re-aim work the user already set, so the
    // first object keeps its own direction and the rest step from there.
    const plan = planBlend([target('a', 0.45, 20), target('b', 0.45, 90)]);

    expect(plan.adjustments[0]!.angle).toBe(20);
    expect(plan.adjustments[1]!.angle).toBe(110);
  });

  it('spaces three fills evenly around the half-turn', () => {
    const plan = planBlend([target('a', 0.4, 0), target('b', 0.4, 0), target('c', 0.4, 0)]);

    // 180 / 3 = 60 degrees apart each.
    expect(plan.adjustments.map((a) => a.angle)).toEqual([0, 60, 120]);
  });

  it('honours a density multiplier on top of the shared split', () => {
    // 0.75 of the shared half-density - a lighter blend.
    const plan = planBlend([target('a', 0.4), target('b', 0.4)], { densityMultiplier: 0.75 });

    // 0.4 * 2 fills * 0.75 = 0.6.
    expect(plan.adjustments[0]!.spacing).toBeCloseTo(0.6, 6);
  });

  it('clamps a multiplier that would ask for an impossible pitch', () => {
    // A huge multiplier would stretch the pitch into sparse, unthreaded
    // territory; a tiny one would break the needle. Both must be clamped.
    const huge = planBlend([target('a', 0.4), target('b', 0.4)], { densityMultiplier: 500 });
    const tiny = planBlend([target('a', 0.4), target('b', 0.4)], { densityMultiplier: 0 });

    expect(huge.adjustments[0]!.spacing).toBeLessThanOrEqual(3);
    expect(tiny.adjustments[0]!.spacing).toBeGreaterThanOrEqual(0.1);
  });

  it('reports one adjustment per target, in order', () => {
    const plan = planBlend([target('a', 0.45), target('b', 0.45), target('c', 0.45)]);

    expect(plan.adjustments.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('never produces a non-positive pitch', () => {
    // Even a very tight starting pitch multiplied up must stay positive, or
    // the generator would divide by zero laying out rows.
    const plan = planBlend([target('a', 0.01), target('b', 0.01)]);
    for (const adj of plan.adjustments) {
      expect(adj.spacing).toBeGreaterThan(0);
      expect(Number.isFinite(adj.spacing)).toBe(true);
    }
  });
});

describe('canBlend', () => {
  const typeOf = (t: StitchType, spacing = 0.45) =>
    ({ ...DEFAULT_PARAMS, stitchType: t, spacing }) as StitchParameters;

  it('accepts two area fills', () => {
    expect(canBlend([typeOf('tatami'), typeOf('tatami')])).toBe(true);
  });

  it('refuses a single object', () => {
    expect(canBlend([typeOf('tatami')])).toBe(false);
  });

  it('refuses when any object is a run or satin', () => {
    // A run is one line and a satin's spacing is the zig-zag across the
    // column, not coverage of an area, so neither can be thinned to share
    // space with another fill.
    expect(canBlend([typeOf('tatami'), typeOf('run')])).toBe(false);
    expect(canBlend([typeOf('tatami'), typeOf('satin')])).toBe(false);
    expect(canBlend([typeOf('bean'), typeOf('tatami')])).toBe(false);
  });

  it('accepts the other area fills too', () => {
    expect(canBlend([typeOf('motif'), typeOf('contour')])).toBe(true);
    expect(canBlend([typeOf('spiral'), typeOf('tatami')])).toBe(true);
  });
});
