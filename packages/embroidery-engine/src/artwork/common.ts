/**
 * Shared artwork geometry for SVG, PDF and print sheets.
 *
 * Art exports are not machine files. They are a clean, colour-accurate drawing
 * of the same stitch sequence the machine will sew, so a customer proof and the
 * final file cannot disagree about the design.
 */

import type { Bounds, Hoop, Stitch, ThreadColor } from '../types.js';
import { boundsOfStitches } from '../formats/dst.js';

export interface ArtworkSource {
  stitches: Stitch[];
  palette: ThreadColor[];
  title?: string;
  hoop?: Hoop | null;
}

export interface ArtworkFrame {
  source: Bounds;
  draw: { x: number; y: number; width: number; height: number };
  contentWidth: number;
  contentHeight: number;
}

export const MM_PER_INCH = 25.4;
export const POINTS_PER_MM = 72 / MM_PER_INCH;

export function artworkBounds(
  stitches: Stitch[],
  marginMm = 3,
  hoop?: Hoop | null,
): Bounds {
  const box =
    stitches.length === 0
      ? { minX: -50, minY: -50, maxX: 50, maxY: 50 }
      : boundsOfStitches(stitches);
  const hb = hoop ? hoopBounds(hoop) : null;
  const minX = hb ? Math.min(box.minX, hb.minX) : box.minX;
  const minY = hb ? Math.min(box.minY, hb.minY) : box.minY;
  const maxX = hb ? Math.max(box.maxX, hb.maxX) : box.maxX;
  const maxY = hb ? Math.max(box.maxY, hb.maxY) : box.maxY;
  return {
    minX: minX - marginMm,
    minY: minY - marginMm,
    maxX: maxX + marginMm,
    maxY: maxY + marginMm,
  };
}

export function frameFor(
  stitches: Stitch[],
  options: {
    widthMm?: number;
    heightMm?: number;
    marginMm?: number;
    hoop?: Hoop | null;
    includeHoop?: boolean;
  },
): ArtworkFrame {
  const margin = Math.max(0, options.marginMm ?? 3);
  const source = artworkBounds(
    stitches,
    margin / 2,
    options.includeHoop ? options.hoop : null,
  );
  const contentWidth = Math.max(1, source.maxX - source.minX);
  const contentHeight = Math.max(1, source.maxY - source.minY);
  const widthMm = options.widthMm ?? contentWidth + margin * 2;
  const heightMm = options.heightMm ?? contentHeight + margin * 2;
  const scale = Math.min(
    Math.max(1, widthMm - margin * 2) / contentWidth,
    Math.max(1, heightMm - margin * 2) / contentHeight,
  );
  const drawWidth = contentWidth * scale;
  const drawHeight = contentHeight * scale;
  return {
    source,
    draw: { x: (widthMm - drawWidth) / 2, y: (heightMm - drawHeight) / 2, width: drawWidth, height: drawHeight },
    contentWidth,
    contentHeight,
  };
}

export function colorOf(palette: ThreadColor[], index: number): string {
  const chosen = palette[Math.abs(Math.trunc(index)) % Math.max(1, palette.length)];
  if (chosen?.hex && /^#[0-9a-f]{6}$/i.test(chosen.hex)) return chosen.hex.toUpperCase();
  return '#222222';
}

/** Contiguous sew runs, separated by jumps, trims and colour changes. */
export interface StitchRun {
  colorIndex: number;
  points: Array<{ x: number; y: number }>;
}

export function stitchRuns(stitches: Stitch[], includeJumps = false): StitchRun[] {
  const runs: StitchRun[] = [];
  let current: StitchRun | null = null;
  let last: { x: number; y: number } | null = null;

  const flush = (): void => {
    if (current && current.points.length >= 2) runs.push(current);
    current = null;
  };

  for (const stitch of stitches) {
    if (stitch.command === 'end') break;
    if (stitch.command === 'jump' || stitch.command === 'trim' || stitch.command === 'colorChange') {
      if (includeJumps && current && last) {
        current.points.push({ x: stitch.x, y: stitch.y });
      } else {
        flush();
      }
      last = { x: stitch.x, y: stitch.y };
      if (stitch.command === 'colorChange') flush();
      continue;
    }
    if (stitch.command !== 'stitch' && stitch.command !== 'lock') continue;
    if (!current || current.colorIndex !== stitch.colorIndex) {
      flush();
      current = { colorIndex: stitch.colorIndex, points: [] };
      if (last) current.points.push(last);
    }
    current.points.push({ x: stitch.x, y: stitch.y });
    last = { x: stitch.x, y: stitch.y };
  }
  flush();
  return runs;
}

/** Bounds of a hoop in design millimetres, or null when no hoop is selected. */
export function hoopBounds(hoop: Hoop | null | undefined): Bounds | null {
  if (!hoop) return null;
  return { minX: 0, minY: 0, maxX: hoop.width, maxY: hoop.height };
}
