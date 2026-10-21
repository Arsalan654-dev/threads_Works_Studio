/**
 * Original single-stroke font families.
 *
 * The studio ships one carefully drawn skeleton alphabet and derives the other
 * cuts from it with explicit geometric transforms. That keeps every family on
 * the same 100-unit em grid, gives them genuinely different skeletons (rounded
 * corners, squared corners, serifs, monospacing), and avoids copying any
 * third-party font data.
 *
 * A font is just a glyph table. The layout engine asks `resolveFontGlyph` for
 * the letter and everything downstream - satin, underlay, compensation and
 * file encoding - is unchanged.
 */

import type { FontId } from '../types.js';
import { GLYPHS, type Glyph } from './font.js';

export interface FontDefinition {
  id: FontId;
  name: string;
  category: 'Sans' | 'Serif' | 'Script' | 'Display';
  description: string;
  glyphs: Record<string, Glyph>;
  /** Extra tracking in em units; negative tightens. */
  tracking: number;
}

const FONT_IDS: FontId[] = ['studio', 'rounded', 'block', 'script', 'serif', 'mono'];

function cloneGlyph(glyph: Glyph): Glyph {
  return {
    advance: glyph.advance,
    strokes: glyph.strokes.map((stroke) => stroke.map(([x, y]) => [x, y] as [number, number])),
  };
}

function cloneTable(): Record<string, Glyph> {
  const out: Record<string, Glyph> = {};
  for (const [char, glyph] of Object.entries(GLYPHS)) out[char] = cloneGlyph(glyph);
  return out;
}

/**
 * Chaikin corner cutting for an open polyline. Endpoints are preserved, which
 * matters at the baseline: a rounded cut that moved them would make the whole
 * word bob up and down.
 */
