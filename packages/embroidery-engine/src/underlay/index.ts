/**
 * Underlay generation.
 *
 * Underlay is sewn BEFORE the top stitch. Its job is to anchor the fabric,
 * stop it stretching under thread tension, and give the top stitch a stable
 * base to sit on. Getting this wrong is the usual cause of puckered or
 * misregistered embroidery.
 *
 * Strategies
 * ---------
 *  - centerRun : a single run along the object's spine. Cheap, good for fills.
 *  - edgeRun   : a run following the boundary, inset slightly. Stabilises edges.
 *  - zigzag    : sparse crossing stitches. Good under satin columns.
 *  - tatami    : coarse grid. Used for large fills and puff embroidery.
 */

import type { CompoundPath, Point, UnderlaySettings } from '../types.js';
import {
  boundsCenter,
  boundsOf,
  dedupePoints,
  pathLength,
  pointAtT,
  railsFromStroke,
  resample,
  rotatePath,
  rotatePoint,
  scanlineSpans,
  toRadians,
} from '../geometry/index.js';
import { DEFAULT_TATAMI, tatamiFill, type RawStitch } from '../stitches/index.js';

const SEW = 'stitch' as const;
const JUMP = 'jump' as const;
/**
 * Tie-in / tie-off stitches are a distinct command, not ordinary stitches:
 * they are intentionally tiny (sub-millimetre) so counting them as `stitch`
 * would drag the average stitch length down and trip the short-stitch
 * validator on every design. The DST encoder maps `lock` back onto a normal
 * needle penetration, since DST has no separate lock code.
 */
const LOCK = 'lock' as const;

export const DEFAULT_UNDERLAY: UnderlaySettings = {
  type: 'none',
  spacing: 1.5,
  offset: 0.4,
  inset: 0.5,
};

/**
 * Generate underlay stitches for a compound shape.
 *
 * Returns an empty array when the strategy is `none`, so callers can skip the
 * work entirely.
 */
export function generateUnderlay(
  path: CompoundPath,
  settings: UnderlaySettings,
  stitchAngle: number,
): RawStitch[] {
  if (settings.type === 'none') return [];
  if (path.rings.length === 0 || path.rings[0]!.length < 3) return [];

  switch (settings.type) {
    case 'centerRun':
      return centerRunUnderlay(path, stitchAngle);
    case 'edgeRun':
      return edgeRunUnderlay(path, settings);
    case 'zigzag':
      return zigzagUnderlay(path, settings, stitchAngle);
    case 'tatami':
      return tatamiUnderlay(path, settings, stitchAngle);
    default:
      return [];
  }
}

/**
 * A run stitch down the middle of the shape along the fill angle.
 *
 * Computed by intersecting the shape with scanlines through its center and
 * keeping the longest crossing, which stays inside the boundary for any
 * convex or simply-concave shape.
 */
function centerRunUnderlay(path: CompoundPath, angleDeg: number): RawStitch[] {
  const center = boundsCenter(boundsOf(path.rings));
  const angle = -toRadians(angleDeg);
  const rotated = rotatePath(path, angle, center);
  const box = boundsOf(rotated.rings);

  // The mid scanline of the rotated box is the spine.
  const midY = (box.minY + box.maxY) / 2;
  const spans = scanlineSpans(rotated.rings, midY);
  if (spans.length === 0) return [];

  // Use the widest crossing as the spine.
  let best = spans[0]!;
  for (const s of spans) {
    if (s[1] - s[0] > best[1] - best[0]) best = s;
  }

  const spine: Point[] = [
    { x: best[0], y: midY },
    { x: best[1], y: midY },
  ];

  const back = -angle;
  const world = spine.map((p) => rotatePoint(p, back, center.x, center.y));
  const sampled = resample(world, 3);

  return sampled.map((p, i) => ({
    x: p.x,
    y: p.y,
    command: i === 0 ? JUMP : SEW,
  }));
}

/**
 * A run following the outline, pulled in by `offset` mm.
 *
 * Sewing the edge first keeps fill stitches from pulling the boundary inward
 * and gives a crisp outline on textured fabrics.
 */
function edgeRunUnderlay(path: CompoundPath, settings: UnderlaySettings): RawStitch[] {
  const out: RawStitch[] = [];
  const inset = Math.max(0.1, settings.offset);
  // Tracks the last point across rings so ring-to-ring travel can jump.
  let prev: Point | null = null;

  for (let r = 0; r < path.rings.length; r++) {
    const ring = path.rings[r]!;
    if (ring.length < 3) continue;

    const center = boundsCenter(boundsOf([ring]));
    const moved = ring.map((p) => {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const len = Math.hypot(dx, dy) || 1;
      // Pull holes outward and the outer boundary inward.
      const sign = r === 0 ? -1 : 1;
      return { x: p.x + (dx / len) * inset * sign, y: p.y + (dy / len) * inset * sign };
    });

    const closed = [...moved, moved[0]!];
    const sampled = resample(closed, Math.max(0.5, settings.spacing));

    for (const p of sampled) {
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > 8) {
        out.push({ x: p.x, y: p.y, command: JUMP });
      } else if (prev === null) {
        out.push({ x: p.x, y: p.y, command: JUMP });
      }
      out.push({ x: p.x, y: p.y, command: SEW });
      prev = p;
    }
  }

  return out;
}

