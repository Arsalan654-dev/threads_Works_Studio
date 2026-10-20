/**
 * The motif library — shapes a motif fill repeats and a carving stamp presses
 * into a fill.
 *
 * Two kinds of shape live here:
 *
 *  - **Built-ins**, generated from the primitives below. They are always
 *    present, never deleted, and each is a clean closed polygon that the
 *    point-in-polygon test handles exactly.
 *  - **Library shapes**, drawn or imported by the operator. They are ordinary
 *    rings like any other in a design, so nothing here knows where one came
 *    from — this module only judges whether the ring can be sewn.
 *
 * A motif is *placed*, not embedded: both users normalise it to its own centre
 * and scale it so `size` is the motif's real extent in millimetres, which is
 * why every shape here is authored at a small radius rather than at any
 * particular size. That keeps the numbers a user types meaning the same thing
 * whichever motif they pick.
 */

import type { MotifChoice, Point, Ring } from './types.js';
import { boundsOf, boundsCenter, signedArea } from './geometry/index.js';

/** Longest side of the box a motif may occupy, in millimetres. */
export const MOTIF_MAX_SIZE = 60;
/** Shortest side of the box a motif may occupy, in millimetres. */
export const MOTIF_MIN_SIZE = 1;
/** Points a stored motif may carry — enough for a smooth curve, not a trace. */
export const MOTIF_MAX_POINTS = 400;

/**
 * Largest circle the DST format can express in one move: 12.1 mm across the
 * diagonal of its 12.1 mm square coordinate field. A motif bigger than this
 * is still legal to *store*, but the machine has to walk its outline in hops,
 * so validation says so rather than the export failing later.
 */
export const MOTIF_COMFORT_SIZE = 12.1;

function regularPolygon(sides: number, radius: number): Ring {
  const pts: Ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

function starPolygon(points: number, outer: number, inner: number): Ring {
  const pts: Ring = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/**
 * Built-in motif library.
 *
 * Each shape is a closed ring inside a unit circle, so the library scales the
 * same way whatever is picked: `motifSize` is the size across, not a scale
 * factor the operator has to reverse-engineer per shape.
 */
export const BUILTIN_MOTIFS = {
  diamond: regularPolygon(4, 1),
  circle: regularPolygon(16, 1),
  star: starPolygon(5, 1, 0.45),
  hexagon: regularPolygon(6, 1),
  square: [
    { x: -0.7, y: -0.7 },
    { x: 0.7, y: -0.7 },
    { x: 0.7, y: 0.7 },
    { x: -0.7, y: 0.7 },
  ],
  cross: [
    { x: -0.3, y: -1 },
    { x: 0.3, y: -1 },
    { x: 0.3, y: -0.3 },
    { x: 1, y: -0.3 },
    { x: 1, y: 0.3 },
    { x: 0.3, y: 0.3 },
    { x: 0.3, y: 1 },
    { x: -0.3, y: 1 },
    { x: -0.3, y: 0.3 },
    { x: -1, y: 0.3 },
    { x: -1, y: -0.3 },
    { x: -0.3, y: -0.3 },
  ],
  heart: [
    { x: 0, y: -0.55 },
    { x: -0.45, y: -1 },
    { x: -1, y: -0.45 },
    { x: -0.8, y: 0.35 },
    { x: 0, y: 1 },
    { x: 0.8, y: 0.35 },
    { x: 1, y: -0.45 },
    { x: 0.45, y: -1 },
  ],
  flower: regularPolygon(8, 1),
} as const satisfies Record<string, Ring>;

export type BuiltinMotifId = keyof typeof BUILTIN_MOTIFS;

/** The built-in shown when nothing else is picked. */
export const DEFAULT_MOTIF: BuiltinMotifId = 'star';

export interface MotifShape {
  /** Identifier: a built-in id, or a library entry's id. */
  id: string;
  name: string;
  /** The ring, in whatever units it was authored in. */
  points: Ring;
  /** True for shapes this build ships. */
  builtin: boolean;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Judge whether a ring can be sewn as a motif.
 *
 * Returns the reason it cannot, or `null` when it is usable. Every check here
 * is one that would otherwise surface as a silent wrong-shape or an export
 * that fails on the machine, so the message names the actual limit.
 */
export function motifProblem(ring: Ring | undefined | null): string | null {
  if (ring == null) return 'No shape was given.';
  if (!Array.isArray(ring)) return 'A motif must be a list of points.';
  if (ring.length < 3) return `A motif needs at least 3 points; this one has ${ring.length}.`;
  if (ring.length > MOTIF_MAX_POINTS) {
    return `A motif may hold at most ${MOTIF_MAX_POINTS} points; this one has ${ring.length}.`;
  }
  for (const p of ring) {
    if (typeof p !== 'object' || p === null || !isFinitePoint(p)) {
      return 'A motif has a point that is not a finite x / y pair.';
    }
  }

  const box = boundsOf([ring]);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  if (width < MOTIF_MIN_SIZE || height < MOTIF_MIN_SIZE) {
    return `A motif must be at least ${MOTIF_MIN_SIZE} mm across; this one is ${Math.min(width, height).toFixed(2)} mm.`;
  }
  if (width > MOTIF_MAX_SIZE || height > MOTIF_MAX_SIZE) {
    return `A motif may be at most ${MOTIF_MAX_SIZE} mm across; this one is ${Math.max(width, height).toFixed(2)} mm.`;
  }
  if (width === 0 || height === 0) return 'A motif cannot be a straight line.';

  // A ring that doubles back on itself sews its own crossings, which reads as
  // a knot rather than a shape. Crossing detection is expensive for long
  // rings, so it is applied where a real shape would actually collapse.
  if (ring.length <= 60 && selfIntersects(ring)) {
    return 'A motif cannot cross itself — the outline doubles back and would sew a knot.';
  }

  return null;
}

/** Do any two non-adjacent edges of the ring cross? */
export function selfIntersects(ring: Ring): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i]!;
    const a2 = ring[(i + 1) % n]!;
    // Skip the pair of edges that share a vertex: they meet by construction.
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = ring[j]!;
      const b2 = ring[(j + 1) % n]!;
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function orientation(a: Point, b: Point, c: Point): number {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-12) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    b.x <= Math.max(a.x, c.x) &&
    b.x >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) &&
    b.y >= Math.min(a.y, c.y)
  );
}

