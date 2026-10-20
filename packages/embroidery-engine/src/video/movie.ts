/**
 * Stitch movie: render a stitch sequence into an animated GIF.
 *
 * The whole thing is pure computation - no canvas, no DOM - so the same code
 * that runs in the browser can be exercised from a test or a script. A frame is
 * drawn, compressed, and thrown away, which keeps memory flat however long the
 * design is.
 *
 * What the movie shows is what the design will actually do: stitches appear in
 * order, in their thread colours, with a marker where the needle is. Jumps and
 * trims move the marker without laying thread, because that is what they do.
 */

import type { Stitch, ThreadColor } from '../types.js';
import { boundsOfStitches } from '../formats/dst.js';
import { GLYPHS, METRICS } from '../lettering/font.js';
import { GifEncoder, type Rgb } from './gif.js';
import { Raster } from './raster.js';

export { GifEncoder, lzwCompress } from './gif.js';
export type { GifOptions, Rgb } from './gif.js';
export { Raster } from './raster.js';

export interface StitchMovieOptions {
  /** Frame size in pixels; the movie is square. Default 480. */
  size?: number;
  /** Playback rate in frames per second. Default 12. */
  fps?: number;
  /** Stitch records laid down per frame. Default: about 240 frames in total. */
  stitchesPerFrame?: number;
  /** Frames held on the finished design before the loop restarts. Default 12. */
  holdFrames?: number;
  /** Hard cap on the frame count - encoding is O(pixels) per frame. Default 400. */
  maxFrames?: number;
  /** Draw the stitch counter and progress bar. Default true. */
  hud?: boolean;
  /** Draw jumps as a faint line so travel is visible. Default false. */
  showJumps?: boolean;
  /** Thread colours, indexed by `stitch.colorIndex`. */
  threads?: Array<Pick<ThreadColor, 'hex'>>;
  /** Fabric colour as #RRGGBB. Default a dark charcoal threads read against. */
  fabric?: string;
  /** Needle marker colour as #RRGGBB. Default amber. */
  needle?: string;
}

export interface StitchMovieResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  frames: number;
  /** Stitch records drawn across the whole movie. */
  stitches: number;
  fps: number;
}

const STRIP = 34;
const MARGIN = 14;

/** File extension for a stitch movie. */
export const GIF_EXTENSION = '.gif';

/** MIME type for a stitch movie. */
export const GIF_MIME = 'image/gif';

const FABRIC = '#1E2128';
const NEEDLE = '#FFD166';
const HUD_TEXT = '#9AA3B2';
const HUD_TRACK = '#2C313C';
const MARKER_HOLE = '#12141A';
const JUMP_LINE = '#3A4150';

