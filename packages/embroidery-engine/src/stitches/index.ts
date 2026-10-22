/**
 * Stitch generators: satin column, tatami fill, run and bean stitch.
 *
 * Every generator takes plain geometry plus parameters and returns ordered
 * needle penetrations in millimeters. They do NOT assign sequence numbers or
 * travel commands - the sequencer in ../sequencing does that, because only it
 * knows about neighbouring objects.
 */

import type { CompoundPath, Point, StitchCommand } from '../types.js';
import {
  EPS,
  TAU,
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
  splitLongSegments,
  toRadians,
} from '../geometry/index.js';

/** A raw generated point before sequencing. */
export interface RawStitch {
  x: number;
  y: number;
  command: StitchCommand;
}

const SEW: StitchCommand = 'stitch';
const JUMP: StitchCommand = 'jump';

/**
 * Deterministic PRNG (mulberry32).
 *
 * Textured fills - stipple, hand stitch, jagged edges - need randomness that
 * is identical on every compile. Seeding from `Math.random()` would make the
 * preview differ from the exported file and the tests unrepeatable, which is
 * exactly the class of lie this engine avoids.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable seed for a shape, in hundredths of a millimetre. */
function textureSeed(minX: number, minY: number, maxX: number, maxY: number): number {
  return (
    ((Math.round(minX * 100) * 73856093) ^
      (Math.round(minY * 100) * 19349663) ^
      (Math.round(maxX * 100) * 83492791) ^
      (Math.round(maxY * 100) * 50331653)) >>>
    0
  );
}

/** Rotate stitches from fill space back into design space. */
function rotateBackIntoDesign(out: RawStitch[], center: Point, angle: number): void {
  const back = -angle;
  for (const st of out) {
    const p = rotatePoint({ x: st.x, y: st.y }, back, center.x, center.y);
    st.x = p.x;
    st.y = p.y;
  }
}

/** Turn long intra-shape travels into jumps where the needle would drag. */
function breakLongTravels(out: RawStitch[], threshold: number): void {
  let prev: RawStitch | null = null;
  for (const st of out) {
    if (prev) {
      const d = Math.hypot(st.x - prev.x, st.y - prev.y);
      if (d > threshold) st.command = JUMP;
    }
    prev = st;
  }
}

/**
 * Penetrations along one span, ends included.
 *
 * Used by every advanced fill: they all walk rows and differ only in what
 * they do between the penetrations, so the walking itself lives here once.
 */
function spanPoints(x1: number, x2: number, spacing: number, phase = 0): number[] {
  const xs: number[] = [];
  if (x2 - x1 <= EPS) return xs;
  let first = x1 + phase;
  if (first > x2) first = x2;
  if (first < x1) first = x1;
  xs.push(first);
  for (let x = first + spacing; x < x2 - 1e-9; x += spacing) xs.push(x);
  if (xs[xs.length - 1]! < x2 - 1e-9) xs.push(x2);
  return xs;
}

/** Rotate a shape so its fill rows run horizontally, plus the two boxes. */
function rotatedFillSpace(
  path: CompoundPath,
  angleDegrees: number,
): {
  rotated: CompoundPath;
  center: Point;
  angle: number;
  box: { minX: number; minY: number; maxX: number; maxY: number };
} | null {
  if (path.rings.length === 0 || path.rings.some((r) => r.length < 3)) return null;
  const center = boundsCenter(boundsOf(path.rings));
  const angle = -toRadians(angleDegrees);
  const rotated = rotatePath(path, angle, center);
  const box = boundsOf(rotated.rings);
  if (box.maxX - box.minX <= 0 || box.maxY - box.minY <= 0) return null;
  return { rotated, center, angle, box };
}

// ---------------------------------------------------------------------------
// Satin column
// ---------------------------------------------------------------------------

export interface SatinOptions {
  /** Distance between penetrations measured along the rail, in mm. */
  spacing: number;
  /** Hard limit for a single stitch span; longer spans get split. */
  maxStitchLength: number;
  /** Widens the column so the finished piece measures true after pulling. */
  pullCompensation: number;
  /**
   * Wells the first rail by this much instead of the uniform value.
   *
   * The two sides of a column do not always sit on the same fabric direction,
   * and edge-adjacent columns pull harder on the side that meets a fill. When
   * absent or null the uniform `pullCompensation` is used.
   */
  pullCompensationLeft?: number | null;
  /** Same, for the second rail. */
  pullCompensationRight?: number | null;
  /**
   * Split strategy for spans longer than `maxStitchLength`.
   * - 'divide': insert evenly spaced penetrations across the span (auto-split)
   * - 'reject': leave the span and let validation report it
   */
  splitStrategy: 'divide' | 'reject';
}

/**
 * Generate a satin column from two boundary rails.
 *
 * Rails are sampled at matching arc-length positions so each needle
 * penetration pairs a point on one side with its counterpart on the other,
 * producing the characteristic zigzag. Rows alternate direction to avoid a
 * pointless jump at the end of every row.
 */
export function satinFromRails(left: Point[], right: Point[], options: SatinOptions): RawStitch[] {
  const spacing = Math.max(0.1, options.spacing);
  const out: RawStitch[] = [];
  if (left.length < 2 || right.length < 2) return out;

  const lenL = pathLength(left);
  const lenR = pathLength(right);
  const track = Math.max(lenL, lenR);
  if (track < EPS) return out;

  // One row every `spacing` mm along the longer rail.
  const rowCount = Math.max(2, Math.round(track / spacing));
  const pullLeft = Math.max(0, options.pullCompensationLeft ?? options.pullCompensation);
  const pullRight = Math.max(0, options.pullCompensationRight ?? options.pullCompensation);

  let reverse = false;

  for (let i = 0; i <= rowCount; i++) {
    const t = i / rowCount;
    let a = pointAtT(left, t);
    let b = pointAtT(right, t);

    // Apply pull compensation along the span direction (widens the column).
    // The rails may be compensated by different amounts; each end moves only
    // by its own value, so the midpoint shifts when the two differ.
    if (pullLeft > 0 || pullRight > 0) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const spanLen = Math.hypot(dx, dy);
      if (spanLen > EPS) {
        const ux = dx / spanLen;
        const uy = dy / spanLen;
        a = { x: a.x - ux * pullLeft, y: a.y - uy * pullLeft };
        b = { x: b.x + ux * pullRight, y: b.y + uy * pullRight };
      }
    }

    const spanLen = Math.hypot(b.x - a.x, b.y - a.y);
    const parts =
      options.splitStrategy === 'divide'
        ? Math.max(1, Math.ceil(spanLen / options.maxStitchLength))
        : 1;

    // Alternate row direction so consecutive rows stay adjacent.
    const from = reverse ? b : a;
    const to = reverse ? a : b;

    out.push({ x: from.x, y: from.y, command: SEW });
    for (let k = 1; k <= parts; k++) {
      const u = k / parts;
      out.push({
        x: from.x + (to.x - from.x) * u,
        y: from.y + (to.y - from.y) * u,
        command: SEW,
      });
    }

    reverse = !reverse;
  }

  return out;
}

/**
 * Generate a satin column from a center stroke and a width.
 * This is the Input A / column digitizing entry point.
 */
export function satinFromStroke(
  stroke: Point[],
  width: number,
  options: SatinOptions,
): RawStitch[] {
  const clean = dedupePoints(stroke);
  if (clean.length < 2) return [];
  const { left, right } = railsFromStroke(clean, width);
  return satinFromRails(left, right, options);
}

