/**
 * Computational geometry primitives for the stitch engine.
 *
 * Conventions
 * -----------
 *  - All coordinates are millimeters.
 *  - Rings are CLOSED polylines whose first point is not repeated at the end.
 *  - Compound shapes use the even-odd rule, so holes work by nesting.
 *  - Screen Y points down; machine Y points up. Conversion happens only at export.
 */

import type { Bounds, CompoundPath, Point, Ring } from '../types.js';

export const TAU = Math.PI * 2;
export const EPS = 1e-9;

/** Rotate a point around a center by `radians`. */
export function rotatePoint(p: Point, radians: number, cx = 0, cy = 0): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Degrees -> radians. */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Bounding box of one or more rings. */
export function boundsOf(rings: Ring[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Bounds of a compound path. */
export function pathBounds(path: CompoundPath): Bounds {
  return boundsOf(path.rings);
}

/** Width of a bounds box. */
export function boundsWidth(b: Bounds): number {
  return b.maxX - b.minX;
}

/** Height of a bounds box. */
export function boundsHeight(b: Bounds): number {
  return b.maxY - b.minY;
}

/** Center of a bounds box. */
export function boundsCenter(b: Bounds): Point {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Union of two bounds. */
export function unionBounds(a: Bounds, b: Bounds): Bounds {
  if (!Number.isFinite(a.minX)) return { ...b };
  if (!Number.isFinite(b.minX)) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Expand bounds by a margin on every side. */
export function inflateBounds(b: Bounds, margin: number): Bounds {
  return {
    minX: b.minX - margin,
    minY: b.minY - margin,
    maxX: b.maxX + margin,
    maxY: b.maxY + margin,
  };
}

/** Are two bounds overlapping (touching counts)? */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

/**
 * Signed area of a ring. Positive when the winding runs counter-clockwise
 * in a Y-up frame (clockwise on a Y-down canvas).
 */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** Absolute area of a ring. */
export function areaOf(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

/** Area of a compound path (outer minus holes), using absolute values. */
export function compoundArea(path: CompoundPath): number {
  if (path.rings.length === 0) return 0;
  let total = areaOf(path.rings[0]!);
  for (let i = 1; i < path.rings.length; i++) {
    total -= areaOf(path.rings[i]!);
  }
  return Math.max(0, total);
}

/** Total length of a polyline. */
export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Point-in-shape test using the even-odd rule across every ring.
 * A point inside the outer ring AND inside a hole crosses an even number of
 * edges and is therefore reported outside - holes need no special handling.
 */
export function containsPoint(path: CompoundPath, pt: Point): boolean {
  let inside = false;
  for (const ring of path.rings) {
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      const straddles = a.y > pt.y !== b.y > pt.y;
      if (!straddles) continue;
      const t = (pt.y - a.y) / (b.y - a.y);
      const x = a.x + t * (b.x - a.x);
      if (pt.x < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Horizontal scanline intersection with a set of rings (even-odd rule).
 *
 * Uses a half-open edge interval [yMin, yMax) so that a vertex shared by two
 * consecutive edges is counted exactly once. Without this, rows that land
 * exactly on a corner produce a spurious extra crossing and the fill leaks.
 *
 * @returns sorted [xStart, xEnd] spans crossed by the scanline
 */
export function scanlineSpans(rings: Ring[], y: number): Array<[number, number]> {
  const crossings: number[] = [];

  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      if (a.y === b.y) continue;

      const yMin = Math.min(a.y, b.y);
      const yMax = Math.max(a.y, b.y);
      if (y < yMin || y >= yMax) continue;

      const t = (y - a.y) / (b.y - a.y);
      crossings.push(a.x + t * (b.x - a.x));
    }
  }

  crossings.sort((p, q) => p - q);

  const spans: Array<[number, number]> = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const start = crossings[i]!;
    const end = crossings[i + 1]!;
    if (end - start > EPS) spans.push([start, end]);
  }
  return spans;
}

/**
 * Douglas-Peucker simplification.
 *
 * Reduces auto-traced contour noise without destroying shape character.
 */
export function simplifyPath(points: Point[], tolerance = 0.05): Point[] {
  if (points.length <= 2) return points.slice();

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    const a = points[start]!;
    const b = points[end]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;

    let maxDist = -1;
    let maxIndex = -1;

    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      let dist: number;
      if (lenSq < EPS) {
        dist = Math.hypot(p.x - a.x, p.y - a.y);
      } else {
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
        const cx = a.x + t * dx;
        const cy = a.y + t * dy;
        dist = Math.hypot(p.x - cx, p.y - cy);
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > tolerance && maxIndex > 0) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }

  return points.filter((_, i) => keep[i]!);
}

/**
 * Resample a polyline so consecutive points are about `spacing` apart.
 * Endpoints are always preserved so the path does not shrink.
 */
export function resample(points: Point[], spacing: number): Point[] {
  if (points.length < 2 || spacing <= 0) return points.slice();

  const out: Point[] = [{ ...points[0]! }];
  let carry = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < EPS) continue;

    let distance = spacing - carry;
    while (distance < segLen) {
      const t = distance / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      distance += spacing;
    }
    carry = segLen - (distance - spacing);
  }

  const last = out[out.length - 1]!;
  const end = points[points.length - 1]!;
  if (Math.hypot(last.x - end.x, last.y - end.y) > EPS * 10) out.push({ ...end });
  else out[out.length - 1] = { ...end };

  return out;
}

/**
 * Insert intermediate points so no segment exceeds `maxLength`.
 * Required because Tajima DST cannot encode a single move beyond 12.1 mm.
 */
export function splitLongSegments(points: Point[], maxLength: number): Point[] {
  if (maxLength <= 0) return points.slice();

  const out: Point[] = [{ ...points[0]! }];
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1]!;
    const b = points[i]!;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const parts = Math.ceil(dist / maxLength);
    for (let k = 1; k <= parts; k++) {
      const t = k / parts;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Sample a cubic Bezier (inclusive of both endpoints). */
export function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, steps = 16): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/** Sample a quadratic Bezier. */
export function sampleQuadratic(p0: Point, p1: Point, p2: Point, steps = 12): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  return out;
}

/** Rectangle ring. */
export function rectanglePath(x: number, y: number, w: number, h: number): CompoundPath {
  return {
    rings: [
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    ],
  };
}

/** Ellipse / circle ring approximated with `segments` points. */
export function ellipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  segments = 72,
): CompoundPath {
  const ring: Ring = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    ring.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return { rings: [ring] };
}

