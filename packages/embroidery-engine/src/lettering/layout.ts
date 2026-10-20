/**
 * Text layout for the single-stroke font.
 *
 * Converts a string into positioned glyph strokes, then into satin columns.
 *
 * Two responsibilities are kept separate on purpose:
 *
 *  - `layoutText` does pure geometry and knows nothing about stitches. It is
 *    therefore easy to test and to reuse for a preview or an export that
 *    needs the raw letter shapes.
 *  - `textToStitches` turns that layout into needle penetrations using the
 *    same satin generator the column tools use, so lettering behaves exactly
 *    like a hand-digitized satin column: underlay, pull compensation and
 *    tie-offs all come from the shared pipeline rather than a private copy.
 *
 * Four layouts share that pipeline: straight text (optionally with one
 * dropped letter), text that follows a path, a three-initial monogram, and
 * monogram frames. Resequencing reorders the finished pieces without moving
 * them, so it changes the sewing order only.
 */

import type { LetteringOrder, LetteringPath, MonogramSpec, Point } from '../types.js';
import { dedupePoints, toRadians } from '../geometry/index.js';
import { satinFromStroke, type RawStitch, type SatinOptions } from '../stitches/index.js';
import { METRICS, resolveGlyph, type Glyph } from './font.js';

export interface LetteringOptions {
  /** Cap height in millimeters. Other features scale with it. */
  height: number;
  /** Extra space between characters, in millimeters. Negative tightens. */
  spacing: number;
  /** Shear applied to the letterforms, in degrees from vertical. */
  slant: number;
  /** Overall rotation of the finished lettering, in degrees. */
  rotation: number;
  /** Anchor the layout at this design-space point. */
  origin: Point;
  /** Stitch width of each stroke in millimeters. */
  width: number;
  /** Horizontal width factor for the glyphs; 1 keeps the font's proportions. */
  stretch?: number;
  /** Mirrors applied to the finished layout. */
  mirror?: { x: boolean; y: boolean } | null;
  /** Text on a path. Absent or null lays the text out straight. */
  onPath?: LetteringPath | null;
  /** Monogram composition. Takes precedence over the other layouts. */
  monogram?: MonogramSpec | null;
  /** One larger letter that drops below the line. Straight text only. */
  drop?: { enabled: boolean; index: number; scale: number } | null;
  /** Sewing order of the glyphs. */
  order?: LetteringOrder;
  /** Satin width of a monogram frame; defaults to `width`. */
  frameWidth?: number;
}

export const DEFAULT_LETTERING: LetteringOptions = {
  height: 20,
  spacing: 0,
  slant: 0,
  rotation: 0,
  origin: { x: 0, y: 0 },
  width: 1.2,
};

export interface GlyphPlacement {
  char: string;
  /** Advance width actually used, in mm. */
  advance: number;
  /** True when the font had no glyph and '?' was substituted. */
  substituted: boolean;
  /** Strokes in design coordinates (after scale, slant, rotation, offset). */
  strokes: Point[][];
}

