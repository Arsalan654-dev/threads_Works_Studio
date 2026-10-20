/**
 * Redwork line automation.
 *
 * Redwork is one-colour line embroidery: the design is an outline, not a fill,
 * and the character comes from how the line itself is sewn. The four styles
 * here are the traditional machine interpretations:
 *
 * - single    one run along the line
 * - triple    three passes over the same line, for a bold cord
 * - backstitch each step is sewn forward then back into the previous hole
 * - stem      short slanted stitches that overlap like a rope
 *
 * The geometric outline is never replaced: redwork is a parameter on the
 * object, so switching it off brings the original fill back. Generation is a
 * pure function of the rings plus the settings, like every other stitch type.
 */

import type { CompoundPath, Point, RedworkSettings, RedworkStyle } from './types.js';
import type { RawStitch } from './stitches/index.js';
import { dedupePoints } from './geometry/index.js';

export const REDWORK_LIMITS = {
  minWidthMm: 0.2,
  maxWidthMm: 6,
  minStitchMm: 0.5,
  maxStitchMm: 8,
} as const;

const DEFAULTS = {
  style: 'single' as RedworkStyle,
  widthMm: 1.2,
  stitchMm: 2.5,
};

/** Off by default: an object is an ordinary fill or line until asked. */
export const DEFAULT_REDWORK: RedworkSettings = {
  enabled: false,
  style: DEFAULTS.style,
  widthMm: DEFAULTS.widthMm,
  stitchMm: DEFAULTS.stitchMm,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Normalize a stored setting, or null when redwork is off. */
export function redworkSettings(input?: Partial<RedworkSettings> | null): RedworkSettings | null {
  if (!input || input.enabled !== true) return null;

  const style: RedworkStyle =
    input.style === 'triple' ||
    input.style === 'backstitch' ||
    input.style === 'stem' ||
    input.style === 'single'
      ? input.style
      : DEFAULTS.style;

  const widthMm = Number.isFinite(input.widthMm)
    ? clamp(input.widthMm as number, REDWORK_LIMITS.minWidthMm, REDWORK_LIMITS.maxWidthMm)
    : DEFAULTS.widthMm;
  const stitchMm = Number.isFinite(input.stitchMm)
    ? clamp(input.stitchMm as number, REDWORK_LIMITS.minStitchMm, REDWORK_LIMITS.maxStitchMm)
    : DEFAULTS.stitchMm;

  return { enabled: true, style, widthMm, stitchMm };
}

export interface RedworkOptions {
  /** Closed shapes are outlined; runs and beans stay open lines. */
  closed: boolean;
  /** Hard limit for a single stitch span. */
  maxStitchLength: number;
}

function stitch(p: Point): RawStitch {
  return { x: p.x, y: p.y, command: 'stitch' };
}

/**
 * Resample a line while keeping every vertex.
 *
 * The generic `resample` walks by arc length across segment boundaries, which
 * can skip a corner when the step does not divide the segment - fine for a
 * smooth fill, but a redwork outline that cuts the corner is simply the wrong
 * shape. Subdividing each segment individually puts a penetration exactly on
 * every corner and keeps every stitch at or under the requested step.
 */
function resampleLine(points: Point[], spacing: number): Point[] {
  if (points.length < 2) return points.slice();
  const step = Math.max(0.05, spacing);
  const out: Point[] = [{ ...points[0]! }];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const parts = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= parts; k++) {
      const t = k / parts;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }

  return out;
}

/** A ring as a line, with the first point repeated when it is closed. */
function linePoints(ring: Point[], closed: boolean): Point[] {
  const clean = dedupePoints(ring);
  if (!closed || clean.length < 2) return clean;

  const first = clean[0]!;
  const last = clean[clean.length - 1]!;
  if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-7) clean.push({ ...first });
  return clean;
}

/** Trim and jump to the next ring so separate lines are not joined by thread. */
function breakBefore(out: RawStitch[], at: Point): void {
  if (out.length === 0) return;
  out.push({ x: at.x, y: at.y, command: 'trim' });
  out.push({ x: at.x, y: at.y, command: 'jump' });
}

function emitSingle(out: RawStitch[], points: Point[], maxStitch: number, step: number): void {
  const path = resampleLine(points, clamp(step, 0.1, maxStitch));
  for (const p of path) out.push(stitch(p));
}

function emitTriple(out: RawStitch[], points: Point[], maxStitch: number, step: number): void {
  const path = resampleLine(points, clamp(step, 0.1, maxStitch));
  if (path.length < 2) return;

  // Forward, back, forward. The first point of each continuation pass is the
  // point the needle is already at, so it is skipped rather than sewn as a
  // zero-length stitch.
  for (const p of path) out.push(stitch(p));
  for (const p of path.slice(0, -1).reverse()) out.push(stitch(p));
  for (const p of path.slice(1)) out.push(stitch(p));
}

function emitBackstitch(out: RawStitch[], points: Point[], maxStitch: number, step: number): void {
  // A forward advance is two steps so the return is one step: every stitch
  // lands in the hole the previous one made, which is the hand motion.
  const capped = clamp(step, 0.25, Math.max(0.25, maxStitch / 2));
  const path = resampleLine(points, capped);
  if (path.length < 2) return;

  for (let i = 0; i < path.length; i++) {
    out.push(stitch(path[i]!));
    if (i > 0) out.push(stitch(path[i - 1]!));
  }
  // Finish on the last point instead of one step short of it.
  out.push(stitch(path[path.length - 1]!));
}

function normalAt(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function emitStem(
  out: RawStitch[],
  points: Point[],
  maxStitch: number,
  step: number,
  widthMm: number,
): void {
  const width = clamp(
    widthMm,
    REDWORK_LIMITS.minWidthMm,
    Math.min(REDWORK_LIMITS.maxWidthMm, maxStitch * 0.8),
  );
  const half = width / 2;
  // The stitch spans a step along the line and the full width across it.
  const along = Math.max(
    0.2,
    Math.min(step / 2, Math.sqrt(Math.max(0.01, maxStitch ** 2 - width ** 2))),
  );
  const path = resampleLine(points, along);
  if (path.length < 2) return;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const n = normalAt(a, b);
    out.push({ x: a.x + n.x * half, y: a.y + n.y * half, command: 'stitch' });
    out.push({ x: b.x - n.x * half, y: b.y - n.y * half, command: 'stitch' });
  }
  // Finish on the centre line so an open line ends where the drawing does.
  const end = path[path.length - 1]!;
  out.push(stitch(end));
}

/**
 * Generate the stitches for one redwork object.
 *
 * Every ring is a continuous line. Multi-ring objects (a fill with holes, for
 * example) get separate passes joined by a trim and a jump, because a thread
 * crossing the shape would show through the work.
 */
export function redworkStitches(
  path: CompoundPath,
  settings: RedworkSettings,
  options: RedworkOptions,
): RawStitch[] {
  const out: RawStitch[] = [];
  const maxStitch = Math.max(0.5, options.maxStitchLength);

  for (const ring of path.rings) {
    const points = linePoints(ring, options.closed);
    if (points.length < 2) continue;

    breakBefore(out, points[0]!);

    switch (settings.style) {
      case 'triple':
        emitTriple(out, points, maxStitch, settings.stitchMm);
        break;
      case 'backstitch':
        emitBackstitch(out, points, maxStitch, settings.stitchMm);
        break;
      case 'stem':
        emitStem(out, points, maxStitch, settings.stitchMm, settings.widthMm);
        break;
      case 'single':
      default:
        emitSingle(out, points, maxStitch, settings.stitchMm);
        break;
    }
  }

  return out;
}
