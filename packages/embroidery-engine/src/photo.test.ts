import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PHOTO,
  PHOTO_LIMITS,
  compileDesign,
  generateObjectStitches,
  photoProblem,
  photoSettings,
  photoStitches,
  planPhotoStitch,
} from './index.js';
import type { EmbroideryObject, PhotoSettings, Ring, StitchParameters } from './types.js';
import type { RasterImage } from './autodigitize/quantize.js';

const FILL_PARAMS: StitchParameters = {
  stitchType: 'tatami',
  angle: 45,
  spacing: 0.4,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0.2,
  fillPattern: 'tatami',
  underlay: { type: 'edgeRun', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: true, length: 0.4, count: 3 },
  tieOff: { enabled: true, length: 0.4, count: 3 },
};

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return { width, height, data };
}

/** A 4x4 image: left half red, right half blue. */
const redBlue = (): RasterImage =>
  image(4, 4, (x) => (x < 2 ? [220, 20, 30, 255] : [20, 40, 220, 255]));

function object(path: Ring[], colorIndex: number, angle = 45): EmbroideryObject {
  return {
    id: `photo-${colorIndex}`,
    name: `Photo ${colorIndex}`,
    type: 'fill',
    path: { rings: path },
    transform: { x: 0, y: 0 },
    colorIndex,
    params: { ...FILL_PARAMS, angle, photo: { ...DEFAULT_PHOTO } },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: colorIndex,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

const sewn = (list: { command: string }[]): number =>
  list.filter((s) => s.command === 'stitch').length;

describe('photo settings', () => {
  it('accepts the defaults', () => {
    expect(photoProblem(DEFAULT_PHOTO)).toBeNull();
  });

  it('ignores a disabled or absent setting', () => {
    expect(photoProblem({ ...DEFAULT_PHOTO, enabled: false, spacing: 0 })).toBeNull();
    expect(photoProblem(undefined)).toBeNull();
    expect(photoSettings(undefined)).toBeNull();
  });

  it('rejects spacing outside the satin range', () => {
    expect(photoProblem({ ...DEFAULT_PHOTO, spacing: 0.1 })).toContain('spacing');
    expect(photoProblem({ ...DEFAULT_PHOTO, spacing: 5 })).toContain('spacing');
  });
});

describe('planPhotoStitch', () => {
  it('turns a two-colour image into cells grouped by thread', () => {
    const plan = planPhotoStitch(redBlue(), { widthMm: 20, cellMm: 2, colorCount: 2 });

    expect(plan.columns).toBe(10);
    expect(plan.rows).toBe(10);
    expect(plan.cellMm).toBe(2);
    expect(plan.widthMm).toBe(20);
    expect(plan.heightMm).toBe(20);
    expect(plan.cells).toBe(100);
    expect(plan.palette).toHaveLength(2);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.reduce((sum, g) => sum + g.rings.length, 0)).toBe(100);
    expect(plan.groups.every((g) => g.rings.every((r) => r.length === 4))).toBe(true);
  });

  it('uses the real cell size after fitting the width', () => {
    const plan = planPhotoStitch(redBlue(), { widthMm: 21, cellMm: 2, colorCount: 2 });
    // 21 / 2 rounds to 10 columns, so the real cell is 2.1 mm.
    expect(plan.columns).toBe(10);
    expect(plan.cellMm).toBeCloseTo(2.1, 6);
    expect(plan.heightMm).toBeCloseTo(21, 6);
  });

  it('skips transparent cells instead of sewing them', () => {
    const transparent = image(2, 2, (x, y) =>
      x === 0 && y === 0 ? [220, 20, 30, 255] : [0, 0, 0, 0],
    );
    const plan = planPhotoStitch(transparent, { widthMm: 10, cellMm: 5, colorCount: 2 });

    expect(plan.columns).toBe(2);
    expect(plan.rows).toBe(2);
    expect(plan.cellMm).toBe(5);
    expect(plan.cells).toBe(1);
    expect(plan.skipped).toBe(3);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.rings).toHaveLength(1);
  });

  it('refuses a grid that would be unreasonably large', () => {
    expect(() => planPhotoStitch(redBlue(), { widthMm: 300, cellMm: 0.6 })).toThrow(/cells at/);
  });

  it('gives every palette entry a usable thread name and hex', () => {
    const plan = planPhotoStitch(redBlue(), { colorCount: 2 });
    for (const [index, colour] of plan.palette.entries()) {
      expect(colour.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colour.name).toBe(colour.hex.toUpperCase());
      expect(colour.id).toBe(`photo-${index + 1}`);
    }
  });

  it('never needs more threads than requested', () => {
    const plan = planPhotoStitch(redBlue(), { colorCount: 2 });
    expect(plan.palette.length).toBeLessThanOrEqual(2);
  });
});