/**
 * Sparse zigzag underlay across the shape.
 *
 * Rows run perpendicular to the top stitch angle so the two layers lock
 * together instead of sliding over one another.
 */
function zigzagUnderlay(
  path: CompoundPath,
  settings: UnderlaySettings,
  topAngleDeg: number,
): RawStitch[] {
  const spacing = Math.max(0.5, settings.spacing);
  const crossAngle = topAngleDeg + 90;

  const center = boundsCenter(boundsOf(path.rings));
  const angle = -toRadians(crossAngle);
  const rotated = rotatePath(path, angle, center);
  const box = boundsOf(rotated.rings);
  if (box.maxX - box.minX <= 0 || box.maxY - box.minY <= 0) return [];

  const out: RawStitch[] = [];
  const rowStart = box.minY + spacing / 2;
  const rowEnd = box.maxY - spacing / 2;

  for (let y = rowStart, row = 0; y <= rowEnd; y += spacing, row++) {
    const spans = scanlineSpans(rotated.rings, y);
    for (const [x1, x2] of spans) {
      out.push({ x: x1, y, command: out.length === 0 ? JUMP : SEW });
      out.push({ x: x2, y, command: SEW });
    }
  }

  const back = -angle;
  for (const st of out) {
    const p = rotatePoint({ x: st.x, y: st.y }, back, center.x, center.y);
    st.x = p.x;
    st.y = p.y;
  }

  // Break rows apart where the needle must travel.
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!;
    const b = out[i]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) > spacing * 3) b.command = JUMP;
  }

  return out;
}

/**
 * Coarse tatami underlay: a wide-pitch fill in the opposite direction.
 *
 * Used for large fills and is the base layer for puff / 3D foam embroidery,
 * where the top stitch density is high enough to need real support.
 */
function tatamiUnderlay(
  path: CompoundPath,
  settings: UnderlaySettings,
  topAngleDeg: number,
): RawStitch[] {
  return tatamiFill(path, {
    ...DEFAULT_TATAMI,
    angle: topAngleDeg + 90,
    spacing: Math.max(0.8, settings.spacing),
    edgeInset: Math.max(0.2, settings.inset),
    jumpThreshold: 6,
  });
}

// ---------------------------------------------------------------------------
// Tie-ins and tie-offs (locks)
// ---------------------------------------------------------------------------

export interface LockOptions {
  length: number;
  count: number;
}

export const DEFAULT_LOCK: LockOptions = { length: 0.4, count: 3 };

/**
 * Lock stitches placed at the START of an object (tie-in).
 *
 * The needle makes a few tiny back-and-forth stitches in roughly the same
 * spot so the thread anchors itself. Without this, the first colour pulls out
 * of the fabric when the machine speeds up.
 */
export function tieIn(
  at: Point,
  options: Partial<LockOptions> = {},
  approach?: Point,
): RawStitch[] {
  const opts = { ...DEFAULT_LOCK, ...options };
  const out: RawStitch[] = [];

  // Travel in first, then weave the lock. The approach itself is not part of
  // the lock, so it stays a jump rather than a `lock` stitch.
  out.push({ x: at.x, y: at.y, command: JUMP });
  void approach;

  const len = Math.max(0.1, opts.length);
  const n = Math.max(1, opts.count);

  // A tight triangular weave keeps the lock small but secure.
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({
      x: at.x + Math.cos(a) * len,
      y: at.y + Math.sin(a) * len,
      command: LOCK,
    });
  }
  out.push({ x: at.x, y: at.y, command: LOCK });

  return out;
}

/**
 * Lock stitches placed at the END of an object (tie-off).
 * Same geometry as the tie-in but without the approach jump.
 */
export function tieOff(at: Point, options: Partial<LockOptions> = {}): RawStitch[] {
  return tieIn(at, options);
}

/**
 * Choose a sensible entry point for an object: the point on the boundary
 * closest to `from`, so travel between objects stays short.
 */
export function chooseEntry(path: CompoundPath, from: Point | null): Point | null {
  const outer = path.rings[0];
  if (!outer || outer.length === 0) return null;
  if (!from) return outer[0] ?? null;

  let best = outer[0]!;
  let bestDist = Infinity;
  for (const p of outer) {
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return { ...best };
}

/**
 * Choose an exit point: the boundary point farthest from the entry, so the
 * needle finishes on the opposite side rather than doubling back.
 */
export function chooseExit(path: CompoundPath, entry: Point | null): Point | null {
  const outer = path.rings[0];
  if (!outer || outer.length === 0) return null;
  if (!entry) return outer[0] ?? null;

  let best = outer[0]!;
  let bestDist = -1;
  for (const p of outer) {
    const d = Math.hypot(p.x - entry.x, p.y - entry.y);
    if (d > bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return { ...best };
}

/** Distance helper reused by the sequencer. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Re-export for convenience in the sequencer. */
export { dedupePoints, pathLength, pointAtT, railsFromStroke };
