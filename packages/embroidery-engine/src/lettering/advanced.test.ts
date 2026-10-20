import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LETTERING,
  layoutText,
  letteringBounds,
  letteringStrokes,
  objectCenter,
  textToStitches,
  translateObject,
  validateObject,
} from '../index.js';
import type {
  EmbroideryObject,
  LetteringOptions,
  LetteringSpec,
  Point,
  StitchParameters,
} from '../index.js';

/**
 * Advanced lettering layouts: resequencing, a dropped letter, text on a path
 * and monograms with frames. Each is pure geometry, so the assertions can be
 * about coordinates rather than snapshots.
 */

function options(patch: Partial<LetteringOptions> = {}): LetteringOptions {
  return { ...DEFAULT_LETTERING, height: 20, ...patch };
}

const boundsOf = (
  strokes: Point[][],
): { minX: number; maxX: number; minY: number; maxY: number } => {
  const flat = strokes.flat();
  return {
    minX: Math.min(...flat.map((p) => p.x)),
    maxX: Math.max(...flat.map((p) => p.x)),
    minY: Math.min(...flat.map((p) => p.y)),
    maxY: Math.max(...flat.map((p) => p.y)),
  };
};

describe('lettering resequencing', () => {
  it('keeps reading order by default and reverses on request', () => {
    expect(
      layoutText('ABC', options())
        .placements.map((p) => p.char)
        .join(''),
    ).toBe('ABC');
    expect(
      layoutText('ABC', options({ order: 'reverse' }))
        .placements.map((p) => p.char)
        .join(''),
    ).toBe('CBA');
  });

  it('starts at both ends for outsideIn and at the middle for insideOut', () => {
    const out = layoutText('ABCDE', options({ order: 'outsideIn' })).placements;
    expect(out[0]!.char).toBe('A');
    expect(out[1]!.char).toBe('E');

    const inn = layoutText('ABCDE', options({ order: 'insideOut' })).placements;
    expect(inn[0]!.char).toBe('C');
  });

  it('reorders sewing without moving any letter', () => {
    const straight = layoutText('AB', options());
    const reversed = layoutText('AB', options({ order: 'reverse' }));
    expect(boundsOf(reversed.strokes)).toEqual(boundsOf(straight.strokes));
  });
});

describe('dropped letter', () => {
  const drop = { enabled: true, index: 0, scale: 1.6 };

  it('scales the chosen letter and lets it hang below the line', () => {
    const layout = layoutText('JT', options({ drop }));
    const first = boundsOf(layout.placements[0]!.strokes);
    const second = boundsOf(layout.placements[1]!.strokes);

    expect(first.maxY - first.minY).toBeGreaterThan(second.maxY - second.minY);
    expect(first.maxY).toBeGreaterThan(second.maxY);
    // The small letter is unchanged by the drop.
    const plain = boundsOf(layoutText('T', options()).placements[0]!.strokes);
    expect(second.maxY - second.minY).toBeCloseTo(plain.maxY - plain.minY, 6);
  });

  it('drops the requested character, not always the first', () => {
    const layout = layoutText('AJ', options({ drop: { ...drop, index: 1 } }));
    const first = boundsOf(layout.placements[0]!.strokes);
    const second = boundsOf(layout.placements[1]!.strokes);
    expect(second.maxY - second.minY).toBeGreaterThan(first.maxY - first.minY);
  });
});

