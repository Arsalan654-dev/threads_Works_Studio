import { describe, it, expect } from 'vitest';
import { layoutText, measureText, textToStitches, DEFAULT_LETTERING } from './layout.js';
import { GLYPHS, resolveGlyph, METRICS, SUPPORTED_CHARACTERS } from './font.js';
import type { SatinOptions } from '../stitches/index.js';

const SATIN: SatinOptions = {
  spacing: 0.4,
  maxStitchLength: 12.1,
  pullCompensation: 0.4,
  splitStrategy: 'divide',
};

const opts = (over: Partial<typeof DEFAULT_LETTERING> = {}) => ({ ...DEFAULT_LETTERING, ...over });

describe('font table', () => {
  it('defines every uppercase letter and digit', () => {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      expect(GLYPHS[c], `missing glyph for ${c}`).toBeDefined();
    }
  });

  it('gives every glyph a positive advance and at least one stroke', () => {
    for (const [char, glyph] of Object.entries(GLYPHS)) {
      expect(glyph.advance, `advance for ${char}`).toBeGreaterThan(0);
      if (char !== ' ') expect(glyph.strokes.length, `strokes for ${char}`).toBeGreaterThan(0);
    }
  });

  it('keeps stroke coordinates inside the em box', () => {
    // The em is 0..70 above the baseline and down to -20 below. A stray
    // coordinate would silently push a letter outside its own advance and
    // make adjacent letters overlap when stitched.
    for (const [char, glyph] of Object.entries(GLYPHS)) {
      for (const stroke of glyph.strokes) {
        for (const [x, y] of stroke) {
          expect(x, `${char} x=${x}`).toBeGreaterThanOrEqual(0);
          expect(x, `${char} x=${x}`).toBeLessThanOrEqual(100);
          expect(y, `${char} y=${y}`).toBeGreaterThanOrEqual(METRICS.descender - 1);
          expect(y, `${char} y=${y}`).toBeLessThanOrEqual(80);
        }
      }
    }
  });
});

describe('resolveGlyph', () => {
  it('maps lowercase to uppercase', () => {
    expect(resolveGlyph('a').glyph).toBe(GLYPHS['A']);
    expect(resolveGlyph('a').substituted).toBe(false);
  });

  it('substitutes a visible placeholder for unknown characters', () => {
    const r = resolveGlyph('你');
    expect(r.glyph).toBe(GLYPHS['?']);
    expect(r.substituted).toBe(true);
  });

  it('handles space without substitution', () => {
    expect(resolveGlyph(' ').substituted).toBe(false);
    expect(resolveGlyph(' ').glyph.strokes).toHaveLength(0);
  });
});

