import { describe, expect, it } from 'vitest';
import {
  CLIPART_CATEGORIES,
  FONT_LIBRARY,
  buildPrintSheet,
  capPreviewPoint,
  capWrapProblem,
  clipartById,
  compileDesign,
  compensateCapPoint,
  designToPdf,
  designToSvg,
  generateObjectStitches,
  layoutText,
  machineNumbers,
  measureText,
  placeClipart,
  searchClipart,
  splitObjectsByMachine,
  spreadAcrossMachines,
  type EmbroideryObject,
  type Hoop,
  type Stitch,
  type StitchParameters,
  type StitchType,
  type ThreadColor,
} from './index.js';

const PALETTE: ThreadColor[] = [
  { id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' },
  { id: 'c2', code: '1002', name: 'Navy', hex: '#003DA5' },
];

const PARAMS: StitchParameters = {
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

const HOOP: Hoop = {
  id: 'h1',
  name: '180 x 130',
  width: 180,
  height: 130,
  shape: 'rect',
  safeMargin: 5,
};

function square(id = 'obj', stitchType: StitchType = 'tatami', machine = 1): EmbroideryObject {
  return {
    id,
    name: id,
    type: 'fill',
    path: {
      rings: [
        [
          { x: 30, y: 30 },
          { x: 70, y: 30 },
          { x: 70, y: 70 },
          { x: 30, y: 70 },
        ],
      ],
    },
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: { ...PARAMS, stitchType },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    machine,
    warnings: [],
  };
}

function stitches(): Stitch[] {
  return [
    { x: 10, y: 10, command: 'stitch', colorIndex: 0, objectId: 'a', sequence: 0 },
    { x: 30, y: 10, command: 'stitch', colorIndex: 0, objectId: 'a', sequence: 1 },
    { x: 35, y: 10, command: 'jump', colorIndex: 0, objectId: null, sequence: 2 },
    { x: 40, y: 10, command: 'stitch', colorIndex: 1, objectId: 'b', sequence: 3 },
    { x: 50, y: 20, command: 'stitch', colorIndex: 1, objectId: 'b', sequence: 4 },
    { x: 50, y: 20, command: 'end', colorIndex: 1, objectId: null, sequence: 5 },
  ];
}

const LETTERING = { height: 10, spacing: 0, slant: 0, rotation: 0, width: 1, origin: { x: 0, y: 0 } };

describe('original font family', () => {
  it('ships six distinct cuts with stable ids', () => {
    expect(FONT_LIBRARY.map((f) => f.id)).toEqual([
      'studio',
      'rounded',
      'block',
      'script',
      'serif',
      'mono',
    ]);
    expect(new Set(FONT_LIBRARY.map((f) => f.name)).size).toBe(6);
  });

  it('changes the skeleton rather than merely the name', () => {
    const shapes = FONT_LIBRARY.map((font) =>
      JSON.stringify(layoutText('S', { ...LETTERING, font: font.id }).strokes),
    );
    expect(new Set(shapes).size).toBeGreaterThan(3);
  });

  it('keeps absent font identical to Studio Sans for old projects', () => {
    const legacy = layoutText('ABC', LETTERING);
    const explicit = layoutText('ABC', { ...LETTERING, font: 'studio' });
    expect(explicit.strokes).toEqual(legacy.strokes);
    expect(measureText('ABC', LETTERING)).toBe(measureText('ABC', { ...LETTERING, font: 'studio' }));
  });

  it('uses family tracking in the measured advance', () => {
    expect(measureText('WORD', { ...LETTERING, font: 'script' })).not.toBe(
      measureText('WORD', { ...LETTERING, font: 'studio' }),
    );
  });
});

describe('clipart catalogue', () => {
  it('has searchable categories and an original built-in catalogue', () => {
    expect(CLIPART_CATEGORIES.length).toBeGreaterThan(3);
    expect(searchClipart('star').length).toBeGreaterThan(0);
    const nature = searchClipart('', 'Nature');
    expect(nature.length).toBeGreaterThan(3);
    expect(nature.every((entry) => entry.category === 'Nature')).toBe(true);
  });

  it('preserves aspect ratio and centres the placed shape', () => {
    const placed = placeClipart('star', { widthMm: 80, heightMm: 20, center: { x: 50, y: 60 } });
    expect(placed).not.toBeNull();
    expect(placed!.widthMm).toBeLessThanOrEqual(80.001);
    expect(placed!.heightMm).toBeLessThanOrEqual(20.001);
    expect(placed!.widthMm / placed!.heightMm).toBeGreaterThan(1);
    expect(placed!.center).toEqual({ x: 50, y: 60 });
    const xs = placed!.rings.flatMap((ring) => ring.map((p) => p.x));
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(50, 3);
  });

  it('cuts holes with an inner ring, as the moon demonstrates', () => {
    expect(clipartById('moon')!.rings).toHaveLength(2);
    expect(clipartById('missing')).toBeNull();
  });
});

describe('artwork export', () => {
  it('writes a millimetre SVG with thread groups', () => {
    const svg = designToSvg({ stitches: stitches(), palette: PALETTE, title: 'Proof <A>' });
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('width="');
    expect(svg).toContain('mm"');
    expect(svg).toContain('<g class="thread"');
    expect(svg).toContain('#C8102E');
    expect(svg).toContain('Proof &lt;A&gt;');
  });

  it('includes the full hoop in the artwork extent when requested', () => {
    const hoop: Hoop = {
      id: 'large',
      name: 'Large',
      width: 500,
      height: 400,
      shape: 'rect',
      safeMargin: 5,
    };
    const svg = designToSvg({
      stitches: stitches(),
      palette: PALETTE,
      hoop,
      includeHoop: true,
    });
    expect(svg).toContain('width="500" height="400"');
  });

  it('writes a valid PDF header and trailer', () => {
    const bytes = designToPdf({ stitches: stitches(), palette: PALETTE, title: 'Proof' });
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('tiles a 1:1 placement sheet and adds a legend page', () => {
    const { bytes, summary } = buildPrintSheet({
      stitches: stitches(),
      palette: PALETTE,
      title: 'Placement',
      scale: '1:1',
      includeLegend: true,
      paper: 'a4',
    });
    expect(bytes.length).toBeGreaterThan(500);
    expect(summary.pages).toBeGreaterThanOrEqual(2);
    expect(summary.columns).toBe(1);
    expect(summary.rows).toBe(1);
    expect(new TextDecoder().decode(bytes)).toContain('Thread legend');
  });
});

describe('cap-frame wrap', () => {
  it('round-trips preview and driver compensation', () => {
    const settings = { enabled: true, radiusMm: 90, compensate: true };
    const transform = { settings, centerX: 90 };
    for (const x of [20, 55, 90, 120, 160]) {
      const compensated = compensateCapPoint({ x, y: 40 }, transform);
      const projected = capPreviewPoint(compensated, transform);
      expect(projected.x).toBeCloseTo(x, 5);
      expect(projected.y).toBe(40);
    }
  });

  it('stretches the machine coordinates toward the cap edges', () => {
    const settings = { enabled: true, radiusMm: 90, compensate: true };
    const transform = { settings, centerX: 90 };
    expect(compensateCapPoint({ x: 150, y: 0 }, transform).x).toBeGreaterThan(150);
    expect(compensateCapPoint({ x: 30, y: 0 }, transform).x).toBeLessThan(30);
    expect(compensateCapPoint({ x: 90, y: 0 }, transform).x).toBe(90);
  });

  it('refuses a design wider than the crown can wrap', () => {
    expect(capWrapProblem({ enabled: true, radiusMm: 90, compensate: true }, 170)).toBeNull();
    expect(capWrapProblem({ enabled: true, radiusMm: 90, compensate: true }, 200)).toMatch(/wider|crown/i);
  });

  it('reports an invalid cap setup through compile validation', () => {
    const { validation } = compileDesign([square()], PALETTE, HOOP, {
      capWrap: { enabled: true, radiusMm: 30, compensate: true },
    });
    expect(validation.issues.some((issue) => issue.code === 'CAP_WRAP_INVALID')).toBe(true);
  });

  it('checks both edges against the crown, not only the total width', () => {
    const settings = { enabled: true, radiusMm: 90, compensate: true };
    expect(
      capWrapProblem(settings, 40, { minX: 130, maxX: 190, centerX: 90 }),
    ).toMatch(/crown|wide/i);
    expect(
      capWrapProblem(settings, 40, { minX: 70, maxX: 110, centerX: 90 }),
    ).toBeNull();

    const offCentre = square();
    offCentre.path.rings = offCentre.path.rings.map((ring) =>
      ring.map((point) => ({ ...point, x: point.x + 120 })),
    );
    const { validation } = compileDesign([offCentre], PALETTE, HOOP, { capWrap: settings });
    expect(validation.issues.some((issue) => issue.code === 'CAP_WRAP_INVALID')).toBe(true);
  });
});

describe('multi-machine assignment', () => {
  it('groups objects by assigned machine in numeric order', () => {
    const groups = splitObjectsByMachine([square('a', 'tatami', 3), square('b', 'tatami', 1), square('c', 'tatami', 3)]);
    expect([...groups.keys()]).toEqual([1, 3]);
    expect(groups.get(3)!.map((o) => o.id)).toEqual(['a', 'c']);
    expect(machineNumbers([...groups.values()].flat())).toEqual([1, 3]);
  });

  it('spreads a selection without exceeding the object count', () => {
    const objects = [square('a'), square('b'), square('c')];
    expect(spreadAcrossMachines(objects).map((o) => o.machine)).toEqual([1, 2, 3]);
  });
});

describe('specialty stitch simulations', () => {
  for (const style of ['sequin', 'beading', 'chenille', 'schiffli'] as const) {
    it(`produces standard penetrations for ${style}`, () => {
      const raw = generateObjectStitches(square('s', style));
      expect(raw.length).toBeGreaterThan(20);
      expect(raw.some((stitch) => stitch.command === 'stitch')).toBe(true);
      expect(raw.every((stitch) => stitch.command === 'stitch' || stitch.command === 'jump')).toBe(true);
    });
  }

  it('reports that specialty stitches are a simulation', () => {
    const { sequence, validation } = compileDesign([square('s', 'sequin')], PALETTE, HOOP);
    expect(sequence.stitches.length).toBeGreaterThan(20);
    expect(validation.issues.some((issue) => issue.code === 'SPECIALTY_SIMULATION')).toBe(true);
  });
});