/** Fallback thread colours, cycled when the caller supplies none. */
const FALLBACK_THREADS = [
  '#E4572E',
  '#17BEBB',
  '#FFC914',
  '#76B041',
  '#2E86AB',
  '#B07BAC',
  '#F3A712',
  '#D64550',
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex: string, fallback: Rgb): Rgb {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return fallback;
  const value = Number.parseInt(clean, 16);
  if (!Number.isFinite(value)) return fallback;
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * Draw single-stroke text with the lettering font.
 *
 * Returns the pen position after the last glyph so callers can chain text.
 * Unknown characters are skipped rather than substituted, which keeps a counter
 * readable even if a glyph is ever missing.
 */
export function drawText(
  raster: Raster,
  text: string,
  x: number,
  baselineY: number,
  capHeightPx: number,
  colour: Rgb,
  thickness: number,
): number {
  const unit = capHeightPx / METRICS.capHeight;
  let pen = x;

  for (const raw of text) {
    const glyph = GLYPHS[raw.toUpperCase()] ?? GLYPHS[raw];
    if (glyph === undefined) continue;
    for (const stroke of glyph.strokes) {
      const points = stroke.map(([gx, gy]) => ({
        x: pen + gx * unit,
        y: baselineY - gy * unit,
      }));
      if (points.length === 1) {
        raster.disc(points[0]!.x, points[0]!.y, thickness / 2, colour);
      } else {
        raster.polyline(points, thickness / 2, colour);
      }
    }
    pen += glyph.advance * unit;
  }

  return pen;
}

/** Text width in pixels, without drawing. */
export function measureText(text: string, capHeightPx: number): number {
  const unit = capHeightPx / METRICS.capHeight;
  let width = 0;
  for (const raw of text) {
    const glyph = GLYPHS[raw.toUpperCase()] ?? GLYPHS[raw];
    if (glyph !== undefined) width += glyph.advance * unit;
  }
  return width;
}

export interface StitchPreviewOptions {
  /** Longest side of the rendered image, in pixels. Default 320. */
  size?: number;
  /** Thread colours, indexed by `stitch.colorIndex`. */
  threads?: Array<Pick<ThreadColor, 'hex'>>;
  /** Fabric colour as #RRGGBB. Default a dark charcoal threads read against. */
  fabric?: string;
}

export interface StitchPreview {
  /** RGBA bytes, row-major - ready for a canvas or an image encoder. */
  rgba: Uint8Array;
  width: number;
  height: number;
  /** The exact colours used, so a caller can build its own palette if needed. */
  palette: Rgb[];
}

/**
 * Render a whole stitch sequence into one still frame.
 *
 * Shares the movie's rasteriser and layout, which keeps the preview honest:
 * what you see here is what the movie and the machine will do.
 */
export function renderStitchPreview(
  stitches: Stitch[],
  options: StitchPreviewOptions = {},
): StitchPreview {
  if (!Array.isArray(stitches)) throw new TypeError('stitches must be an array');

  const size = Math.round(clamp(options.size ?? 320, 32, 2048));
  const fabric = hexToRgb(options.fabric ?? FABRIC, { r: 30, g: 33, b: 40 });

  const threadHex: string[] = [];
  for (const stitch of stitches) {
    if (stitch.colorIndex >= 0 && threadHex[stitch.colorIndex] === undefined) {
      threadHex[stitch.colorIndex] = options.threads?.[stitch.colorIndex]?.hex ?? '';
    }
  }
  const threadCount = Math.max(1, threadHex.length);
  const threadRgb: Rgb[] = [];
  for (let i = 0; i < threadCount; i++) {
    const fallback = hexToRgb(FALLBACK_THREADS[i % FALLBACK_THREADS.length]!, {
      r: 230,
      g: 230,
      b: 230,
    });
    const hex = threadHex[i];
    threadRgb.push(hex ? hexToRgb(hex, fallback) : fallback);
  }

  const bounds = boundsOfStitches(stitches);
  const designWidth = Math.max(0, bounds.maxX - bounds.minX);
  const designHeight = Math.max(0, bounds.maxY - bounds.minY);
  const inner = size - MARGIN * 2;
  const scale =
    designWidth > 0 && designHeight > 0 ? Math.min(inner / designWidth, inner / designHeight) : 1;
  const originX = MARGIN + (inner - designWidth * scale) / 2 - bounds.minX * scale;
  const originY = MARGIN + (inner - designHeight * scale) / 2 - bounds.minY * scale;
  const penRadius = clamp(scale * 0.35, 0.6, 6);

  const raster = new Raster(size, size, fabric);
  let previous: Stitch | null = null;
  for (const stitch of stitches) {
    if (previous !== null && (stitch.command === 'stitch' || stitch.command === 'lock')) {
      raster.line(
        originX + previous.x * scale,
        originY + previous.y * scale,
        originX + stitch.x * scale,
        originY + stitch.y * scale,
        penRadius,
        threadRgb[stitch.colorIndex] ?? threadRgb[0]!,
      );
    }
    previous = stitch;
  }

  return { rgba: raster.data, width: size, height: size, palette: [fabric, ...threadRgb] };
}

/**
 * Render a stitch sequence into an animated GIF.
 *
 * @param stitches the compiled sequence, in sewing order
 */
export function encodeStitchMovie(
  stitches: Stitch[],
  options: StitchMovieOptions = {},
): StitchMovieResult {
  if (!Array.isArray(stitches)) throw new TypeError('stitches must be an array');

  const size = Math.round(clamp(options.size ?? 480, 64, 2048));
  const fps = clamp(options.fps ?? 12, 1, 50);
  const hud = options.hud ?? true;
  const showJumps = options.showJumps ?? false;
  const holdFrames = Math.max(0, Math.round(options.holdFrames ?? 12));
  const maxFrames = Math.max(1, Math.round(options.maxFrames ?? 400));

  const fabric = hexToRgb(options.fabric ?? FABRIC, { r: 30, g: 33, b: 40 });
  const needle = hexToRgb(options.needle ?? NEEDLE, { r: 255, g: 209, b: 102 });

  // --- palette ------------------------------------------------------------
  const threadHex: string[] = [];
  for (const stitch of stitches) {
    if (stitch.colorIndex >= 0 && threadHex[stitch.colorIndex] === undefined) {
      threadHex[stitch.colorIndex] = options.threads?.[stitch.colorIndex]?.hex ?? '';
    }
  }
  const threadCount = Math.max(1, threadHex.length);
  const threadRgb: Rgb[] = [];
  for (let i = 0; i < threadCount; i++) {
    const hex = threadHex[i];
    const fallback = hexToRgb(FALLBACK_THREADS[i % FALLBACK_THREADS.length]!, {
      r: 230,
      g: 230,
      b: 230,
    });
    threadRgb.push(hex ? hexToRgb(hex, fallback) : fallback);
  }

  // Every entry is a distinct colour: `toIndices` is a lookup, not a nearest
  // search, and a repeated colour would silently collapse onto one index.
  const palette: Rgb[] = [
    fabric,
    ...threadRgb,
    needle,
    hexToRgb(HUD_TEXT, { r: 154, g: 163, b: 178 }),
    hexToRgb(HUD_TRACK, { r: 44, g: 49, b: 60 }),
    hexToRgb(MARKER_HOLE, { r: 18, g: 20, b: 26 }),
    hexToRgb(JUMP_LINE, { r: 58, g: 65, b: 80 }),
  ];
  const INDEX_HUD_TEXT = threadCount + 2;
  const INDEX_HUD_TRACK = threadCount + 3;
  const INDEX_MARKER_HOLE = threadCount + 4;
  const INDEX_JUMP = threadCount + 5;

  // --- geometry -----------------------------------------------------------
  const strip = hud ? STRIP : 0;
  const bounds = boundsOfStitches(stitches);
  const designWidth = Math.max(0, bounds.maxX - bounds.minX);
  const designHeight = Math.max(0, bounds.maxY - bounds.minY);
  const areaWidth = size - MARGIN * 2;
  const areaHeight = size - strip - MARGIN * 2;

  const scale =
    designWidth > 0 && designHeight > 0
      ? Math.min(areaWidth / designWidth, areaHeight / designHeight)
      : 1;
  const originX = MARGIN + (areaWidth - designWidth * scale) / 2 - bounds.minX * scale;
  const originY = MARGIN + (areaHeight - designHeight * scale) / 2 - bounds.minY * scale;
  const toX = (mm: number): number => originX + mm * scale;
  const toY = (mm: number): number => originY + mm * scale;

  const penRadius = clamp(scale * 0.35, 1, 6);
  const markerRadius = clamp(scale * 0.9, 3, 10);

  // --- frame plan ---------------------------------------------------------
  const total = stitches.length;
  const defaultPerFrame = Math.max(1, Math.ceil(total / 240));
  let perFrame = Math.max(1, Math.round(options.stitchesPerFrame ?? defaultPerFrame));
  const planned = Math.ceil(total / perFrame) + holdFrames;
  if (planned > maxFrames) {
    perFrame = Math.max(1, Math.ceil(total / Math.max(1, maxFrames - holdFrames)));
  }

  const frameCount = total === 0 ? 1 : Math.max(1, Math.ceil(total / perFrame) + holdFrames);
  const delayCs = Math.max(2, Math.round(100 / fps));

  // --- render -------------------------------------------------------------
  const encoder = new GifEncoder({ width: size, height: size, palette, delayCs, loop: true });
  const sewn = new Raster(size, size, fabric);
  const frame = new Raster(size, size, fabric);

  let index = 0;
  let markerX = toX(stitches[0]?.x ?? 0);
  let markerY = toY(stitches[0]?.y ?? 0);

  const drawSlice = (): void => {
    const end = Math.min(total, index + perFrame);
    for (; index < end; index++) {
      const stitch = stitches[index]!;
      const x = toX(stitch.x);
      const y = toY(stitch.y);
      const previous = index > 0 ? (stitches[index - 1] ?? null) : null;

      if (previous !== null) {
        const px = toX(previous.x);
        const py = toY(previous.y);
        if (stitch.command === 'stitch' || stitch.command === 'lock') {
          const colour = threadRgb[stitch.colorIndex] ?? threadRgb[0]!;
          sewn.line(px, py, x, y, penRadius, colour);
        } else if (showJumps && stitch.command === 'jump') {
          sewn.line(px, py, x, y, 0.5, palette[INDEX_JUMP]!);
        }
      }
      markerX = x;
      markerY = y;
    }
  };

  const drawHud = (drawn: number): void => {
    if (!hud) return;
    const top = size - strip;
    frame.rect(0, top, size, strip, palette[INDEX_HUD_TRACK]!);

    const trackX = MARGIN;
    const trackY = top + strip - 10;
    const trackW = size - MARGIN * 2;
    frame.rect(trackX, trackY, trackW, 4, fabric);
    const fraction = total === 0 ? 1 : drawn / total;
    frame.rect(trackX, trackY, Math.round(trackW * fraction), 4, needle);

    const label = `${drawn} OF ${total}`;
    const textHeight = 12;
    drawText(frame, label, MARGIN, top + 18, textHeight, palette[INDEX_HUD_TEXT]!, 1.6);
  };

  for (let f = 0; f < frameCount; f++) {
    drawSlice();

    frame.data.set(sewn.data);
    drawHud(index);
    frame.disc(markerX, markerY, markerRadius, needle);
    frame.disc(markerX, markerY, markerRadius * 0.45, palette[INDEX_MARKER_HOLE]!);

    encoder.addFrame(frame.toIndices(palette));
  }

  return {
    bytes: encoder.finish(),
    width: size,
    height: size,
    frames: frameCount,
    stitches: total,
    fps,
  };
}
