/**
 * Offsetting and corner rounding.
 *
 * Both operations rewrite an outline rather than adding an effect to it: an
 * offset shape really is a different set of rings, and a rounded corner really
 * is a different corner. Keeping them as geometry means every later step —
 * validation, preview, export — sees the truth without knowing these tools
 * exist.
 *
 * Offsetting works by moving every edge sideways by the distance and joining
 * the moved edges at each corner. That is simple; what is not simple is that
 * moving edges apart can make the outline cross itself near a tight corner, so
 * the raw result is split at its self-intersections and the inverted loops are
 * thrown away. Those inverted loops are the "fold-over" that makes a naive
 * offset look like a bow tie, and dropping them is what makes a 3 mm border
 * around a narrow notch come out as two clean outlines instead of a knot.
 *
 * A shape and its holes offset in opposite directions relative to the material:
 * moving a hole's boundary into the hole makes the material bigger. Rather
 * than special-casing that everywhere, each ring is first wound so that the
 * material is on its left — outer rings counter-clockwise, holes clockwise —
 * after which "right of the edge" is always "out of the material" and one
 * formula offsets both.
 */

import type { CompoundPath, Point, Ring } from '../types.js';
import { boundsIntersect, pathBounds, signedArea, TAU } from '../geometry/index.js';
import { combinePaths, resolveRing, subtractPaths } from './boolean.js';

export interface OffsetOptions {
  /**
   * What happens at a corner on the outside of the turn.
   *
   * `miter` keeps a sharp point until it gets too long, `bevel` cuts it flat,
   * and `round` follows an arc. Inside corners are always a plain intersection;
   * there is nothing else they could be.
   */
  join?: 'miter' | 'bevel' | 'round';
  /** Longest miter, as a multiple of the offset distance. Defaults to 4. */
  miterLimit?: number;
  /** Segments used for a full circle when rounding. Defaults to 24. */
  arcSegments?: number;
}

interface Options {
  join: 'miter' | 'bevel' | 'round';
  miterLimit: number;
  arcSegments: number;
}