describe('photoStitches', () => {
  const cell = (x: number, y: number, size = 2): Ring => [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];

  it('fills a cell with satin rows that stay inside it', () => {
    const raw = photoStitches({ rings: [cell(0, 0)] }, 0, {
      ...DEFAULT_PHOTO,
      spacing: 0.5,
    });

    expect(sewn(raw)).toBeGreaterThan(4);
    for (const s of raw) {
      expect(s.x).toBeGreaterThanOrEqual(-1e-9);
      expect(s.x).toBeLessThanOrEqual(2 + 1e-9);
      expect(s.y).toBeGreaterThanOrEqual(-1e-9);
      expect(s.y).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it('lays one stroke for a run cell and two for a cross cell', () => {
    const run = photoStitches({ rings: [cell(0, 0)] }, 45, {
      ...DEFAULT_PHOTO,
      style: 'run',
    });
    const cross = photoStitches({ rings: [cell(0, 0)] }, 45, {
      ...DEFAULT_PHOTO,
      style: 'cross',
    });

    expect(sewn(run)).toBe(2);
    expect(sewn(cross)).toBe(4);
  });

  it('jumps between scattered cells but not between neighbours', () => {
    const near = photoStitches({ rings: [cell(0, 0), cell(2, 0)] }, 0, DEFAULT_PHOTO);
    const far = photoStitches({ rings: [cell(0, 0), cell(20, 0)] }, 0, DEFAULT_PHOTO);

    expect(near.filter((s) => s.command === 'jump')).toHaveLength(0);
    expect(far.filter((s) => s.command === 'jump').length).toBeGreaterThan(0);
  });

  it('does nothing when disabled or without cells', () => {
    expect(photoStitches({ rings: [cell(0, 0)] }, 0, { ...DEFAULT_PHOTO, enabled: false })).toEqual(
      [],
    );
    expect(photoStitches({ rings: [] }, 0, DEFAULT_PHOTO)).toEqual([]);
  });

  it('is what the object generator returns, with no underlay', () => {
    const obj = object([cell(0, 0), cell(0, 2)], 0);
    const direct = photoStitches(obj.path, obj.params.angle, obj.params.photo!);

    expect(generateObjectStitches(obj)).toEqual(direct);
  });
});

describe('photo design', () => {
  it('compiles and validates as a multi-colour design', () => {
    const plan = planPhotoStitch(redBlue(), { widthMm: 16, cellMm: 2, colorCount: 2 });
    const objects = plan.groups.map((group) => object(group.rings, group.colorIndex, plan.angle));

    expect(objects.length).toBeGreaterThanOrEqual(2);
    const { sequence, validation } = compileDesign(objects, plan.palette, null);

    expect(sequence.stitches.length).toBeGreaterThan(100);
    expect(validation.ok).toBe(true);
    // One colour per object: the sequence uses both threads.
    expect(new Set(sequence.stitches.map((s) => s.colorIndex)).size).toBeGreaterThanOrEqual(2);
  });

  it('accepts the whole valid range of the panel', () => {
    for (const spacing of [PHOTO_LIMITS.minSpacing, 0.4, PHOTO_LIMITS.maxSpacing]) {
      const settings: PhotoSettings = { enabled: true, style: 'satin', spacing };
      expect(photoProblem(settings)).toBeNull();
    }
  });
});
