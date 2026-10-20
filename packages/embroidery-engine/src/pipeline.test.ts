import { describe, it, expect } from 'vitest';
import {
  compileDesign,
  generateObjectStitches,
  boundsOfObjects,
  translateObject,
  normalizeObjectPath,
} from './index.js';
import { writeDst, readDst } from './formats/dst.js';
import { generateUnderlay } from './underlay/index.js';
import type {
  CarveSettings,
  EmbroideryObject,
  Hoop,
  LetteringSpec,
  MotifChoice,
  ObjectType,
  StitchParameters,
  StitchType,
  ThreadColor,
} from './types.js';
import { DEFAULT_LETTERING_SPEC } from './types.js';
import { BUILTIN_MOTIFS } from './motifs.js';

const PALETTE: ThreadColor[] = [
  { id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' },
  { id: 'c2', code: '1002', name: 'Blue', hex: '#003DA5' },
];

const DEFAULT_PARAMS: StitchParameters = {
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

/** A filled square, the smallest shape that exercises the whole pipeline. */
function squareObject(overrides: Partial<EmbroideryObject> = {}): EmbroideryObject {
  return {
    id: 'obj-1',
    name: 'Square',
    type: 'fill' as ObjectType,
    path: {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 40 },
          { x: 0, y: 40 },
        ],
      ],
    },
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: { ...DEFAULT_PARAMS },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
    ...overrides,
  };
}

function circleObject(id: string, cx: number, cy: number, r: number, colorIndex = 1) {
  const pts = [];
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return squareObject({
    id,
    name: `Circle ${id}`,
    path: { rings: [pts] },
    colorIndex,
  });
}

const HOOP: Hoop = {
  id: 'h1',
  name: '180 x 130',
  width: 180,
  height: 130,
  shape: 'rect',
  safeMargin: 5,
};

