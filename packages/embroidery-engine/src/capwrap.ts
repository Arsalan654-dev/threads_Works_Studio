/**
 * Cap-frame wrap geometry.
 *
 * A cap is sewn on a curved frame, not a flat table. The design is authored
 * flat, so two different views are useful:
 *
 *  - **Preview** projects flat X positions onto the crown as seen from the
 *    front. It is a sine projection: points near the edge move inward and sit
 *    deeper in the cylinder.
 *  - **Compensation** is the inverse operation applied to the machine file.
 *    It stretches X toward the edges by arcsin so that when the machine wraps
 *    that file around the crown, the finished design keeps the widths the
 *    operator drew.
 *
 * The model assumes the frame's X axis follows the crown's arc length and the
 * cap is a circular cylinder. That is the standard approximation used for cap
 * driver compensation; it is deliberately documented rather than hidden.
 */

import type { CapWrapSettings, Point, Stitch } from './types.js';

export interface CapWrapTransform {
  settings: CapWrapSettings;
  /** X coordinate of the design's centre on the cap, in mm. */
  centerX: number;
}

export interface CapPreviewPoint {
  x: number;
  y: number;
  /** 1 at the centre of the crown, falling toward 0 at the edges. */
  depth: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function capRadius(settings: CapWrapSettings): number {
  return Number.isFinite(settings.radiusMm)
    ? clamp(Math.abs(settings.radiusMm), 20, 400)
    : 90;
}

/** Project a flat point onto the front view of the crown. */
export function capPreviewPoint(point: Point, transform: CapWrapTransform): CapPreviewPoint {
  const radius = capRadius(transform.settings);
  const angle = (point.x - transform.centerX) / radius;
  return {
    x: transform.centerX + radius * Math.sin(angle),
    y: point.y,
    depth: Math.cos(angle),
  };
}

/**
 * Inverse projection for the machine file. A point at flat X is stretched
 * outward along the arc so its projected position lands back on the drawn X.
 */
export function compensateCapPoint(point: Point, transform: CapWrapTransform): Point {
  const radius = capRadius(transform.settings);
  const ratio = clamp((point.x - transform.centerX) / radius, -0.999, 0.999);
  return {
    x: transform.centerX + radius * Math.asin(ratio),
    y: point.y,
  };
}

/** Apply compensation to a complete sequence, preserving commands. */
export function compensateCapStitches(
  stitches: Stitch[],
  transform: CapWrapTransform,
): Stitch[] {
  return stitches.map((stitch) => {
    const p = compensateCapPoint(stitch, transform);
    return { ...stitch, x: p.x, y: p.y };
  });
}

export interface CapWrapSpan {
  minX: number;
  maxX: number;
  /** Flat X that maps to the middle of the crown. */
  centerX: number;
}

/**
 * A problem the UI can show before export, or null when the values are sane.
 *
 * Without a span the check uses the design's total width around its own
 * midpoint. Callers that know the actual bounds should pass them: a design can
 * be narrow and still hang off one side of the crown, which makes the edge
 * ratio exceed one even though the total width looks acceptable.
 */
export function capWrapProblem(
  settings: CapWrapSettings,
  designWidthMm: number,
  span?: CapWrapSpan,
): string | null {
  if (!settings.enabled) return null;
  if (!Number.isFinite(settings.radiusMm)) return 'Enter a cap crown radius in millimetres.';
  if (settings.radiusMm < 40) return 'A cap crown radius below 40 mm is not physically plausible.';
  if (settings.radiusMm > 250) return 'A cap crown radius above 250 mm is effectively flat.';
  const half = span
    ? Math.max(Math.abs(span.minX - span.centerX), Math.abs(span.maxX - span.centerX))
    : Math.abs(designWidthMm) / 2;
  if (half >= settings.radiusMm) {
    return `This design is ${designWidthMm.toFixed(1)} mm wide; a ${settings.radiusMm.toFixed(0)} mm crown can wrap less than that. Increase the radius, narrow the design or centre it on the cap.`;
  }
  return null;
}

/** A 0-1 shade used by the cap preview to suggest curvature. */
export function capDepthShade(depth: number): number {
  return clamp((depth + 1) / 2, 0, 1);
}
