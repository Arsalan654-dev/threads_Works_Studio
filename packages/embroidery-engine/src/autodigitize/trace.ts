/**
 * Contour tracing for auto-digitizing.
 *
 * Turns a binary mask into closed polygons by walking the "cracks" between
 * inside and outside pixels. Every pixel boundary edge is emitted once as a
 * directed edge with the region on its right; walking those edges therefore
 * yields exact pixel-corner polygons with no interpolation, and holes fall out
 * as loops that wind the other way.
 *
 * Corners are integer lattice points over a (width+1) x (height+1) grid, so a
 * region touching the image edge still closes cleanly.
 */

import type { Point } from '../types.js';

export interface PixelLoop {
  /** Corners in pixel units, first point not repeated at the end. */
  points: Point[];
  /** Signed shoelace area: positive for an outer ring, negative for a hole. */
  area: number;
}

interface Edge {
  ex: number;
  ey: number;
  dx: number;
  dy: number;
  used: boolean;
}

/** Shoelace area; the sign tells an outer ring from a hole. */
export function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Turn preference, highest first. At a pinch point - two parts of a region
 * touching only at a corner - taking the leftmost turn keeps the walk on one
 * sheet instead of welding the two into a single self-touching loop.
 */
function turnScore(ax: number, ay: number, bx: number, by: number): number {
  const cross = ax * by - ay * bx;
  const dot = ax * bx + ay * by;
  if (cross < 0) return 2; // left
  if (cross === 0) return dot > 0 ? 1 : -1; // straight, or back the way we came
  return 0; // right
}

/**
 * Trace every connected boundary of a mask.
 *
 * @param mask one byte per pixel; non-zero means inside
 */
export function traceMask(mask: Uint8Array, width: number, height: number): PixelLoop[] {
  const stride = width + 1;
  const edges = new Map<number, Edge[]>();

  const isInside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] !== 0;

  const addEdge = (sx: number, sy: number, ex: number, ey: number): void => {
    const key = sy * stride + sx;
    let list = edges.get(key);
    if (list === undefined) {
      list = [];
      edges.set(key, list);
    }
    list.push({ ex, ey, dx: ex - sx, dy: ey - sy, used: false });
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInside(x, y)) continue;
      // The region is always on the right of the direction of travel.
      if (!isInside(x, y - 1)) addEdge(x, y, x + 1, y); // top edge, going right
      if (!isInside(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1); // right edge, going down
      if (!isInside(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1); // bottom edge, going left
      if (!isInside(x - 1, y)) addEdge(x, y + 1, x, y); // left edge, going up
    }
  }

  const loops: PixelLoop[] = [];

  for (const [startKey, startList] of edges) {
    for (const first of startList) {
      if (first.used) continue;
      first.used = true;

      const startX = startKey % stride;
      const startY = (startKey - startX) / stride;

      const points: Point[] = [{ x: startX, y: startY }];
      let curKey = first.ey * stride + first.ex;
      let curX = first.ex;
      let curY = first.ey;
      let inDx = first.dx;
      let inDy = first.dy;

      let guard = 0;
      const guardLimit = width * height * 4 + 16;

      while (curKey !== startKey && guard++ < guardLimit) {
        points.push({ x: curX, y: curY });

        const outgoing = edges.get(curKey);
        let next: Edge | null = null;
        let bestScore = -Infinity;
        if (outgoing !== undefined) {
          for (const candidate of outgoing) {
            if (candidate.used) continue;
            const score = turnScore(inDx, inDy, candidate.dx, candidate.dy);
            if (score > bestScore) {
              bestScore = score;
              next = candidate;
            }
          }
        }
        if (next === null) break; // open chain: cannot happen for a closed mask

        next.used = true;
        curKey = next.ey * stride + next.ex;
        curX = next.ex;
        curY = next.ey;
        inDx = next.dx;
        inDy = next.dy;
      }

      if (points.length >= 3) loops.push({ points, area: signedArea(points) });
    }
  }

  return loops;
}

/** Ray-casting point-in-polygon, used to attach holes to their outer ring. */
export function pointInRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

/**
 * A point guaranteed to sit inside a ring: the midpoint of the ring's first
 * scanline span, which is inside by construction rather than by luck.
 */
export function interiorPoint(ring: Point[]): Point {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minY)) return { x: 0, y: 0 };

  // Walk a hair below the topmost row, where a span must exist.
  for (let attempt = 0; attempt < 8; attempt++) {
    const y = minY + (maxY - minY) * (attempt / 16) + (maxY > minY ? 1e-6 : 0);
    const crossings: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if (a.y === b.y) continue;
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      if (y < lo || y >= hi) continue;
      crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    crossings.sort((p, q) => p - q);
    if (crossings.length >= 2) {
      return { x: (crossings[0]! + crossings[1]!) / 2, y };
    }
  }

  // Degenerate ring: fall back to the centroid.
  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / ring.length, y: sy / ring.length };
}