function smoothStroke(stroke: Array<[number, number]>, iterations = 1): Array<[number, number]> {
  if (stroke.length < 3) return stroke.map(([x, y]) => [x, y] as [number, number]);
  let current = stroke;
  for (let pass = 0; pass < iterations; pass += 1) {
    const next: Array<[number, number]> = [current[0]!];
    for (let i = 0; i < current.length - 1; i += 1) {
      const a = current[i]!;
      const b = current[i + 1]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(current[current.length - 1]!);
    current = next;
  }
  return current;
}

function smoothTable(iterations: number): Record<string, Glyph> {
  const table = cloneTable();
  for (const glyph of Object.values(table)) {
    glyph.strokes = glyph.strokes.map((stroke) => smoothStroke(stroke, iterations));
  }
  return table;
}

/** Snap control points to a 5-unit grid, giving the squared display cut. */
function blockTable(): Record<string, Glyph> {
  const table = cloneTable();
  const snap = (value: number): number => Math.round(value / 5) * 5;
  for (const glyph of Object.values(table)) {
    glyph.strokes = glyph.strokes
      .map((stroke) => {
        const snapped: Array<[number, number]> = [];
        for (const [x, y] of stroke) {
          const point: [number, number] = [snap(x), snap(y)];
          const last = snapped[snapped.length - 1];
          if (!last || last[0] !== point[0] || last[1] !== point[1]) snapped.push(point);
        }
        return snapped;
      })
      .filter((stroke) => stroke.length >= 2);
  }
  return table;
}

/**
 * Add rectangular serifs to terminals whose final segment is close to
 * vertical. Curved terminals are left alone; hanging a horizontal slab off a
 * curve reads as a mistake rather than a serif.
 */
function serifTable(): Record<string, Glyph> {
  const table = cloneTable();
  for (const glyph of Object.values(table)) {
    const extra: Array<Array<[number, number]>> = [];
    for (const stroke of glyph.strokes) {
      if (stroke.length < 2) continue;
      const ends: Array<[number, number]> = [];
      const first = stroke[0]!;
      const second = stroke[1]!;
      const last = stroke[stroke.length - 1]!;
      const penultimate = stroke[stroke.length - 2]!;
      ends.push(first, last);
      for (const [index, end] of ends.entries()) {
        const neighbor = index === 0 ? second : penultimate;
        const dx = Math.abs(neighbor[0] - end[0]);
        const dy = Math.abs(neighbor[1] - end[1]);
        if (dy >= 8 && dx <= dy * 0.55) {
          extra.push([
            [end[0] - 5, end[1]],
            [end[0] + 5, end[1]],
          ]);
        }
      }
    }
    if (extra.length > 0) glyph.strokes.push(...extra);
  }
  return table;
}

/** Fixed 70-unit advance with the ink centred inside it. */
function monoTable(): Record<string, Glyph> {
  const table = cloneTable();
  const fixedAdvance = 70;
  for (const [char, glyph] of Object.entries(table)) {
    if (char === ' ') {
      glyph.advance = 40;
      continue;
    }
    const xs = glyph.strokes.flatMap((stroke) => stroke.map(([x]) => x));
    if (xs.length === 0) {
      glyph.advance = fixedAdvance;
      continue;
    }
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const width = Math.max(1, max - min);
    const scale = Math.min(1.35, 56 / width);
    const cx = (min + max) / 2;
    for (const stroke of glyph.strokes) {
      for (const point of stroke) {
        point[0] = fixedAdvance / 2 + (point[0] - cx) * scale;
      }
    }
    glyph.advance = fixedAdvance;
  }
  return table;
}

function buildLibrary(): FontDefinition[] {
  return [
    {
      id: 'studio',
      name: 'Studio Sans',
      category: 'Sans',
      description: 'The original clean single-stroke sans. Reads well from 4 mm up.',
      glyphs: cloneTable(),
      tracking: 0,
    },
    {
      id: 'rounded',
      name: 'Studio Round',
      category: 'Sans',
      description: 'Softened corners and terminals. Good for childrenswear and logos.',
      glyphs: smoothTable(1),
      tracking: 0.4,
    },
    {
      id: 'block',
      name: 'Studio Block',
      category: 'Display',
      description: 'Squared 5-unit grid cut for bold, athletic lettering.',
      glyphs: blockTable(),
      tracking: 1,
    },
    {
      id: 'script',
      name: 'Studio Script',
      category: 'Script',
      description: 'Smooth flowing cut with tight tracking for names and monograms.',
      glyphs: smoothTable(2),
      tracking: -1.2,
    },
    {
      id: 'serif',
      name: 'Studio Serif',
      category: 'Serif',
      description: 'Traditional serif terminals for formal caps and monograms.',
      glyphs: serifTable(),
      tracking: 0.8,
    },
    {
      id: 'mono',
      name: 'Studio Mono',
      category: 'Display',
      description: 'Fixed-width letters for technical labels and uniform spacing.',
      glyphs: monoTable(),
      tracking: 0,
    },
  ];
}

export const FONT_LIBRARY: FontDefinition[] = buildLibrary();

export const FONTS: Record<FontId, FontDefinition> = Object.fromEntries(
  FONT_LIBRARY.map((font) => [font.id, font]),
) as Record<FontId, FontDefinition>;

/** Every id the schema accepts, in library order. */
export const FONT_IDS_PUBLIC: readonly FontId[] = FONT_IDS;

export function isFontId(value: unknown): value is FontId {
  return typeof value === 'string' && (FONT_IDS as string[]).includes(value);
}

export function fontFor(id: FontId | string | undefined): FontDefinition {
  return isFontId(id) ? FONTS[id] : FONTS.studio;
}

/**
 * Resolve a character inside a font. Lowercase maps to uppercase, matching the
 * base alphabet's practical single-case design; unsupported characters become
 * `?` and report `substituted`.
 */
export function resolveFontGlyph(
  char: string,
  font: FontId | string | undefined,
): { glyph: Glyph; substituted: boolean } {
  const table = fontFor(font).glyphs;
  const direct = table[char];
  if (direct) return { glyph: direct, substituted: false };
  const upper = table[char.toUpperCase()];
  if (upper) return { glyph: upper, substituted: false };
  return { glyph: table['?']!, substituted: true };
}
