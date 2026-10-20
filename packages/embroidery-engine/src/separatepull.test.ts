import { describe, it, expect } from 'vitest';
import { generateObjectStitches } from './index.js';
import type { EmbroideryObject, Point, StitchParameters } from './types.js';

/**
 * Separate pull compensation, end to end: the object's two rails are sewn by
 * `satinFromRails`, and the wiring in `generateObjectStitches` has to pass each
 * side's value through rather than collapsing back to the uniform one.
 */

const PARAMS: StitchParameters = {
  stitchType: 'satin',
  angle: 0,
  spacing: 0.5,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0,
  fillPattern: 'tatami',
  underlay: { type: 'none', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: false, length: 0.4, count: 3 },
  tieOff: { enabled: false, length: 0.4, count: 3 },
};

function rails(y0: number, y1: number): Point[][] {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= 4; i++) {
    const x = (i / 4) * 20;
    left.push({ x, y: y0 });
    right.push({ x, y: y1 });
  }
  return [left, right];
}

function column(params: Partial<StitchParameters>): EmbroideryObject {
  return {
    id: 'column-1',
    name: 'Column',
    type: 'column',
    path: { rings: rails(0, 6) },
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: { ...PARAMS, ...params },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

function sewnYs(object: EmbroideryObject): number[] {
  return generateObjectStitches(object)
    .filter((s) => s.command === 'stitch')
    .map((s) => s.y);
}

describe('generateObjectStitches with separate pull compensation', () => {
  it('compensates each rail by its own amount', () => {
    const ys = sewnYs(column({ separatePullCompensation: { left: 0.8, right: 0.2 } }));

    // The first rail sits at y=0 and the second at y=6; each is pushed
    // outwards by its side's compensation.
    expect(Math.min(...ys)).toBeCloseTo(-0.8, 1);
    expect(Math.max(...ys)).toBeCloseTo(6.2, 1);
  });

  it('uses the uniform value when separate compensation is absent', () => {
    const ys = sewnYs(column({ pullCompensation: 0.5 }));
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 1);
    expect(Math.max(...ys)).toBeCloseTo(6.5, 1);
  });

  it('falls back for a null value, as a cleared toggle saves', () => {
    const ys = sewnYs(column({ pullCompensation: 0.5, separatePullCompensation: null }));
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 1);
    expect(Math.max(...ys)).toBeCloseTo(6.5, 1);
  });

  it('leaves a non-satin fill on the uniform value', () => {
    const object: EmbroideryObject = {
      ...column({
        stitchType: 'tatami',
        pullCompensation: 0.3,
        separatePullCompensation: { left: 2, right: 2 },
      }),
      path: {
        rings: [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 6 },
            { x: 0, y: 6 },
          ],
        ],
      },
    };
    const xs = generateObjectStitches(object)
      .filter((s) => s.command === 'stitch')
      .map((s) => s.x);

    // A 0.3 mm row-end extension, not the 2 mm satin sides. Precision 0
    // allows the row-end stepping to land a fraction short of the exact edge.
    expect(Math.min(...xs)).toBeCloseTo(-0.3, 0);
    expect(Math.max(...xs)).toBeCloseTo(20.3, 0);
  });
});
