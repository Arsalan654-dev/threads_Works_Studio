import { describe, it, expect } from 'vitest';
import {
  APPLIQUE_LIMITS,
  DEFAULT_APPLIQUE,
  appliqueProblem,
  appliqueStitches,
  compileDesign,
  generateObjectStitches,
  ringSection,
} from './index.js';
import type {
  AppliqueSettings,
  CompoundPath,
  EmbroideryObject,
  StitchParameters,
  ThreadColor,
} from './types.js';

const PALETTE: ThreadColor[] = [{ id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' }];

const FILL_PARAMS: StitchParameters = {
  stitchType: 'tatami',
  angle: 0,
  spacing: 0.4,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0.2,
  fillPattern: 'tatami',
  underlay: { type: 'edgeRun', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: true, length: 0.4, count: 3 },
  tieOff: { enabled: true, length: 0.4, count: 3 },
};

function square(size = 10): CompoundPath {
  return {
    rings: [
      [
        { x: 0, y: 0 },
        { x: size, y: 0 },
        { x: size, y: size },
        { x: 0, y: size },
      ],
    ],
  };
}

function frame(): CompoundPath {
  return {
    rings: [
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
        { x: 5, y: 15 },
      ],
    ],
  };
}

function settings(overrides: Partial<AppliqueSettings> = {}): AppliqueSettings {
  return { ...DEFAULT_APPLIQUE, enabled: true, ...overrides };
}

function object(
  path: CompoundPath,
  applique: AppliqueSettings | undefined,
  extra: Partial<StitchParameters> = {},
): EmbroideryObject {
  return {
    id: 'obj-1',
    name: 'Patch',
    type: 'fill',
    path,
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: { ...FILL_PARAMS, ...extra, ...(applique ? { applique } : {}) },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

const sewn = (list: { command: string }[]): number =>
  list.filter((s) => s.command === 'stitch').length;

const commands = (list: { command: string }[], command: string): number =>
  list.filter((s) => s.command === command).length;

describe('applique validation', () => {
  it('accepts the defaults', () => {
    expect(appliqueProblem(DEFAULT_APPLIQUE)).toBeNull();
  });

  it('ignores disabled settings', () => {
    expect(appliqueProblem({ ...DEFAULT_APPLIQUE, enabled: false, tackWidth: 0 })).toBeNull();
    expect(appliqueProblem(undefined)).toBeNull();
  });

  it('rejects a tack narrower than the machine can lay', () => {
    expect(appliqueProblem(settings({ tackWidth: APPLIQUE_LIMITS.minWidth - 0.01 }))).toContain(
      'Tack width',
    );
  });

  it('rejects a finish wider than the limit', () => {
    expect(appliqueProblem(settings({ finishWidth: APPLIQUE_LIMITS.maxWidth + 1 }))).toContain(
      'Finish width',
    );
  });

  it('rejects spacing outside the usable range', () => {
    expect(appliqueProblem(settings({ tackSpacing: 99 }))).toContain('Tack spacing');
    expect(appliqueProblem(settings({ finishSpacing: 0.01 }))).toContain('Finish spacing');
  });

  it('rejects a partial stretch outside the perimeter', () => {
    expect(appliqueProblem(settings({ mode: 'partial', start: 1.5 }))).toContain('start');
    expect(appliqueProblem(settings({ mode: 'partial', length: 0 }))).toContain('length');
  });

  it('rejects an offset that would move the finish off the work', () => {
    expect(appliqueProblem(settings({ finishOffset: 11 }))).toContain('offset');
  });
});

describe('ringSection', () => {
  it('returns the whole ring when the length is the whole perimeter', () => {
    expect(ringSection(square().rings[0]!, 0, 1)).toHaveLength(4);
  });

  it('cuts a quarter of a square from the first corner', () => {
    const arc = ringSection(square().rings[0]!, 0, 0.25);
    expect(arc[0]!.x).toBeCloseTo(0, 6);
    expect(arc[0]!.y).toBeCloseTo(0, 6);
    expect(arc[arc.length - 1]!.x).toBeCloseTo(10, 6);
    expect(arc[arc.length - 1]!.y).toBeCloseTo(0, 6);
  });

  it('wraps around the start corner', () => {
    const arc = ringSection(square().rings[0]!, 0.75, 0.5);
    // From the top-left corner, through the bottom-left and along the bottom.
    expect(arc[0]!.x).toBeCloseTo(0, 6);
    expect(arc[0]!.y).toBeCloseTo(10, 6);
    const last = arc[arc.length - 1]!;
    expect(last.x).toBeCloseTo(10, 6);
    expect(last.y).toBeCloseTo(0, 6);
  });

  it('never returns a path longer than the fraction asked for', () => {
    const arc = ringSection(square(20).rings[0]!, 0.1, 0.3);
    let length = 0;
    for (let i = 0; i + 1 < arc.length; i++) {
      const a = arc[i]!;
      const b = arc[i + 1]!;
      length += Math.hypot(b.x - a.x, b.y - a.y);
    }
    expect(length).toBeCloseTo(24, 6); // 30% of 80
  });
});

describe('appliqueStitches', () => {
  it('sews placement, tack and finish with stops between them', () => {
    const raw = appliqueStitches(square(), settings(), { maxStitchLength: 12.1 });

    expect(sewn(raw)).toBeGreaterThan(100);
    expect(commands(raw, 'colorChange')).toBe(2);
    expect(commands(raw, 'trim')).toBe(2);
    expect(commands(raw, 'jump')).toBe(2);
    expect(raw[0]!.command).toBe('stitch');
  });

  it('keeps the finish band centred on the outline', () => {
    const raw = appliqueStitches(square(), settings({ finishWidth: 4 }), {
      maxStitchLength: 12.1,
    });
    const xs = raw.filter((s) => s.command === 'stitch').map((s) => s.x);
    const ys = raw.filter((s) => s.command === 'stitch').map((s) => s.y);
    // The 4 mm finish reaches 2 mm either side of the 0..10 square.
    expect(Math.min(...xs)).toBeCloseTo(-2, 1);
    expect(Math.max(...xs)).toBeCloseTo(12, 1);
    expect(Math.min(...ys)).toBeCloseTo(-2, 1);
    expect(Math.max(...ys)).toBeCloseTo(12, 1);
  });

  it('moves the finish outward when the offset is positive', () => {
    const raw = appliqueStitches(square(), settings({ finishWidth: 4, finishOffset: 2 }), {
      maxStitchLength: 12.1,
    });
    const xs = raw.filter((s) => s.command === 'stitch').map((s) => s.x);
    expect(Math.min(...xs)).toBeCloseTo(-4, 1);
    expect(Math.max(...xs)).toBeCloseTo(14, 1);
  });

  it('runs only along the chosen stretch in partial mode', () => {
    const raw = appliqueStitches(
      square(),
      settings({ mode: 'partial', start: 0, length: 0.25, finishWidth: 4 }),
      { maxStitchLength: 12.1 },
    );
    const ys = raw.filter((s) => s.command === 'stitch').map((s) => s.y);
    // One edge only: the band never reaches the far side of the square.
    expect(Math.max(...ys)).toBeLessThan(3);
    expect(commands(raw, 'colorChange')).toBe(2);
    expect(sewn(raw)).toBeGreaterThan(20);
  });

  it('leaves the tack out when it is set to none', () => {
    const raw = appliqueStitches(square(), settings({ tack: 'none' }), {
      maxStitchLength: 12.1,
    });
    // Only placement and finish remain, so one stop instead of two.
    expect(commands(raw, 'colorChange')).toBe(1);
  });

  it('leaves the finish out when it is set to none', () => {
    const raw = appliqueStitches(square(), settings({ finish: 'none' }), {
      maxStitchLength: 12.1,
    });
    expect(commands(raw, 'colorChange')).toBe(1);
    // The tack is 4 mm wide, so its zigzag reaches 2 mm each side of the
    // 0..10 square - and no further.
    const ys = raw.filter((s) => s.command === 'stitch').map((s) => s.y);
    expect(Math.max(...ys)).toBeCloseTo(12, 1);
  });

  it('is just the placement run when both other passes are off', () => {
    const raw = appliqueStitches(square(), settings({ tack: 'none', finish: 'none' }), {
      maxStitchLength: 12.1,
    });
    expect(commands(raw, 'colorChange')).toBe(0);
    expect(raw.every((s) => s.command === 'stitch')).toBe(true);
    // 40 mm at a 3 mm run spacing, including both ends.
    expect(sewn(raw)).toBeGreaterThanOrEqual(14);
    expect(sewn(raw)).toBeLessThanOrEqual(17);
  });

  it('goes round a hole as well as the outside', () => {
    const raw = appliqueStitches(frame(), settings({ finishWidth: 4 }), {
      maxStitchLength: 12.1,
    });
    expect(commands(raw, 'colorChange')).toBe(2);
    const xs = raw.map((s) => s.x);
    expect(Math.min(...xs)).toBeCloseTo(-2, 1);
    expect(Math.max(...xs)).toBeCloseTo(22, 1);
  });

  it('never emits a non-finite coordinate', () => {
    const raw = appliqueStitches(frame(), settings({ mode: 'partial', start: 0.2, length: 0.6 }), {
      maxStitchLength: 12.1,
    });
    for (const s of raw) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
  });

  it('does nothing when disabled', () => {
    expect(
      appliqueStitches(square(), settings({ enabled: false }), { maxStitchLength: 12.1 }),
    ).toEqual([]);
  });
});

describe('generateObjectStitches with applique', () => {
  it('does not lay the fill under a patch unless asked', () => {
    const patch = generateObjectStitches(object(square(20), settings()));
    const filled = generateObjectStitches(object(square(20), settings({ fill: true })));

    expect(sewn(patch)).toBeGreaterThan(50);
    expect(sewn(filled)).toBeGreaterThan(sewn(patch) * 2);
  });

  it('is exactly the applique passes when the fill is off', () => {
    const s = settings();
    const fromObject = generateObjectStitches(object(square(), s));
    const direct = appliqueStitches(square(), s, { maxStitchLength: 12.1 });
    expect(JSON.stringify(fromObject)).toBe(JSON.stringify(direct));
  });

  it('jumps from the fill into the first applique pass', () => {
    const withFill = generateObjectStitches(object(square(20), settings({ fill: true })));
    const beforeJump = withFill.findIndex((s) => s.command === 'colorChange');
    expect(beforeJump).toBeGreaterThan(0);
    // A trim and jump mark the change from fill to appliqué.
    expect(withFill.slice(0, beforeJump).some((s) => s.command === 'jump')).toBe(true);
  });

  it('produces a valid, exportable sequence', () => {
    const obj = object(square(20), settings({ fill: false }));
    const { sequence, validation } = compileDesign([obj], PALETTE, null);

    expect(sequence.stitches.length).toBeGreaterThan(0);
    expect(validation.ok).toBe(true);
    expect(sequence.stitches.filter((s) => s.command === 'colorChange')).toHaveLength(2);
  });
});
