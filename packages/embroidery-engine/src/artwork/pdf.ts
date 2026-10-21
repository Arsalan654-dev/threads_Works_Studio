/**
 * Dependency-free PDF writer for artwork and print sheets.
 *
 * A PDF is a small object graph plus one content stream per page. Writing it
 * directly keeps the studio free of a 300 KB rendering library and lets the
 * print sheet place vector thread paths at exact millimetre sizes. No raster
 * image is involved, so a 1:1 sheet is genuinely 1:1 when printed.
 */

import type { Hoop, Stitch, ThreadColor } from '../types.js';
import { artworkBounds, colorOf, frameFor, hoopBounds, POINTS_PER_MM, stitchRuns } from './common.js';

export interface PdfPage {
  widthPt: number;
  heightPt: number;
  /** Content stream commands, ASCII. */
  content: string;
  label?: string;
}

export interface PdfDocumentOptions {
  title?: string;
  author?: string;
}

function ascii(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?');
}

function pdfEscape(value: string): string {
  return ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function n(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4).replace(/\.?0+$/, '') : '0';
}

function rgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return [0.15, 0.15, 0.15];
  const int = parseInt(match[1]!, 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

export function pdfText(
  text: string,
  x: number,
  y: number,
  size = 9,
  color = '#222222',
): string {
  const [r, g, b] = rgb(color);
  return `BT /F1 ${n(size)} Tf ${n(r)} ${n(g)} ${n(b)} rg 1 0 0 1 ${n(x)} ${n(y)} Tm (${pdfEscape(text)}) Tj ET`;
}

export function pdfLine(
  points: Array<{ x: number; y: number }>,
  options: { color?: string; widthPt?: number; dash?: [number, number] | null } = {},
): string {
  if (points.length < 2) return '';
  const [r, g, b] = rgb(options.color ?? '#222222');
  const dash = options.dash ? `[${n(options.dash[0])} ${n(options.dash[1])}] 0 d` : '[] 0 d';
  const segments = points
    .map((p, index) => `${index === 0 ? 'm' : 'l'} ${n(p.x)} ${n(p.y)}`)
    .join(' ');
  return `q ${dash} ${n(r)} ${n(g)} ${n(b)} RG ${n(options.widthPt ?? 0.5)} w 1 J 1 j ${segments} S Q`;
}

/** Build a complete PDF. All content must already be ASCII-safe. */
export function buildPdf(pages: PdfPage[], options: PdfDocumentOptions = {}): string {
  if (pages.length === 0) {
    pages = [{ widthPt: 595.28, heightPt: 841.89, content: '' }];
  }

  const objects: string[] = [];
  const reserve = (): number => {
    objects.push('');
    return objects.length;
  };

  const catalogNumber = reserve();
  const pagesNumber = reserve();
  const fontNumber = reserve();
  const infoNumber = reserve();
  const pageNumbers: number[] = [];

  for (const page of pages) {
    const pageNumber = reserve();
    const contentNumber = reserve();
    pageNumbers.push(pageNumber);
    objects[pageNumber - 1] =
      `<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 ${n(page.widthPt)} ${n(page.heightPt)}] ` +
      `/Resources << /Font << /F1 ${fontNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`;
    const content = ascii(page.content);
    objects[contentNumber - 1] =
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  }

  objects[catalogNumber - 1] = `<< /Type /Catalog /Pages ${pagesNumber} 0 R >>`;
  objects[pagesNumber - 1] =
    `<< /Type /Pages /Count ${pageNumbers.length} /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] >>`;
  objects[fontNumber - 1] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objects[infoNumber - 1] =
    `<< /Title (${pdfEscape(options.title ?? 'ThreadWorks artwork')}) ` +
    `/Author (${pdfEscape(options.author ?? 'ThreadWorks Studio')}) /Producer (ThreadWorks Studio) >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNumber} 0 R /Info ${infoNumber} 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`;
  return pdf;
}

export function pdfBytes(pages: PdfPage[], options: PdfDocumentOptions = {}): Uint8Array {
  const text = buildPdf(pages, options);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

export type PaperSize = 'a4' | 'letter';

export const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

export interface DesignPdfOptions {
  stitches: Stitch[];
  palette: ThreadColor[];
  title?: string;
  hoop?: Hoop | null;
  paper?: PaperSize;
  landscape?: boolean;
  marginMm?: number;
  /** `fit` shrinks to the page but never enlarges beyond 1:1. */
  scale?: 'fit' | number;
  background?: string;
  includeHoop?: boolean;
}

/**
 * One-page artwork PDF. Text and paths are vector; printing at 100% gives the
 * design's real size whenever the page is large enough.
 */
export function designToPdf(options: DesignPdfOptions): Uint8Array {
  const paper = PAPER_MM[options.paper ?? 'a4'];
  const pageW = (options.landscape ? paper.height : paper.width) * POINTS_PER_MM;
  const pageH = (options.landscape ? paper.width : paper.height) * POINTS_PER_MM;
  const marginPt = Math.max(4, options.marginMm ?? 10) * POINTS_PER_MM;
  const source = artworkBounds(
    options.stitches,
    0,
    options.includeHoop ? options.hoop : null,
  );
  const artW = Math.max(0.1, source.maxX - source.minX);
  const artH = Math.max(0.1, source.maxY - source.minY);
  const fitScale = Math.min(
    (pageW - marginPt * 2) / (artW * POINTS_PER_MM),
    (pageH - marginPt * 2 - 24) / (artH * POINTS_PER_MM),
  );
  const request = options.scale ?? 'fit';
  const scale = request === 'fit' ? Math.min(1, fitScale) : Math.max(0.05, request);
  const scalePt = scale * POINTS_PER_MM;
  const offsetX = (pageW - artW * scalePt) / 2;
  const offsetY = marginPt + 18 + (pageH - marginPt * 2 - 24 - artH * scalePt) / 2;

  const tx = (x: number): number => offsetX + (x - source.minX) * scalePt;
  const ty = (y: number): number => pageH - (offsetY + (y - source.minY) * scalePt);

  const content: string[] = [];
  content.push(`q 1 1 1 rg 0 0 ${n(pageW)} ${n(pageH)} re f Q`);
  content.push(pdfText(options.title ?? 'ThreadWorks design', marginPt, pageH - marginPt - 10, 12));
  content.push(
    pdfText(
      `Scale ${Math.round(scale * 100)}% | ${options.stitches.length} stitch records | ${options.palette.length} colours`,
      marginPt,
      pageH - marginPt - 22,
      8,
      '#666666',
    ),
  );

  if (options.includeHoop && options.hoop) {
    const hb = hoopBounds(options.hoop);
    if (hb) {
      const points = [
        { x: tx(hb.minX), y: ty(hb.minY) },
        { x: tx(hb.maxX), y: ty(hb.minY) },
        { x: tx(hb.maxX), y: ty(hb.maxY) },
        { x: tx(hb.minX), y: ty(hb.maxY) },
        { x: tx(hb.minX), y: ty(hb.minY) },
      ];
      content.push(pdfLine(points, { color: '#b0b0b0', widthPt: 0.6, dash: [4, 3] }));
    }
  }

  const byColor = new Map<number, string[]>();
  for (const run of stitchRuns(options.stitches)) {
    const points = run.points.map((p) => ({ x: tx(p.x), y: ty(p.y) }));
    const line = pdfLine(points, { color: colorOf(options.palette, run.colorIndex), widthPt: 0.42 * POINTS_PER_MM });
    const list = byColor.get(run.colorIndex) ?? [];
    list.push(line);
    byColor.set(run.colorIndex, list);
  }
  for (const lines of byColor.values()) content.push(lines.join('\n'));

  return pdfBytes([{ widthPt: pageW, heightPt: pageH, content: content.join('\n') }], {
    title: options.title,
  });
}

export interface ArtworkPdfPageOptions {
  title?: string;
  hoop?: Hoop | null;
}

/** Shared helper for print sheets: draw one design into a page content stream. */
export function artworkContent(
  stitches: Stitch[],
  palette: ThreadColor[],
  mapPoint: (p: { x: number; y: number }) => { x: number; y: number },
): string {
  const content: string[] = [];
  const byColor = new Map<number, string[]>();
  for (const run of stitchRuns(stitches)) {
    const points = run.points.map(mapPoint);
    const line = pdfLine(points, { color: colorOf(palette, run.colorIndex), widthPt: 0.42 * POINTS_PER_MM });
    const list = byColor.get(run.colorIndex) ?? [];
    list.push(line);
    byColor.set(run.colorIndex, list);
  }
  for (const lines of byColor.values()) content.push(lines.join('\n'));
  return content.join('\n');
}

export { frameFor };
