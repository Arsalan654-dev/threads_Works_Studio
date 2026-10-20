/**
 * Photo stitch: an image turned into a mosaic of tiny thread blocks.
 *
 * The picture is reduced to a grid of cells, each cell becomes one thread
 * colour, and every cell is sewn as a small block. `satin` gives the dense,
 * photoreal look of Colour Photo Stitch; `run` and `cross` are the coarser,
 * much faster Photo Flash styles.
 *
 * Cells are grouped by colour into objects. That is deliberate: a stitch
 * carries the colour of its object, so one object per thread is how a
 * multi-colour photo reaches the machine without inventing a per-stitch colour
 * channel that no format could carry anyway. The editable path stays a list of
 * cell squares, so the design can be re-stitched, scaled and exported exactly
 * like anything else.
 */

import type { CompoundPath, PhotoSettings, PhotoStyle, Point, Ring, ThreadColor } from './types.js';
import { DEFAULT_PHOTO } from './types.js';
import { BACKGROUND, paletteHex, quantize, type RasterImage } from './autodigitize/quantize.js';
import type { RawStitch } from './stitches/index.js';

export interface PhotoLimits {
  minWidth: number;
  maxWidth: number;
  minCell: number;
  maxCell: number;
  minColors: number;
  maxColors: number;
  minSpacing: number;
  maxSpacing: number;
  maxCells: number;
}

export const PHOTO_LIMITS: PhotoLimits = {
  minWidth: 10,
  maxWidth: 300,
  minCell: 0.6,
  maxCell: 10,
  minColors: 2,
  maxColors: 24,
  minSpacing: 0.2,
  maxSpacing: 2,
  // 20k cells is already a large picture; beyond it compile time and stitch
  // count stop being useful on a home machine.
  maxCells: 20_000,
};

/** Settings with every field filled in, or null when the object is not photo. */
export function photoSettings(input: PhotoSettings | undefined): PhotoSettings | null {
  if (!input || !input.enabled) return null;
  return { ...DEFAULT_PHOTO, ...input };
}