function segmentsCross(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  // Collinear overlaps count: a ring whose edges lie on each other still
  // sews the same point twice, which is the failure being guarded against.
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

/**
 * Normalise a shape for the library: recentered on its own centre, sized so
 * its longest side is 1, wound counter-clockwise.
 *
 * Storing at unit size means a stored shape measures the same as a built-in
 * one, so `scale` in the UI means the same thing whichever was picked.
 */
export function normalizeMotif(ring: Ring): Ring {
  const box = boundsOf([ring]);
  const center = boundsCenter(box);
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY) || 1;
  const unit = ring.map((p) => ({ x: (p.x - center.x) / span, y: (p.y - center.y) / span }));
  return signedArea(unit) < 0 ? unit.slice().reverse() : unit;
}

/**
 * Resolve a shape choice to the ring that will actually be sewn.
 *
 * The design's own shape wins, then the built-in named by `id`, then the
 * default. A shape carried by the design is what was saved with it, so it
 * stays correct even if the library entry it came from is later renamed or
 * removed.
 */
export function resolveMotif(choice: MotifChoice | undefined | null): Ring {
  if (choice?.points && choice.points.length >= 3) return choice.points;
  const id = choice?.id;
  if (id && id in BUILTIN_MOTIFS) return BUILTIN_MOTIFS[id as BuiltinMotifId];
  return BUILTIN_MOTIFS[DEFAULT_MOTIF];
}

/** Every built-in, as the same record the library holds, for a picker. */
export function builtinMotifs(): MotifShape[] {
  return (Object.keys(BUILTIN_MOTIFS) as BuiltinMotifId[]).map((id) => ({
    id,
    name: labelFor(id),
    points: BUILTIN_MOTIFS[id],
    builtin: true,
  }));
}

