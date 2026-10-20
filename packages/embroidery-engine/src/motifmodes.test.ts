/**
 * Phase M: motif runs, singles, columns, gradients and the user-defined split.
 *
 * The motif used here is a square the design carries, so every count and
 * measurement is exact and tied to nothing built-in.
 */

import { describe, it, expect } from 'vitest';
import { generateObjectStitches } from './index.js';
import type { EmbroideryObject, Point, StitchParameters } from './types.js';

/** A 10 x 10 mm square ring centred on the origin. */
const SQUARE: Point[] = [
  { x: -5, y: -5 },
  { x: 5, y: -5 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
];

function rect(x0: number, y0: number, w: number, h: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + h },
    { x: x0, y: y0 + h },
  ];
}

const BASE: StitchParameters = {
  stitchType: 'motif',
  angle: 0,
  spacing: 0.4,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0.2,
  fillPattern: 'motif',
  // Underlay off: these tests count motif stitches, so nothing else may sew.
  underlay: { type: 'none', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: false, length: 0.4, count: 3 },
  tieOff: { enabled: false, length: 0.4, count: 3 },
  motif: { points: SQUARE },
};

function object(
  type: EmbroideryObject['type'],
  rings: Point[][],
  params: Partial<StitchParameters> = {},
): EmbroideryObject {
  return {
    id: 'm1',
    name: 'Motif',
    type,
    path: { rings },
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: { ...BASE, ...params },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

const sewn = (obj: EmbroideryObject) =>
  generateObjectStitches(obj).filter((s) => s.command === 'stitch');

function bounds(list: { x: number; y: number }[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of list) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Split a flat stitch list into groups of `size` (one motif each). */
function groups<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i + size <= list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

describe('motif run', () => {
  it('sews a trail of motifs along the outline, rotated to it', () => {
    const fill = sewn(object('motif', [rect(0, 0, 60, 40)], { motifMode: 'fill' }));
    const run = sewn(object('motif', [rect(0, 0, 60, 40)], { motifMode: 'run' }));

    expect(run.length).toBeGreaterThan(100);
    expect(run.length).not.toBe(fill.length);
    // A run covers the perimeter, not the area, so it uses far fewer motifs
    // than the fill of the same shape.
    expect(run.length).toBeLessThan(fill.length);

    // Deterministic, like every other generator.
    const again = sewn(object('motif', [rect(0, 0, 60, 40)], { motifMode: 'run' }));
    expect(JSON.stringify(again)).toBe(JSON.stringify(run));

    // The trail follows the outline: stitches sit in a band around the
    // rectangle's border, never deep in the middle. Half a motif is 5 mm at
    // the grid's scale, plus a little for the corner samples.
    for (const s of run) {
      const deepInside = s.x > 12 && s.x < 48 && s.y > 12 && s.y < 28;
      expect(deepInside, `(${s.x.toFixed(1)}, ${s.y.toFixed(1)}) is inside the fill`).toBe(false);
    }
  });

  it('walks an open path for a run object without wrapping', () => {
    const line = sewn(
      object(
        'run',
        [
          [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
          ],
        ],
        {
          stitchType: 'run',
          motifMode: 'run',
        },
      ),
    );
    expect(line.length).toBeGreaterThan(20);

    // The stamp takes half a motif past each end at most, and never reaches
    // the far side of the rectangle the closed test used.
    const box = bounds(line);
    expect(box.minX).toBeGreaterThan(-8);
    expect(box.maxX).toBeLessThan(58);
  });
});

describe('motif single', () => {
  it('stamps exactly one motif, scaled to fill the box it was drawn in', () => {
    const one = sewn(object('motif', [rect(0, 0, 20, 20)], { motifMode: 'single' }));

    // One stamp of a 4-point motif: 4 points plus the closing stitch.
    expect(one.length).toBe(5);

    // Contained scales to the box, so a square box and a square motif make
    // the stamp touch all four sides.
    const box = bounds(one);
    expect(box.minX).toBeCloseTo(0, 4);
    expect(box.maxX).toBeCloseTo(20, 4);
    expect(box.minY).toBeCloseTo(0, 4);
    expect(box.maxY).toBeCloseTo(20, 4);
  });

  it('keeps the stamp inside a wide box rather than stretching it', () => {
    const one = sewn(object('motif', [rect(0, 0, 40, 10)], { motifMode: 'single' }));
    const box = bounds(one);

    // Contain: the square motif touches top and bottom, not left and right.
    expect(box.maxY - box.minY).toBeCloseTo(10, 4);
    expect(box.maxX - box.minX).toBeCloseTo(10, 4);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(20, 4);
  });
});

describe('motif column', () => {
  it('spans the column rail to rail and follows its width', () => {
    // A straight 10 mm column running up the y axis.
    const narrow = sewn(
      object(
        'column',
        [
          [
            { x: 0, y: 0 },
            { x: 0, y: 40 },
          ],
          [
            { x: 10, y: 0 },
            { x: 10, y: 40 },
          ],
        ],
        { motifMode: 'column' },
      ),
    );
    expect(narrow.length).toBeGreaterThan(20);

    const box = bounds(narrow);
    // The motif's width spans the column (rail to rail), turned across it.
    expect(box.minX).toBeGreaterThanOrEqual(-0.01);
    expect(box.maxX).toBeLessThanOrEqual(10.01);
    expect(box.maxX - box.minX).toBeGreaterThan(9);

    // A wider column gets wider motifs, not more of them across.
    const wide = sewn(
      object(
        'column',
        [
          [
            { x: 0, y: 0 },
            { x: 0, y: 40 },
          ],
          [
            { x: 20, y: 0 },
            { x: 20, y: 40 },
          ],
        ],
        { motifMode: 'column' },
      ),
    );
    const wideBox = bounds(wide);
    expect(wideBox.maxX - wideBox.minX).toBeGreaterThan(18);
  });
});

describe('motif gradient', () => {
  it('grows the motifs from one end of the fill to the other', () => {
    const list = sewn(
      object('motif', [rect(0, 0, 30, 60)], {
        motifMode: 'fill',
        motifGradient: { scaleFrom: 0.5, scaleTo: 1.8, angleFrom: 0, angleTo: 0 },
      }),
    );

    // Each motif is 4 points + the close, in stamp order from the first row
    // to the last.
    const motifs = groups(list, 5);
    expect(motifs.length).toBeGreaterThan(10);

    const first = bounds(motifs[0]!);
    const last = bounds(motifs[motifs.length - 1]!);
    const firstWidth = first.maxX - first.minX;
    const lastWidth = last.maxX - last.minX;
    expect(lastWidth).toBeGreaterThan(firstWidth * 1.8);
  });

  it('turns the motifs across the layout with the angle gradient', () => {
    const straight = sewn(object('motif', [rect(0, 0, 30, 60)], { motifMode: 'fill' }));
    const turned = sewn(
      object('motif', [rect(0, 0, 30, 60)], {
        motifMode: 'fill',
        motifGradient: { scaleFrom: 1, scaleTo: 1, angleFrom: 0, angleTo: 45 },
      }),
    );

    expect(turned.length).toBeGreaterThan(10);
    expect(JSON.stringify(turned)).not.toBe(JSON.stringify(straight));
  });
});

describe('user-defined split', () => {
  it('replaces the built-in block numbers without leaving the pattern', () => {
    const base = object('fill', [rect(0, 0, 60, 40)], { stitchType: 'tatami' });
    const builtin = sewn({ ...base, params: { ...base.params, fillPattern: 'programmedSplit' } });
    const custom = sewn({
      ...base,
      params: {
        ...base.params,
        fillPattern: 'programmedSplit',
        customSplit: { segmentLength: 6, gap: 2, stagger: 0 },
      },
    });

    expect(custom.length).toBeGreaterThan(10);
    expect(JSON.stringify(custom)).not.toBe(JSON.stringify(builtin));

    // Rows still end at the same edge: the split eats blocks, not the outline.
    const xs = (l: typeof custom) => l.map((s) => s.x);
    expect(Math.min(...xs(custom))).toBeCloseTo(Math.min(...xs(builtin)), 4);
    expect(Math.max(...xs(custom))).toBeCloseTo(Math.max(...xs(builtin)), 4);
  });

  it('staggers breaks by the fraction asked for', () => {
    const base = object('fill', [rect(0, 0, 60, 40)], { stitchType: 'tatami' });
    const aligned = sewn({
      ...base,
      params: {
        ...base.params,
        fillPattern: 'programmedSplit',
        customSplit: { segmentLength: 6, gap: 2, stagger: 0 },
      },
    });
    const brick = sewn({
      ...base,
      params: {
        ...base.params,
        fillPattern: 'programmedSplit',
        customSplit: { segmentLength: 6, gap: 2, stagger: 0.5 },
      },
    });

    // Both really break somewhere, and stagger 0 and 0.5 are different lays.
    expect(aligned.length).toBeGreaterThan(10);
    expect(JSON.stringify(brick)).not.toBe(JSON.stringify(aligned));
  });
});

describe('one meaning through either door', () => {
  it('a tatami object with the motif fill pattern honours the same layout', () => {
    const byStitchType = sewn(
      object('fill', [rect(0, 0, 20, 20)], { stitchType: 'motif', motifMode: 'single' }),
    );
    const byFillPattern = sewn(
      object('fill', [rect(0, 0, 20, 20)], {
        stitchType: 'tatami',
        fillPattern: 'motif',
        motifMode: 'single',
      }),
    );

    expect(byStitchType.length).toBe(5);
    expect(JSON.stringify(byFillPattern)).toBe(JSON.stringify(byStitchType));
  });
});