describe('layoutText', () => {
  it('produces no ink for empty or blank text', () => {
    expect(layoutText('', opts()).strokes).toHaveLength(0);
    expect(layoutText('', opts()).bounds).toBeNull();
    expect(layoutText('   ', opts()).strokes).toHaveLength(0);
  });

  it('scales so cap height matches the requested height', () => {
    // 'H' has a stroke reaching y=70 (cap height) and y=0 (baseline).
    const layout = layoutText('H', opts({ height: 35 }));
    const b = layout.bounds!;
    expect(b.maxY - b.minY).toBeCloseTo(35, 1);
  });

  it('advances each character by its own width plus spacing', () => {
    const tight = layoutText('AV', opts({ height: 20, spacing: 0 })).bounds!;
    const loose = layoutText('AV', opts({ height: 20, spacing: 8 })).bounds!;
    expect(loose.maxX - tight.maxX).toBeCloseTo(8, 1);
  });

  it('reports substitution so a caller can warn the operator', () => {
    const layout = layoutText('A?你', opts());
    expect(layout.placements[0]!.substituted).toBe(false);
    expect(layout.placements[1]!.substituted).toBe(false);
    expect(layout.placements[2]!.substituted).toBe(true);
  });

  it('slants letters to the right without changing their height', () => {
    const upright = layoutText('I', opts({ height: 20 }))['bounds']!;
    const slanted = layoutText('I', opts({ height: 20, slant: 15 }))['bounds']!;
    expect(slanted.maxX).toBeGreaterThan(upright.maxX);
    expect(slanted.maxY - slanted.minY).toBeCloseTo(upright.maxY - upright.minY, 1);
  });

  it('anchors at the requested origin', () => {
    const at = layoutText('L', opts({ height: 20, origin: { x: 100, y: 50 } })).bounds!;
    const home = layoutText('L', opts({ height: 20 })).bounds!;
    expect(at.minX - home.minX).toBeCloseTo(100, 6);
    expect(at.minY - home.minY).toBeCloseTo(50, 6);
  });

  it('rotates the whole line about the origin', () => {
    // A 90-degree rotation must swap the extents exactly: what was the
    // line's width becomes its height, and vice versa. Asserting the swap
    // rather than "one is bigger" checks the transform is a real rotation
    // and not a scale or a shear.
    const flat = layoutText('HI', opts({ height: 20 }))['bounds']!;
    const turned = layoutText('HI', opts({ height: 20, rotation: 90 }))['bounds']!;

    const flatWidth = flat.maxX - flat.minX;
    const flatHeight = flat.maxY - flat.minY;
    const turnedWidth = turned.maxX - turned.minX;
    const turnedHeight = turned.maxY - turned.minY;

    expect(turnedHeight).toBeCloseTo(flatWidth, 6);
    expect(turnedWidth).toBeCloseTo(flatHeight, 6);
  });
});

describe('measureText', () => {
  it('matches the laid-out advance for a simple string', () => {
    const width = measureText('HI', opts({ height: 20, spacing: 2 }));
    // 'H' advances 70, 'I' advances 34, in em units at scale 20/70.
    const scale = 20 / 70;
    expect(width).toBeCloseTo((70 + 34) * scale + 2, 6);
  });

  it('is monotonic in spacing', () => {
    expect(measureText('ABC', opts({ spacing: 5 }))).toBeGreaterThan(
      measureText('ABC', opts({ spacing: 0 })),
    );
  });
});

describe('textToStitches', () => {
  it('produces stitches for real text', () => {
    const stitches = textToStitches('TEST 123', opts(), SATIN);
    expect(stitches.length).toBeGreaterThan(100);
  });

  it('returns nothing for empty text', () => {
    expect(textToStitches('', opts(), SATIN)).toHaveLength(0);
  });

  it('keeps every stitch inside the reported layout bounds plus satin width', () => {
    const options = opts({ height: 20 });
    const layout = layoutText('ABC', options);
    const stitches = textToStitches('ABC', options, SATIN);
    const b = layout.bounds!;
    const half = options.width / 2 + 0.5; // pull compensation widens rows

    for (const s of stitches) {
      expect(s.x).toBeGreaterThanOrEqual(b.minX - half);
      expect(s.x).toBeLessThanOrEqual(b.maxX + half);
      expect(s.y).toBeGreaterThanOrEqual(b.minY - half);
      expect(s.y).toBeLessThanOrEqual(b.maxY + half);
    }
  });

  it('is denser than a single point - real satin rows, not a dot', () => {
    // A 20mm capital stroke is ~30 rows at 0.4mm spacing.
    const stitches = textToStitches('I', opts({ height: 20 }), SATIN);
    expect(stitches.length).toBeGreaterThan(20);
  });
});

describe('supported characters', () => {
  it('exposes the set for a UI picker', () => {
    expect(SUPPORTED_CHARACTERS).toContain('A');
    expect(SUPPORTED_CHARACTERS).toContain('0');
    // 26 letters + 10 digits + space + 17 punctuation marks.
    expect(SUPPORTED_CHARACTERS).toHaveLength(54);
    expect(new Set(SUPPORTED_CHARACTERS).size).toBe(54);
  });
});
