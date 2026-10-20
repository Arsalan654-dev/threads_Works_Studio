/**
 * Colour blending.
 *
 * Blending is how a digitizer makes two or more threads read as a third
 * colour: the fills overlap, each is sewn at a fraction of its normal density,
 * and their rows run at different angles so the stitches interleave instead of
 * stacking. Where a red fill and a yellow fill cross at half density each, the
 * eye mixes them into orange - no new thread is invented, the mix is optical.
 *
 * The maths is deliberately simple and honest:
 *
 *  - Coverage is shared, not doubled. With N fills over the same area, each
 *    one covers 1/N of the rows, so the row pitch is multiplied by N. Two
 *    half-density fills leave the total stitch count about where a single
 *    full fill would be; stacking two full-density fills would instead double
 *    it and pucker the fabric.
 *
 *  - Angles are spread so no two fills share a direction. Fills at the same
 *    angle lay their rows on top of each other and produce stripes rather than
 *    a blend, so the plan walks each fill a fixed step around the dial.
 *
 * This module only *plans* the change. It returns the parameter overrides a
 * blend implies and never touches the document, so the same plan can be
 * previewed, tested, and applied as a single undoable edit.
 */

import type { StitchParameters } from './types.js';

/** Anything with an id and stitch parameters - a document object. */
export interface BlendTarget {
  id: string;
  params: StitchParameters;
}

/** What the blend wants one object's parameters to become. */
export interface BlendAdjustment {
  id: string;
  /** Fill angle in degrees, already normalised into 0-360. */
  angle: number;
  /** Row pitch in mm - larger means fewer rows, hence lighter coverage. */
  spacing: number;
}

export interface BlendPlan {
  adjustments: BlendAdjustment[];
  /** Share of the area each fill covers, as a fraction of full density. */
  densityFraction: number;
}

export interface BlendOptions {
  /**
   * Extra density on top of the shared split, as a multiplier.
   *
   * 1 leaves the combined coverage where a single full fill would be. Below 1
   * lightens the blend, above 1 fattens it. Clamped so a plan can never ask
   * for a negative or zero pitch.
   */
  densityMultiplier?: number;
}

/** A pitch this small would break the needle; never plan one. */
const MIN_PITCH = 0.1;
/** Upper bound so a plan cannot wander into sparse, unthreaded territory. */
const MAX_PITCH = 3;

/** Normalise any angle into the half-turn a fill angle actually repeats over. */
export function normalizeFillAngle(angle: number): number {
  const wrapped = angle % 180;
  return wrapped < 0 ? wrapped + 180 : wrapped;
}

/**
 * Plan a blend across two or more objects.
 *
 * A single object cannot blend with anything, so the plan returned for one (or
 * none) leaves the parameters untouched and reports full density - the caller
 * can apply it without special-casing, and nothing changes.
 *
 * Angles are spread evenly around the 180 degrees a fill repeats over: two
 * fills end up a quarter turn apart (a crosshatch, the classic blend), three a
 * sixth apart, and so on. The first object keeps its own angle as the base so
 * blending does not silently re-aim work the user already set.
 */
export function planBlend(targets: BlendTarget[], options: BlendOptions = {}): BlendPlan {
  const count = targets.length;

  if (count < 2) {
    return {
      adjustments: targets.map((t) => ({
        id: t.id,
        angle: normalizeFillAngle(t.params.angle),
        spacing: t.params.spacing,
      })),
      densityFraction: 1,
    };
  }

  const multiplier = Math.max(0.1, Math.min(3, options.densityMultiplier ?? 1));
  const step = 180 / count;
  const baseAngle = normalizeFillAngle(targets[0]!.params.angle);

  const adjustments = targets.map((t, i) => {
    // The pitch grows by the number of fills sharing the area, which is what
    // turns N full-density fills into N interleaved light ones.
    const spacing = Math.max(MIN_PITCH, Math.min(MAX_PITCH, t.params.spacing * count * multiplier));

    return {
      id: t.id,
      angle: normalizeFillAngle(baseAngle + step * i),
      spacing,
    };
  });

  return { adjustments, densityFraction: 1 / count };
}

/**
 * Whether a set of objects can meaningfully be blended.
 *
 * Blending needs something to blend: at least two objects. Run and satin
 * fills are excluded because their density is not a row pitch you can share -
 * a run is a single line, and a satin column's spacing sets the zig-zag across
 * the column rather than coverage of an area.
 */
export function canBlend(params: StitchParameters[]): boolean {
  if (params.length < 2) return false;
  return params.every(
    (p) =>
      p.stitchType === 'tatami' ||
      p.stitchType === 'motif' ||
      p.stitchType === 'contour' ||
      p.stitchType === 'spiral',
  );
}
