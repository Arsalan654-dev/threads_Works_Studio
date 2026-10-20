/**
 * 3D foam — the technique behind raised "puff" embroidery on caps.
 *
 * A sheet of foam (typically 2–4 mm EVA) is laid on the fabric and a dense
 * satin column is sewn over it. The satin traps the foam, and the excess is
 * torn away by hand afterwards. Three things make it work, and all three are
 * real sewing consequences rather than a rendering trick:
 *
 *  1. **A tack holds the foam.** A normal underlay is a dense bed of stitches
 *     that would lift and skate the foam sheet before the satin arrived. What
 *     foam needs instead is one light run to stop it moving, which is what
 *     `foamTack` produces.
 *  2. **The satin is denser.** Foam shows through anything looser than about
 *     0.30 mm, so the row spacing is capped no matter what the object asks
 *     for. A flat column at 0.40 mm looks fine; the same column over foam
 *     shows the sheet between every pair of rows.
 *  3. **The satin is wider.** The thread has to climb the foam's edge and
 *     still meet fabric on the far side, so the column pulls wider by a share
 *     of the foam's thickness. Without this the letters look pinched and the
 *     foam peeks out along the edges.
 *
 * Every one of these changes the emitted needle penetrations, so what is
 * exported and what the stitch video shows genuinely differs from a flat
 * column — which is the point.
 */

import type { CompoundPath, FoamSettings, Point } from './types.js';
import { dedupePoints, pathLength, pointAtT } from './geometry/index.js';
import { runStitch, type RawStitch } from './stitches/index.js';

/** Foam off by default: a design is flat until someone asks for puff. */
export const DEFAULT_FOAM: FoamSettings = {
  enabled: false,
  thicknessMm: 2,
  tackUnderlay: true,
};

/**
 * Loosest row spacing that still hides foam, in mm.
 *
 * Ordinary satin sits around 0.40 mm and looks solid on fabric. Over foam the
 * same spacing opens gaps you can see the sheet through. 0.30 mm covers
 * without turning the column into a solid thread mass that puckers the cap.
 */
export const FOAM_MAX_SPACING = 0.3;

/**
 * How much of the foam's thickness the column pulls wider, per side.
 *
 * The thread climbs the foam's edge, so the needle lands on a slope and the
 * stitch draws inward more than it would on flat fabric. Widening by a share
 * of the thickness puts the edge back where the drawing says it is: a 2 mm
 * sheet adds 0.7 mm per side, which is visible but not extreme.
 */
export const FOAM_PULL_RATIO = 0.35;

/** Row spacing for a foam column: never looser than the foam can hide. */
export function foamSpacing(base: number): number {
  // A non-finite spacing would silently produce zero rows (or an infinite
  // loop), and a negative one is meaningless - clamp both to the densest
  // setting the machine can still sew.
  const safe = Number.isFinite(base) ? base : FOAM_MAX_SPACING;
  return Math.min(Math.max(safe, 0.05), FOAM_MAX_SPACING);
}

/**
 * Pull compensation for a foam column.
 *
 * Starts from whatever the object already asked for and adds a share of the
 * foam's thickness, because the raised edge steals width that a flat column
 * would keep.
 */
export function foamPullCompensation(base: number, thicknessMm: number): number {
  const thickness = Math.max(0, thicknessMm);
  return base + thickness * FOAM_PULL_RATIO;
}

/**
 * A light tack to hold the foam down for the satin.
 *
 * For a two-rail column this runs down the spine — the midpoint between the
 * rails — because that is where the satin will trap the foam and where a
 * shifting sheet would show first. For a single-ring shape it follows the
 * outline. Either way it is one light run, not a bed of stitches: its only
 * job is to stop the foam moving before the satin takes over.
 *
 * Returns an empty array when the path cannot support one, so a caller can
 * treat "no tack" and "tack skipped" the same way.
 */
export function foamTack(
  path: CompoundPath,
  options: { spacing: number; maxStitchLength: number },
): RawStitch[] {
  const line = columnSpine(path);
  if (line.length < 2) return [];
  const run = runStitch(line, options);
  // Travel to the tack's start rather than sewing a thread across from
  // wherever the needle happened to be - the same convention the other
  // underlays follow.
  if (run.length > 0) {
    run.unshift({ x: run[0]!.x, y: run[0]!.y, command: 'jump' });
  }
  return run;
}

/**
 * The line down the middle of a satin column.
 *
 * Sampled by walking both rails at matching arc-length fractions and taking
 * the midpoint of each pair, which follows a curving column correctly — a
 * straight average of the bounds would cut the corner on a bent letter. When
 * the shape is a single closed ring rather than a pair of rails, the outline
 * itself is the best available line to tack along.
 */
function columnSpine(path: CompoundPath): Point[] {
  const left = path.rings[0];
  const right = path.rings[1];

  if (left !== undefined && right !== undefined && left.length >= 2 && right.length >= 2) {
    const track = Math.max(pathLength(left), pathLength(right));
    if (track <= 0) return [];
    // One sample every 1.5 mm is fine for a tack: it is a holding line, not
    // a decorative edge, and finer sampling would only add travel.
    const samples = Math.max(2, Math.round(track / 1.5));
    const spine: Point[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const a = pointAtT(left, t);
      const b = pointAtT(right, t);
      spine.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    return spine;
  }

  const ring = path.rings[0];
  if (ring === undefined || ring.length < 2) return [];
  return dedupePoints([...ring, { ...ring[0]! }]);
}