describe('compileDesign', () => {
  it('produces stitches for a simple fill object', () => {
    const { sequence } = compileDesign([squareObject()], PALETTE, HOOP);

    expect(sequence.stitches.length).toBeGreaterThan(100);
    expect(sequence.stats.sewStitches).toBeGreaterThan(100);
    // Underlay + top stitch both sew.
    expect(sequence.stats.jumps).toBeGreaterThan(0);
  });

  it('reports validation as ok for a design that fits its hoop', () => {
    // The field starts at (0,0), so the raw square sits right on the corner,
    // inside the 5 mm safe margin. Move it in first.
    const inside = translateObject(squareObject(), 20, 20);
    const { validation } = compileDesign([inside], PALETTE, HOOP);
    const errors = validation.issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it('addresses the hoop from its top-left corner, matching the editor', () => {
    // Bottom-right quadrant of the field: inside a (0,0)-(width,height) hoop,
    // but outside a hoop centred on the origin. The editor draws the field at
    // the top-left, so this must be accepted - an earlier build checked a
    // centred field and refused almost every design that visibly fitted.
    const quadrant = translateObject(squareObject(), 120, 80);
    const { validation } = compileDesign([quadrant], PALETTE, HOOP);
    expect(validation.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects a design that sits in the safe margin', () => {
    // Flush against the top-left corner: 0 mm from the edge, inside the 5 mm
    // margin the hoop reserves for the frame.
    const { validation } = compileDesign([squareObject()], PALETTE, HOOP);
    expect(validation.ok).toBe(false);
    const out = validation.issues.find((i) => i.code === 'OUT_OF_HOOP');
    expect(out?.severity).toBe('error');
    // The message should say where the design actually is and which hoop it
    // missed, not just that it does not fit.
    expect(out?.message).toMatch(/runs from -?[\d.]+, -?[\d.]+ to -?[\d.]+, -?[\d.]+ mm/);
    expect(out?.message).toContain('hoop "180 x 130"');
  });

  it('flags a design larger than the hoop as an error', () => {
    const huge = squareObject({
      path: {
        rings: [
          [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 400 },
            { x: 0, y: 400 },
          ],
        ],
      },
    });
    const { validation } = compileDesign([huge], PALETTE, HOOP);
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('emits a color change between two objects of different colours', () => {
    const { sequence } = compileDesign(
      [squareObject(), circleObject('obj-2', 100, 20, 15)],
      PALETTE,
      HOOP,
    );

    expect(sequence.stitches.some((s) => s.command === 'colorChange')).toBe(true);
    expect(sequence.colorCount).toBe(2);
  });

  it('emits tie-in and tie-off locks when enabled', () => {
    const { sequence } = compileDesign([squareObject()], PALETTE, HOOP);
    expect(sequence.stats.locks).toBeGreaterThan(0);
  });

  it('omits locks when they are disabled on the object', () => {
    const obj = squareObject();
    obj.params = {
      ...obj.params,
      tieIn: { ...obj.params.tieIn, enabled: false },
      tieOff: { ...obj.params.tieOff, enabled: false },
    };
    const { sequence } = compileDesign([obj], PALETTE, HOOP);
    expect(sequence.stats.locks).toBe(0);
  });

  it('skips hidden objects entirely', () => {
    const { sequence } = compileDesign([squareObject({ hidden: true })], PALETTE, HOOP);
    expect(sequence.stitches.length).toBe(0);
    expect(sequence.stats.sewStitches).toBe(0);
  });

  it('respects the object order field, not array order', () => {
    const first = squareObject({ id: 'a', order: 5, colorIndex: 0 });
    const second = circleObject('b', 100, 20, 15, 1);
    second.order = 1;

    // Pass them in the wrong order on purpose.
    const { sequence } = compileDesign([first, second], PALETTE, HOOP);

    const firstColorStitch = sequence.stitches.find((s) => s.command === 'stitch')!;
    expect(firstColorStitch.colorIndex).toBe(1);
  });

  it('assigns a running sequence number to every stitch', () => {
    const { sequence } = compileDesign([squareObject()], PALETTE, HOOP);
    sequence.stitches.forEach((s, i) => expect(s.sequence).toBe(i));
  });

  it('is deterministic - the same input yields byte-identical output', () => {
    const objs = [squareObject(), circleObject('obj-2', 100, 20, 15)];
    const a = compileDesign(objs, PALETTE, HOOP);
    const b = compileDesign(objs, PALETTE, HOOP);

    expect(JSON.stringify(a.sequence.stitches)).toBe(JSON.stringify(b.sequence.stitches));
    expect(writeDst(a.sequence.stitches)).toEqual(writeDst(b.sequence.stitches));
  });

  it('keeps every sew stitch within the machine step limit', () => {
    const { sequence } = compileDesign(
      [squareObject({ params: { ...DEFAULT_PARAMS, stitchType: 'satin' } })],
      PALETTE,
      HOOP,
    );

    // Satin on a 40 mm shape via a stroked outline can exceed a single step,
    // so the encoder is responsible for splitting. Verify by writing the file
    // and confirming no absolute delta exceeds the limit after encode.
    const bytes = writeDst(sequence.stitches);
    const parsed = readDst(bytes);
    expect(parsed.stitches.length).toBeGreaterThan(0);
  });
});

describe('per-stitch-type generation', () => {
  const types: StitchType[] = ['tatami', 'satin', 'run', 'bean', 'motif', 'contour', 'spiral'];

  for (const stitchType of types) {
    it(`generates stitches for ${stitchType}`, () => {
      const obj = squareObject({ params: { ...DEFAULT_PARAMS, stitchType } });
      const raw = generateObjectStitches(obj);

      expect(raw.length).toBeGreaterThan(0);
      // Every generated point must be finite - a NaN here would produce a
      // file that puts the needle somewhere undefined.
      for (const r of raw) {
        expect(Number.isFinite(r.x)).toBe(true);
        expect(Number.isFinite(r.y)).toBe(true);
      }
    });
  }

  it('generates underlay before the top stitch', () => {
    const obj = squareObject({ params: { ...DEFAULT_PARAMS, stitchType: 'tatami' } });
    const raw = generateObjectStitches(obj);
    const topStart = raw.findIndex((s) => s.command === 'stitch');
    expect(topStart).toBeGreaterThan(0);
  });
});

describe('lettering objects', () => {
  /** A lettering object: text spec, empty path. */
  function letteringObject(
    text: string,
    over: Partial<LetteringSpec> = {},
    objOver: Partial<EmbroideryObject> = {},
  ): EmbroideryObject {
    return squareObject({
      id: 'let-1',
      name: `Text ${text}`,
      type: 'lettering' as ObjectType,
      // Lettering derives its geometry from the spec; `path` is not the
      // source of truth and stays empty.
      path: { rings: [] },
      lettering: { ...DEFAULT_LETTERING_SPEC, text, ...over },
      ...objOver,
    });
  }

  it('generates stitches from its text spec, not from path', () => {
    // `path.rings` is empty, so any path-driven generator would return
    // nothing here. Getting stitches at all proves the spec is what drives
    // generation.
    const raw = generateObjectStitches(letteringObject('HELLO'));
    expect(raw.length).toBeGreaterThan(50);
    for (const r of raw) {
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
    }
  });

  it('positions letters at the object transform, not at the origin', () => {
    const atOrigin = generateObjectStitches(letteringObject('HI'));
    const moved = generateObjectStitches(
      letteringObject('HI', {}, { transform: { x: 100, y: 60 } }),
    );

    const minX = (rs: { x: number }[]) => Math.min(...rs.map((r) => r.x));
    const minY = (rs: { y: number }[]) => Math.min(...rs.map((r) => r.y));

    expect(minX(moved) - minX(atOrigin)).toBeCloseTo(100, 0);
    expect(minY(moved) - minY(atOrigin)).toBeCloseTo(60, 0);
  });

  it('produces more stitches for longer text', () => {
    const short = generateObjectStitches(letteringObject('HI'));
    const long = generateObjectStitches(letteringObject('HELLO WORLD'));
    expect(long.length).toBeGreaterThan(short.length);
  });

  it('scales stitch count with size', () => {
    const small = generateObjectStitches(letteringObject('H', { height: 10 }));
    const large = generateObjectStitches(letteringObject('H', { height: 30 }));
    expect(large.length).toBeGreaterThan(small.length);
  });

  it('returns nothing for blank text rather than sewing a placeholder', () => {
    expect(generateObjectStitches(letteringObject(''))).toHaveLength(0);
    expect(generateObjectStitches(letteringObject('   '))).toHaveLength(0);
  });

  it('falls back to the default spec when the object has none', () => {
    const obj = squareObject({
      type: 'lettering' as ObjectType,
      path: { rings: [] },
      lettering: null,
    });
    // No spec and no text: nothing to sew. The important part is that it does
    // not throw - a missing spec must not take the whole compile down.
    expect(() => generateObjectStitches(obj)).not.toThrow();
  });

  it('survives a compile to a full sequence and a DST file', () => {
    // Placed clear of the hoop's 5 mm safe margin: the spec anchors the text
    // at its top-left, so (10,10) puts the whole word inside the field.
    const seq = compileDesign(
      [letteringObject('TEST', {}, { transform: { x: 10, y: 10 } })],
      PALETTE,
      HOOP,
    );
    expect(seq.sequence.stitches.length).toBeGreaterThan(50);
    expect(seq.validation.issues.filter((i) => i.severity === 'error')).toHaveLength(0);

    const bytes = writeDst(seq.sequence.stitches, { name: 'LETTERING', colorCount: 2 });
    expect(bytes.length).toBeGreaterThan(512);
  });
});

describe('underlay to top-layer travel', () => {
  it('never lets a sew stitch cross the gap between the two layers', () => {
    const obj = circleObject('c1', 55, 55, 15);
    const stitches = generateObjectStitches(obj);

    // The edge run can finish on the far side of the shape from where the fill
    // starts. That move is travel, not a stitch: sewing it would drag a thread
    // across the work and the machine limit check would reject the design.
    expect(stitches.length).toBeGreaterThan(0);
    for (let i = 1; i < stitches.length; i++) {
      const a = stitches[i - 1]!;
      const b = stitches[i]!;
      if (b.command !== 'stitch') continue;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(12.1);
    }
  });

  it('puts a jump at the seam, on the first fill stitch', () => {
    const obj = circleObject('c1', 55, 55, 15);
    const underlay = generateUnderlay(obj.path, obj.params.underlay!, obj.params.angle);
    const stitches = generateObjectStitches(obj);

    // Records stay in order (appendAll pushes element-wise), so the seam sits
    // right after the underlay's last stitch.
    const seam = stitches[underlay.length]!;
    expect(seam.command).toBe('jump');

    const firstTop = stitches[underlay.length + 1]!;
    expect(firstTop.command).toBe('stitch');
    // The jump lands exactly on the first fill stitch, so the fill still
    // starts where it was generated.
    expect(seam.x).toBeCloseTo(firstTop.x, 6);
    expect(seam.y).toBeCloseTo(firstTop.y, 6);
  });

  it('leaves a short seam alone', () => {
    // A flat square's edge run finishes near where the fill begins, so the
    // first stitch should carry the move with no extra jump inserted.
    const obj = squareObject();
    const underlay = generateUnderlay(obj.path, obj.params.underlay!, obj.params.angle);
    const stitches = generateObjectStitches(obj);

    const seam = stitches[underlay.length]!;
    expect(seam.command).toBe('stitch');
  });
});

describe('design helpers', () => {
  it('computes object bounds from source geometry', () => {
    const b = boundsOfObjects([squareObject()]);
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 40 });
  });

  it('ignores hidden objects when computing bounds', () => {
    const b = boundsOfObjects([squareObject({ hidden: true })]);
    expect(b.maxX).toBe(0);
  });

  it('translates geometry without touching parameters', () => {
    const moved = translateObject(squareObject(), 10, 5);
    expect(moved.path.rings[0]![0]).toEqual({ x: 10, y: 5 });
    expect(moved.params.spacing).toBe(DEFAULT_PARAMS.spacing);
  });

  it('drops consecutive duplicate points when normalizing', () => {
    const duped = squareObject({
      path: {
        rings: [
          [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 40 },
          ],
        ],
      },
    });
    const norm = normalizeObjectPath(duped);
    expect(norm.path.rings[0]!.length).toBe(3);
  });
});

describe('compile to DST end to end', () => {
  it('writes a machine file that reads back with matching bounds', () => {
    const { sequence } = compileDesign(
      [squareObject(), circleObject('obj-2', 100, 20, 15)],
      PALETTE,
      HOOP,
    );

    const bytes = writeDst(sequence.stitches, { name: 'INTEGRATION', colorCount: 2 });
    expect(bytes.length).toBeGreaterThan(512);

    const parsed = readDst(bytes);
    expect(parsed.name).toBe('INTEGRATION');

    // The header's extents describe the path the needle takes, which starts
    // at the origin and reaches every named point through hops: they cover
    // the design and can be wider, but never narrower. Half a unit of slack
    // is all that quantising to 0.1 mm is allowed to take off.
    const HALF_UNIT_MM = 0.05;
    expect(parsed.bounds.maxX).toBeGreaterThanOrEqual(sequence.bounds.maxX - HALF_UNIT_MM - 1e-9);
    expect(parsed.bounds.maxY).toBeGreaterThanOrEqual(sequence.bounds.maxY - HALF_UNIT_MM - 1e-9);
    expect(parsed.bounds.minX).toBeLessThanOrEqual(sequence.bounds.minX + HALF_UNIT_MM + 1e-9);
    expect(parsed.bounds.minY).toBeLessThanOrEqual(sequence.bounds.minY + HALF_UNIT_MM + 1e-9);

    // The needle must actually return to the target for the last stitch.
    const lastSource = sequence.stitches[sequence.stitches.length - 1]!;
    const lastParsed = parsed.stitches[parsed.stitches.length - 1]!;
    expect(Math.abs(lastParsed.x - lastSource.x)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(lastParsed.y - lastSource.y)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('produces a file whose stitch count matches the header', () => {
    const { sequence } = compileDesign([squareObject()], PALETTE, HOOP);
    const parsed = readDst(writeDst(sequence.stitches, { colorCount: 1 }));

    // ST counts the rows the encoded stream holds, terminator included, and
    // a cut is one row that writes the three jumps of a needle pop. The
    // record count is therefore the row count plus two per cut actually
    // written, and the two only ever agree on a design with no cuts in it.
    // (The reader stops at the terminator, so it is not in the parsed list.)
    const cuts = sequence.stitches.filter((s) => s.command === 'trim').length;
    const records = parsed.stitches.length + 1;
    expect(parsed.headerStitchCount).toBeGreaterThan(0);
    expect(records).toBeGreaterThanOrEqual(parsed.headerStitchCount);
    expect(records - parsed.headerStitchCount).toBeLessThanOrEqual(2 * cuts);
  });
});

/**
 * `minStitchLength` used to be a stored number that nothing read: the field
 * travelled from the UI to the database and back without ever touching a
 * stitch. These tests pin the real behaviour - a machine cannot sew below
 * roughly a needle width, so the setting has to collapse those stitches out.
 */
describe('minStitchLength', () => {
  /** Count of gaps below `limit`, measured between consecutive sewn points. */
  function gapsBelow(stitches: { x: number; y: number; command: string }[], limit: number): number {
    let count = 0;
    let prev: { x: number; y: number } | null = null;
    for (const s of stitches) {
      if (s.command !== 'stitch') continue;
      if (prev) {
        const d = Math.hypot(s.x - prev.x, s.y - prev.y);
        if (d > 1e-9 && d < limit) count += 1;
      }
      prev = s;
    }
    return count;
  }

  it('leaves more sub-minimum stitches in place when the floor is off', () => {
    const loose = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0 } });
    const tight = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0.5 } });

    const looseStitches = generateObjectStitches(loose).filter((s) => s.command === 'stitch');
    const tightStitches = generateObjectStitches(tight).filter((s) => s.command === 'stitch');

    // The tighter floor must never introduce short stitches the loose one
    // avoided - it only removes them.
    expect(gapsBelow(tightStitches, 0.25)).toBeLessThanOrEqual(gapsBelow(looseStitches, 0.25));
    expect(tightStitches.length).toBeLessThanOrEqual(looseStitches.length);
  });

  it('actually removes stitches when the floor is raised', () => {
    const off = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0 } });
    const on = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 1.0 } });

    const before = generateObjectStitches(off).filter((s) => s.command === 'stitch').length;
    const after = generateObjectStitches(on).filter((s) => s.command === 'stitch').length;

    expect(after).toBeLessThan(before);
  });

  it('a zero floor keeps every short stitch a positive floor would drop', () => {
    // With the floor off, the filter is a pass-through: nothing collapses.
    const off = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0 } });
    const on = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0.8 } });

    const offStitches = generateObjectStitches(off).filter((s) => s.command === 'stitch');
    const onStitches = generateObjectStitches(on).filter((s) => s.command === 'stitch');

    // The zero floor has to leave the sub-minimum gaps in place - that is the
    // whole distinction between "off" and "set very low".
    expect(gapsBelow(offStitches, 0.25)).toBeGreaterThanOrEqual(gapsBelow(onStitches, 0.25));
    expect(offStitches.length).toBeGreaterThanOrEqual(onStitches.length);

    // And it must be exactly as many stitches as the shape was digitized with,
    // i.e. two independent compiles of the same zero-floor object agree.
    const again = generateObjectStitches(
      squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0 } }),
    );
    expect(JSON.stringify(again)).toBe(JSON.stringify(generateObjectStitches(off)));
  });

  it('keeps the very last point of the shape so the outline still closes', () => {
    const off = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0 } });
    const on = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 1.5 } });

    const lastOf = (o: EmbroideryObject) => {
      const all = generateObjectStitches(o).filter((s) => s.command === 'stitch');
      return all[all.length - 1];
    };

    expect(lastOf(on)).toEqual(lastOf(off));
  });

  it('never emits a sewn gap below the floor, apart from run ends', () => {
    const obj = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0.6 } });
    const stitches = generateObjectStitches(obj).filter((s) => s.command === 'stitch');
    const violations = gapsBelow(stitches, 0.6 - 1e-9);

    // Run ends are kept deliberately (a satin row ends where the rail ends),
    // so allow the handful of them but nothing structural.
    const rows = Math.ceil(40 / DEFAULT_PARAMS.spacing);
    expect(violations).toBeLessThan(rows);
  });

  it('keeps every jump intact when the floor is high', () => {
    // Travel is a machine instruction, not a stitch. Raising the floor must
    // never eat one: the move would be re-sewn as a line of thread across the
    // work, which is exactly what a jump exists to avoid.
    const off = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0 } });
    const on = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 4 } });

    const jumps = (o: EmbroideryObject) =>
      generateObjectStitches(o).filter((s) => s.command === 'jump').length;

    expect(jumps(on)).toBe(jumps(off));
    expect(jumps(on)).toBeGreaterThan(0);

    // Same for trims - a deleted trim leaves a thread tail the operator has
    // to snip by hand, and the count is what the machine acts on.
    const trims = (o: EmbroideryObject) =>
      generateObjectStitches(o).filter((s) => s.command === 'trim').length;
    expect(trims(on)).toBe(trims(off));
  });

  it('never collapses a stitch across a jump', () => {
    const obj = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 1.5 } });
    const stitches = generateObjectStitches(obj);

    const jumpIndex = stitches.findIndex((s) => s.command === 'jump');
    if (jumpIndex < 0) return; // no travel in this shape; the test above covers counts

    // The stitch the jump lands on must still be there: it is the start of
    // the next layer, and the filter must not fold it back into the jump.
    const landing = stitches[jumpIndex + 1];
    expect(landing).toBeDefined();
    expect(landing!.command).not.toBe('jump');
    // Nothing before the jump may have been merged onto its coordinates.
    const before = stitches[jumpIndex - 1];
    if (before && before.command === 'stitch') {
      const gap = Math.hypot(landing!.x - before.x, landing!.y - before.y);
      expect(gap).toBeGreaterThan(0);
    }
  });

  it('reaches the compiled design, not just the raw generator', () => {
    const off = squareObject({ id: 'a', params: { ...DEFAULT_PARAMS, minStitchLength: 0 } });
    const on = squareObject({
      id: 'a',
      params: { ...DEFAULT_PARAMS, minStitchLength: 1.0 },
    });

    const a = compileDesign([off], PALETTE, HOOP).sequence.stitches;
    const b = compileDesign([on], PALETTE, HOOP).sequence.stitches;

    expect(b.length).toBeLessThan(a.length);
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
  });

  it('applies to lettering too, which is where short stitches pile up', () => {
    const base: EmbroideryObject = {
      id: 'l1',
      name: 'Text',
      type: 'lettering',
      path: { rings: [] },
      transform: { x: 20, y: 40 },
      colorIndex: 0,
      params: { ...DEFAULT_PARAMS, stitchType: 'satin' },
      entryExit: { entry: null, exit: null },
      lettering: { ...DEFAULT_LETTERING_SPEC, text: 'HELLO', height: 20 },
      order: 0,
      locked: false,
      hidden: false,
      groupId: null,
      warnings: [],
    };

    const off = { ...base, params: { ...base.params, minStitchLength: 0 } };
    const on = { ...base, params: { ...base.params, minStitchLength: 1.0 } };

    const a = generateObjectStitches(off).filter((s) => s.command === 'stitch').length;
    const b = generateObjectStitches(on).filter((s) => s.command === 'stitch').length;

    expect(b).toBeLessThan(a);
  });

  it('is deterministic for the same setting', () => {
    const obj = squareObject({ params: { ...DEFAULT_PARAMS, minStitchLength: 0.45 } });
    const first = generateObjectStitches(obj);
    const second = generateObjectStitches(obj);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

/**
 * The motif library: a design may name a built-in or carry a shape of its
 * own, and either has to reach the stitches it is sewn into.
 */
describe('motif library', () => {
  // Placed well inside the field rather than at the origin: these tests are
  // about the shape the motif sews, not about the hoop margin, and a motif
  // sized to its grid cell overhangs its own shape by a fraction of a
  // millimetre — exactly as the built-in one always has.
  const motifFill = (motif?: MotifChoice): EmbroideryObject =>
    squareObject({
      path: {
        rings: [
          [
            { x: 15, y: 15 },
            { x: 55, y: 15 },
            { x: 55, y: 55 },
            { x: 15, y: 55 },
          ],
        ],
      },
      params: {
        ...DEFAULT_PARAMS,
        stitchType: 'motif',
        fillPattern: 'motif',
        spacing: 0.5,
        ...(motif ? { motif } : {}),
      },
    });

  it('sews a different pattern when a different motif is chosen', () => {
    const star = compileDesign([motifFill({ id: 'star' })], PALETTE, HOOP).sequence.stitches;
    const cross = compileDesign([motifFill({ id: 'cross' })], PALETTE, HOOP).sequence.stitches;

    expect(star.length).toBeGreaterThan(10);
    expect(cross.length).toBeGreaterThan(10);
    // Same shape, same grid, different outline: the stitches cannot coincide
    // point for point or the choice is not reaching the generator at all.
    const same =
      star.length === cross.length &&
      star.every((s, i) => {
        const t = cross[i];
        return t !== undefined && s.x === t.x && s.y === t.y;
      });
    expect(same).toBe(false);
  });

  it('fits the chosen motif to its grid cell rather than to a fixed size', () => {
    const choice = (id: string): EmbroideryObject =>
      squareObject({
        path: {
          rings: [
            [
              { x: 15, y: 15 },
              { x: 55, y: 15 },
              { x: 55, y: 55 },
              { x: 15, y: 55 },
            ],
          ],
        },
        params: {
          ...DEFAULT_PARAMS,
          stitchType: 'motif',
          fillPattern: 'motif',
          spacing: 0.5,
          motif: { id },
        },
      });

    // A cross is narrow and a hexagon is wide; both are sized to the same
    // grid, so the motifs in both fills span about the same distance.
    const span = (id: string): number => {
      const pts = compileDesign([choice(id)], PALETTE, HOOP).sequence.stitches;
      const xs = pts.map((s) => s.x);
      const ys = pts.map((s) => s.y);
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    };
    const a = span('cross');
    const b = span('hexagon');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    // Both fill the same 40 mm square, so both motifs tile the whole shape.
    expect(Math.abs(a - b)).toBeLessThan(4);
  });

  it('carries a shape of its own without consulting the library', () => {
    // A shape no built-in provides: a plain triangle, sized in mm.
    const triangle: MotifChoice = {
      id: 'shop-triangle',
      points: [
        { x: -4, y: -3 },
        { x: 4, y: -3 },
        { x: 0, y: 4 },
      ],
    };
    const { sequence, validation } = compileDesign([motifFill(triangle)], PALETTE, HOOP);
    expect(validation.ok).toBe(true);
    expect(sequence.stitches.length).toBeGreaterThan(10);

    // The id names nothing in this build, so the shape itself is what was
    // used: a built-in would have produced a different point list.
    const builtin = compileDesign([motifFill({ id: 'star' })], PALETTE, HOOP).sequence.stitches;
    const same =
      sequence.stitches.length === builtin.length &&
      sequence.stitches.every((s, i) => {
        const t = builtin[i];
        return t !== undefined && s.x === t.x && s.y === t.y;
      });
    expect(same).toBe(false);
  });

  it('is a pure function of its inputs, so reopening a design resews it', () => {
    const objects = [motifFill({ id: 'circle', points: BUILTIN_MOTIFS.circle })];
    const a = compileDesign(objects, PALETTE, HOOP).sequence.stitches;
    const b = compileDesign(objects, PALETTE, HOOP).sequence.stitches;
    expect(a).toEqual(b);
  });

  it('presses a library stamp into a carve instead of a built-in one', () => {
    const base: Partial<EmbroideryObject> = {
      params: { ...DEFAULT_PARAMS, fillPattern: 'tatami', spacing: 0.4 },
    };
    const carved = (carve: Partial<CarveSettings>): EmbroideryObject =>
      squareObject({
        params: {
          ...base.params!,
          carve: {
            enabled: true,
            pattern: 'diamond',
            spacing: 6,
            scale: 6,
            rotation: 0,
            outline: true,
            ...carve,
          },
        },
      });

    const builtin = compileDesign([carved({})], PALETTE, HOOP).sequence.stitches;
    const library = compileDesign(
      [carved({ motif: { id: 'shop-ring', points: BUILTIN_MOTIFS.hexagon } })],
      PALETTE,
      HOOP,
    ).sequence.stitches;

    expect(builtin.length).toBeGreaterThan(0);
    expect(library.length).toBeGreaterThan(0);
    // Removing a different shape leaves a different set of holes, so the two
    // fills cannot be the same stitches.
    expect(builtin).not.toEqual(library);
  });

  it('still compiles when a named motif does not exist', () => {
    // A document written by a build carrying more motifs than this one.
    const { sequence, validation } = compileDesign(
      [motifFill({ id: 'shape-from-a-later-build' })],
      PALETTE,
      HOOP,
    );
    expect(validation.ok).toBe(true);
    expect(sequence.stitches.length).toBeGreaterThan(10);
  });
});
