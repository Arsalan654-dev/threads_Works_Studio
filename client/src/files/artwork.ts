/**
 * Raster artwork export.
 *
 * PNG is for proofs and web previews; PDF/SVG remain the production formats.
 * The canvas is drawn from the same stitch runs and palette as the machine
 * file, at a stated dots-per-inch so the pixel size is predictable.
 */

import type { Hoop, Stitch, ThreadColor } from '@threadworks/engine';
import { stitchRuns } from '@threadworks/engine';

export interface PngArtworkOptions {
  stitches: Stitch[];
  palette: ThreadColor[];
  hoop?: Hoop | null;
  title?: string;
  /** Physical width of the image, millimetres. Default 200. */
  widthMm?: number;
  /** Output resolution. Default 200 DPI. */
  dpi?: number;
  background?: string | null;
  includeHoop?: boolean;
}

function colorOf(palette: ThreadColor[], index: number): string {
  const chosen = palette[Math.abs(Math.trunc(index)) % Math.max(1, palette.length)];
  return chosen?.hex && /^#[0-9a-f]{6}$/i.test(chosen.hex) ? chosen.hex : '#222222';
}

function boundsOf(stitches: Stitch[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (stitches.length === 0) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of stitches) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  return { minX, minY, maxX, maxY };
}

export function renderArtworkToCanvas(
  canvas: HTMLCanvasElement,
  options: PngArtworkOptions,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot render PNG artwork.');

  const requestedDpi = Number.isFinite(options.dpi) ? (options.dpi as number) : 200;
  const dpi = Math.max(72, Math.min(600, requestedDpi));
  const pxPerMm = dpi / 25.4;
  const marginMm = 4;
  const box = boundsOf(options.stitches);
  if (options.includeHoop && options.hoop) {
    box.minX = Math.min(box.minX, 0);
    box.minY = Math.min(box.minY, 0);
    box.maxX = Math.max(box.maxX, options.hoop.width);
    box.maxY = Math.max(box.maxY, options.hoop.height);
  }
  const contentW = Math.max(0.1, box.maxX - box.minX);
  const contentH = Math.max(0.1, box.maxY - box.minY);
  const requestedW = Number.isFinite(options.widthMm)
    ? Math.max(20, options.widthMm as number)
    : 200;
  const drawW = Math.max(1, requestedW - marginMm * 2);
  const scale = Math.min(drawW / contentW, (drawW * (contentH / contentW)) / contentH);
  const artW = contentW * scale;
  const artH = contentH * scale;
  const widthMm = requestedW;
  const heightMm = artH + marginMm * 2;
  const widthPx = Math.max(1, Math.round(widthMm * pxPerMm));
  const heightPx = Math.max(1, Math.round(heightMm * pxPerMm));
  // Browsers silently fail or crash above their canvas limit. Refuse with an
  // explanation instead of returning a blank PNG or losing the editor tab.
  if (widthPx > 16_384 || heightPx > 16_384 || widthPx * heightPx > 64_000_000) {
    throw new Error(
      `The PNG would be ${widthPx} x ${heightPx} pixels. Reduce the image width or the resolution.`,
    );
  }
  canvas.width = widthPx;
  canvas.height = heightPx;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (options.background !== null) {
    ctx.fillStyle = options.background ?? '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const originX = (widthMm - artW) / 2;
  const originY = (heightMm - artH) / 2;
  const tx = (x: number): number => (originX + (x - box.minX) * scale) * pxPerMm;
  const ty = (y: number): number => (originY + (y - box.minY) * scale) * pxPerMm;

  if (options.includeHoop && options.hoop) {
    ctx.strokeStyle = '#a0a0a0';
    ctx.lineWidth = Math.max(1, 0.3 * pxPerMm);
    ctx.setLineDash([4 * pxPerMm, 3 * pxPerMm]);
    ctx.strokeRect(tx(0), ty(0), options.hoop.width * scale * pxPerMm, options.hoop.height * scale * pxPerMm);
    ctx.setLineDash([]);
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, 0.42 * pxPerMm);
  for (const run of stitchRuns(options.stitches)) {
    if (run.points.length < 2) continue;
    ctx.strokeStyle = colorOf(options.palette, run.colorIndex);
    ctx.beginPath();
    run.points.forEach((p, index) => {
      if (index === 0) ctx.moveTo(tx(p.x), ty(p.y));
      else ctx.lineTo(tx(p.x), ty(p.y));
    });
    ctx.stroke();
  }
}

/** Resolve to PNG bytes. Kept browser-only; callers are UI event handlers. */
export async function artworkPng(options: PngArtworkOptions): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  renderArtworkToCanvas(canvas, options);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG image.');
  return new Uint8Array(await blob.arrayBuffer());
}
