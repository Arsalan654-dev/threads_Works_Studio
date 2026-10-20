/**
 * Minimum stitch length filtering.
 *
 * A machine cannot sew an arbitrarily short stitch: below roughly a needle
 * width the penetration lands on top of the previous one, the thread loops,
 * and the machine buries a knot in the fabric. Real digitizing packages
 * therefore collapse sub-minimum stitches instead of exporting them.
 *
 * This is a *shape preserving* filter, not a naive decimation. Naively
 * dropping every short point would truncate every run at its end - the last
 * point of a satin row is short by construction, because rows end where the
 * rail ends and not on a spacing boundary. So the rule is:
 *
 *   - a point is dropped only when it is closer to the last point the machine
 *     will actually sew than `minLength`; and
 *   - the final point of a run is always kept, so the shape still ends where
 *     the generator put it.
 *
 * The error this introduces is bounded by `minLength` itself: a point is only
 * ever folded into a neighbour that is closer together than the user asked
 * for. Commands other than `stitch` (jump, trim, colour change) are hard
 * barriers - they are machine instructions, not geometry, and collapsing
 * across one would delete a trim the operator is relying on.
 */

import type { StitchCommand } from '../types.js';

/** A generated point, matching the engine's raw stitch shape. */
export interface LengthPoint {
  x: number;
  y: number;
  command: StitchCommand;
}

/**
 * Collapse runs of stitches shorter than `minLength` millimetres.
 *
 * Returns the input untouched when `minLength` is not a positive finite
 * number, so callers can pass a stored setting straight through without
 * having to validate it first.
 */
export function mergeShortStitches<T extends LengthPoint>(
  points: readonly T[],
  minLength: number,
): T[] {
  if (!Number.isFinite(minLength) || minLength <= 0 || points.length < 2) return points as T[];

  const out: T[] = [];
  /** Last point emitted, or null when the last item was a command barrier. */
  let lastKept: T | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;

    // Commands are barriers: emit verbatim and reset, since a jump lands
    // wherever the needle goes rather than a measured step from before.
    if (p.command !== 'stitch') {
      out.push(p);
      lastKept = null;
      continue;
    }

    if (lastKept === null) {
      out.push(p);
      lastKept = p;
      continue;
    }

    // Measure from the last point the machine will actually sew to, not from
    // the previous candidate: the guarantee that matters is the one between
    // two consecutive needle penetrations.
    if (Math.hypot(p.x - lastKept.x, p.y - lastKept.y) >= minLength) {
      out.push(p);
      lastKept = p;
      continue;
    }

    // Too short to sew on its own. Drop it - unless it is the last point of
    // the run, which is where the shape ends and so must survive.
    const next = points[i + 1];
    if (!next || next.command !== 'stitch') {
      out.push(p);
      lastKept = p;
    }
  }

  return out;
}
