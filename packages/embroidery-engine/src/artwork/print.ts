/**
 * Printable placement sheets.
 *
 * A print sheet is a production document, not a proof. At 1:1 it tiles the
 * design across as many pages as the paper needs, adds crop/registration marks
 * and labels each tile, and finishes with a thread legend. Printing at 100%
 * and trimming on the marks gives an accurate placement template.
 */

import type { Hoop, Stitch, ThreadColor } from '../types.js';
import { artworkBounds, colorOf, POINTS_PER_MM, stitchRuns } from './common.js';
import { PAPER_MM, buildPdf, pdfBytes, pdfLine, pdfText, type PaperSize, type PdfPage } from './pdf.js';

export interface PrintSheetOptions {
  stitches: Stitch[];
  palette: ThreadColor[];
  title?: string;
  hoop?: Hoop | null;
  paper?: PaperSize;
  landscape?: boolean;
  marginMm?: number;
  /** 1:1 is the default because this is a placement tool. */
  scale?: '1:1' | 'fit';
  includeLegend?: boolean;
  includeHoop?: boolean;
}

export interface PrintSheetSummary {
  pages: number;
  columns: number;
  rows: number;
  scale: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
}

function n(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, '') : '0';
}

function drawRegistration(
  content: string[],
  x: number,
  y: number,
  size = 8,
  color = '#333333',
): void {
  content.push(pdfLine([{ x: x - size, y }, { x: x + size, y }], { color, widthPt: 0.4 }));
  content.push(pdfLine([{ x, y: y - size }, { x, y: y + size }], { color, widthPt: 0.4 }));
}

function legendPage(
  palette: ThreadColor[],
  stitches: Stitch[],
  options: PrintSheetOptions,
  pageW: number,
  pageH: number,
): PdfPage {
  const margin = 12 * POINTS_PER_MM;
  const content: string[] = [`q 1 1 1 rg 0 0 ${n(pageW)} ${n(pageH)} re f Q`];
  content.push(pdfText(options.title ?? 'ThreadWorks design', margin, pageH - margin - 8, 16));
  content.push(pdfText('Thread legend and print sheet notes', margin, pageH - margin - 26, 10, '#555555'));
  let y = pageH - margin - 56;
  palette.forEach((thread, index) => {
    if (y < margin + 20) return;
    const color = colorOf(palette, index);
    const int = parseInt(color.replace('#', ''), 16);
    const r = ((int >> 16) & 255) / 255;
    const g = ((int >> 8) & 255) / 255;
    const b = (int & 255) / 255;
    content.push(`q ${n(r)} ${n(g)} ${n(b)} rg ${n(margin)} ${n(y - 2)} ${n(8 * POINTS_PER_MM)} ${n(5 * POINTS_PER_MM)} re f Q`);
    content.push(pdfText(`${index + 1}. ${thread.code} ${thread.name} ${color}`, margin + 11 * POINTS_PER_MM, y, 10));
    y -= 9 * POINTS_PER_MM;
  });

  const sew = stitches.filter((s) => s.command === 'stitch' || s.command === 'lock').length;
  content.push(pdfText(`Total stitch records: ${stitches.length}`, margin, margin + 18, 9, '#555555'));
  content.push(pdfText(`Sew penetrations: ${sew}`, margin, margin + 8, 9, '#555555'));
  content.push(pdfText('Print at 100% / actual size. Trim on the crop marks. Do not use "fit to page".', margin, margin + 30, 8, '#8a3b12'));
  return { widthPt: pageW, heightPt: pageH, content: content.join('\n'), label: 'Legend' };
}