describe('text on a path', () => {
  const path = (points: Point[], patch: Partial<NonNullable<LetteringOptions['onPath']>> = {}) =>
    options({ onPath: { points, upright: false, offsetMm: 0, align: 'start', ...patch } });

  it('centres the text along a straight path', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    const layout = layoutText('AB', path(line, { align: 'center' }));
    const box = boundsOf(layout.strokes);
    // Two letters are far narrower than 200 mm, so centring must not touch
    // either end of the path.
    expect(box.minX).toBeGreaterThan(80);
    expect(box.maxX).toBeLessThan(120);
  });

  it('offsets the letters above a left-to-right path', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    const base = boundsOf(layoutText('A', path(line)).strokes);
    const lifted = boundsOf(layoutText('A', path(line, { offsetMm: 5 })).strokes);

    // The letters straddle the path line; a positive offset simply lifts the
    // whole group by that many millimetres.
    expect(lifted.minY).toBeCloseTo(base.minY - 5, 6);
    expect(lifted.maxY).toBeCloseTo(base.maxY - 5, 6);
  });

  it('rotates letters with the tangent unless asked to stay upright', () => {
    const diagonal: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    const rotated = layoutText('L', path(diagonal));
    const upright = layoutText('L', path(diagonal, { upright: true }));

    const rotatedBox = boundsOf(rotated.strokes);
    const uprightBox = boundsOf(upright.strokes);
    // The rotated letter leans along the 45-degree path, so its bounding box
    // is wider than the upright one.
    expect(rotatedBox.maxX - rotatedBox.minX).toBeGreaterThan(uprightBox.maxX - uprightBox.minX);
  });

  it('falls back to straight text for a path with no direction', () => {
    const layout = layoutText(
      'AB',
      options({
        onPath: { points: [{ x: 5, y: 5 }], upright: false, offsetMm: 0, align: 'start' },
      }),
    );
    expect(layout.placements).toHaveLength(2);
    // Identical to ordinary straight text, not text anchored at the point.
    expect(boundsOf(layout.strokes)).toEqual(boundsOf(layoutText('AB', options()).strokes));
  });

  it('sews every letter even when the text is longer than the path', () => {
    const layout = layoutText(
      'ABCDEFGHIJKLMNOP',
      path([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ]),
    );
    expect(layout.placements).toHaveLength(16);
    expect(layout.bounds).not.toBeNull();
  });
});

describe('monograms', () => {
  const monogram = (patch: Partial<NonNullable<LetteringSpec['monogram']>> = {}) =>
    options({
      monogram: { enabled: true, frame: 'none', mirrorSides: false, frameWidth: 1.5, ...patch },
    });

  it('makes the middle initial the big one', () => {
    const layout = layoutText('ABC', monogram());
    expect(layout.placements.map((p) => p.char)).toEqual(['A', 'B', 'C']);

    const left = boundsOf(layout.placements[0]!.strokes);
    const centre = boundsOf(layout.placements[1]!.strokes);
    expect(centre.maxY - centre.minY).toBeGreaterThan(left.maxY - left.minY);
    // Side initials are centred vertically against the big one.
    expect((left.minY + left.maxY) / 2).toBeCloseTo((centre.minY + centre.maxY) / 2, 6);
  });

  it('mirrors the two outer initials when asked', () => {
    const plain = layoutText('ABC', monogram());
    const mirrored = layoutText('ABC', monogram({ mirrorSides: true }));

    const firstPlain = plain.placements[0]!.strokes[0]![0]!;
    const firstMirrored = mirrored.placements[0]!.strokes[0]![0]!;
    const box = boundsOf(plain.placements[0]!.strokes);
    const mid = (box.minX + box.maxX) / 2;
    expect(firstMirrored.x).toBeCloseTo(2 * mid - firstPlain.x, 6);
    // The centre initial is never mirrored.
    const centrePlain = plain.placements[1]!.strokes[0]![0]!;
    const centreMirrored = mirrored.placements[1]!.strokes[0]![0]!;
    expect(centreMirrored.x).toBeCloseTo(centrePlain.x, 6);
  });

  it('supports one and two letters', () => {
    expect(layoutText('A', monogram()).placements).toHaveLength(1);
    const two = layoutText('AB', monogram());
    expect(two.placements.map((p) => p.char)).toEqual(['A', 'B']);
    // With two letters the first is the centre, so it is the larger one.
    const first = boundsOf(two.placements[0]!.strokes);
    const second = boundsOf(two.placements[1]!.strokes);
    expect(first.maxY - first.minY).toBeGreaterThan(second.maxY - second.minY);
  });

  it('draws each frame style around the initials and keeps it closed', () => {
    for (const frame of ['circle', 'oval', 'diamond'] as const) {
      const layout = layoutText('ABC', monogram({ frame }));
      expect(layout.frame).not.toBeNull();
      const letters = boundsOf(layout.strokes);
      const ring = boundsOf([layout.frame!]);
      expect(ring.minX).toBeLessThan(letters.minX);
      expect(ring.maxX).toBeGreaterThan(letters.maxX);
      expect(ring.minY).toBeLessThan(letters.minY);
      expect(ring.maxY).toBeGreaterThan(letters.maxY);

      const first = layout.frame![0]!;
      const last = layout.frame![layout.frame!.length - 1]!;
      expect(last.x).toBeCloseTo(first.x, 6);
      expect(last.y).toBeCloseTo(first.y, 6);
    }
    expect(layoutText('ABC', monogram()).frame).toBeNull();
  });

  it('sews a frame with more stitches than the letters alone', () => {
    const satin = {
      spacing: 0.4,
      maxStitchLength: 12.1,
      pullCompensation: 0,
      splitStrategy: 'divide' as const,
    };
    const withFrame = textToStitches('ABC', monogram({ frame: 'oval' }), satin);
    const without = textToStitches('ABC', monogram(), satin);
    expect(withFrame.length).toBeGreaterThan(without.length);
  });

  it('treats a blank monogram as nothing to sew', () => {
    const layout = layoutText('   ', monogram());
    expect(layout.placements).toHaveLength(0);
    expect(layout.bounds).toBeNull();
  });
});

