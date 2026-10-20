/**
 * Production statistics.
 *
 * Split out of the package index so that other engine modules (multi-hoop
 * splitting, for instance) can recompute per-section stats without importing
 * the index - which would be circular, since the index is what re-exports
 * them to the outside world.
 */

import type { Stitch, StitchStats } from './types.js';
import { maxStitchLength } from './stitches/index.js';
import { LIMITS } from './validation/index.js';

/** Compute production statistics from a generated sequence. */
export function computeStats(stitches: Stitch[]): StitchStats {
  let sew = 0;
  let jumps = 0;
  let trims = 0;
  let colorChanges = 0;
  let locks = 0;
  let short = 0;

  for (const s of stitches) {
    switch (s.command) {
      case 'stitch':
        sew++;
        break;
      case 'jump':
        jumps++;
        break;
      case 'trim':
        trims++;
        break;
      case 'colorChange':
        colorChanges++;
        break;
      case 'lock':
        locks++;
        break;
      default:
        break;
    }
  }

  // Short-stitch detection over sew stitches only.
  for (let i = 1; i < stitches.length; i++) {
    const a = stitches[i - 1]!;
    const b = stitches[i]!;
    if (b.command !== 'stitch') continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > 0 && d < LIMITS.minUsefulStitchLength) short++;
  }

  return {
    totalStitches: stitches.length,
    sewStitches: sew,
    jumps,
    trims,
    colorChanges,
    locks,
    maxStitchLength: maxStitchLength(
      stitches.map((s) => ({
        x: s.x,
        y: s.y,
        command: s.command === 'stitch' ? 'stitch' : ('jump' as never),
      })),
    ),
    shortStitches: short,
  };
}