export function buildPrintSheet(options: PrintSheetOptions): {
  bytes: Uint8Array;
  summary: PrintSheetSummary;
} {
  const paper = PAPER_MM[options.paper ?? 'a4'];
  const sheetW = options.landscape ? paper.height : paper.width;
  const sheetH = options.landscape ? paper.width : paper.height;
  const marginMm = Math.max(6, options.marginMm ?? 12);
  const printableW = Math.max(10, sheetW - marginMm * 2);
  // Keep a header band at the top and a note band at the bottom clear of the
  // tiled artwork. The old 8 mm reserve let the top of a tile run under the
  // tile label even though the page edge was never reached.
  const printableH = Math.max(10, sheetH - marginMm * 2 - 24);
  const source = artworkBounds(
    options.stitches,
    0,
    options.includeHoop ? options.hoop : null,
  );
  const artW = Math.max(0.1, source.maxX - source.minX);
  const artH = Math.max(0.1, source.maxY - source.minY);
  const scale = options.scale === 'fit' ? Math.min(1, printableW / artW, printableH / artH) : 1;
  const columns = Math.max(1, Math.ceil((artW * scale) / printableW));
  const rows = Math.max(1, Math.ceil((artH * scale) / printableH));
  const pageW = sheetW * POINTS_PER_MM;
  const pageH = sheetH * POINTS_PER_MM;
  const marginPt = marginMm * POINTS_PER_MM;
  const legend = options.includeLegend !== false;

  const pages: PdfPage[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const content: string[] = [`q 1 1 1 rg 0 0 ${n(pageW)} ${n(pageH)} re f Q`];
      const clipX = marginPt;
      const clipY = marginPt + 12 * POINTS_PER_MM;
      const clipW = printableW * POINTS_PER_MM;
      const clipH = printableH * POINTS_PER_MM;
      content.push(`q ${n(clipX)} ${n(clipY)} ${n(clipW)} ${n(clipH)} re W n`);

      const map = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: clipX + (p.x - source.minX) * scale * POINTS_PER_MM - col * clipW,
        y: clipY + clipH - (p.y - source.minY) * scale * POINTS_PER_MM + row * clipH,
      });

      if (options.includeHoop && options.hoop) {
        const hb = { minX: 0, minY: 0, maxX: options.hoop.width, maxY: options.hoop.height };
        const corners = [
          map({ x: hb.minX, y: hb.maxY }),
          map({ x: hb.maxX, y: hb.maxY }),
          map({ x: hb.maxX, y: hb.minY }),
          map({ x: hb.minX, y: hb.minY }),
          map({ x: hb.minX, y: hb.maxY }),
        ];
        content.push(pdfLine(corners, { color: '#b0b0b0', widthPt: 0.6, dash: [4, 3] }));
      }

      const byColor = new Map<number, string[]>();
      for (const run of stitchRuns(options.stitches)) {
        const points = run.points.map(map);
        const list = byColor.get(run.colorIndex) ?? [];
        list.push(
          pdfLine(points, {
            color: colorOf(options.palette, run.colorIndex),
            widthPt: 0.42 * POINTS_PER_MM,
          }),
        );
        byColor.set(run.colorIndex, list);
      }
      for (const lines of byColor.values()) content.push(lines.join('\n'));
      content.push('Q');

      // Crop marks live outside the clip so they are never trimmed away.
      const markSize = 5 * POINTS_PER_MM;
      const corners = [
        [clipX, clipY],
        [clipX + clipW, clipY],
        [clipX, clipY + clipH],
        [clipX + clipW, clipY + clipH],
      ] as const;
      for (const [x, y] of corners) drawRegistration(content, x, y, markSize);

      content.push(
        pdfText(
          `${options.title ?? 'ThreadWorks design'}  |  tile ${row + 1}.${col + 1} of ${rows}.${columns}  |  1:1 (${Math.round(scale * 100)}%)  |  ${artW.toFixed(1)} x ${artH.toFixed(1)} mm`,
          marginPt,
          pageH - marginPt + 4,
          9,
          '#333333',
        ),
      );
      content.push(
        pdfText(
          'Print at 100% / actual size. Overlap tiles on the registration marks.',
          marginPt,
          marginPt - 7,
          7,
          '#8a3b12',
        ),
      );

      pages.push({ widthPt: pageW, heightPt: pageH, content: content.join('\n'), label: `${row + 1}.${col + 1}` });
    }
  }

  if (legend) pages.push(legendPage(options.palette, options.stitches, options, pageW, pageH));

  return {
    bytes: pdfBytes(pages, { title: options.title }),
    summary: {
      pages: pages.length,
      columns,
      rows,
      scale,
      sheetWidthMm: sheetW,
      sheetHeightMm: sheetH,
    },
  };
}

export function printSheetToPdf(pages: PdfPage[]): string {
  return buildPdf(pages);
}
