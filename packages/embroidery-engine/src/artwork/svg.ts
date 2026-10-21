/**
 * Vector art export.
 *
 * The SVG is a real millimetre document: one SVG user unit is one millimetre,
 * so opening it in a print or cutting application gives the design at its true
 * size. Each thread colour becomes a group of round-capped paths.
 */

import type { Hoop, Stitch, ThreadColor } from '../types.js';
import { colorOf, frameFor, hoopBounds, stitchRuns } from './common.js';

export interface SvgArtworkOptions {
  stitches: Stitch[];
  palette: ThreadColor[];
  title?: string;
  hoop?: Hoop | null;
  /** Outer canvas size. Defaults to the design bounds plus margin. */
  widthMm?: number;
  heightMm?: number;
  marginMm?: number;
  background?: string | null;
  includeHoop?: boolean;
  /** Draw jumps as dashed travel lines. Off by default for clean proofs. */
  includeJumps?: boolean;
  threadWidthMm?: number;
}

function n(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, '') : '0';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pathFor(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  return points
    .map((p, index) => `${index === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`)
    .join(' ');
}

function jumpPaths(stitches: Stitch[]): Array<{ colorIndex: number; points: Array<{ x: number; y: number }> }> {
  const out: Array<{ colorIndex: number; points: Array<{ x: number; y: number }> }> = [];
  let current: { colorIndex: number; points: Array<{ x: number; y: number }> } | null = null;
  let last: { x: number; y: number } | null = null;
  for (const stitch of stitches) {
    if (stitch.command === 'jump' || stitch.command === 'trim') {
      if (!current) current = { colorIndex: stitch.colorIndex, points: [] };
      if (last) current.points.push(last);
      current.points.push({ x: stitch.x, y: stitch.y });
      last = { x: stitch.x, y: stitch.y };
    } else if (stitch.command === 'stitch' || stitch.command === 'lock') {
      last = { x: stitch.x, y: stitch.y };
      if (current && current.points.length >= 2) out.push(current);
      current = null;
    } else if (stitch.command === 'colorChange') {
      if (current && current.points.length >= 2) out.push(current);
      current = null;
      last = { x: stitch.x, y: stitch.y };
    }
  }
  if (current && current.points.length >= 2) out.push(current);
  return out;
}

export function designToSvg(options: SvgArtworkOptions): string {
  const frame = frameFor(options.stitches, {
    widthMm: options.widthMm,
    heightMm: options.heightMm,
    marginMm: options.marginMm ?? 3,
    hoop: options.hoop,
    includeHoop: options.includeHoop,
  });
  const source = frame.source;
  const contentW = Math.max(1, frame.contentWidth);
  const contentH = Math.max(1, frame.contentHeight);
  const scale = Math.min(frame.draw.width / contentW, frame.draw.height / contentH);
  const tx = (x: number): number => frame.draw.x + (x - source.minX) * scale;
  const ty = (y: number): number => frame.draw.y + (y - source.minY) * scale;
  const widthMm = options.widthMm ?? frame.contentWidth + (options.marginMm ?? 3) * 2;
  const heightMm = options.heightMm ?? frame.contentHeight + (options.marginMm ?? 3) * 2;
  const threadWidth = options.threadWidthMm ?? 0.42;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(widthMm)}mm" height="${n(heightMm)}mm" viewBox="0 0 ${n(widthMm)} ${n(heightMm)}">`,
  );
  if (options.title) lines.push(`<title>${escapeXml(options.title)}</title>`);
  lines.push('<desc>ThreadWorks Studio vector artwork - 1 unit = 1 mm</desc>');
  if (options.background !== null) {
    lines.push(`<rect x="0" y="0" width="${n(widthMm)}" height="${n(heightMm)}" fill="${options.background ?? '#ffffff'}"/>`);
  }

  if (options.includeHoop && options.hoop) {
    const hb = hoopBounds(options.hoop);
    if (hb) {
      lines.push('<g id="hoop" fill="none" stroke="#a0a0a0" stroke-width="0.3" stroke-dasharray="2 2">');
      if (options.hoop.shape === 'round' || options.hoop.shape === 'oval') {
        const cx = tx((hb.minX + hb.maxX) / 2);
        const cy = ty((hb.minY + hb.maxY) / 2);
        const rx = (options.hoop.width / 2) * scale;
        const ry = (options.hoop.height / 2) * scale;
        lines.push(`<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"/>`);
      } else {
        lines.push(
          `<rect x="${n(tx(hb.minX))}" y="${n(ty(hb.minY))}" width="${n((hb.maxX - hb.minX) * scale)}" height="${n((hb.maxY - hb.minY) * scale)}"/>`,
        );
      }
      lines.push('</g>');
    }
  }

  lines.push('<g id="threads" fill="none" stroke-linecap="round" stroke-linejoin="round">');
  const byColor = new Map<number, string[]>();
  for (const run of stitchRuns(options.stitches)) {
    const points = run.points.map((p) => ({ x: tx(p.x), y: ty(p.y) }));
    const path = pathFor(points);
    if (!path) continue;
    const list = byColor.get(run.colorIndex) ?? [];
    list.push(path);
    byColor.set(run.colorIndex, list);
  }
  for (const [index, paths] of byColor) {
    const color = colorOf(options.palette, index);
    lines.push(`<g class="thread" data-color-index="${index}" stroke="${color}" stroke-width="${n(threadWidth)}">`);
    for (const path of paths) lines.push(`<path d="${path}"/>`);
    lines.push('</g>');
  }
  lines.push('</g>');

  if (options.includeJumps) {
    lines.push('<g id="jumps" fill="none" stroke="#7a7a7a" stroke-width="0.22" stroke-dasharray="1.2 1.2">');
    for (const jump of jumpPaths(options.stitches)) {
      const points = jump.points.map((p) => ({ x: tx(p.x), y: ty(p.y) }));
      const path = pathFor(points);
      if (path) lines.push(`<path d="${path}"/>`);
    }
    lines.push('</g>');
  }

  lines.push(
    `<metadata>${escapeXml(options.title ?? 'ThreadWorks design')} | ${options.stitches.length} stitches | ${options.palette.length} thread colours</metadata>`,
  );
  lines.push('</svg>');
  return lines.join('\n');
}