/** A readable name for a built-in id. */
export function labelFor(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Draw an SVG path element's outline into a ring.
 *
 * A modest path parser covering the operators a shape drawn in a design tool
 * actually uses — M, L, H, V, C, Q and Z, absolute and relative. Anything it
 * does not understand returns `null` rather than a partial outline, because a
 * motif silently missing its last two curves would sew a shape the operator
 * never drew.
 */
export function ringFromSvgPath(path: string, samplesPerCurve = 16): Ring | null {
  const tokens = path.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens || tokens.length < 4) return null;

  const out: Ring = [];
  let i = 0;
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let cmd = '';
  let sawMove = false;

  const num = (): number => {
    const t = tokens[i++];
    if (t === undefined) throw new Error('path ran out of numbers');
    const v = Number(t);
    if (!Number.isFinite(v)) throw new Error(`not a number: ${t}`);
    return v;
  };

  const push = (p: Point): void => {
    const last = out[out.length - 1];
    // Collapse the repeated point a closed path leaves behind.
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) return;
    out.push(p);
  };

  const curve = (p0: Point, p1: Point, p2: Point, p3: Point, cubic: boolean): void => {
    for (let s = 1; s <= samplesPerCurve; s++) {
      const t = s / samplesPerCurve;
      if (cubic) {
        const u = 1 - t;
        push({
          x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        });
      } else {
        const u = 1 - t;
        push({
          x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
          y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
        });
      }
    }
  };

  try {
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (/^[a-zA-Z]$/.test(t)) {
        cmd = t;
        i++;
      } else if (cmd === '') {
        throw new Error('path starts with a number');
      }
      // A repeated command keeps running with the same verb; Z takes no args.
      const rel = cmd === cmd.toLowerCase() && cmd !== 'z' && cmd !== 'Z';
      const C = cmd.toUpperCase();

      if (C === 'Z') {
        // Close: the ring is complete; a trailing move back to the start has
        // already been collapsed by `push`.
        cur = start;
        break;
      }

      if (C === 'M') {
        const x = num();
        const y = num();
        cur = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
        if (!sawMove) {
          out.push(cur);
          start = cur;
          sawMove = true;
        } else {
          push(cur);
          start = cur;
        }
        // Per the SVG rules a moveto's partners become linetos.
        cmd = rel ? 'l' : 'L';
        continue;
      }

      if (!sawMove) throw new Error('path draws before it moves');

      if (C === 'L') {
        const x = num();
        const y = num();
        cur = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
        push(cur);
      } else if (C === 'H') {
        const x = num();
        cur = { x: rel ? cur.x + x : x, y: cur.y };
        push(cur);
      } else if (C === 'V') {
        const y = num();
        cur = { x: cur.x, y: rel ? cur.y + y : y };
        push(cur);
      } else if (C === 'C') {
        const x1 = num();
        const y1 = num();
        const x2 = num();
        const y2 = num();
        const x = num();
        const y = num();
        const p1 = rel ? { x: cur.x + x1, y: cur.y + y1 } : { x: x1, y: y1 };
        const p2 = rel ? { x: cur.x + x2, y: cur.y + y2 } : { x: x2, y: y2 };
        const p3 = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
        curve(cur, p1, p2, p3, true);
        cur = p3;
      } else if (C === 'Q') {
        const x1 = num();
        const y1 = num();
        const x = num();
        const y = num();
        const p1 = rel ? { x: cur.x + x1, y: cur.y + y1 } : { x: x1, y: y1 };
        const p3 = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
        curve(cur, p1, p3, p3, false);
        cur = p3;
      } else {
        // Arcs, smooth curves and anything else: refuse rather than guess.
        return null;
      }
    }
  } catch {
    return null;
  }

  if (out.length < 3) return null;
  return out;
}

/** Draw a closed polygon from a list of `x,y` pairs, for pasted coordinates. */
export function ringFromPointsText(text: string): Ring | null {
  const pairs = text.match(/-?\d+(?:\.\d+)?\s*[,\s]\s*-?\d+(?:\.\d+)?/g);
  if (!pairs || pairs.length < 3) return null;
  const ring: Ring = [];
  for (const pair of pairs) {
    const [xs, ys] = pair.split(/[,\s]+/).filter((s) => s !== '');
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    ring.push({ x, y });
  }
  return ring;
}
