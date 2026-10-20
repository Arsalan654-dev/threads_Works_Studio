/**
 * Boolean operations on closed shapes: weld (union), combine, subtract and
 * intersect.
 *
 * Every shape in a design is a set of closed rings, so the problem is the
 * classic one: given two sets of polygons, return the polygons that enclose
 * exactly the points the operation asks for. The approach here is the one that
 * keeps the result usable as embroidery rather than as a raster:
 *
 *  1. Split every edge at every place it crosses an edge of the other shape.
 *  2. Decide, for each resulting piece, whether its middle lies inside the
 *     other shape, outside it, or along its boundary.
 *  3. Keep the pieces the operation calls for — union keeps what is outside,
 *     intersection what is inside, difference the outside of A plus the inside
 *     of B reversed, and xor both differences.
 *  4. Chain the kept pieces back into closed rings.
 *
 * Chaining is the part that decides whether the output is a set of clean
 * outlines or a tangle. At a vertex where several pieces meet (the shapes
 * touch there), the next piece is chosen by turning consistently one way,
 * which is the standard face-traversal rule for a planar graph: it always
 * walks a face without crossing itself, so every ring that comes out is a
 * simple loop. Figuring the answer out any other way produces figure-eights
 * that sew across themselves.
 *
 * Coordinates are millimetres and rings are closed without repeating the
 * first point, matching the rest of the engine. The result uses the even-odd
 * rule, so a subtracted region becomes a hole simply by being a ring inside
 * another — no explicit hole bookkeeping.
 */

import type { CompoundPath, Point, Ring } from '../types.js';
import { boundsIntersect, pathBounds, TAU } from '../geometry/index.js';

export type BooleanOp = 'union' | 'intersection' | 'difference' | 'xor';

/** Two points closer than this are the same vertex when chaining. */
const VERTEX_EPS = 1e-6;
/** An edge shorter than this carries no direction and is dropped. */
const MIN_EDGE = 1e-9;

interface Edge {
  a: Point;
  b: Point;
  /** Which shape the edge came from. */
  from: 'a' | 'b';
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

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= VERTEX_EPS && Math.abs(a.y - b.y) <= VERTEX_EPS;
}

/** A stable key for a vertex, so pieces that meet there can be matched up. */
function keyOf(p: Point): string {
  return `${Math.round(p.x / VERTEX_EPS)},${Math.round(p.y / VERTEX_EPS)}`;
}

/**
 * Where two segments meet.
 *
 * Returns the parameters along each segment plus the point. Parallel segments
 * that lie on top of each other return the overlap's endpoints as two
 * intersections, because each end is a place where one edge starts or stops
 * being coincident with the other — treating the overlap as a single crossing
 * would silently drop it.
 */
export function segmentIntersections(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): Array<{ t: number; u: number; point: Point }> {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const denom = cross(d1, d2);
  const delta = sub(p3, p1);

  if (Math.abs(denom) > 1e-12) {
    const t = cross(delta, d2) / denom;
    const u = cross(delta, d1) / denom;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return [];
    const tc = Math.min(1, Math.max(0, t));
    const uc = Math.min(1, Math.max(0, u));
    return [{ t: tc, u: uc, point: add(p1, scale(d1, tc)) }];
  }

  // Parallel. Only collinear overlaps can intersect.
  if (Math.abs(cross(delta, d1)) > 1e-9 * Math.max(1, length(d1))) return [];

  const len1 = dot(d1, d1);
  if (len1 < MIN_EDGE) return [];
  const len2 = dot(d2, d2);
  if (len2 < MIN_EDGE) return [];

  const t3 = dot(sub(p3, p1), d1) / len1;
  const t4 = dot(sub(p4, p1), d1) / len1;
  const lo = Math.max(0, Math.min(t3, t4));
  const hi = Math.min(1, Math.max(t3, t4));
  if (hi < lo - 1e-9) return [];

  const out: Array<{ t: number; u: number; point: Point }> = [];
  for (const t of [lo, hi]) {
    const point = add(p1, scale(d1, Math.min(1, Math.max(0, t))));
    const u = dot(sub(point, p3), d2) / len2;
    out.push({ t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)), point });
  }
  // A zero-length overlap is a single touch, not two events.
  if (out.length === 2 && samePoint(out[0]!.point, out[1]!.point)) return [out[0]!];
  return out;
}

/**
 * Split every edge of `edges` where it meets any edge of `others`.
 *
 * A piece shorter than `MIN_EDGE` is dropped, because a zero-length edge has
 * no direction and would confuse the turn test that chains the result.
 */