export function photoProblem(input: PhotoSettings | undefined): string | null {
  const s = photoSettings(input);
  if (!s) return null;
  if (
    !Number.isFinite(s.spacing) ||
    s.spacing < PHOTO_LIMITS.minSpacing ||
    s.spacing > PHOTO_LIMITS.maxSpacing
  ) {
    return `Satin spacing must be between ${PHOTO_LIMITS.minSpacing} and ${PHOTO_LIMITS.maxSpacing} mm.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Planning: image -> palette + cell squares
// ---------------------------------------------------------------------------

export interface PhotoStitchOptions {
  /** Finished width in mm. Default 100. */
  widthMm?: number;
  /** Thread colours to reduce to (2-24). Default 12. */
  colorCount?: number;
  /** Approximate cell size in mm. Default 1.5. */
  cellMm?: number;
  /** How each cell is sewn. Default satin. */
  style?: PhotoStyle;
  /** Satin row spacing in mm. Default 0.4. */
  spacing?: number;
  /** Stitch angle in degrees. Default 45. */
  angle?: number;
  /** Safety ceiling for the cell grid. Default 20,000. */
  maxCells?: number;
  /** Alpha below this is skipped. Default 128. */
  alphaThreshold?: number;
}

export interface PhotoGroup {
  /** Index into `palette`. */
  colorIndex: number;
  /** Cell squares, in millimetres, origin at the top-left of the picture. */
  rings: Ring[];
}

export interface PhotoPlan {
  /** Thread colours, most-used first; index matches `colorIndex`. */
  palette: ThreadColor[];
  /** One entry per colour that owns at least one cell, ordered by palette. */
  groups: PhotoGroup[];
  /** One palette index per cell, or -1 for a transparent cell (row-major). */
  labels: Int16Array;
  columns: number;
  rows: number;
  /** Real cell edge after the picture was fitted to the grid, in mm. */
  cellMm: number;
  widthMm: number;
  heightMm: number;
  /** Cells that carry a stitch, and cells that were transparent. */
  cells: number;
  skipped: number;
  /** Stitch settings the caller should write onto each object. */
  style: PhotoStyle;
  spacing: number;
  angle: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Reduce an image to cell squares grouped by thread colour.
 *
 * Averaging the source rectangle rather than point-sampling matters on a
 * photograph: a single pixel can be noise, while the average of 8x8 pixels is
 * the colour the eye actually sees in that square. The averaged grid is then
 * quantized, so the palette describes the blocks that will really be sewn,
 * not colours that only exist at full resolution.
 */
export function planPhotoStitch(image: RasterImage, options: PhotoStitchOptions = {}): PhotoPlan {
  const { width, height, data } = image;
  if (width < 1 || height < 1 || data.length < width * height * 4) {
    throw new Error('The image has no pixels to stitch.');
  }

  const widthMm = clamp(options.widthMm ?? 100, PHOTO_LIMITS.minWidth, PHOTO_LIMITS.maxWidth);
  const colorCount = Math.round(
    clamp(options.colorCount ?? 12, PHOTO_LIMITS.minColors, PHOTO_LIMITS.maxColors),
  );
  const requestedCell = clamp(options.cellMm ?? 1.5, PHOTO_LIMITS.minCell, PHOTO_LIMITS.maxCell);
  const maxCells = Math.round(clamp(options.maxCells ?? PHOTO_LIMITS.maxCells, 100, 100_000));
  const alphaThreshold = clamp(options.alphaThreshold ?? 128, 1, 255);
  const style = options.style ?? 'satin';
  const spacing = clamp(options.spacing ?? 0.4, PHOTO_LIMITS.minSpacing, PHOTO_LIMITS.maxSpacing);
  const angle = Number.isFinite(options.angle) ? (options.angle as number) : 45;

  const heightMmRaw = (height / width) * widthMm;
  const columns = Math.max(1, Math.min(1000, Math.floor(widthMm / requestedCell)));
  // Square cells: the width is divided evenly, and the height follows the
  // picture's aspect ratio rounded to a whole number of cells.
  const cellMm = widthMm / columns;
  const rows = Math.max(1, Math.round(heightMmRaw / cellMm));
  const cellCount = columns * rows;
  if (cellCount > maxCells) {
    throw new Error(
      `This picture needs ${cellCount.toLocaleString()} cells at ${cellMm.toFixed(2)} mm. ` +
        `Increase the cell size or reduce the width (limit ${maxCells.toLocaleString()} cells).`,
    );
  }
  const heightMm = rows * cellMm;

  // Average each cell's source rectangle. A cell with no opaque pixels is
  // background and is skipped rather than sewn black.
  const cellImage: RasterImage = {
    width: columns,
    height: rows,
    data: new Uint8ClampedArray(columns * rows * 4),
  };
  const averaged = cellImage.data;
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / rows));
    for (let cx = 0; cx < columns; cx++) {
      const x0 = Math.floor((cx * width) / columns);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / columns));

      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        let o = (y * width + x0) * 4;
        for (let x = x0; x < x1 && x < width; x++, o += 4) {
          if (data[o + 3]! < alphaThreshold) continue;
          r += data[o]!;
          g += data[o + 1]!;
          b += data[o + 2]!;
          count++;
        }
      }

      const cell = (cy * columns + cx) * 4;
      if (count === 0) {
        averaged[cell + 3] = 0;
      } else {
        averaged[cell] = Math.round(r / count);
        averaged[cell + 1] = Math.round(g / count);
        averaged[cell + 2] = Math.round(b / count);
        averaged[cell + 3] = 255;
      }
    }
  }

  const quantized = quantize(cellImage, colorCount, 128);
  const palette: ThreadColor[] = quantized.palette.map((colour, index) => {
    const hex = paletteHex(colour);
    return {
      id: `photo-${index + 1}`,
      code: `PHOTO${index + 1}`,
      name: hex.toUpperCase(),
      hex,
    };
  });

  const ringsByColor = new Map<number, Ring[]>();
  let cells = 0;
  let skipped = 0;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const label = quantized.labels[cy * columns + cx]!;
      if (label === BACKGROUND) {
        skipped++;
        continue;
      }
      const x0 = cx * cellMm;
      const y0 = cy * cellMm;
      const x1 = x0 + cellMm;
      const y1 = y0 + cellMm;
      const ring: Ring = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      const list = ringsByColor.get(label);
      if (list) list.push(ring);
      else ringsByColor.set(label, [ring]);
      cells++;
    }
  }

  const groups: PhotoGroup[] = [...ringsByColor.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([colorIndex, rings]) => ({ colorIndex, rings }));

  return {
    palette,
    groups,
    labels: quantized.labels,
    columns,
    rows,
    cellMm,
    widthMm,
    heightMm,
    cells,
    skipped,
    style,
    spacing,
    angle,
  };
}

// ---------------------------------------------------------------------------
// Cell geometry -> stitches
// ---------------------------------------------------------------------------

interface Span {
  a: Point;
  b: Point;
}

/**
 * Intersections of one infinite line with a closed polygon, paired into
 * inside spans.
 *
 * The line is p(t) = origin + dir*t and each crossing is solved against every
 * edge. Even-odd pairing is used rather than a convex-only clip so a shape
 * with a notch still fills correctly.
 */
function lineSpans(polygon: Ring, origin: Point, dir: Point): Span[] {
  const ts: number[] = [];

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-12) continue;

    const dx = a.x - origin.x;
    const dy = a.y - origin.y;
    const t = (dx * ey - dy * ex) / den;
    const u = (dx * dir.y - dy * dir.x) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) {
      // A corner is shared by two edges, so it is reported twice. Pairing
      // those duplicates would produce a zero-length span and swallow the
      // real span between the two corners.
      if (!ts.some((existing) => Math.abs(existing - t) < 1e-7)) ts.push(t);
    }
  }

  ts.sort((a, b) => a - b);
  const spans: Span[] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-6) continue;
    spans.push({
      a: { x: origin.x + dir.x * t0, y: origin.y + dir.y * t0 },
      b: { x: origin.x + dir.x * t1, y: origin.y + dir.y * t1 },
    });
  }
  return spans;
}

function centroidOf(ring: Ring): Point {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/**
 * Stitches for every cell in one colour object.
 *
 * A jump is inserted when the next cell is far from the last penetration.
 * Neighbouring cells are allowed to connect with a real stitch - it is only a
 * millimetre or two and it is hidden under the blocks on either side - but a
 * scattered cell 20 mm away must not drag a thread across the picture.
 */
export function photoStitches(
  path: CompoundPath,
  angleDegrees: number,
  input: PhotoSettings,
): RawStitch[] {
  const settings = photoSettings(input);
  if (!settings) return [];

  const radians = (angleDegrees * Math.PI) / 180;
  const dir = { x: Math.cos(radians), y: Math.sin(radians) };
  const normal = { x: -dir.y, y: dir.x };

  const out: RawStitch[] = [];
  let last: Point | null = null;
  const push = (p: Point, command: RawStitch['command']): void => {
    out.push({ x: p.x, y: p.y, command });
    if (command === 'stitch' || command === 'jump') last = { x: p.x, y: p.y };
  };
  const jumpTo = (p: Point): void => {
    if (last && Math.hypot(last.x - p.x, last.y - p.y) > 2.5) push(p, 'jump');
  };

  for (const ring of path.rings) {
    const polygon = dedupeRing(ring);
    if (polygon.length < 3) continue;
    const centre = centroidOf(polygon);

    if (settings.style === 'run' || settings.style === 'cross') {
      const directions =
        settings.style === 'run'
          ? [dir]
          : [
              { x: Math.cos(radians + Math.PI / 4), y: Math.sin(radians + Math.PI / 4) },
              { x: Math.cos(radians - Math.PI / 4), y: Math.sin(radians - Math.PI / 4) },
            ];

      for (const direction of directions) {
        const spans = lineSpans(polygon, centre, direction);
        const span = spans.sort((a, b) => spanLength(b) - spanLength(a))[0];
        if (!span) continue;
        jumpTo(span.a);
        push(span.a, 'stitch');
        push(span.b, 'stitch');
      }
      continue;
    }

    // Satin: walk rows across the cell, alternating direction so the thread
    // stays connected and no row retraces the previous one.
    let min = Infinity;
    let max = -Infinity;
    for (const p of polygon) {
      const projection = (p.x - centre.x) * normal.x + (p.y - centre.y) * normal.y;
      if (projection < min) min = projection;
      if (projection > max) max = projection;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) continue;

    const step = Math.max(0.1, settings.spacing);
    const rowCount = Math.max(1, Math.floor((max - min) / step));
    const margin = (max - min - (rowCount - 1) * step) / 2;

    for (let row = 0; row < rowCount; row++) {
      const offset = min + margin + row * step;
      const origin = {
        x: centre.x + normal.x * offset,
        y: centre.y + normal.y * offset,
      };
      const spans = lineSpans(polygon, origin, dir);
      if (spans.length === 0) continue;
      const ordered = row % 2 === 0 ? spans : [...spans].reverse();
      for (const span of ordered) {
        const first = row % 2 === 0 ? span.a : span.b;
        const second = row % 2 === 0 ? span.b : span.a;
        jumpTo(first);
        push(first, 'stitch');
        push(second, 'stitch');
      }
    }
  }

  return out;
}

function spanLength(span: Span): number {
  return Math.hypot(span.b.x - span.a.x, span.b.y - span.a.y);
}

function dedupeRing(ring: Ring): Ring {
  const out: Point[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-9) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && out.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) {
    out.pop();
  }
  return out;
}