function withDefaults(options: OffsetOptions | undefined): Options {
  return {
    join: options?.join ?? 'miter',
    miterLimit: Math.max(1, options?.miterLimit ?? 4),
    arcSegments: Math.max(4, Math.round(options?.arcSegments ?? 256)),
  };
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(a: Point, k: number): Point {
  return { x: a.x * k, y: a.y * k };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function length(a: Point): number {
  return Math.hypot(a.x, a.y);
}

function normalized(a: Point): Point {
  const len = length(a);
  return len < 1e-12 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Right-hand normal of a direction: the side a positive offset moves to. */
function rightNormal(dir: Point): Point {
  return { x: dir.y, y: -dir.x };
}

/** Point-in-ring by the even-odd rule, for deciding whether one ring holds another. */
function pointInRing(ring: Ring, p: Point): boolean {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (x > p.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Rewind a ring so the material is on its left: counter-clockwise for an
 * outer boundary, clockwise for a hole.
 */
function windForMaterial(ring: Ring, outer: boolean): Ring {
  const positive = signedArea(ring) > 0;
  const wantPositive = outer;
  return positive === wantPositive ? ring.slice() : ring.slice().reverse();
}

/** Points along the shorter arc from `from` to `to` around `center`. */
function arcPoints(
  center: Point,
  from: Point,
  to: Point,
  radius: number,
  segments: number,
  tolerance = 0.02,
): Point[] {
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const a1 = Math.atan2(to.y - center.y, to.x - center.x);
  let delta = a1 - a0;
  while (delta <= -Math.PI) delta += TAU;
  while (delta > Math.PI) delta -= TAU;

  // A flatter arc needs fewer pieces. Sizing the pieces by how far a chord is
  // allowed to sag from the true arc keeps a 1 mm radius from carrying as many
  // points as a 50 mm one while still sewing smoothly.
  const maxStep =
    radius > tolerance ? 2 * Math.acos(Math.max(-1, 1 - tolerance / radius)) : Math.PI / 2;
  const perCircle = Math.min(segments, TAU / maxStep);
  const steps = Math.max(2, Math.ceil((Math.abs(delta) / TAU) * perCircle));

  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = a0 + (delta * i) / steps;
    out.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
  return out;
}

/**
 * The points that replace one corner of an offset outline.
 *
 * Starts at the moved end of the incoming edge and ends at the moved start of
 * the outgoing one, so concatenating the joins for every corner in order gives
 * the whole ring.
 */
function joinAt(
  prev: Point,
  corner: Point,
  next: Point,
  distance: number,
  options: Options,
): Point[] {
  const inDir = normalized(sub(corner, prev));
  const outDir = normalized(sub(next, corner));
  if (length(inDir) < 0.5 || length(outDir) < 0.5) return [corner];

  const inNormal = rightNormal(inDir);
  const outNormal = rightNormal(outDir);
  const p1 = add(corner, scale(inNormal, distance));
  const p2 = add(corner, scale(outNormal, distance));

  const turn = cross(inDir, outDir);
  const alignment = dot(inDir, outDir);

  if (Math.abs(turn) < 1e-9) {
    if (alignment > 0) return [p1]; // straight through
    // A 180-degree turn: the two moved edges point opposite ways, so the only
    // join that does not pinch is a half circle.
    return arcPoints(corner, p1, p2, Math.abs(distance), options.arcSegments);
  }

  // Where the two moved edge lines meet.
  const t = cross(sub(p2, p1), outDir) / turn;
  const meeting = add(p1, scale(inDir, t));
  const miterLength = length(sub(meeting, corner));

  // The moved side is on the inside of a right turn, where the lines always
  // meet and the meeting point is the join. On a left turn it is the outside,
  // where the point can run away and needs to be limited.
  if (turn < 0) return [meeting];

  if (options.join === 'bevel') return [p1, p2];
  if (options.join === 'round') {
    return arcPoints(corner, p1, p2, Math.abs(distance), options.arcSegments);
  }

  if (miterLength <= options.miterLimit * Math.abs(distance)) return [meeting];

  return [p1, p2];
}

/** Move one ring's edges by `distance`. The result may cross itself. */
function rawOffsetRing(ring: Ring, distance: number, options: Options): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length]!;
    const corner = ring[i]!;
    const next = ring[(i + 1) % ring.length]!;
    out.push(...joinAt(prev, corner, next, distance, options));
  }
  return out;
}

/** Drop points that repeat or sit on a straight run. */
function clean(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push(p);
  }
  while (
    out.length > 1 &&
    Math.abs(out[0]!.x - out[out.length - 1]!.x) < 1e-9 &&
    Math.abs(out[0]!.y - out[out.length - 1]!.y) < 1e-9
  ) {
    out.pop();
  }
  return out;
}

/**
 * Distance from the closest point of `loop` to the boundary of `ring`.
 *
 * Used to reject a shrink that has folded through itself. When every edge of a
 * small shape moves inwards by more than the shape can take, the edges cross
 * and the "result" is a loop inside the original that happens to be wound the
 * right way — so winding alone cannot tell it apart from a real answer. What
 * gives it away is distance: a real offset boundary is exactly the offset
 * distance from the original, and a folded one is closer.
 */
function minDistanceToRing(loop: Ring, ring: Ring): number {
  let best = Infinity;
  for (const p of loop) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const ab = sub(b, a);
      const len2 = dot(ab, ab);
      if (len2 < 1e-12) continue;
      const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
      const closest = add(a, scale(ab, t));
      const d = length(sub(p, closest));
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Offset one ring and remove the loops its own folds create.
 *
 * `outer` says which way the ring should end up wound, which is also the test
 * for which loops survive: a loop that comes out wound the other way is the
 * overlap of a fold, not part of the boundary.
 */
export function offsetRing(
  ring: Ring,
  distance: number,
  outer = true,
  options?: OffsetOptions,
): Ring[] {
  if (ring.length < 3 || !Number.isFinite(distance) || distance === 0) {
    return [ring.slice()];
  }

  const opts = withDefaults(options);
  const wound = windForMaterial(ring, outer);
  const wanted = outer ? 1 : -1;
  const raw = rawOffsetRing(wound, distance, opts);
  const required = Math.abs(distance) * (1 - 1e-6) - 1e-9;

  return resolveRing(raw)
    .map(clean)
    .filter((loop) => loop.length >= 3)
    .filter((loop) => Math.sign(signedArea(loop)) === wanted || Math.abs(signedArea(loop)) < 1e-9)
    .filter((loop) => Math.abs(signedArea(loop)) > 1e-9)
    .filter((loop) => minDistanceToRing(loop, wound) >= required);
}

/**
 * Grow (positive) or shrink (negative) a whole shape.
 *
 * Nested rings are handled by depth: a ring inside an even number of others is
 * an outer boundary and a ring inside an odd number is a hole. The offset
 * outer boundaries are unioned and the offset holes subtracted, which keeps the
 * answer right even when a hole grows through the outline and opens it — the
 * subtraction simply cuts the opening.
 */
export function offsetPath(
  path: CompoundPath,
  distance: number,
  options?: OffsetOptions,
): CompoundPath {
  const rings = path.rings.filter((ring) => ring.length >= 3);
  if (rings.length === 0) return { rings: [] };
  if (!Number.isFinite(distance) || distance === 0) {
    return { rings: rings.map((ring) => ring.map((p) => ({ x: p.x, y: p.y }))) };
  }

  const outers: Ring[] = [];
  const holes: Ring[] = [];

  for (const ring of rings) {
    const depth = rings.filter((other) => other !== ring && pointInRing(other, ring[0]!)).length;
    const outer = depth % 2 === 0;
    const moved = offsetRing(ring, distance, outer, options);
    if (outer) outers.push(...moved);
    else holes.push(...moved);
  }

  if (outers.length === 0) return { rings: [] };

  let result = combinePaths(
    outers.map((ring) => ({ rings: [ring] })),
    'union',
  );

  if (holes.length > 0) {
    const holePath = combinePaths(
      holes.map((ring) => ({ rings: [ring] })),
      'union',
    );
    if (holePath.rings.length > 0) result = subtractPaths(result, holePath);
  }

  return result;
}

export interface RoundOptions {
  /** Segments used for a full circle. Defaults to 24. */
  arcSegments?: number;
}

/**
 * Replace each corner of a shape with a tangent arc.
 *
 * The arc touches both edges at the same distance from the corner, so the
 * straight runs shorten by exactly as much as the arc takes. Where the radius
 * is too big for the edges on either side, it is reduced until the arcs of
 * neighbouring corners just meet; that keeps a 5 mm radius on a 4 mm square
 * from turning the outline inside out.
 */
export function roundCorners(
  path: CompoundPath,
  radius: number,
  options?: RoundOptions,
): CompoundPath {
  const rings = path.rings.filter((ring) => ring.length >= 3);
  if (rings.length === 0) return { rings: [] };
  if (!Number.isFinite(radius) || radius <= 0) {
    return { rings: rings.map((ring) => ring.map((p) => ({ x: p.x, y: p.y }))) };
  }

  const segments = Math.max(4, Math.round(options?.arcSegments ?? 256));
  const out: Ring[] = [];

  for (const ring of rings) {
    const rounded: Ring = [];
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length]!;
      const corner = ring[i]!;
      const next = ring[(i + 1) % ring.length]!;

      const toPrev = sub(prev, corner);
      const toNext = sub(next, corner);
      const lenPrev = length(toPrev);
      const lenNext = length(toNext);
      if (lenPrev < 1e-9 || lenNext < 1e-9) {
        rounded.push(corner);
        continue;
      }

      const v1 = normalized(toPrev);
      const v2 = normalized(toNext);
      const theta = Math.acos(Math.min(1, Math.max(-1, dot(v1, v2))));

      // Straight through: there is no corner to round.
      if (Math.PI - theta < 1e-6) {
        rounded.push(corner);
        continue;
      }

      // A spike has no room for a tangent circle that is worth sewing; keep
      // the point rather than replacing it with a circle that overshoots.
      if (theta < 1e-4) {
        rounded.push(corner);
        continue;
      }

      // Distance from the corner to each tangent point, capped so the arcs of
      // two corners on the same edge cannot cross.
      const tangent = radius / Math.tan(theta / 2);
      const maxTangent = Math.min(lenPrev, lenNext) / 2;
      const t = Math.min(tangent, maxTangent);
      if (t < 1e-9) {
        rounded.push(corner);
        continue;
      }

      // With the radius reduced to fit, the effective radius follows the
      // tangent length rather than staying at the requested value.
      const effective = t * Math.tan(theta / 2);
      const p1 = add(corner, scale(v1, t));
      const p2 = add(corner, scale(v2, t));
      const bisector = normalized(add(v1, v2));
      if (length(bisector) < 0.5) {
        rounded.push(corner);
        continue;
      }
      const center = add(corner, scale(bisector, effective / Math.sin(theta / 2)));

      const arc = arcPoints(center, p1, p2, effective, segments);
      // The first point replaces the corner's tangent point; keeping it and
      // dropping the duplicate at the end keeps the ring simple.
      rounded.push(...arc);
    }

    // Consecutive arcs can share a point where two corners meet on a short
    // edge; cleaning here saves every consumer from having to cope.
    const cleaned = clean(rounded);
    if (cleaned.length >= 3) out.push(cleaned);
  }

  return { rings: out };
}

/**
 * The outline a border should sew along.
 *
 * Same rings `offsetPath` returns, but the caller wants them as a path to run
 * a stitch down rather than as an area to fill. Keeping this separate makes the
 * intent readable at the call site; the geometry is one and the same.
 */
export function borderPath(
  path: CompoundPath,
  distance: number,
  options?: OffsetOptions,
): CompoundPath {
  return offsetPath(path, distance, options);
}

/**
 * Move a shape so its bounds are centred on `center`.
 *
 * Kept here beside the other geometry rewriting so callers do not hand-roll
 * translation and drift by half a millimetre.
 */
export function centrePath(path: CompoundPath, center: Point): CompoundPath {
  const bounds = pathBounds(path);
  const dx = center.x - (bounds.minX + bounds.maxX) / 2;
  const dy = center.y - (bounds.minY + bounds.maxY) / 2;
  return {
    rings: path.rings.map((ring) => ring.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
  };
}

/** Do two shapes' bounds overlap? Exposed for callers that skip needless work. */
export function pathsTouch(a: CompoundPath, b: CompoundPath): boolean {
  return boundsIntersect(pathBounds(a), pathBounds(b));
}