/** Regular polygon ring with `sides` edges inscribed in radius `radius`. */
export function polygonPath(cx: number, cy: number, radius: number, sides = 6): CompoundPath {
  const ring: Ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU - Math.PI / 2;
    ring.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return { rings: [ring] };
}

/** Star ring with `points` spikes. */
export function starPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  points = 5,
): CompoundPath {
  const ring: Ring = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    ring.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { rings: [ring] };
}

/**
 * Build the two boundary "rails" of a satin column from a center stroke.
 *
 * This is the geometric core of Input A / column digitizing: every point on
 * the stroke gets a normal, and the rails sit +/- width/2 along it. When the
 * rails are later sampled at matching parameter values, the needle
 * penetrations fall straight across the column.
 */
export function railsFromStroke(stroke: Point[], width: number): { left: Point[]; right: Point[] } {
  if (stroke.length < 2) {
    return { left: stroke.slice(), right: stroke.slice() };
  }

  const half = width / 2;
  const left: Point[] = [];
  const right: Point[] = [];

  for (let i = 0; i < stroke.length; i++) {
    const prev = stroke[Math.max(0, i - 1)]!;
    const next = stroke[Math.min(stroke.length - 1, i + 1)]!;
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);

    if (len < EPS) {
      dx = 1;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }

    const nx = -dy;
    const ny = dx;
    const p = stroke[i]!;
    left.push({ x: p.x + nx * half, y: p.y + ny * half });
    right.push({ x: p.x - nx * half, y: p.y - ny * half });
  }

  return { left, right };
}

/** Point at normalized position `t` (0..1) along a polyline by arc length. */
export function pointAtT(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || t <= 0) return { ...points[0]! };
  if (t >= 1) return { ...points[points.length - 1]! };

  const total = pathLength(points);
  if (total < EPS) return { ...points[0]! };

  const target = total * t;
  let travelled = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (travelled + seg >= target) {
      const u = seg < EPS ? 0 : (target - travelled) / seg;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    travelled += seg;
  }

  return { ...points[points.length - 1]! };
}

/** Rotate every ring of a path around a center. */
export function rotatePath(path: CompoundPath, radians: number, center: Point): CompoundPath {
  return {
    rings: path.rings.map((ring) => ring.map((p) => rotatePoint(p, radians, center.x, center.y))),
  };
}

/** Translate a path. */
export function translatePath(path: CompoundPath, dx: number, dy: number): CompoundPath {
  return { rings: path.rings.map((ring) => ring.map((p) => ({ x: p.x + dx, y: p.y + dy }))) };
}

/**
 * Remove consecutive duplicate and zero-length segments.
 * Traced artwork routinely contains these; they break normals and scanlines.
 */
export function dedupePoints(points: Point[], tolerance = 1e-6): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tolerance) out.push({ ...p });
  }
  return out;
}

/** Close a ring if it is not already closed (removes a trailing duplicate). */
export function normalizeRing(ring: Ring): Ring {
  let pts = dedupePoints(ring);
  if (pts.length > 1) {
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) pts = pts.slice(0, -1);
  }
  return pts;
}