function splitEdges(edges: Edge[], others: Edge[]): Edge[] {
  const out: Edge[] = [];

  for (const edge of edges) {
    const ts = new Set<number>([0, 1]);
    for (const other of others) {
      for (const hit of segmentIntersections(edge.a, edge.b, other.a, other.b)) {
        ts.add(Math.round(hit.t / 1e-9) * 1e-9);
      }
    }
    const sorted = [...ts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const t0 = sorted[i]!;
      const t1 = sorted[i + 1]!;
      if (t1 - t0 < 1e-9) continue;
      const a = add(edge.a, scale(sub(edge.b, edge.a), t0));
      const b = add(edge.a, scale(sub(edge.b, edge.a), t1));
      if (length(sub(b, a)) < MIN_EDGE) continue;
      out.push({ a, b, from: edge.from });
    }
  }

  return out;
}

/** Even-odd point-in-shape, matching `containsPoint` in the geometry module. */
function insideRings(rings: Ring[], p: Point): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if (a.y > p.y !== b.y > p.y) {
        const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (x > p.x) inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Is a point inside the shape the operation produces?
 *
 * This is the whole of the boolean logic. Every edge is tested by nudging a
 * probe to each side of it; the edge is kept exactly when one side is in the
 * result and the other is not, which is what being on the boundary means.
 *
 * Deciding it this way rather than by "is this piece inside the other shape"
 * matters for xor. There, an edge of one shape can lie inside the other and
 * still bound the answer (the two squares' shared stretch is the edge between
 * one square and both), so a per-edge inside/outside test winds the result
 * wrong. Asking about the result on both sides cannot.
 */
function inResult(op: BooleanOp, insideA: boolean, insideB: boolean): boolean {
  switch (op) {
    case 'union':
      return insideA || insideB;
    case 'intersection':
      return insideA && insideB;
    case 'difference':
      return insideA && !insideB;
    case 'xor':
      return insideA !== insideB;
    default:
      return false;
  }
}

/** How far off an edge to probe, in mm. Far below any stitch, far above noise. */
const PROBE = 1e-4;

/**
 * Keep the pieces that form the result's boundary, each wound with the filled
 * side on its left.
 *
 * Orientation matters twice over: chaining walks with the filled side on the
 * left, so a piece wound the wrong way would turn the walk the wrong way, and
 * a hole has to wind opposite its outline for the signed area to subtract.
 */
function boundaryPieces(op: BooleanOp, edges: Edge[], ringsA: Ring[], ringsB: Ring[]): Edge[] {
  const kept: Edge[] = [];

  for (const edge of edges) {
    const dir = sub(edge.b, edge.a);
    const len = length(dir);
    if (len < MIN_EDGE) continue;

    // Left normal of the direction. Screen y points down, so "left" here is
    // the side that looks right on screen; only consistency matters, because
    // the test is symmetric.
    const mid = scale(add(edge.a, edge.b), 0.5);
    const probe = Math.min(PROBE, len * 0.01);
    const nx = (-dir.y / len) * probe;
    const ny = (dir.x / len) * probe;

    const left = inResult(
      op,
      insideRings(ringsA, { x: mid.x + nx, y: mid.y + ny }),
      insideRings(ringsB, { x: mid.x + nx, y: mid.y + ny }),
    );
    const right = inResult(
      op,
      insideRings(ringsA, { x: mid.x - nx, y: mid.y - ny }),
      insideRings(ringsB, { x: mid.x - nx, y: mid.y - ny }),
    );

    if (left === right) continue;
    kept.push(left ? edge : { a: edge.b, b: edge.a, from: edge.from });
  }

  // Shapes that share an edge produce the same boundary piece from both
  // sides. One copy is the boundary; two would sew the edge twice.
  const seen = new Set<string>();
  const unique: Edge[] = [];
  for (const edge of kept) {
    const key = `${keyOf(edge.a)}>${keyOf(edge.b)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
  }

  return unique;
}

/**
 * Turn the kept pieces into closed rings.
 *
 * At each vertex the outgoing piece is chosen by taking the one that comes
 * immediately clockwise from the direction we came in. That is the standard
 * face traversal for a planar graph: it keeps the filled side on the left and
 * never crosses itself, so the ring that comes out is a simple loop even where
 * the two shapes touch at a point and four pieces share a vertex.
 *
 * A walk that cannot close is rolled back rather than consuming its pieces.
 * The pieces stay available for another seed, and the next ring starts from a
 * clean boundary instead of from a half-finished one.
 */
function chain(edges: Edge[]): Ring[] {
  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = keyOf(edge.a);
    const list = outgoing.get(key);
    if (list) list.push(edge);
    else outgoing.set(key, [edge]);
  }

  const used = new Set<Edge>();
  const rings: Ring[] = [];

  const nextEdge = (fromKey: string, incoming: Point): Edge | null => {
    const candidates = (outgoing.get(fromKey) ?? []).filter((e) => !used.has(e));
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;

    const back = Math.atan2(-incoming.y, -incoming.x);
    let best: Edge | null = null;
    let bestTurn = Infinity;
    for (const candidate of candidates) {
      const dir = sub(candidate.b, candidate.a);
      const angle = Math.atan2(dir.y, dir.x);
      // Clockwise turn from straight back, in (0, 2*pi].
      let turn = back - angle;
      while (turn <= 1e-12) turn += TAU;
      while (turn > TAU) turn -= TAU;
      if (turn < bestTurn) {
        bestTurn = turn;
        best = candidate;
      }
    }
    return best;
  };

  for (const seed of edges) {
    if (used.has(seed)) continue;

    const ring: Ring = [];
    const touched: Edge[] = [];
    let current: Edge | null = seed;
    let closed = false;
    let guard = 0;

    while (current !== null && guard++ <= edges.length + 1) {
      touched.push(current);
      used.add(current);
      ring.push(current.a);

      // The ring closes when the piece just walked ends where it began.
      if (keyOf(current.b) === keyOf(ring[0]!)) {
        closed = true;
        break;
      }

      const next = nextEdge(keyOf(current.b), sub(current.b, current.a));
      if (next === null) break;
      current = next;
    }

    if (closed && ring.length >= 3) {
      rings.push(ring);
    } else {
      for (const edge of touched) used.delete(edge);
    }
  }

  return rings;
}

/** Remove points that repeat or sit on a straight run, which add nothing. */
function cleanRing(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && samePoint(last, p)) continue;
    out.push(p);
  }
  while (out.length > 1 && samePoint(out[0]!, out[out.length - 1]!)) out.pop();

  // Drop a point whose two neighbours lie on one line through it.
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length]!;
      const cur = out[i]!;
      const next = out[(i + 1) % out.length]!;
      const v1 = sub(cur, prev);
      const v2 = sub(next, cur);
      const area = Math.abs(cross(v1, v2));
      if (area <= 1e-9 * Math.max(1, length(v1) * length(v2))) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function ringsOf(path: CompoundPath): Ring[] {
  return path.rings.filter((ring) => ring.length >= 2);
}

/**
 * Copy rings with fresh point objects.
 *
 * A ring array is not enough: the points themselves are shared with the
 * design's editable geometry, and a later move of the result would drag the
 * original along with it.
 */
function cloneRings(rings: Ring[]): Ring[] {
  return rings.map((ring) => ring.map((p) => ({ x: p.x, y: p.y })));
}

/** Apply one boolean operation to two shapes. */
export function booleanPath(a: CompoundPath, b: CompoundPath, op: BooleanOp): CompoundPath {
  const ringsA = ringsOf(a);
  const ringsB = ringsOf(b);

  // Boundaries that cannot meet need no sweep at all; answering directly is
  // both faster and exactly right, where a sweep would have to special-case
  // the empty side.
  if (ringsA.length === 0) {
    if (op === 'union' || op === 'xor') return { rings: cloneRings(ringsB) };
    return { rings: [] };
  }
  if (ringsB.length === 0) {
    if (op === 'union' || op === 'difference' || op === 'xor') return { rings: cloneRings(ringsA) };
    return { rings: [] };
  }

  if (!boundsIntersect(pathBounds(a), pathBounds(b))) {
    switch (op) {
      case 'union':
      case 'xor':
        return { rings: [...cloneRings(ringsA), ...cloneRings(ringsB)] };
      case 'intersection':
        return { rings: [] };
      case 'difference':
        return { rings: cloneRings(ringsA) };
    }
  }

  const edgesA: Edge[] = [];
  for (const ring of ringsA) {
    for (let i = 0; i < ring.length; i++) {
      edgesA.push({ a: ring[i]!, b: ring[(i + 1) % ring.length]!, from: 'a' });
    }
  }
  const edgesB: Edge[] = [];
  for (const ring of ringsB) {
    for (let i = 0; i < ring.length; i++) {
      edgesB.push({ a: ring[i]!, b: ring[(i + 1) % ring.length]!, from: 'b' });
    }
  }

  const splitA = splitEdges(edgesA, edgesB);
  const splitB = splitEdges(edgesB, edgesA);

  const kept = boundaryPieces(op, [...splitA, ...splitB], ringsA, ringsB);

  const rings = chain(kept)
    .map(cleanRing)
    .filter((ring) => ring.length >= 3)

    // A ring that encloses nothing is noise from an exact touch, not a shape.
    .filter((ring) => Math.abs(areaOf(ring)) > 1e-9);

  // Largest first so the outer outline leads and holes follow it, which is the
  // order every other part of the engine expects.
  rings.sort((x, y) => Math.abs(areaOf(x)) - Math.abs(areaOf(y)));
  rings.reverse();

  return { rings };
}

function areaOf(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** Union of two shapes: everything either one covers. */
export function unionPaths(a: CompoundPath, b: CompoundPath): CompoundPath {
  return booleanPath(a, b, 'union');
}

/** Intersection: only what both cover. */
export function intersectPaths(a: CompoundPath, b: CompoundPath): CompoundPath {
  return booleanPath(a, b, 'intersection');
}

/** Difference: `a` with `b` cut out of it. */
export function subtractPaths(a: CompoundPath, b: CompoundPath): CompoundPath {
  return booleanPath(a, b, 'difference');
}

/** Everything one covers but not both. */
export function xorPaths(a: CompoundPath, b: CompoundPath): CompoundPath {
  return booleanPath(a, b, 'xor');
}

/**
 * Fold a whole list of shapes with one operation.
 *
 * Folded left to right rather than all at once: each step is the same
 * well-tested two-shape operation, so a list of ten shapes cannot exercise a
 * code path a list of two does not.
 */
export function combinePaths(paths: CompoundPath[], op: BooleanOp): CompoundPath {
  if (paths.length === 0) return { rings: [] };
  let acc: CompoundPath = { rings: cloneRings(paths[0]!.rings) };
  for (let i = 1; i < paths.length; i++) acc = booleanPath(acc, paths[i]!, op);
  return acc;
}

/**
 * Merge several shapes that overlap into one outline per connected region.
 *
 * This is "weld" as a digitiser means it: shapes that touch become a single
 * outline, while shapes that do not stay separate objects rather than being
 * forced into one. Union does the merging; the split back into separate paths
 * is by containment, so two disjoint shapes come back as two.
 */
export function weldPaths(paths: CompoundPath[]): CompoundPath[] {
  if (paths.length === 0) return [];

  // Union them all, then group the rings: a ring is an outer boundary unless
  // it lies inside one already taken as outer.
  const merged = combinePaths(paths, 'union');
  const rings = merged.rings
    .map(cleanRing)
    .filter((r) => r.length >= 3)
    .sort((a, b) => Math.abs(areaOf(b)) - Math.abs(areaOf(a)));

  const groups: Ring[][] = [];
  for (const ring of rings) {
    const probe = ring[0]!;
    let placed = false;
    for (const group of groups) {
      // Inside this group's outer ring -> it is a hole of that region.
      if (insideRings([group[0]!], probe)) {
        group.push(ring);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([ring]);
  }

  return groups.map((g) => ({ rings: g }));
}

/** Every ring of a shape as its own outline. */
export function explodePath(path: CompoundPath): CompoundPath[] {
  return path.rings.map((ring) => ({ rings: cloneRings([ring]) }));
}

/**
 * Split a ring that crosses itself into the simple loops it describes.
 *
 * A ring can cross itself when it was produced by moving every edge of
 * another outline sideways — near a tight corner the moved edges pass through
 * each other and the outline folds over. Splitting at those crossings and
 * walking the pieces recovers the loops, some of which run the wrong way
 * round: those are the fold-overs and the caller drops them by their sign.
 */
export function resolveRing(ring: Ring): Ring[] {
  if (ring.length < 3) return [];

  const edges: Edge[] = [];
  for (let i = 0; i < ring.length; i++) {
    edges.push({ a: ring[i]!, b: ring[(i + 1) % ring.length]!, from: 'a' });
  }

  const split = splitEdges(edges, edges);
  return chain(split)
    .map(cleanRing)
    .filter((loop) => loop.length >= 3)
    .filter((loop) => Math.abs(areaOf(loop)) > 1e-9);
}