const PARAMS: StitchParameters = {
  stitchType: 'satin',
  angle: 0,
  spacing: 0.4,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0.2,
  fillPattern: 'tatami',
  underlay: { type: 'none', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: false, length: 0.4, count: 3 },
  tieOff: { enabled: false, length: 0.4, count: 3 },
};

/** A lettering object with sane parameters, for the editor-facing helpers. */
function textObject(patch: Partial<LetteringSpec>): EmbroideryObject {
  const lettering: LetteringSpec = {
    text: 'TEXT',
    height: 20,
    spacing: 0,
    slant: 0,
    rotation: 0,
    width: 1.2,
    ...patch,
  };
  return {
    id: 'text-1',
    name: 'Text',
    type: 'lettering',
    path: { rings: [] },
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: PARAMS,
    entryExit: { entry: null, exit: null },
    lettering,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

describe('lettering size limits', () => {
  it('warns about tiny letters without blocking them', () => {
    const result = validateObject(textObject({ height: 2 }));
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain('LETTERING_TOO_SMALL');
  });

  it('warns when the stroke swallows the letters', () => {
    const result = validateObject(textObject({ height: 6, width: 9 }));
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain('LETTERING_STROKE_TOO_WIDE');
  });

  it('warns about a path with a single point', () => {
    const result = validateObject(
      textObject({
        onPath: { points: [{ x: 0, y: 0 }], upright: false, offsetMm: 0, align: 'start' },
      }),
    );
    expect(result.issues.map((i) => i.code)).toContain('LETTERING_PATH_TOO_SHORT');
  });

  it('stays quiet for sensible lettering', () => {
    const result = validateObject(textObject({}));
    expect(result.issues).toHaveLength(0);
  });
});

describe('lettering helpers the editor uses', () => {
  it('moves text by its transform, leaving the empty path alone', () => {
    const obj = textObject({});
    const moved = translateObject(obj, 5, -3);
    expect(moved.transform).toEqual({ x: 5, y: -3 });
    expect(moved.path.rings).toHaveLength(0);
    expect(obj.transform).toEqual({ x: 0, y: 0 });
  });

  it('reports text bounds and a centre from the laid-out letters', () => {
    const obj = textObject({});
    const box = letteringBounds(obj);
    expect(box).not.toBeNull();
    // The letters start at the transform origin and extend right and down.
    expect(box!.minX).toBeGreaterThanOrEqual(0);
    expect(box!.maxX).toBeGreaterThan(box!.minX);
    expect(box!.maxY).toBeGreaterThan(0);

    const centre = objectCenter(obj);
    expect(centre.x).toBeCloseTo((box!.minX + box!.maxX) / 2, 6);
    expect(centre.y).toBeCloseTo((box!.minY + box!.maxY) / 2, 6);
  });

  it('has no bounds for blank text or non-lettering objects', () => {
    expect(letteringBounds(textObject({ text: '   ' }))).toBeNull();
    expect(letteringBounds({ ...textObject({}), type: 'fill' })).toBeNull();
  });

  it('exposes the laid-out strokes and the monogram frame', () => {
    const plain = letteringStrokes(textObject({}));
    expect(plain.strokes.length).toBeGreaterThan(0);
    expect(plain.frame).toBeNull();

    const framed = letteringStrokes(
      textObject({
        monogram: { enabled: true, frame: 'circle', mirrorSides: false, frameWidth: 1.5 },
      }),
    );
    expect(framed.frame).not.toBeNull();
    expect(framed.frame!.length).toBeGreaterThan(10);
  });

  it('places the centre of moved text where the letters actually are', () => {
    const moved = translateObject(textObject({}), 30, 40);
    const box = letteringBounds(moved)!;
    const centre = objectCenter(moved);
    expect(centre.x).toBeGreaterThan(30);
    expect(centre.y).toBeGreaterThan(40);
    expect(centre.x).toBeCloseTo((box.minX + box.maxX) / 2, 6);
  });
});

describe('lettering width and mirrors', () => {
  const widthOf = (strokes: Point[][]): number => {
    const box = boundsOf(strokes);
    return box.maxX - box.minX;
  };

  it('condenses and widens the glyphs with the width factor', () => {
    const narrow = layoutText('MM', options({ stretch: 0.6 }));
    const normal = layoutText('MM', options());
    const wide = layoutText('MM', options({ stretch: 1.6 }));

    expect(widthOf(narrow.strokes)).toBeLessThan(widthOf(normal.strokes));
    expect(widthOf(wide.strokes)).toBeGreaterThan(widthOf(normal.strokes));
  });

  it('ignores a nonsensical width factor', () => {
    const zero = layoutText('MM', options({ stretch: 0 }));
    expect(widthOf(zero.strokes)).toBeCloseTo(widthOf(layoutText('MM', options()).strokes), 6);
  });

  it('mirrors horizontally about the layout centre, keeping its box', () => {
    const plain = layoutText('L', options());
    const mirrored = layoutText('L', options({ mirror: { x: true, y: false } }));
    const box = boundsOf(plain.strokes);
    const mid = (box.minX + box.maxX) / 2;
    const mirroredBox = boundsOf(mirrored.strokes);

    expect(mirroredBox.minX).toBeCloseTo(box.minX, 6);
    expect(mirroredBox.maxX).toBeCloseTo(box.maxX, 6);
    expect(mirrored.strokes[0]![0]!.x).toBeCloseTo(2 * mid - plain.strokes[0]![0]!.x, 6);
  });

  it('mirrors vertically too', () => {
    const plain = layoutText('T', options());
    const mirrored = layoutText('T', options({ mirror: { x: false, y: true } }));
    const box = boundsOf(plain.strokes);
    const mid = (box.minY + box.maxY) / 2;

    expect(mirrored.strokes[0]![0]!.y).toBeCloseTo(2 * mid - plain.strokes[0]![0]!.y, 6);
  });

  it('sews mirrored, stretched text as real stitches', () => {
    const satin = {
      spacing: 0.4,
      maxStitchLength: 12.1,
      pullCompensation: 0,
      splitStrategy: 'divide' as const,
    };
    const stitches = textToStitches(
      'AB',
      options({ mirror: { x: true, y: false }, stretch: 1.4 }),
      satin,
    );
    expect(stitches.length).toBeGreaterThan(0);
  });
});