/** Angle of a ring's long axis, in radians, from its boundary points. */
function principalAxis(ring: Point[]): { angle: number; cx: number; cy: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    n++;
    sx += p.x;
    sy += p.y;
  }
  if (n < 3) return { angle: 0, cx: sx / Math.max(1, n), cy: sy / Math.max(1, n) };
  const cx = sx / n;
  const cy = sy / n;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of ring) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  if (Math.abs(cxx) < 1e-9 && Math.abs(cyy) < 1e-9 && Math.abs(cxy) < 1e-9) {
    return { angle: 0, cx, cy };
  }
  return { angle: 0.5 * Math.atan2(2 * cxy, cxx - cyy), cx, cy };
}

/**
 * Sew a single closed outline as a satin column.
 *
 * The column tool collects one closed ring around the area to be satin-filled
 * (Wilcom's Input A outlines a column the same way). Treating that ring as a
 * spine and stroking it would sew a hairline around the shape; the ring is the
 * COLUMN BOUNDARY, not its centre line.
 *
 * The ring is rotated onto its long axis and every scanline across the column
 * becomes one satin row: stitches run rail to rail and rows advance by
 * `spacing` along the length. Alternating row direction keeps consecutive rows
 * connected at the same edge, and each scanline span is sewn on its own, so
 * curved, S-shaped and multi-arm columns all fill without crossing themselves.
 * Pull compensation widens every row outward along the stitch direction.
 */
