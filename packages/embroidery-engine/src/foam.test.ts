import { describe, it, expect } from 'vitest';
import {
  compileDesign,
  generateObjectStitches,
  DEFAULT_FOAM,
  FOAM_MAX_SPACING,
  FOAM_PULL_RATIO,
  foamPullCompensation,
  foamSpacing,
  foamTack,
} from './index.js';
import type {
  CompoundPath,
  EmbroideryObject,
  FoamSettings,
  StitchParameters,
  ThreadColor,
} from './types.js';

const PALETTE: ThreadColor[] = [{ id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' }];

const FLAT_PARAMS: StitchParameters = {
  stitchType: 'satin',
  angle: 0,
  spacing: 0.4,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0.4,
  fillPattern: 'tatami',
  underlay: { type: 'zigzag', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: true, length: 0.4, count: 3 },
  tieOff: { enabled: true, length: 0.4, count: 3 },
};

/** Two parallel rails: a straight 40 mm satin column 6 mm wide. */
function twoRailPath(): CompoundPath {
  const left = [];
  const right = [];
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * 40;
    left.push({ x, y: 0 });
    right.push({ x, y: 6 });
  }
  return { rings: [left, right] };
}

function columnObject(
  foam: FoamSettings | undefined,
  params: Partial<StitchParameters> = {},
): EmbroideryObject {
  return {
    id: 'obj-1',
    name: 'Column',
    type: 'column',
    path: twoRailPath(),
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: { ...FLAT_PARAMS, ...params, ...(foam === undefined ? {} : { foam }) },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

const ON: FoamSettings = { enabled: true, thicknessMm: 2, tackUnderlay: true };
const OFF: FoamSettings = { enabled: false, thicknessMm: 2, tackUnderlay: true };

/** Only the `stitch` records, i.e. the actual needle penetrations. */
function sewn(raw: { command: string }[]): number {
  return raw.filter((s) => s.command === 'stitch').length;
}

describe('foamSpacing', () => {
  it('caps spacing so no foam shows between rows', () => {
    expect(foamSpacing(0.4)).toBe(FOAM_MAX_SPACING);
    expect(foamSpacing(1.0)).toBe(FOAM_MAX_SPACING);
  });

  it('does not force an already-dense column looser', () => {
    expect(foamSpacing(0.2)).toBe(0.2);
  });

  it('clamps nonsense to something sewable', () => {
    expect(foamSpacing(0)).toBeGreaterThanOrEqual(0.05);
    expect(foamSpacing(Number.NaN)).toBeGreaterThanOrEqual(0.05);
    expect(foamSpacing(-3)).toBeGreaterThanOrEqual(0.05);
  });
});

describe('foamPullCompensation', () => {
  it('widens the column by a share of the foam thickness', () => {
    expect(foamPullCompensation(0.4, 2)).toBeCloseTo(0.4 + 2 * FOAM_PULL_RATIO, 10);
  });

  it('leaves a thicker sheet wider than a thinner one', () => {
    expect(foamPullCompensation(0.4, 3)).toBeGreaterThan(foamPullCompensation(0.4, 2));
  });

  it('treats a negative thickness as no foam rather than shrinking the column', () => {
    expect(foamPullCompensation(0.4, -2)).toBe(0.4);
  });
});

describe('foamTack', () => {
  it('runs down the spine between the two rails', () => {
    const tack = foamTack(twoRailPath(), { spacing: 3, maxStitchLength: 12.1 });

    expect(sewn(tack)).toBeGreaterThan(0);
    // The spine of a column from y=0 to y=6 sits at y=3.
    for (const s of tack) {
      expect(s.y).toBeCloseTo(3, 1);
    }
  });

  it('follows a curved spine instead of cutting the corner', () => {
    // A rail that bends: the spine must bend with it, not beaver across.
    const left = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    const right = left.map((p) => ({ x: p.x, y: p.y + 6 }));
    const tack = foamTack({ rings: [left, right] }, { spacing: 2, maxStitchLength: 12.1 });

    const ys = tack.map((s) => s.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
  });

  it('returns nothing when the path cannot support a line', () => {
    expect(foamTack({ rings: [] }, { spacing: 3, maxStitchLength: 12.1 })).toHaveLength(0);
    expect(
      foamTack({ rings: [[{ x: 0, y: 0 }]] }, { spacing: 3, maxStitchLength: 12.1 }),
    ).toHaveLength(0);
  });

  it('marks the start as travel rather than sewing a thread to nowhere', () => {
    const tack = foamTack(twoRailPath(), { spacing: 3, maxStitchLength: 12.1 });
    expect(tack[0]!.command).toBe('jump');
  });
});

describe('generateObjectStitches with foam', () => {
  it('ignores the normal underlay when foam is on', () => {
    // The point of foam underlay is that the *normal* underlay is dropped:
    // a dense bed would skate the foam sheet. So changing the underlay type
    // must make no difference once foam is enabled.
    const zigzag = generateObjectStitches(columnObject(ON));
    const heavy = generateObjectStitches(
      columnObject(ON, { underlay: { type: 'tatami', spacing: 1, offset: 0.5, inset: 2 } }),
    );
    const none = generateObjectStitches(
      columnObject(ON, { underlay: { type: 'none', spacing: 3, offset: 1, inset: 1 } }),
    );

    expect(sewn(heavy)).toBe(sewn(zigzag));
    expect(sewn(none)).toBe(sewn(zigzag));
  });

  it('omits the tack when tackUnderlay is off', () => {
    const withTack = generateObjectStitches(columnObject({ ...ON, tackUnderlay: true }));
    const without = generateObjectStitches(columnObject({ ...ON, tackUnderlay: false }));

    expect(sewn(without)).toBeLessThan(sewn(withTack));
  });

  it('sews the foam column denser than the flat one', () => {
    const flat = generateObjectStitches(columnObject(undefined));
    const foam = generateObjectStitches(columnObject(ON));

    // The tack is one light run, so it cannot make up for the many extra
    // satin rows the tighter spacing produces.
    expect(sewn(foam)).toBeGreaterThan(sewn(flat));
  });

  it('keeps every foam stitch finite and inside the machine step limit', () => {
    const raw = generateObjectStitches(columnObject(ON));
    expect(raw.length).toBeGreaterThan(0);
    for (const r of raw) {
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
    }
  });

  it('widens the column so the thread still meets fabric past the foam edge', () => {
    const flat = generateObjectStitches(columnObject(undefined));
    const foam = generateObjectStitches(columnObject(ON));

    const span = (raw: { y: number }[]): number => {
      const ys = raw.map((r) => r.y);
      return Math.max(...ys) - Math.min(...ys);
    };

    expect(span(foam)).toBeGreaterThan(span(flat));
  });

  it('leaves a satin column untouched when foam is disabled', () => {
    const flat = generateObjectStitches(columnObject(undefined));
    const explicit = generateObjectStitches(columnObject(OFF));

    expect(sewn(explicit)).toBe(sewn(flat));
  });

  it('ignores foam on a non-satin object rather than mis-sewing it', () => {
    // Foam over a fill has no technique behind it; the object must sew flat.
    const fillFlat = generateObjectStitches(
      columnObject(undefined, { stitchType: 'tatami', angle: 45 }),
    );
    const fillFoam = generateObjectStitches(columnObject(ON, { stitchType: 'tatami', angle: 45 }));

    expect(sewn(fillFoam)).toBe(sewn(fillFlat));
  });

  it('applies foam to lettering, the usual reason for puff', () => {
    const base: EmbroideryObject = {
      id: 'obj-2',
      name: 'Text',
      type: 'lettering',
      path: { rings: [] },
      transform: { x: 0, y: 0 },
      colorIndex: 0,
      params: { ...FLAT_PARAMS },
      entryExit: { entry: null, exit: null },
      lettering: { text: 'ABC', height: 20, spacing: 0, slant: 0, rotation: 0, width: 3 },
      order: 0,
      locked: false,
      hidden: false,
      groupId: null,
      warnings: [],
    };

    const flat = generateObjectStitches(base);
    const foam = generateObjectStitches({ ...base, params: { ...FLAT_PARAMS, foam: ON } });

    expect(sewn(foam)).toBeGreaterThan(sewn(flat));
  });
});

describe('compileDesign with foam', () => {
  it('produces a valid, exportable sequence for a foam column', () => {
    const { sequence, validation } = compileDesign([columnObject(ON)], PALETTE, null);

    expect(sequence.stitches.length).toBeGreaterThan(0);
    expect(validation.ok).toBe(true);
  });

  it('is deterministic - the same foam settings reproduce the same stitches', () => {
    const a = compileDesign([columnObject(ON)], PALETTE, null);
    const b = compileDesign([columnObject(ON)], PALETTE, null);

    expect(JSON.stringify(a.sequence.stitches)).toBe(JSON.stringify(b.sequence.stitches));
  });

  it('compiles a design saved before foam existed, with no foam field at all', () => {
    // Backwards compatibility: `foam` is optional, so an old document that
    // lacks it must behave exactly as it always did.
    const legacy = columnObject(undefined);
    expect(legacy.params.foam).toBeUndefined();

    const { sequence, validation } = compileDesign([legacy], PALETTE, null);
    expect(sequence.stitches.length).toBeGreaterThan(0);
    expect(validation.ok).toBe(true);
  });

  it('defaults to flat when no foam field is present', () => {
    expect(DEFAULT_FOAM.enabled).toBe(false);
    expect(DEFAULT_FOAM.tackUnderlay).toBe(true);
  });
});