export interface TextLayout {
  placements: GlyphPlacement[];
  /** Everything the glyphs produced, flattened - handy for bounds checks. */
  strokes: Point[][];
  /** Monogram frame polyline in design coordinates, or null. */
  frame: Point[] | null;
  /** Bounding box in design coordinates, or null for blank input. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** Scale factor from em units to millimeters. */
function scaleFor(options: LetteringOptions): number {
  return options.height / METRICS.capHeight;
}

/**
 * Apply slant as a horizontal shear about the baseline.
 *
 * A slant of 0 leaves the glyph alone; positive leans right, which is what
 * "italic" means for lettering. The shear is applied before rotation so the
 * slant stays consistent along the lettering's own baseline rather than the
 * page's.
 */
function applySlant(pt: Point, slantDegrees: number): Point {
  if (slantDegrees === 0) return pt;
  const shear = Math.tan(toRadians(slantDegrees));
  return { x: pt.x + pt.y * shear, y: pt.y };
}

/** A glyph's strokes in mm, y down, cap top on y=0, not yet positioned. */
function composeGlyph(
  glyph: Glyph,
  scale: number,
  slant: number,
  mirror: boolean,
  shiftY: number,
  stretch = 1,
): Point[][] {
  const local = glyph.strokes.map((stroke) =>
    stroke.map(([x, y]) => {
      // 1. Slant in the em frame, where y still points up. Applying it after
      // the flip would reverse the shear direction, so "italic" would lean
      // left.
      const slanted = applySlant({ x, y }, slant);
      // 2. em units -> mm, flipping y so it points down like the design.
      //    The cap top is moved to y=0 so the glyph's top-left is its anchor:
      //    the field is addressed from its top-left, so "place text here"
      //    should make the letters fall down and to the right of the click.
      return {
        x: slanted.x * scale * stretch,
        y: (-slanted.y + METRICS.capHeight) * scale + shiftY,
      };
    }),
  );

  if (mirror) mirrorInPlace(local);
  return local;
}

/** Read the width factor, guarding against nonsense values. */
function stretchOf(options: LetteringOptions): number {
  const stretch = options.stretch ?? 1;
  return Number.isFinite(stretch) && stretch > 0 ? stretch : 1;
}

/** Mirror strokes horizontally about their own ink centre. */
function mirrorInPlace(strokes: Point[][]): void {
  const box = inkBounds(strokes);
  if (!box) return;
  const mid = (box.minX + box.maxX) / 2;
  for (const stroke of strokes) {
    for (const p of stroke) p.x = 2 * mid - p.x;
  }
}

function translateX(strokes: Point[][], dx: number): void {
  if (dx === 0) return;
  for (const stroke of strokes) {
    for (const p of stroke) p.x += dx;
  }
}

/** Rotate about the layout origin, then translate to the anchor point. */
function rotateTranslate(strokes: Point[][], angleRadians: number, origin: Point): Point[][] {
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  return strokes.map((stroke) =>
    stroke.map((p) => ({
      x: p.x * cos - p.y * sin + origin.x,
      y: p.x * sin + p.y * cos + origin.y,
    })),
  );
}

function inkBounds(strokes: Point[][]): TextLayout['bounds'] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const p of stroke) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

interface Piece {
  char: string;
  advance: number;
  substituted: boolean;
  /** Local strokes, pen position already applied. */
  strokes: Point[][];
  /** Position along the text line, used only for resequencing. */
  anchorX: number;
}

/** Reorder pieces for sewing; the geometry never moves. */
function orderPieces<T extends { anchorX: number }>(
  pieces: T[],
  order: LetteringOrder | undefined,
): T[] {
  switch (order) {
    case 'reverse':
      return pieces.slice().reverse();
    case 'outsideIn': {
      const xs = pieces.map((p) => p.anchorX);
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      return pieces
        .slice()
        .sort(
          (a, b) => Math.abs(b.anchorX - mid) - Math.abs(a.anchorX - mid) || a.anchorX - b.anchorX,
        );
    }
    case 'insideOut': {
      const xs = pieces.map((p) => p.anchorX);
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      return pieces
        .slice()
        .sort(
          (a, b) => Math.abs(a.anchorX - mid) - Math.abs(b.anchorX - mid) || a.anchorX - b.anchorX,
        );
    }
    case 'default':
    default:
      return pieces;
  }
}

function finishStraight(
  pieces: Piece[],
  options: LetteringOptions,
  frameLocal: Point[] | null,
): TextLayout {
  const ordered = orderPieces(pieces, options.order);
  const angle = toRadians(options.rotation);
  const placements: GlyphPlacement[] = [];
  const letterStrokes: Point[][] = [];

  for (const piece of ordered) {
    const strokes = rotateTranslate(piece.strokes, angle, options.origin);
    placements.push({
      char: piece.char,
      advance: piece.advance,
      substituted: piece.substituted,
      strokes,
    });
    letterStrokes.push(...strokes);
  }

  const frame =
    frameLocal && frameLocal.length >= 2
      ? rotateTranslate([frameLocal], angle, options.origin)[0]!
      : null;
  const allStrokes = frame ? [...letterStrokes, frame] : letterStrokes;

  return {
    placements,
    strokes: letterStrokes,
    frame,
    bounds: allStrokes.length === 0 ? null : inkBounds(allStrokes),
  };
}