export function satinFromOutline(
  path: CompoundPath,
  options: SatinOptions,
): RawStitch[] {
  const outer = path.rings[0];
  if (!outer || outer.length < 3) return [];
  const spacing = Math.max(0.1, options.spacing);
  const pullLeft = Math.max(0, options.pullCompensationLeft ?? options.pullCompensation);
  const pullRight = Math.max(0, options.pullCompensationRight ?? options.pullCompensation);

  const axis = principalAxis(outer);
  const centre = { x: axis.cx, y: axis.cy };
  // Rotate the long axis to vertical, so horizontal scanlines run ACROSS the
  // column and stepping down the page advances along its length.
  const rotated = rotatePath(path, -axis.angle - Math.PI / 2, centre);
  const box = boundsOf(rotated.rings);
  if (box.maxY - box.minY <= EPS || box.maxX - box.minX <= EPS) return [];

  const out: RawStitch[] = [];
  // Rows inset by half a row so the outline itself is not over-sewn.
  let reverse = false;
  const rowCount = Math.max(1, Math.round((box.maxY - box.minY) / spacing));
  const pitch = (box.maxY - box.minY) / rowCount;

  for (let r = 0; r <= rowCount; r++) {
    const y = box.minY + r * pitch;
    const spans = scanlineSpans(rotated.rings, y);
    if (spans.length === 0) continue;
    const ordered = reverse ? spans.slice().reverse() : spans;

    for (const [a, b] of ordered) {
      let x1 = a - pullLeft;
      let x2 = b + pullRight;
      if (x2 - x1 <= 0.2) continue;
      if (x1 > x2) [x1, x2] = [x2, x1];

      const parts = Math.max(1, Math.ceil((x2 - x1) / Math.max(0.5, options.maxStitchLength)));
      const from = reverse ? x2 : x1;
      const to = reverse ? x1 : x2;

      // The first point of a span is a stitch when it continues the row (the
      // short hop along the rail between rows); it is travel - a jump - when
      // the span starts somewhere else entirely, such as another arm of a
      // U-shaped column.
      const start: RawStitch = { x: from, y, command: SEW };
      const prev = out[out.length - 1];
      if (prev && Math.hypot(start.x - prev.x, start.y - prev.y) > 4) {
        start.command = JUMP;
      }
      out.push(start);
      for (let k = 1; k <= parts; k++) {
        const u = k / parts;
        out.push({ x: from + (to - from) * u, y, command: SEW });
      }
      reverse = !reverse;
    }
  }

  // Rotate back into design space.
  const back = axis.angle + Math.PI / 2;
  for (const st of out) {
    const p = rotatePoint({ x: st.x, y: st.y }, back, centre.x, centre.y);
    st.x = p.x;
    st.y = p.y;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Tatami fill
// ---------------------------------------------------------------------------

export interface TatamiOptions {
  /** Fill angle in degrees (0 = horizontal rows). */
  angle: number;
  /** Row pitch in mm - smaller means denser. */
  spacing: number;
  /**
   * Distance between penetrations ALONG each row, in mm.
   *
   * `spacing` is the row pitch across the fill; this is how long a single
   * stitch is. A real tatami is 0.35-0.5 mm between rows but 2-4 mm between
   * penetrations inside a row - using the row pitch as the along-row step too
   * would make every fill a solid mass of 0.4 mm stitches (and multiply the
   * stitch count of a machine file several times over).
   *
   * Optional: absent means {@link DEFAULT_TATAMI.stitchLength} (3 mm), which
   * is what a fill should sew when nobody has chosen otherwise.
   */
  stitchLength?: number;
  /** Outward extension applied to each row end in mm. */
  pullCompensation: number;
  /** Gaps wider than this become jump commands instead of travel stitches. */
  jumpThreshold: number;
  /** Alternating row direction, which minimises travel distance. */
  serpentine: boolean;
  /** Half-stitch offset on alternate rows: the woven / brick appearance. */
  offsetPattern: boolean;
  /** Pull rows in from the extreme edge so the outline stays clean. */
  edgeInset: number;
  /**
   * Break each row into blocks with a small gap between them - the
   * "programmed split" fill.
   *
   * `segmentLength` is how long a block runs before it breaks; `gap` is the
   * width of the break itself. Gap positions are staggered on alternate rows
   * so the breaks read as a brick grid rather than one line ruled across the
   * shape. Row ends are never eaten, so the outline still closes.
   *
   * Optional: absent means a plain continuous tatami, which is how every
   * design saved before this existed behaves.
   */
  split?: { segmentLength: number; gap: number; stagger?: number };
  /**
   * Ragged row ends: each row end is pushed in or out by up to this many mm.
   * Seeded from the shape, so the same design always tears the same way -
   * a texture you can trust, not a different fill on every compile.
   */
  jagged?: number;
  /**
   * Dome warp: rows bow outward sideways by up to this many mm along their
   * length, as if the fabric were stretched over a curved surface.
   */
  warp?: number;
  /**
   * Adaptive splits: block length follows the row's own width (short breaks
   * in narrow necks, longer ones across wide spans) instead of a fixed
   * number, so a flexi split follows the shape.
   */
  adaptiveSplit?: boolean;
}

export const DEFAULT_TATAMI: TatamiOptions = {
  angle: 45,
  spacing: 0.45,
  stitchLength: 3,
  pullCompensation: 0,
  jumpThreshold: 4,
  serpentine: true,
  offsetPattern: true,
  edgeInset: 0.15,
};

/**
 * Along-path penetration step for a fill, in mm.
 *
 * Clamped to a range a machine can actually sew: below ~0.5 mm the needle
 * punches the same hole repeatedly and shreds the thread, above 8 mm a fill
 * stitch starts to look like a run. Shared by tatami and the textured fills so
 * "stitch length" means one thing everywhere.
 */
export function fillStitchLength(value: number | undefined): number {
  const requested = value ?? DEFAULT_TATAMI.stitchLength ?? 3;
  if (!Number.isFinite(requested)) return 3;
  return Math.max(0.5, Math.min(8, requested));
}

/**
 * Generate tatami (weave / step) fill inside a compound shape.
 *
 * The shape is rotated so fill rows become horizontal, intersected with
 * horizontal scanlines, then rotated back. Holes are respected through the
 * even-odd scanline rule. Rows sit `spacing` mm apart; inside a row the needle
 * steps every `stitchLength` mm, which is what keeps the fill from collapsing
 * into a solid sheet of sub-millimetre stitches.
 */
export function tatamiFill(path: CompoundPath, options: Partial<TatamiOptions> = {}): RawStitch[] {
  const opts = { ...DEFAULT_TATAMI, ...options };
  const spacing = Math.max(0.05, opts.spacing);
  const stitchLength = fillStitchLength(opts.stitchLength);
  const inset = Math.max(0, opts.edgeInset);

  if (path.rings.length === 0 || path.rings.some((r) => r.length < 3)) return [];

  const center = boundsCenter(boundsOf(path.rings));
  const angle = -toRadians(opts.angle);
  const rotated = rotatePath(path, angle, center);
  const box = boundsOf(rotated.rings);

  if (box.maxX - box.minX <= 0 || box.maxY - box.minY <= 0) return [];

  // Texture randomness is seeded from the shape, never from a clock: a
  // jagged or wavy fill must compile to the same stitches every time, or the
  // preview and the file would disagree on every render.
  const rand = mulberry32(textureSeed(box.minX, box.minY, box.maxX, box.maxY));
  const jag = Math.max(0, opts.jagged ?? 0);
  const warp = Math.max(0, opts.warp ?? 0);

  const out: RawStitch[] = [];
  const rowStart = box.minY + inset;
  const rowEnd = box.maxY - inset;

  /**
   * Sew one row as programmed blocks.
   *
   * The gaps belong to the row's plan, not to the sampled stitch positions:
   * the row stops at a gap edge and starts again after it. Filtering a row's
   * penetrations instead would make the split depend on whether a stitch
   * happened to land inside a 1-2 mm gap, so a fill with a normal 3 mm stitch
   * length would silently sew as plain tatami - exactly the "the setting does
   * nothing" bug this pattern is meant to avoid.
   */
  const pushSplitRow = (
    x1: number,
    x2: number,
    reverse: boolean,
    row: number,
    pushPoint: (x: number, command: StitchCommand) => void,
  ): void => {
    const split = opts.split!;
    const width = x2 - x1;
    // Adaptive blocks measure the row itself, so a wide span breaks rarely
    // and a narrow neck breaks often - the split follows the shape.
    const segment = opts.adaptiveSplit
      ? Math.min(14, Math.max(3, width * 0.7))
      : Math.max(0.5, split.segmentLength);
    const gap = Math.max(0.2, split.gap);
    const span = segment + gap;
    // Alternate rows start part of a block later, so the breaks stagger into
    // a brick grid instead of ruling one line straight across the shape; a
    // user-defined split can set that fraction (0 = one straight break line).
    const stagger = split.stagger ?? 0.5;
    const firstGap = ((-(row % 2) * segment * stagger) % span + span) % span;

    // Sewn intervals in row-local coordinates.
    const blocks: [number, number][] = [];
    let cursor = 0;
    // The row's own ends are never eaten: an outline must still close. A gap
    // opening at the edge moves one span inward, and a gap that would leave
    // less than a stitch of row after it is skipped so the row can finish.
    let gapStart = firstGap < 0.5 ? firstGap + span : firstGap;
    while (cursor < width - 1e-9) {
      const gapEnd = gapStart + gap;
      if (gapStart >= width - 0.5 || gapEnd >= width - 0.5) break;
      if (gapStart > cursor + 1e-9) blocks.push([cursor, gapStart]);
      cursor = gapEnd;
      gapStart += span;
    }
    if (width - cursor > 0.25) blocks.push([cursor, width]);

    // Blocks are sewn in row order so the needle only ever lifts across the
    // short gap between two blocks, never back across a whole segment.
    const ordered = reverse ? blocks.slice().reverse() : blocks;
    for (let i = 0; i < ordered.length; i++) {
      const [a, b] = ordered[i]!;
      const from = x1 + (reverse ? b : a);
      const to = x1 + (reverse ? a : b);
      const length = Math.abs(to - from);
      const parts = Math.max(1, Math.ceil(length / stitchLength - 1e-9));
      const dir = to >= from ? 1 : -1;
      for (let k = 0; k <= parts; k++) {
        pushPoint(from + dir * (length / parts) * k, k === 0 && i > 0 ? JUMP : SEW);
      }
    }
  };

  const pushRow = (y: number, phase: number, reverse: boolean, row: number): void => {
    const spans = scanlineSpans(rotated.rings, y);
    const ordered = reverse ? spans.slice().reverse() : spans;

    for (const [rawStart, rawEnd] of ordered) {
      let x1 = rawStart - opts.pullCompensation;
      let x2 = rawEnd + opts.pullCompensation;
      // Jagged ends: grow or shrink each end, seeded per shape, so the edge
      // reads torn rather than ruled.
      if (jag > 0) {
        x1 -= rand() * jag;
        x2 += rand() * jag;
      }
      // A sliver narrower than a thread cannot be seen, and sewing both of
      // its ends puts two penetrations in one hole. It appears where a row
      // just grazes a rounded corner or a hole, so drop the whole span.
      if (x2 - x1 < 0.2) continue;

      // A warped row bows sideways: the displacement peaks at the row's
      // middle and returns to zero at both ends, so neighbouring rows still
      // meet and the outline keeps its shape.
      const pushPoint = (x: number, command: StitchCommand): void => {
        const wy = warp > 0 ? y - warp * Math.sin(Math.PI * ((x - x1) / (x2 - x1))) : y;
        out.push({ x, y: wy, command });
      };

      const xs: number[] = [];
      if (opts.split && x2 - x1 > 0.5) {
        // Programmed blocks replace the plain row: the row is broken at the
        // planned gap edges rather than filtered afterwards.
        pushSplitRow(x1, x2, reverse, row, pushPoint);
        continue;
      }

      if (!reverse) {
        // Walk left -> right. Penetrations land every `stitchLength` mm; the
        // half-stitch phase on alternate rows is what makes the brick weave.
        let first = x1 + phase;
        if (first < x1 + stitchLength * 0.25) first += stitchLength;
        if (first > x2) first = x2;
        xs.push(first);
        for (let x = first + stitchLength; x < x2 - 1e-9; x += stitchLength) xs.push(x);
        // A remainder shorter than a thread is not a stitch: snap the last
        // penetration to the exact row end instead of putting two holes in
        // the same spot.
        const last = xs[xs.length - 1]!;
        if (last < x2 - 1e-9) {
          if (x2 - last < 0.2) xs[xs.length - 1] = x2;
          else xs.push(x2);
        } else {
          xs[xs.length - 1] = x2;
        }
      } else {
        // Walk right -> left.
        let first = x2 - phase;
        if (first > x2 - stitchLength * 0.25) first -= stitchLength;
        if (first < x1) first = x1;
        xs.push(first);
        for (let x = first - stitchLength; x > x1 + 1e-9; x -= stitchLength) xs.push(x);
        const last = xs[xs.length - 1]!;
        if (last > x1 + 1e-9) {
          if (last - x1 < 0.2) xs[xs.length - 1] = x1;
          else xs.push(x1);
        } else {
          xs[xs.length - 1] = x1;
        }
      }

      if (xs.length === 0) continue;
      for (const x of xs) pushPoint(x, SEW);
    }
  };

  if (rowEnd <= rowStart) {
    // Shape is thinner than one row: fall back to a single mid-line pass.
    pushRow((box.minY + box.maxY) / 2, 0, false, 0);
  } else {
    const rowCount = Math.max(1, Math.floor((rowEnd - rowStart) / spacing));
    const pitch = (rowEnd - rowStart) / rowCount;
    for (let r = 0; r <= rowCount; r++) {
      const y = rowStart + r * pitch;
      // Alternate rows start half a stitch later, so penetrations stagger into
      // a brick weave instead of lining up into visible columns of holes.
      const phase = opts.offsetPattern ? (r % 2) * (stitchLength / 2) : 0;
      const reverse = opts.serpentine && r % 2 === 1;
      pushRow(y, phase, reverse, r);
    }
  }

  if (out.length === 0) return out;

  // Rotate the generated points back into design space.
  const back = -angle;
  for (const st of out) {
    const p = rotatePoint({ x: st.x, y: st.y }, back, center.x, center.y);
    st.x = p.x;
    st.y = p.y;
  }

  // Convert intra-shape travel into jumps where the needle would otherwise
  // drag thread across the design.
  let prev: RawStitch | null = null;
  for (const st of out) {
    if (prev) {
      const d = Math.hypot(st.x - prev.x, st.y - prev.y);
      if (d > opts.jumpThreshold) st.command = JUMP;
    }
    prev = st;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Run stitch
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Distance between penetrations in mm. */
  spacing: number;
  /** Curve sampling tolerance in mm - smaller follows curves more closely. */
  curveTolerance: number;
  /** Split moves that would exceed the machine limit. */
  maxStitchLength: number;
}

export const DEFAULT_RUN: RunOptions = {
  spacing: 3,
  curveTolerance: 0.15,
  maxStitchLength: 12.1,
};

/**
 * Generate a single run stitch along an open path.
 * Also used for outlines and travel paths.
 */
export function runStitch(points: Point[], options: Partial<RunOptions> = {}): RawStitch[] {
  const opts = { ...DEFAULT_RUN, ...options };
  const clean = dedupePoints(points);
  if (clean.length < 2) return [];

  const sampled = resample(clean, Math.max(0.1, opts.spacing));
  const split = splitLongSegments(sampled, opts.maxStitchLength);

  return split.map((p) => ({ x: p.x, y: p.y, command: SEW }));
}

/**
 * Generate a bean / triple-run stitch.
 *
 * Each segment is traversed forward, backward, then forward again, which lays
 * three threads side by side and produces a bold outline without changing
 * thread weight.
 */
export function beanStitch(
  points: Point[],
  options: Partial<RunOptions> = {},
  repeats = 3,
): RawStitch[] {
  const opts = { ...DEFAULT_RUN, ...options };
  const clean = dedupePoints(points);
  if (clean.length < 2) return [];

  const sampled = resample(clean, Math.max(0.1, opts.spacing));
  const split = splitLongSegments(sampled, opts.maxStitchLength);

  const passes = Math.max(1, repeats);
  const out: RawStitch[] = [];

  for (let pass = 0; pass < passes; pass++) {
    const reverse = pass % 2 === 1;
    const source = reverse ? split.slice().reverse() : split;
    for (const p of source) out.push({ x: p.x, y: p.y, command: SEW });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Decorative fills
// ---------------------------------------------------------------------------

export interface MotifOptions {
  spacing: number;
  motifScale: number;
  motifRotation: number;
  angle: number;
  /**
   * Size / rotation gradient across the layout.
   *
   * `t` runs 0 at the first row to 1 at the last and lerps both pairs, so a
   * motif fill can open out, close down or lean as it crosses the shape.
   */
  gradient?: {
    scaleFrom: number;
    scaleTo: number;
    angleFrom: number;
    angleTo: number;
  } | null;
}

/** A motif centred on the origin, unscaled: the canonical placement shape. */
function normalizeMotif(motif: Point[]): Point[] {
  const centre = boundsCenter(boundsOf([motif]));
  return motif.map((p) => ({ x: p.x - centre.x, y: p.y - centre.y }));
}

/** Place a centred motif at a point, scaled and rotated. */
function placeMotif(
  local: Point[],
  cx: number,
  cy: number,
  scale: number,
  radians: number,
): Point[] {
  return local.map((p) => {
    const r = rotatePoint({ x: p.x * scale, y: p.y * scale }, radians, 0, 0);
    return { x: r.x + cx, y: r.y + cy };
  });
}

/**
 * Repeat a motif along scanline rows inside a shape.
 *
 * The motif is a small closed path (a star, heart, flower ...) scaled to
 * `motifScale` and stamped wherever it fits on a grid derived from `spacing`.
 * Each motif is sewn as a run-stitch outline rather than a fill, which keeps
 * small motifs readable instead of turning them into a solid blob.
 */
export function motifFill(
  path: CompoundPath,
  motif: Point[],
  options: Partial<MotifOptions> = {},
): RawStitch[] {
  const spacing = Math.max(1, options.spacing ?? 4);
  const scale = Math.max(0.1, options.motifScale ?? 3);
  const angleDeg = options.angle ?? 0;
  const motifRot = toRadians(options.motifRotation ?? 0);
  const gradient = options.gradient ?? null;

  if (motif.length < 3 || path.rings.length === 0) return [];

  const center = boundsCenter(boundsOf(path.rings));
  const angle = -toRadians(angleDeg);
  const rotated = rotatePath(path, angle, center);
  const box = boundsOf(rotated.rings);
  if (box.maxX - box.minX <= 0 || box.maxY - box.minY <= 0) return [];

  const motifLocal = normalizeMotif(motif);
  const out: RawStitch[] = [];
  // Only position is tracked between motifs - the jump decision never needs
  // the command, so this stays a bare Point rather than a full RawStitch.
  let prev: Point | null = null;

  const boxHeight = Math.max(EPS, box.maxY - box.minY);
  for (let y = box.minY + spacing / 2; y <= box.maxY; y += spacing) {
    // Gradient position across the fill: the first row's motifs wear the
    // `From` values, the last row's the `To` values.
    const t = gradient ? Math.min(1, Math.max(0, (y - box.minY) / boxHeight)) : 0;
    const gradScale = gradient
      ? gradient.scaleFrom + (gradient.scaleTo - gradient.scaleFrom) * t
      : 1;
    const gradAngle = gradient
      ? toRadians(gradient.angleFrom + (gradient.angleTo - gradient.angleFrom) * t)
      : 0;
    const rot = motifRot + gradAngle;
    const motifScale = scale * gradScale;

    for (let x = box.minX + spacing / 2; x <= box.maxX; x += spacing) {
      // Stagger alternate rows for a brick-like motif arrangement.
      const cx = x + (Math.round((y - box.minY) / spacing) % 2 === 1 ? spacing / 2 : 0);
      const test = { x: cx, y };

      // Only stamp where the grid point sits inside the shape.
      if (!pointInRotated(rotated, test)) continue;

      const placed = placeMotif(motifLocal, cx, y, motifScale, rot);

      // The grid test above only proves the motif's CENTRE is inside. A motif
      // spans `scale` times its own half-size in every direction - with the
      // built-in star at scale 3 that is 15 mm - so a centre sitting just
      // inside the outline throws the whole stamped shape outside it, sewing
      // thread onto fabric the user never digitized (and quite possibly off
      // the hoop). Stamp only when the ENTIRE motif lands inside.
      let fits = true;
      for (const p of placed) {
        if (!pointInRotated(rotated, p)) {
          fits = false;
          break;
        }
      }
      if (!fits) continue;

      // Travel to the motif, then sew its outline.
      const first = placed[0]!;
      if (prev) {
        const d = Math.hypot(first.x - prev.x, first.y - prev.y);
        if (d > 0.5) out.push({ x: first.x, y: first.y, command: JUMP });
      }
      for (const p of placed) out.push({ x: p.x, y: p.y, command: SEW });
      out.push({ x: first.x, y: first.y, command: SEW });
      prev = placed[placed.length - 1]!;
    }
  }

  // Rotate back into design space.
  const back = -angle;
  for (const st of out) {
    const p = rotatePoint({ x: st.x, y: st.y }, back, center.x, center.y);
    st.x = p.x;
    st.y = p.y;
  }

  return out;
}

/**
 * Motif run: a motif stamped along a path, rotated to the path's tangent.
 *
 * This is line work made of motifs rather than a plain running stitch: the
 * motif's size is `motifScale` of its natural width and it steps along the
 * path at `spacing`. An open path starts at the first point and ends at the
 * last; a closed one wraps.
 */
export function motifRun(
  motif: Point[],
  path: Point[],
  options: {
    spacing: number;
    motifScale: number;
    angle?: number;
    closed?: boolean;
    gradient?: MotifOptions['gradient'];
  },
): RawStitch[] {
  const spacing = Math.max(1, options.spacing ?? 4);
  const scale = Math.max(0.1, options.motifScale ?? 3);
  const extra = toRadians(options.angle ?? 0);
  const gradient = options.gradient ?? null;
  const closed = options.closed ?? false;

  if (motif.length < 3 || path.length < 2) return [];

  // A closed outline as stored does not repeat its first point, so the walk
  // would miss the closing segment and leave a gap between the last motif and
  // the first. Append the wrap point before resampling.
  const wrap =
    closed &&
    Math.hypot(path[0]!.x - path[path.length - 1]!.x, path[0]!.y - path[path.length - 1]!.y) > 1e-9;
  const walkInput = wrap ? [...path, { ...path[0]! }] : path;

  // Walk the path at the motif pitch: each sample gets one motif, so adjacent
  // motifs meet instead of overlapping or leaving gaps.
  const walk = resample(walkInput, spacing);
  if (closed && walk.length > 1) {
    const a = walk[0]!;
    const b = walk[walk.length - 1]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) walk.pop();
  }
  if (walk.length === 0) return [];

  const local = normalizeMotif(motif);
  const out: RawStitch[] = [];
  let prev: Point | null = null;

  for (let i = 0; i < walk.length; i++) {
    const at = walk[i]!;
    // Tangent from the neighbours so the first and last samples still have
    // one direction to face.
    const before = walk[i - 1] ?? (closed ? walk[walk.length - 1]! : at);
    const after = walk[i + 1] ?? (closed ? walk[0]! : at);
    let dx = after.x - before.x;
    let dy = after.y - before.y;
    if (dx === 0 && dy === 0) {
      dx = 1;
      dy = 0;
    }
    const tangent = Math.atan2(dy, dx);

    const t = gradient && walk.length > 1 ? i / (walk.length - 1) : 0;
    const gradScale = gradient
      ? gradient.scaleFrom + (gradient.scaleTo - gradient.scaleFrom) * t
      : 1;
    const gradAngle = gradient
      ? toRadians(gradient.angleFrom + (gradient.angleTo - gradient.angleFrom) * t)
      : 0;

    const placed = placeMotif(local, at.x, at.y, scale * gradScale, tangent + extra + gradAngle);

    const first = placed[0]!;
    if (prev) {
      const d = Math.hypot(first.x - prev.x, first.y - prev.y);
      if (d > 0.5) out.push({ x: first.x, y: first.y, command: JUMP });
    }
    for (const p of placed) out.push({ x: p.x, y: p.y, command: SEW });
    out.push({ x: first.x, y: first.y, command: SEW });
    prev = first;
  }

  return out;
}

/**
 * Motif single: one motif stamp, scaled to fit the object's own box.
 *
 * Draw the box you want the stamp to fill, and the motif is centred in it and
 * scaled to touch the nearer pair of sides - the stamp tool. `rotation` turns
 * the whole stamp.
 */
export function motifSingle(
  motif: Point[],
  box: { minX: number; minY: number; maxX: number; maxY: number },
  options: { rotation?: number } = {},
): RawStitch[] {
  if (motif.length < 3) return [];

  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  if (width <= 0 || height <= 0) return [];

  const local = normalizeMotif(motif);
  const natural = boundsOf([local]);
  const naturalW = Math.max(EPS, natural.maxX - natural.minX);
  const naturalH = Math.max(EPS, natural.maxY - natural.minY);
  // Contain, not cover: the stamp must not sew outside the box it was drawn in.
  const scale = Math.min(width / naturalW, height / naturalH);

  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const placed = placeMotif(local, cx, cy, scale, toRadians(options.rotation ?? 0));

  const out: RawStitch[] = [];
  for (const p of placed) out.push({ x: p.x, y: p.y, command: SEW });
  out.push({ x: placed[0]!.x, y: placed[0]!.y, command: SEW });
  return out;
}

/**
 * Motif column: motifs laid across a column between two rails.
 *
 * Each motif spans the local width and steps along the centreline, which is
 * how a motif column replaces the satin zigzag with shapes. Widths come from
 * the rails themselves, so the column can taper.
 */
export function motifColumn(
  motif: Point[],
  left: Point[],
  right: Point[],
  options: {
    spacing: number;
    angle?: number;
    gradient?: MotifOptions['gradient'];
  },
): RawStitch[] {
  const spacing = Math.max(1, options.spacing ?? 4);
  const extra = toRadians(options.angle ?? 0);
  const gradient = options.gradient ?? null;

  if (motif.length < 3 || left.length < 2 || right.length < 2) return [];

  // Resample both rails at the same pitch so station i of one rail pairs with
  // station i of the other.
  const leftWalk = resample(left, spacing);
  const rightWalk = resample(right, spacing);
  const stations = Math.min(leftWalk.length, rightWalk.length);
  if (stations < 2) return [];

  const local = normalizeMotif(motif);
  const natural = boundsOf([local]);
  const naturalW = Math.max(EPS, natural.maxX - natural.minX);

  const out: RawStitch[] = [];
  let prev: Point | null = null;

  for (let i = 0; i < stations; i++) {
    const l = leftWalk[i]!;
    const r = rightWalk[i]!;
    const cx = (l.x + r.x) / 2;
    const cy = (l.y + r.y) / 2;
    const width = Math.hypot(r.x - l.x, r.y - l.y);
    if (width <= EPS) continue;

    // The motif crosses the column: its long axis lies rail-to-rail.
    const across = Math.atan2(r.y - l.y, r.x - l.x);

    const t = gradient && stations > 1 ? i / (stations - 1) : 0;
    const gradScale = gradient
      ? gradient.scaleFrom + (gradient.scaleTo - gradient.scaleFrom) * t
      : 1;
    const gradAngle = gradient
      ? toRadians(gradient.angleFrom + (gradient.angleTo - gradient.angleFrom) * t)
      : 0;

    // Scale so the motif's natural width spans the column (rail to rail),
    // turned a quarter turn so its width runs across the direction of travel.
    const scale = ((width * 0.95) / naturalW) * gradScale || 0.1;
    const placed = placeMotif(local, cx, cy, scale, across + extra + gradAngle);

    const first = placed[0]!;
    if (prev) {
      const d = Math.hypot(first.x - prev.x, first.y - prev.y);
      if (d > 0.5) out.push({ x: first.x, y: first.y, command: JUMP });
    }
    for (const p of placed) out.push({ x: p.x, y: p.y, command: SEW });
    out.push({ x: first.x, y: first.y, command: SEW });
    prev = first;
  }

  return out;
}

/** Local point-in-path test used by motif placement (rotated space). */
function pointInRotated(path: CompoundPath, pt: Point): boolean {
  let inside = false;
  for (const ring of path.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > pt.y !== b.y > pt.y) {
        const t = (pt.y - a.y) / (b.y - a.y);
        if (pt.x < a.x + t * (b.x - a.x)) inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Contour fill: concentric offset rings followed the shape outline.
 *
 * Offsets are generated by moving each vertex inward along its angle bisector.
 * This is robust for convex and moderately concave shapes; deeply concave or
 * self-intersecting input is detected by the caller and reported as a warning
 * rather than silently producing crossed stitches.
 */
export function contourFill(
  path: CompoundPath,
  options: { spacing: number; angle?: number; maxIterations?: number; stitchLength?: number },
): RawStitch[] {
  const spacing = Math.max(0.2, options.spacing);
  const stitchLength = fillStitchLength(options.stitchLength);
  const out: RawStitch[] = [];
  const outer = path.rings[0];
  if (!outer || outer.length < 3) return out;

  const box = boundsOf(path.rings);
  const maxRings =
    options.maxIterations ??
    Math.ceil(Math.min(box.maxX - box.minX, box.maxY - box.minY) / (2 * spacing));

  let current = outer.map((p) => ({ ...p }));
  // Position only - used to decide when a ring step needs a jump.
  let prev: Point | null = null;

  for (let ring = 0; ring < maxRings; ring++) {
    if (current.length < 3) break;

    const closed = [...current, current[0]!];
    // Penetrations march along the contour every stitch length, not every row
    // pitch: the row pitch is how far the next ring sits inward.
    const sampled = resample(closed, stitchLength);

    // Alternate direction so rings link up with a short travel.
    const source = ring % 2 === 1 ? sampled.slice().reverse() : sampled;

    for (const p of source) {
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > 6) {
        out.push({ x: p.x, y: p.y, command: JUMP });
      }
      out.push({ x: p.x, y: p.y, command: SEW });
      prev = p;
    }

    const next = insetRing(current, spacing);
    if (next.length < 3) break;
    if (ringArea(next) < spacing * spacing) break;
    current = next;
  }

  return out;
}

/** Move every vertex toward the centroid along its bisector by `distance`. */
function insetRing(ring: Point[], distance: number): Point[] {
  const n = ring.length;
  if (n < 3) return [];

  const cx = ring.reduce((s, p) => s + p.x, 0) / n;
  const cy = ring.reduce((s, p) => s + p.y, 0) / n;

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const prev = ring[(i - 1 + n) % n]!;
    const next = ring[(i + 1) % n]!;

    const v1x = prev.x - p.x;
    const v1y = prev.y - p.y;
    const v2x = next.x - p.x;
    const v2y = next.y - p.y;
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = Math.hypot(v2x, v2y) || 1;

    // Bisector direction.
    let bx = v1x / l1 + v2x / l2;
    let by = v1y / l1 + v2y / l2;
    const bl = Math.hypot(bx, by);
    if (bl < EPS) {
      bx = cx - p.x;
      by = cy - p.y;
      const cl = Math.hypot(bx, by) || 1;
      bx /= cl;
      by /= cl;
    } else {
      bx /= bl;
      by /= bl;
    }

    // Make sure the bisector points inward.
    if (bx * (cx - p.x) + by * (cy - p.y) < 0) {
      bx = -bx;
      by = -by;
    }

    out.push({ x: p.x + bx * distance, y: p.y + by * distance });
  }
  return out;
}

function ringArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Spiral fill: an Archimedean spiral clipped to the shape by stopping the
 * radial advance whenever the traced point leaves the boundary.
 */
export function spiralFill(
  path: CompoundPath,
  options: { spacing: number; clockwise?: boolean; startAtCenter?: boolean; stitchLength?: number },
): RawStitch[] {
  const spacing = Math.max(0.3, options.spacing);
  const stitchLength = fillStitchLength(options.stitchLength);
  const direction = options.clockwise === false ? -1 : 1;
  const out: RawStitch[] = [];

  const box = boundsOf(path.rings);
  const center = boundsCenter(box);
  const radius = Math.hypot(box.maxX - center.x, box.maxY - center.y);
  if (radius <= 0) return out;

  const b = spacing / TAU; // Archimedean: r = b * theta
  const maxTheta = (radius / b) * 1.4;

  let prevInside = false;
  let prev: RawStitch | null = null;

  // The arc travelled by one angular step grows with radius, so keep the arc
  // length constant instead: a fixed angular step puts stitches 0.1 mm apart
  // near the centre and 3 mm apart at the rim.
  for (let theta = 0; theta <= maxTheta; ) {
    const r = b * theta;
    const a = direction * theta;
    const p = { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
    const inside = pointInRotated(path, p);

    if (inside) {
      if (!prevInside && prev) out.push({ x: p.x, y: p.y, command: JUMP });
      out.push({ x: p.x, y: p.y, command: SEW });
      prev = { x: p.x, y: p.y, command: SEW };
    }
    prevInside = inside;

    theta += Math.min(0.45, stitchLength / Math.max(1, r));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Advanced fills
// ---------------------------------------------------------------------------

/** Shared options for the textured fills: direction and density. */
export interface AdvancedFillOptions {
  /** Fill angle in degrees (0 = horizontal rows). */
  angle?: number;
  /** Row pitch / stitch density in mm. */
  spacing?: number;
  /**
   * Distance between penetrations along a row, in mm.
   *
   * Row pitch and stitch length are different quantities: `spacing` says how
   * far apart the rows are, this says how long each stitch is. Absent means
   * 3 mm, the same default the plain tatami uses.
   */
  stitchLength?: number;
}

/**
 * Accordion fill: pleated zigzag bands.
 *
 * Each row is a triangle wave whose peaks run above and below the row line,
 * with the phase inverted on alternate rows, so the surface reads as a fan of
 * folds. Peaks that would fall outside the shape are dropped rather than sewn
 * over the edge.
 */
export function accordionFill(path: CompoundPath, options: AdvancedFillOptions = {}): RawStitch[] {
  const space = rotatedFillSpace(path, options.angle ?? 45);
  if (!space) return [];
  const { rotated, center, angle, box } = space;

  const spacing = Math.max(0.15, options.spacing ?? 0.45);
  const stitchLength = fillStitchLength(options.stitchLength);
  const pitch = Math.max(spacing * 2.2, stitchLength * 0.9);
  const amp = Math.max(spacing * 1.6, stitchLength * 0.5);
  const step = stitchLength;
  const inset = Math.min(amp, (box.maxY - box.minY) / 2);
  const out: RawStitch[] = [];

  const rows = Math.max(1, Math.floor((box.maxY - box.minY - inset * 2) / pitch));
  for (let r = 0; r <= rows; r++) {
    const y = box.minY + inset + r * pitch;
    if (y > box.maxY - inset + 1e-9) break;
    const dir = r % 2 === 0 ? 1 : -1;
    const reverse = r % 2 === 1;
    const spans = scanlineSpans(rotated.rings, y);
    const ordered = reverse ? spans.slice().reverse() : spans;

    for (const [sx, ex] of ordered) {
      const xs = spanPoints(sx, ex, step, (r % 2) * (step / 2));
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]!;
        const yy = y + dir * (i % 2 === 0 ? amp : -amp);
        if (!pointInRotated(rotated, { x, y: yy })) continue;
        out.push({ x, y: yy, command: SEW });
      }
    }
  }

  rotateBackIntoDesign(out, center, angle);
  // The zig-zag legs are stitches, not travel: break only moves longer than a
  // leg, or the pattern's own stitches would be converted into jumps and the
  // fill would lose almost every penetration.
  breakLongTravels(out, Math.max(4, Math.hypot(step, amp * 2) + 0.5));
  return out;
}

/**
 * Florentine fill: a leaf / herringbone weave.
 *
 * The shape is split into horizontal bands whose rows lean one way, the next
 * band the other way, so the fill reads as rows of leaves rather than one
 * ruled texture.
 */
export function florentineFill(path: CompoundPath, options: AdvancedFillOptions = {}): RawStitch[] {
  const space = rotatedFillSpace(path, options.angle ?? 45);
  if (!space) return [];
  const { rotated, center, angle, box } = space;

  const spacing = Math.max(0.15, options.spacing ?? 0.45);
  const stitchLength = fillStitchLength(options.stitchLength);
  const band = spacing * 6;
  const pitch = spacing * 1.6;
  const slope = Math.tan(toRadians(35));
  const out: RawStitch[] = [];

  const bands = Math.max(1, Math.ceil((box.maxY - box.minY) / band));
  for (let b = 0; b <= bands; b++) {
    const top = box.minY + b * band + spacing * 0.4;
    const bottom = Math.min(box.maxY - spacing * 0.4, top + band - spacing * 0.8);
    if (bottom < top) continue;
    const dir = b % 2 === 0 ? 1 : -1;
    let r = 0;

    for (let y0 = top; y0 <= bottom + 1e-9; y0 += pitch, r++) {
      const reverse = r % 2 === 1;
      const spans = scanlineSpans(rotated.rings, y0);
      const ordered = reverse ? spans.slice().reverse() : spans;

      for (const [sx, ex] of ordered) {
        const xs = spanPoints(sx, ex, stitchLength);
        for (const x of xs) {
          // The tilt resets every band, so each row is a zigzag leaf inside
          // its band rather than one huge diagonal across the shape.
          const t = (((x - sx) % (band * 2)) + band * 2) % (band * 2);
          const yy = y0 + dir * slope * (t / (band * 2) - 0.5) * band;
          if (!pointInRotated(rotated, { x, y: yy })) continue;
          out.push({ x, y: yy, command: SEW });
        }
      }
    }
  }

  rotateBackIntoDesign(out, center, angle);
  breakLongTravels(out, 4);
  return out;
}

/** Liquid fill: rows that flow as gentle sine waves. */
export function liquidFill(path: CompoundPath, options: AdvancedFillOptions = {}): RawStitch[] {
  const space = rotatedFillSpace(path, options.angle ?? 45);
  if (!space) return [];
  const { rotated, center, angle, box } = space;

  const spacing = Math.max(0.15, options.spacing ?? 0.45);
  const stitchLength = fillStitchLength(options.stitchLength);
  const pitch = spacing * 1.6;
  const amp = Math.max(spacing * 0.9, stitchLength * 0.22);
  const wavelength = Math.max(4, stitchLength * 2.5);
  const inset = Math.min(amp, (box.maxY - box.minY) / 2);
  const out: RawStitch[] = [];

  const rows = Math.max(1, Math.floor((box.maxY - box.minY - inset * 2) / pitch));
  for (let r = 0; r <= rows; r++) {
    const y0 = box.minY + inset + r * pitch;
    const reverse = r % 2 === 1;
    const spans = scanlineSpans(rotated.rings, y0);
    const ordered = reverse ? spans.slice().reverse() : spans;

    for (const [sx, ex] of ordered) {
      const xs = spanPoints(sx, ex, stitchLength);
      for (const x of xs) {
        const yy = y0 + amp * Math.sin((TAU * (x - sx)) / wavelength + (r % 2) * Math.PI);
        if (!pointInRotated(rotated, { x, y: yy })) continue;
        out.push({ x, y: yy, command: SEW });
      }
    }
  }

  rotateBackIntoDesign(out, center, angle);
  breakLongTravels(out, 4);
  return out;
}

/**
 * Maze fill: one line wandering the shape with square turns.
 *
 * Rows run to near the edge, then step down a row's pitch at the same x, so
 * the turns are right angles and the whole fill is a single meandering line.
 */
export function mazeFill(path: CompoundPath, options: AdvancedFillOptions = {}): RawStitch[] {
  const space = rotatedFillSpace(path, options.angle ?? 0);
  if (!space) return [];
  const { rotated, center, angle, box } = space;

  const spacing = Math.max(0.2, options.spacing ?? 0.45);
  const stitchLength = fillStitchLength(options.stitchLength);
  const pitch = spacing * 1.6;
  const out: RawStitch[] = [];

  for (let r = 0; ; r++) {
    const y = box.minY + pitch * 0.75 + r * pitch;
    if (y > box.maxY - pitch * 0.75 + 1e-9) break;
    const reverse = r % 2 === 1;
    const spans = scanlineSpans(rotated.rings, y);
    const ordered = reverse ? spans.slice().reverse() : spans;

    for (const [sx, ex] of ordered) {
      const x1 = sx + pitch * 0.75;
      const x2 = ex - pitch * 0.75;
      const xs = spanPoints(x1, Math.max(x1, x2), stitchLength);
      const walked = reverse ? xs.slice().reverse() : xs;
      for (const x of walked) out.push({ x, y, command: SEW });
    }
  }

  rotateBackIntoDesign(out, center, angle);
  breakLongTravels(out, 4);
  return out;
}

/** String fill: loosely laid, longer meandering stitches. */
export function stringFill(path: CompoundPath, options: AdvancedFillOptions = {}): RawStitch[] {
  const space = rotatedFillSpace(path, options.angle ?? 45);
  if (!space) return [];
  const { rotated, center, angle, box } = space;

  const spacing = Math.max(0.15, options.spacing ?? 0.45);
  const stitchLength = fillStitchLength(options.stitchLength);
  const pitch = spacing * 2.6;
  const step = Math.max(1.5, stitchLength);
  const drift = spacing * 2.5;
  const out: RawStitch[] = [];

  const rows = Math.max(1, Math.floor((box.maxY - box.minY) / pitch));
  for (let r = 0; r <= rows; r++) {
    const y = box.minY + r * pitch;
    if (y > box.maxY + 1e-9) break;
    const reverse = r % 2 === 1;
    // Alternating insets give the row-to-row connectors a diagonal drift, so
    // the thread reads as string rather than a ladder.
    const inset = drift * (r % 2 === 0 ? 1 : 1.7);
    const spans = scanlineSpans(rotated.rings, y);
    const ordered = reverse ? spans.slice().reverse() : spans;

    for (const [sx, ex] of ordered) {
      const x1 = sx + inset;
      const x2 = ex - inset;
      if (x2 <= x1) continue;
      const xs = spanPoints(x1, x2, step);
      const walked = reverse ? xs.slice().reverse() : xs;
      for (const x of walked) {
        if (!pointInRotated(rotated, { x, y })) continue;
        out.push({ x, y, command: SEW });
      }
    }
  }

  rotateBackIntoDesign(out, center, angle);
  breakLongTravels(out, 4);
  return out;
}

/**
 * Laydown fill: long parallel laid threads.
 *
 * One texture pass of deliberately long stitches, split at the machine's
 * maximum so the file stays sewable. Used as a visible fill in its own right
 * and as the honest basis for a base layer under other work.
 */
export function laydownFill(
  path: CompoundPath,
  options: AdvancedFillOptions & { maxStitchLength?: number } = {},
): RawStitch[] {
  const space = rotatedFillSpace(path, options.angle ?? 0);
  if (!space) return [];
  const { rotated, center, angle, box } = space;

  const spacing = Math.max(0.2, options.spacing ?? 0.5);
  const pitch = Math.max(1, spacing * 2);
  const step = Math.max(2, options.maxStitchLength ?? 12.1);
  const out: RawStitch[] = [];

  const rows = Math.max(1, Math.floor((box.maxY - box.minY) / pitch));
  for (let r = 0; r <= rows; r++) {
    const y = box.minY + r * pitch;
    if (y > box.maxY + 1e-9) break;
    const reverse = r % 2 === 1;
    const spans = scanlineSpans(rotated.rings, y);
    const ordered = reverse ? spans.slice().reverse() : spans;

    for (const [sx, ex] of ordered) {
      const xs = spanPoints(sx, ex, step);
      const walked = reverse ? xs.slice().reverse() : xs;
      for (const x of walked) out.push({ x, y, command: SEW });
    }
  }

  rotateBackIntoDesign(out, center, angle);
  // The long laid threads ARE the texture, so only breaks longer than a laid
  // stitch plus a row step (a hop across a hole) become needle-up travel.
  breakLongTravels(out, step + pitch + 1);
  return out;
}

/**
 * Stipple fill: a jittered dot texture.
 *
 * Dots sit on a grid with deterministic jitter, kept only when they land
 * inside the shape. The dot-to-dot travel is usually short enough to sew; a
 * long hop becomes a jump so no thread is dragged across a hole.
 */
export function stippleFill(path: CompoundPath, options: AdvancedFillOptions = {}): RawStitch[] {
  if (path.rings.length === 0 || path.rings.some((r) => r.length < 3)) return [];

  const spacing = Math.max(0.2, options.spacing ?? 0.45);
  const grid = Math.max(1.1, spacing * 2.4);
  const box = boundsOf(path.rings);
  const rand = mulberry32(textureSeed(box.minX, box.minY, box.maxX, box.maxY));
  const jitter = grid * 0.38;
  const out: RawStitch[] = [];

  let row = 0;
  for (let y = box.minY + grid / 2; y <= box.maxY; y += grid, row++) {
    const reverse = row % 2 === 1;
    const candidates: Point[] = [];
    for (let x = box.minX + grid / 2; x <= box.maxX; x += grid) {
      const px = x + (rand() * 2 - 1) * jitter;
      const py = y + (rand() * 2 - 1) * jitter;
      if (pointInRotated(path, { x: px, y: py })) candidates.push({ x: px, y: py });
    }
    const ordered = reverse ? candidates.reverse() : candidates;
    for (const p of ordered) out.push({ x: p.x, y: p.y, command: SEW });
  }

  breakLongTravels(out, Math.max(3, grid * 1.5));
  return out;
}

/** Cross hatch fill: one pass at the fill angle, one perpendicular to it. */
export function crossFill(path: CompoundPath, options: AdvancedFillOptions = {}): RawStitch[] {
  const angle = options.angle ?? 0;
  const spacing = Math.max(0.15, options.spacing ?? 0.45);
  const stitchLength = fillStitchLength(options.stitchLength);
  const pitch = spacing * 2;
  const edgeInset = Math.min(0.3, spacing * 0.35);

  const base = tatamiFill(path, {
    angle,
    spacing: pitch,
    stitchLength,
    serpentine: true,
    offsetPattern: false,
    edgeInset,
  });
  const crossed = tatamiFill(path, {
    angle: angle + 90,
    spacing: pitch,
    stitchLength,
    serpentine: true,
    offsetPattern: false,
    edgeInset,
  });
  // The two passes are separate runs: the needle lifts between them.
  if (crossed.length > 0) crossed[0] = { ...crossed[0]!, command: JUMP };
  return [...base, ...crossed];
}

/**
 * Shading fill: the row pitch fades from open to dense across the shape.
 *
 * Reads as light falling across the surface: the open end shows more fabric,
 * the dense end more thread.
 */
export function shadingFill(path: CompoundPath, options: AdvancedFillOptions = {}): RawStitch[] {
  const space = rotatedFillSpace(path, options.angle ?? 45);
  if (!space) return [];
  const { rotated, center, angle, box } = space;

  const spacing = Math.max(0.15, options.spacing ?? 0.45);
  const stitchLength = fillStitchLength(options.stitchLength);
  const height = box.maxY - box.minY;
  const out: RawStitch[] = [];

  let y = box.minY;
  let r = 0;
  while (y <= box.maxY + 1e-9 && r < 4000) {
    const t = height > 0 ? (y - box.minY) / height : 0;
    const pitch = spacing * (2.6 - 2.1 * t);
    const reverse = r % 2 === 1;
    const spans = scanlineSpans(rotated.rings, y);
    const ordered = reverse ? spans.slice().reverse() : spans;

    for (const [sx, ex] of ordered) {
      const xs = spanPoints(sx, ex, stitchLength, (r % 2) * (stitchLength / 2));
      const walked = reverse ? xs.slice().reverse() : xs;
      for (const x of walked) out.push({ x, y, command: SEW });
    }

    y += Math.max(0.1, pitch);
    r++;
  }

  rotateBackIntoDesign(out, center, angle);
  breakLongTravels(out, 4);
  return out;
}

/** Hand stitch fill: irregular penetrations and jittered rows, hand-sewn look. */
export function handStitchFill(path: CompoundPath, options: AdvancedFillOptions = {}): RawStitch[] {
  const space = rotatedFillSpace(path, options.angle ?? 45);
  if (!space) return [];
  const { rotated, center, angle, box } = space;

  const spacing = Math.max(0.2, options.spacing ?? 0.45);
  const stitchLength = fillStitchLength(options.stitchLength);
  const pitch = spacing * 2.4;
  const rand = mulberry32(textureSeed(box.minX, box.minY, box.maxX, box.maxY));
  const out: RawStitch[] = [];

  let r = 0;
  for (let y0 = box.minY; y0 <= box.maxY + 1e-9; y0 += pitch, r++) {
    const reverse = r % 2 === 1;
    const spans = scanlineSpans(rotated.rings, y0);
    const ordered = reverse ? spans.slice().reverse() : spans;

    for (const [sx, ex] of ordered) {
      const dir = reverse ? -1 : 1;
      let x = (reverse ? ex : sx) + dir * rand() * spacing * 2;
      let guard = 0;
      while ((dir > 0 ? x < ex - 1e-9 : x > sx + 1e-9) && guard++ < 5000) {
        const py = y0 + (rand() - 0.5) * spacing;
        if (pointInRotated(rotated, { x, y: py })) {
          out.push({ x, y: py, command: SEW });
        }
        x += dir * Math.max(0.6, stitchLength * (0.55 + rand() * 0.9));
      }
    }
  }

  rotateBackIntoDesign(out, center, angle);
  breakLongTravels(out, Math.max(3, pitch * 1.5));
  return out;
}

// ---------------------------------------------------------------------------
// Validation helpers used by every generator
// ---------------------------------------------------------------------------

/** Longest single sew stitch in a raw point list. */
export function maxStitchLength(stitches: RawStitch[]): number {
  let max = 0;
  for (let i = 1; i < stitches.length; i++) {
    const a = stitches[i - 1]!;
    const b = stitches[i]!;
    if (b.command !== SEW) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > max) max = d;
  }
  return max;
}
