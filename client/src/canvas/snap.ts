/**
 * Object snapping for the canvas.
 *
 * The editor draws in millimetres but the operator aims in pixels, so the
 * threshold is expressed in screen pixels and converted with the current zoom.
 * Nodes win over edges and edges over centres: that order is what makes a
 * several-points-at-one-place outline joinable without hunting for the vertex.
 *
 * Pure geometry with no canvas or store dependency, so the rules are testable
 * without a DOM and the pointer handlers stay small.
 */

import type { EmbroideryObject, Point } from '@threadworks/engine';

export type SnapKind = 'node' | 'edge' | 'centre';

export interface SnapHit {
  x: number;
  y: number;
  kind: SnapKind;
  objectId: string;
  /** Distance from the cursor to the snapped point, in mm. */
  distance: number;
}

export interface SnapOptions {
  /** Pixels per design millimetre (the canvas zoom). */
  scale: number;
  /** How close the cursor has to be, in screen pixels. Default 8. */
  thresholdPx?: number;
  /** Object being edited or dragged; it must not snap to itself. */
  excludeId?: string | null;
}

/** Objects whose path is an open line, not a closed outline. */
function isOpen(type: EmbroideryObject['type']): boolean {
  return type === 'run' || type === 'bean';
}

function distanceToSegment(p: Point, a: Point, b: Point): { distance: number; point: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) {
    return { distance: Math.hypot(p.x - a.x, p.y - a.y), point: { x: a.x, y: a.y } };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return { distance: Math.hypot(p.x - x, p.y - y), point: { x, y } };
}

function centreOf(object: EmbroideryObject): Point | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of object.path.rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Find the nearest object feature within the pixel threshold.
 *
 * Returns null when nothing is close enough, so the caller can fall back to
 * the grid or leave the point where the pointer is. A hidden object is not a
 * snap target - it is not on screen, so catching it would be a surprise.
 */
export function snapToObjects(
  point: Point,
  objects: EmbroideryObject[],
  options: SnapOptions,
): SnapHit | null {
  if (!Number.isFinite(options.scale) || options.scale <= 0) return null;
  const threshold = (options.thresholdPx ?? 8) / options.scale;

  let bestNode: SnapHit | null = null;
  let bestEdge: SnapHit | null = null;
  let bestCentre: SnapHit | null = null;

  for (const object of objects) {
    if (object.hidden) continue;
    if (options.excludeId && object.id === options.excludeId) continue;

    // Photo stitch can carry tens of thousands of cell corners. No operator
    // aims at one of those on purpose, and walking them on every pointer move
    // would make drawing lag; its centre is still a sane snap target.
    const pointCount = object.path.rings.reduce((n, ring) => n + ring.length, 0);
    if (pointCount > 4000) {
      const centre = centreOf(object);
      if (centre) {
        const d = Math.hypot(centre.x - point.x, centre.y - point.y);
        if (d <= threshold && (!bestCentre || d < bestCentre.distance)) {
          bestCentre = {
            x: centre.x,
            y: centre.y,
            kind: 'centre',
            objectId: object.id,
            distance: d,
          };
        }
      }
      continue;
    }

    for (const ring of object.path.rings) {
      for (const node of ring) {
        const d = Math.hypot(node.x - point.x, node.y - point.y);
        if (d <= threshold && (!bestNode || d < bestNode.distance)) {
          bestNode = { x: node.x, y: node.y, kind: 'node', objectId: object.id, distance: d };
        }
      }

      const segments = isOpen(object.type) ? ring.length - 1 : ring.length;
      for (let i = 0; i < segments; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const hit = distanceToSegment(point, a, b);
        // A node hit already wins by kind; keeping the edge candidate here is
        // only for objects whose node is out of range.
        if (hit.distance <= threshold && (!bestEdge || hit.distance < bestEdge.distance)) {
          bestEdge = {
            x: hit.point.x,
            y: hit.point.y,
            kind: 'edge',
            objectId: object.id,
            distance: hit.distance,
          };
        }
      }
    }

    const centre = centreOf(object);
    if (centre) {
      const d = Math.hypot(centre.x - point.x, centre.y - point.y);
      if (d <= threshold && (!bestCentre || d < bestCentre.distance)) {
        bestCentre = { x: centre.x, y: centre.y, kind: 'centre', objectId: object.id, distance: d };
      }
    }
  }

  return bestNode ?? bestEdge ?? bestCentre;
}

/**
 * Snap a point to the grid, if the grid is usable.
 *
 * Kept next to the object rule so the pointer handlers have one place to ask
 * "where should this point really go?" - object geometry first, grid second.
 */
export function snapToGrid(point: Point, gridSize: number): Point {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return point;
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}