/**
 * Place every character of `text` on a straight line.
 *
 * The pen starts at the origin and moves right. Because our font's y axis
 * points up while the design's points down, y is negated in `composeGlyph` -
 * once, in a single place, rather than at every call site.
 */
function layoutStraight(chars: string[], options: LetteringOptions): TextLayout {
  const scale = scaleFor(options);
  const stretch = stretchOf(options);
  const drop = options.drop?.enabled ? options.drop : null;
  const pieces: Piece[] = [];
  let penX = 0;

  chars.forEach((char, index) => {
    const { glyph, substituted } = resolveGlyph(char);
    const dropHere = drop !== null && index === drop.index;
    const factor = dropHere ? Math.max(0.5, drop.scale) : 1;
    const charScale = scale * factor;
    // The dropped letter keeps its top near the line and hangs below it.
    const shiftY = dropHere ? options.height * (factor - 1) * 0.35 : 0;
    const strokes = composeGlyph(glyph, charScale, options.slant, false, shiftY, stretch);
    translateX(strokes, penX);

    const advance = glyph.advance * charScale * stretch + options.spacing;
    pieces.push({ char, advance, substituted, strokes, anchorX: penX });
    penX += advance;
  });

  return finishStraight(pieces, options, null);
}

/** Sample a position and tangent angle at arc length `s` along a polyline. */
function pointOnPath(
  points: Point[],
  cumulative: number[],
  s: number,
): { point: Point; angle: number } {
  const total = cumulative[cumulative.length - 1]!;
  const d = Math.min(Math.max(s, 0), total);

  let index = 1;
  while (index < cumulative.length - 1 && cumulative[index]! < d) index++;

  const a = points[index - 1]!;
  const b = points[index]!;
  const from = cumulative[index - 1]!;
  const span = cumulative[index]! - from;
  const t = span < 1e-9 ? 0 : (d - from) / span;

  return {
    point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** Text that follows a polyline, each letter rotated to the local tangent. */
function layoutOnPath(chars: string[], options: LetteringOptions, path: LetteringPath): TextLayout {
  const scale = scaleFor(options);
  const stretch = stretchOf(options);
  const points = dedupePoints(path.points);
  if (points.length < 2) return emptyLayout();

  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative[cumulative.length - 1]!;

  const advances = chars.map((char) => {
    const { glyph } = resolveGlyph(char);
    return glyph.advance * scale * stretch + options.spacing;
  });
  const textWidth = advances.reduce((sum, a) => sum + a, 0) - options.spacing;
  let cursor = path.align === 'center' ? Math.max(0, (total - textWidth) / 2) : 0;

  const pieces: Piece[] = [];

  chars.forEach((char, index) => {
    const { glyph, substituted } = resolveGlyph(char);
    const advance = advances[index]!;
    const mid = Math.min(cursor + advance / 2, total);
    const { point, angle } = pointOnPath(points, cumulative, mid);

    // A positive offset sits above a left-to-right path, where "above" is
    // the -y side of the tangent: the normal is (sin, -cos) in this y-down
    // frame.
    const nx = Math.sin(angle);
    const ny = -Math.cos(angle);
    const offX = nx * path.offsetMm;
    const offY = ny * path.offsetMm;

    const angleRadians = (path.upright ? 0 : angle) + toRadians(options.rotation);
    const cos = Math.cos(angleRadians);
    const sin = Math.sin(angleRadians);
    const centreX = advance / 2;
    const centreY = options.height / 2;
    const local = composeGlyph(glyph, scale, options.slant, false, 0, stretch);

    const strokes = local.map((stroke) =>
      stroke.map((p) => {
        const vx = p.x - centreX;
        const vy = p.y - centreY;
        return {
          x: vx * cos - vy * sin + point.x + offX,
          y: vx * sin + vy * cos + point.y + offY,
        };
      }),
    );

    pieces.push({ char, advance, substituted, strokes, anchorX: cursor });
    cursor += advance;
  });

  const ordered = orderPieces(pieces, options.order);

  const placements: GlyphPlacement[] = [];
  const allStrokes: Point[][] = [];
  for (const piece of ordered) {
    placements.push({
      char: piece.char,
      advance: piece.advance,
      substituted: piece.substituted,
      strokes: piece.strokes,
    });
    allStrokes.push(...piece.strokes);
  }

  return {
    placements,
    strokes: allStrokes,
    frame: null,
    bounds: allStrokes.length === 0 ? null : inkBounds(allStrokes),
  };
}

/** Circle/oval/diamond ring around the composed initials, in local mm. */
function frameFor(
  bounds: NonNullable<TextLayout['bounds']>,
  spec: MonogramSpec,
  height: number,
): Point[] | null {
  if (spec.frame === 'none') return null;

  const width = bounds.maxX - bounds.minX;
  const tall = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const margin = Math.max(0.5, spec.frameWidth) * 1.6 + height * 0.12;
  const rx = width / 2 + margin;
  const ry = spec.frame === 'circle' ? Math.max(width, tall) / 2 + margin : tall / 2 + margin;
  const out: Point[] = [];

  if (spec.frame === 'diamond') {
    out.push(
      { x: cx, y: cy - ry },
      { x: cx + rx, y: cy },
      { x: cx, y: cy + ry },
      { x: cx - rx, y: cy },
      { x: cx, y: cy - ry },
    );
    return out;
  }

  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return out;
}

/**
 * Three-initial monogram: a large centre initial with smaller, optionally
 * mirrored side initials, and an optional frame around the group.
 *
 * With three characters the middle one is the honoured initial and sews
 * larger. Two characters put the first in the centre and the second on the
 * right; one character is simply large and centred.
 */
function layoutMonogram(text: string, options: LetteringOptions): TextLayout {
  const spec = options.monogram!;
  const letters = [...text].filter((c) => c.trim() !== '').slice(0, 3);
  if (letters.length === 0) return emptyLayout();

  const scale = scaleFor(options);
  const stretch = stretchOf(options);
  const sideFactor = 0.72;
  const centreScale = scale;
  const sideScale = scale * sideFactor;
  const gap = options.height * 0.12;

  const centre = letters.length >= 3 ? letters[1]! : letters[0]!;
  const left = letters.length >= 3 ? letters[0]! : null;
  const right = letters.length >= 3 ? letters[2]! : letters.length === 2 ? letters[1]! : null;

  const centreGlyph = resolveGlyph(centre);
  const centreAdvance = centreGlyph.glyph.advance * centreScale * stretch;
  const sideAdvanceFor = (char: string): number =>
    resolveGlyph(char).glyph.advance * sideScale * stretch;

  const leftAdvance = left ? sideAdvanceFor(left) : 0;
  const rightAdvance = right ? sideAdvanceFor(right) : 0;
  const leftX = 0;
  const centreX = left ? leftAdvance + gap : 0;
  const rightX = centreX + centreAdvance + (right ? gap : 0);

  // Side initials are centred vertically against the big one.
  const sideShiftY = options.height * (1 - sideFactor) * 0.5;
  const pieces: Piece[] = [];

  if (left) {
    const { glyph, substituted } = resolveGlyph(left);
    const strokes = composeGlyph(
      glyph,
      sideScale,
      options.slant,
      spec.mirrorSides,
      sideShiftY,
      stretch,
    );
    translateX(strokes, leftX);
    pieces.push({ char: left, advance: leftAdvance, substituted, strokes, anchorX: leftX });
  }

  {
    const { glyph, substituted } = centreGlyph;
    const strokes = composeGlyph(glyph, centreScale, options.slant, false, 0, stretch);
    translateX(strokes, centreX);
    pieces.push({ char: centre, advance: centreAdvance, substituted, strokes, anchorX: centreX });
  }

  if (right) {
    const { glyph, substituted } = resolveGlyph(right);
    const strokes = composeGlyph(
      glyph,
      sideScale,
      options.slant,
      spec.mirrorSides,
      sideShiftY,
      stretch,
    );
    translateX(strokes, rightX);
    pieces.push({ char: right, advance: rightAdvance, substituted, strokes, anchorX: rightX });
  }

  const letterStrokes = pieces.flatMap((p) => p.strokes);
  const box = inkBounds(letterStrokes);
  const frame = box ? frameFor(box, spec, options.height) : null;

  return finishStraight(pieces, { ...options, drop: null }, frame);
}

function emptyLayout(): TextLayout {
  return { placements: [], strokes: [], frame: null, bounds: null };
}

/**
 * Mirror the finished layout about its own centre box.
 *
 * Flipping text is a visual operation - mirrored letters as they appear on
 * screen - so it happens after rotation and any path placement, and it maps
 * the bounding box onto itself, leaving every position exactly where the user
 * put it. The placements' stroke arrays are the same arrays as `strokes`, so
 * mirroring one mirrors the other.
 */
function mirrorLayout(
  layout: TextLayout,
  mirror: { x: boolean; y: boolean } | null | undefined,
): TextLayout {
  if (!mirror || (!mirror.x && !mirror.y) || !layout.bounds) return layout;

  const { minX, maxX, minY, maxY } = layout.bounds;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const flip = (p: Point): void => {
    if (mirror.x) p.x = 2 * cx - p.x;
    if (mirror.y) p.y = 2 * cy - p.y;
  };

  for (const stroke of layout.strokes) for (const p of stroke) flip(p);
  if (layout.frame) for (const p of layout.frame) flip(p);
  return layout;
}

/**
 * Place every character of `text`.
 *
 * The layout is chosen by the options: a monogram when one is requested, a
 * path when the spec carries one, otherwise a straight line. Mirrors are
 * applied last, to the finished design-space geometry.
 */
export function layoutText(text: string, options: LetteringOptions): TextLayout {
  if (text.length === 0) return emptyLayout();

  const chars = [...text];
  const layout = options.monogram?.enabled
    ? layoutMonogram(text, options)
    : options.onPath && options.onPath.points.length >= 2
      ? layoutOnPath(chars, options, options.onPath)
      : layoutStraight(chars, options);

  return mirrorLayout(layout, options.mirror);
}

/**
 * Total advance width in mm, including the trailing character spacing.
 *
 * Callers use this to center lettering: measuring the ink bounds instead
 * would mis-center text ending in a space or a narrow character like '.'.
 */
export function measureText(text: string, options: LetteringOptions): number {
  const scale = scaleFor(options);
  let penX = 0;
  for (const char of text) {
    const { glyph } = resolveGlyph(char);
    penX += glyph.advance * scale + options.spacing;
  }
  // The final spacing is not inked but it is not a gap either - it simply
  // does not exist once sewing stops, so subtract it back.
  return penX - options.spacing;
}

/**
 * Sew the lettering as satin columns.
 *
 * Each stroke becomes its own satin column, which is exactly how a digitizer
 * would sew a single-stroke font: one column per stroke, in reading order. A
 * monogram frame is sewn last, with its own width, as a closed satin ring.
 */
export function textToStitches(
  text: string,
  options: LetteringOptions,
  satin: SatinOptions,
): RawStitch[] {
  const layout = layoutText(text, options);
  const out: RawStitch[] = [];

  const jumpTo = (p: Point): void => {
    // Without this the generator emits one continuous run of `stitch`
    // records, so the machine would drag thread from the end of one letter
    // straight across to the start of the next - a single long "stitch" that
    // pulls the fabric and is not a stitch at all. Letter strokes are
    // separate sewn elements, so the needle lifts between them.
    if (out.length > 0) out.push({ x: p.x, y: p.y, command: 'jump' });
  };

  for (const stroke of layout.strokes) {
    // A single point has no direction, so it cannot define a column. Two
    // points is the minimum a satin can be built from.
    if (stroke.length < 2) continue;
    jumpTo(stroke[0]!);
    for (const s of satinFromStroke(stroke, options.width, satin)) out.push(s);
  }

  if (layout.frame && layout.frame.length >= 2) {
    jumpTo(layout.frame[0]!);
    const frameWidth = options.frameWidth ?? options.width;
    for (const s of satinFromStroke(layout.frame, frameWidth, satin)) out.push(s);
  }

  return out;
}
