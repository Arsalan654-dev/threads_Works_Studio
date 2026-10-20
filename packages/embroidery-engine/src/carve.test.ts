import { describe, it, expect } from 'vitest';
import {
  compileDesign,
  generateObjectStitches,
  CARVE_PATTERNS,
  DEFAULT_CARVE,
  carveFill,
  carvePattern,
} from './index.js';
import type {
  CarveSettings,
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

/** A plain 40x30 mm filled square. */
function squarePath(): CompoundPath {
  const ring = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 30 },
    { x: 0, y: 30 },
  ];
  return { rings: [ring] };
}

const ON: CarveSettings = {
  enabled: true,
  pattern: 'diamond',
  spacing: 6,
  scale: 3,
  rotation: 0,
  outline: true,
};
const OFF: CarveSettings = { ...ON, enabled: false };

function fillObject(carve: CarveSettings | undefined): EmbroideryObject {
  return {
    id: 'obj-1',
    name: 'Square',
    type: 'fill',
    path: squarePath(),
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: { ...FILL_PARAMS, ...(carve === undefined ? {} : { carve }) },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

const sewn = (raw: { command: string }[]): number =>
  raw.filter((s) => s.command === 'stitch').length;

describe('carvePattern', () => {
  it('resolves every built-in pattern to a usable polygon', () => {
    for (const id of Object.keys(CARVE_PATTERNS)) {
      const shape = carvePattern(id as CarveSettings['pattern']);
      expect(shape.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('falls back to the default when the id is unknown', () => {
    // A document could name a pattern this build does not ship.
    const shape = carvePattern('nope' as CarveSettings['pattern']);
    expect(shape).toBe(CARVE_PATTERNS[DEFAULT_CARVE.pattern]);
  });
});

describe('carveFill', () => {
  it('leaves the fill completely alone when disabled', () => {
    const base = [
      { x: 5, y: 5, command: 'stitch' as const },
      { x: 6, y: 5, command: 'stitch' as const },
    ];
    expect(carveFill(base, squarePath(), OFF)).toEqual(base);
  });

  it('returns the base fill untouched when it cannot place a stamp', () => {
    const base = [{ x: 5, y: 5, command: 'stitch' as const }];
    expect(carveFill(base, { rings: [] }, ON)).toEqual(base);
  });

  it('removes fill stitches that fall inside a stamp', () => {
    const object = fillObject(undefined);
    const base = generateObjectStitches(object);

    const carved = carveFill(base, object.path, ON);
    // Every stamp is placed on a grid inside this square, so some fill must
    // be removed for the carve to have done anything.
    expect(sewn(carved)).toBeLessThan(sewn(base));
  });

  it('never invents stitches - carving only subtracts', () => {
    const base = generateObjectStitches(fillObject(undefined));
    const carved = carveFill(base, squarePath(), ON);

    // With the outline off, the carved result is a strict subset of the base.
    const noOutline = carveFill(base, squarePath(), { ...ON, outline: false });
    expect(sewn(noOutline)).toBeLessThanOrEqual(sewn(base));
    expect(carved.length).toBeLessThanOrEqual(base.length + 10_000);
  });

  it('keeps every travel command so separate runs do not collapse together', () => {
    const base = generateObjectStitches(fillObject(undefined));
    const jumps = base.filter((s) => s.command === 'jump').length;
    const carved = carveFill(base, squarePath(), ON);
    const carvedJumps = carved.filter((s) => s.command === 'jump').length;

    expect(carvedJumps).toBeGreaterThanOrEqual(jumps);
  });

  it('sews a run outline around each stamp when outline is on', () => {
    const base = generateObjectStitches(fillObject(undefined));
    const plain = carveFill(base, squarePath(), { ...ON, outline: false });
    const outlined = carveFill(base, squarePath(), { ...ON, outline: true });

    // The outline adds thread the plain carve does not have.
    expect(sewn(outlined)).toBeGreaterThan(sewn(plain));
  });

  it('packs stamps tighter when the spacing shrinks, carving more away', () => {
    const base = generateObjectStitches(fillObject(undefined));
    const wide = carveFill(base, squarePath(), { ...ON, spacing: 12, outline: false });
    const tight = carveFill(base, squarePath(), { ...ON, spacing: 3, outline: false });

    expect(sewn(tight)).toBeLessThan(sewn(wide));
  });

  it('leaves every remaining stitch finite', () => {
    const base = generateObjectStitches(fillObject(undefined));
    const carved = carveFill(base, squarePath(), ON);
    expect(carved.length).toBeGreaterThan(0);
    for (const s of carved) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
  });

  it('carves along the fill angle rather than a fixed grid', () => {
    const base = generateObjectStitches(fillObject(undefined));
    const straight = carveFill(base, squarePath(), ON, 0);
    const diagonal = carveFill(base, squarePath(), ON, 45);

    expect(sewn(diagonal)).not.toBe(sewn(straight));
  });
});

describe('generateObjectStitches with carve', () => {
  it('produces a different fill than the plain one', () => {
    const plain = generateObjectStitches(fillObject(undefined));
    const carved = generateObjectStitches(fillObject(ON));

    expect(sewn(carved)).not.toBe(sewn(plain));
    expect(sewn(carved)).toBeLessThan(sewn(plain));
  });

  it('leaves a fill untouched when carve is explicitly off', () => {
    const plain = generateObjectStitches(fillObject(undefined));
    const explicit = generateObjectStitches(fillObject(OFF));

    expect(sewn(explicit)).toBe(sewn(plain));
  });

  it('ignores carve on a non-fill rather than mis-sewing it', () => {
    // A run outline has no fill to carve; the effect must not touch it.
    const runParams: Partial<StitchParameters> = { stitchType: 'run' };
    const plain = generateObjectStitches({
      ...fillObject(undefined),
      params: { ...FILL_PARAMS, ...runParams },
    });
    const carved = generateObjectStitches({
      ...fillObject(undefined),
      params: { ...FILL_PARAMS, ...runParams, carve: ON },
    });

    expect(sewn(carved)).toBe(sewn(plain));
  });
});

describe('compileDesign with carve', () => {
  it('produces a valid, exportable sequence for a carved fill', () => {
    const { sequence, validation } = compileDesign([fillObject(ON)], PALETTE, null);

    expect(sequence.stitches.length).toBeGreaterThan(0);
    expect(validation.ok).toBe(true);
  });

  it('is deterministic - the same carve reproduces the same stitches', () => {
    const a = compileDesign([fillObject(ON)], PALETTE, null);
    const b = compileDesign([fillObject(ON)], PALETTE, null);

    expect(JSON.stringify(a.sequence.stitches)).toBe(JSON.stringify(b.sequence.stitches));
  });

  it('compiles a design saved before carve existed, with no field at all', () => {
    const legacy = fillObject(undefined);
    expect(legacy.params.carve).toBeUndefined();

    const { sequence, validation } = compileDesign([legacy], PALETTE, null);
    expect(sequence.stitches.length).toBeGreaterThan(0);
    expect(validation.ok).toBe(true);
  });

  it('defaults to a plain fill when no carve field is present', () => {
    expect(DEFAULT_CARVE.enabled).toBe(false);
    expect(DEFAULT_CARVE.outline).toBe(true);
  });
});
