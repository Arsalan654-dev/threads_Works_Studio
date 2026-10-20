import { describe, it, expect } from 'vitest';
import {
  MultiHoopError,
  SPLIT_PADDING,
  boundsOfStitches,
  computeStats,
  splitIntoHoops,
  usableField,
} from './index.js';
import type { Hoop, Stitch, StitchSequence } from './types.js';

/** A rectangular hoop: 100x100 mm with a 5 mm safe margin. */
const HOOP_100: Hoop = {
  id: 'h-100',
  name: 'Square 100',
  width: 100,
  height: 100,
  shape: 'rect',
  safeMargin: 5,
};

/** A bigger frame: 200x200 mm, 5 mm margin. */
const HOOP_200: Hoop = {
  id: 'h-200',
  name: 'Square 200',
  width: 200,
  height: 200,
  shape: 'rect',
  safeMargin: 5,
};

const LIBRARY = [HOOP_100, HOOP_200];

/**
 * A horizontal run of `objects` blobs, each `blobW` mm wide, separated by a
 * jump. Each blob is a dense row of stitches, so a blob wider than the hoop
 * is a genuine "one object larger than the frame" case.
 */
function runSequence(options: {
  objects: number;
  blobW: number;
  blobY: number;
  step?: number;
  objectId?: string;
  /** Left edge of the first blob. Defaults to 0. */
  x0?: number;
}): StitchSequence {
  const step = options.step ?? 0.4;
  const stitches: Stitch[] = [];
  let seq = 0;
  let x = options.x0 ?? 0;

  for (let o = 0; o < options.objects; o++) {
    if (o > 0) {
      // Travel to the next blob as a jump, the way buildSequence would.
      stitches.push({
        x,
        y: options.blobY,
        command: 'jump',
        colorIndex: 0,
        objectId: null,
        sequence: seq++,
      });
    }
    const steps = Math.max(2, Math.round(options.blobW / step));
    for (let i = 0; i <= steps; i++) {
      stitches.push({
        x: x + (i * options.blobW) / steps,
        y: options.blobY,
        command: 'stitch',
        colorIndex: 0,
        objectId: options.objectId ?? `obj-${o}`,
        sequence: seq++,
      });
    }
    x += options.blobW;
  }

  return {
    stitches,
    colorCount: 1,
    bounds: boundsOfStitches(stitches),
    stats: computeStats(stitches),
  };
}

/** Usable width of a hoop after the splitter's own padding is applied. */
function maxContentWidth(hoop: Hoop): number {
  const f = usableField(hoop);
  return f.width - SPLIT_PADDING * 2;
}

describe('splitIntoHoops', () => {
  it('returns a single untouched section when the design already fits', () => {
    // 36 mm wide, sitting fully inside the 100 mm hoop's 5 mm safe area.
    const seq = runSequence({ objects: 3, blobW: 12, blobY: 20, x0: 10 });
    const result = splitIntoHoops(seq, LIBRARY);

    expect(result.sections).toHaveLength(1);
    const only = result.sections[0]!;
    expect(only.cut).toBe('end');
    // Passthrough: no translation, original stitch count, same coordinates.
    expect(only.offset).toEqual({ x: 0, y: 0 });
    expect(only.stitches).toHaveLength(seq.stitches.length);
    expect(only.stitches[0]!.x).toBeCloseTo(seq.stitches[0]!.x, 6);
    expect(only.validation.ok).toBe(true);
  });

  it('picks the smallest hoop that holds the whole design when it fits', () => {
    const seq = runSequence({ objects: 2, blobW: 30, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY);
    expect(result.hoop.id).toBe('h-100');
  });

  it('falls back to the roomiest hoop when nothing holds the design', () => {
    // 5 objects x 60 mm = 300 mm wide: larger than both frames.
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY);
    expect(result.hoop.id).toBe('h-200');
  });

  it('splits a too-wide design into sections that each fit the hoop', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY);

    expect(result.sections.length).toBeGreaterThan(1);
    const limit = maxContentWidth(result.hoop);
    for (const section of result.sections) {
      const w = section.bounds.maxX - section.bounds.minX;
      const h = section.bounds.maxY - section.bounds.minY;
      expect(w).toBeLessThanOrEqual(limit);
      expect(h).toBeLessThanOrEqual(limit);
      expect(section.validation.ok).toBe(true);
    }
  });

  it('cuts on travel points, not mid-object, when jumps are available', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY);

    // Every section except the last ends on a cut; all should be travel cuts
    // because this design has a jump between every object.
    const cuts = result.sections.slice(0, -1).map((s) => s.cut);
    expect(cuts.every((c) => c === 'travel')).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns and forces a cut when a single object is larger than the hoop', () => {
    // One 180 mm blob (one object, no internal jumps) in a 100 mm hoop.
    const seq = runSequence({ objects: 1, blobW: 180, blobY: 10, objectId: 'big' });
    const result = splitIntoHoops(seq, [HOOP_100]);

    expect(result.sections.length).toBeGreaterThan(1);
    expect(result.sections.some((s) => s.cut === 'forced')).toBe(true);
    expect(result.warnings.some((w) => /mid-object/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /"big"/.test(w))).toBe(true);
  });

  it('preserves every stitch exactly once across sections', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY);

    // Source ranges must tile the input with no gaps or overlaps.
    let cursor = 0;
    for (const section of result.sections) {
      expect(section.source.start).toBe(cursor);
      expect(section.source.end).toBeGreaterThan(section.source.start);
      cursor = section.source.end;
    }
    expect(cursor).toBe(seq.stitches.length);
  });

  it('emits a leading jump and renumbers each section as a standalone file', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY);

    for (const section of result.sections) {
      expect(section.stitches[0]!.command).toBe('jump');
      // sequence is 0..n-1, contiguous.
      section.stitches.forEach((s, i) => expect(s.sequence).toBe(i));
    }
  });

  it('adds a trailing trim to every section that is not the last', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY);

    const notLast = result.sections.slice(0, -1);
    expect(notLast.length).toBeGreaterThan(0);
    for (const section of notLast) {
      expect(section.stitches[section.stitches.length - 1]!.command).toBe('trim');
    }
    // The last section must not be trimmed: the design simply ends.
    const last = result.sections[result.sections.length - 1]!;
    expect(last.stitches[last.stitches.length - 1]!.command).not.toBe('trim');
  });

  it('centres each split section inside the hoop field', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY);
    const hoop = result.hoop;
    const margin = hoop.safeMargin;

    for (const section of result.sections) {
      // Inside the safe area.
      expect(section.bounds.minX).toBeGreaterThanOrEqual(margin);
      expect(section.bounds.minY).toBeGreaterThanOrEqual(margin);
      expect(section.bounds.maxX).toBeLessThanOrEqual(hoop.width - margin);
      expect(section.bounds.maxY).toBeLessThanOrEqual(hoop.height - margin);
    }
  });

  it('is deterministic', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const a = splitIntoHoops(seq, LIBRARY);
    const b = splitIntoHoops(seq, LIBRARY);
    expect(a.sections.map((s) => s.stitches)).toEqual(b.sections.map((s) => s.stitches));
    expect(a.message).toBe(b.message);
  });

  it('honours an explicitly supplied hoop', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY, { hoop: HOOP_100 });
    expect(result.hoop.id).toBe('h-100');
    expect(result.sections.every((s) => s.hoop.id === 'h-100')).toBe(true);
  });

  it('counts colours and stats per section', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    const result = splitIntoHoops(seq, LIBRARY);
    for (const section of result.sections) {
      expect(section.colorCount).toBeGreaterThanOrEqual(1);
      expect(section.stats.totalStitches).toBe(section.stitches.length);
      expect(section.stats.sewStitches).toBeGreaterThan(0);
    }
  });

  it('rejects an empty design', () => {
    const empty: StitchSequence = {
      stitches: [],
      colorCount: 0,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      stats: computeStats([]),
    };
    expect(() => splitIntoHoops(empty, LIBRARY)).toThrow(MultiHoopError);
    expect(() => splitIntoHoops(empty, LIBRARY)).toThrow(/no stitches/i);
  });

  it('rejects an empty hoop library', () => {
    const seq = runSequence({ objects: 5, blobW: 60, blobY: 10 });
    expect(() => splitIntoHoops(seq, [])).toThrow(MultiHoopError);
    expect(() => splitIntoHoops(seq, [])).toThrow(/no hoop presets/i);
  });

  it('rejects a hoop whose margin eats the whole field', () => {
    const useless: Hoop = {
      ...HOOP_100,
      id: 'h-tiny',
      name: 'Tiny',
      width: 8,
      height: 8,
      safeMargin: 5,
    };
    const seq = runSequence({ objects: 2, blobW: 20, blobY: 10 });
    expect(() => splitIntoHoops(seq, [useless], { hoop: useless })).toThrow(
      /no usable stitching area/i,
    );
  });
});

// ---------------------------------------------------------------------------

describe('splitIntoHoops overlap', () => {
  /** A design far too wide for the square hoop, so it always splits. */
  const WIDE = (): StitchSequence => runSequence({ objects: 6, blobW: 40, blobY: 50 });

  it('shares a band between consecutive sections instead of meeting on a line', () => {
    const seq = WIDE();
    const res = splitIntoHoops(seq, LIBRARY, { hoop: HOOP_100, overlap: 10 });

    expect(res.sections.length).toBeGreaterThan(1);

    for (let i = 1; i < res.sections.length; i++) {
      const prev = res.sections[i - 1]!.source;
      const cur = res.sections[i]!.source;

      // The next section opens BEFORE the last one stopped...
      expect(cur.start).toBeLessThan(prev.end);
      // ...but never on or before where that section began, so the split
      // still walks forward.
      expect(cur.start).toBeGreaterThanOrEqual(prev.start + 1);

      // The shared band is no deeper than the overlap that was asked for,
      // measured along the axis the design is split along.
      const band = seq.stitches.slice(cur.start, prev.end).map((s) => s.x);
      const span = Math.max(...band) - Math.min(...band);
      expect(span).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('still produces sections that fit the hoop', () => {
    const res = splitIntoHoops(WIDE(), LIBRARY, { hoop: HOOP_100, overlap: 10 });

    for (const section of res.sections) {
      expect(section.validation.ok).toBe(true);
      const f = usableField(HOOP_100);
      expect(section.bounds.maxX - section.bounds.minX).toBeLessThanOrEqual(f.width + 1e-9);
      expect(section.bounds.maxY - section.bounds.minY).toBeLessThanOrEqual(f.height + 1e-9);
    }
  });

  it('sews every shared stitch into both files', () => {
    const seq = WIDE();
    const res = splitIntoHoops(seq, LIBRARY, { hoop: HOOP_100, overlap: 10 });

    const sewn = res.sections.reduce(
      (n, s) => n + s.stitches.filter((k) => k.command === 'stitch').length,
      0,
    );
    const original = seq.stitches.filter((k) => k.command === 'stitch').length;

    // The point of an overlap is duplication - so this cannot be equal.
    expect(sewn).toBeGreaterThan(original);
  });

  it('leaves consecutive sections exactly adjacent when no overlap is asked for', () => {
    const seq = WIDE();
    const plain = splitIntoHoops(seq, LIBRARY, { hoop: HOOP_100 });
    expect(plain.sections.length).toBeGreaterThan(1);

    for (let i = 1; i < plain.sections.length; i++) {
      expect(plain.sections[i]!.source.start).toBe(plain.sections[i - 1]!.source.end);
    }
    // And zero is a real value, not "unset": asking for it changes nothing.
    const explicit = splitIntoHoops(seq, LIBRARY, { hoop: HOOP_100, overlap: 0 });
    expect(explicit.sections.map((s) => s.source)).toEqual(plain.sections.map((s) => s.source));
  });

  it('clamps an overlap far larger than the hoop instead of looping', () => {
    const res = splitIntoHoops(WIDE(), LIBRARY, { hoop: HOOP_100, overlap: 5000 });

    expect(res.sections.length).toBeGreaterThan(1);
    for (const section of res.sections) expect(section.validation.ok).toBe(true);
    // The message names what was actually applied, not what was requested.
    expect(res.message).toMatch(/mm of every join sewn twice/);
    expect(res.message).not.toContain('5000 mm');
  });

  it('is deterministic', () => {
    const a = splitIntoHoops(WIDE(), LIBRARY, { hoop: HOOP_100, overlap: 10 });
    const b = splitIntoHoops(WIDE(), LIBRARY, { hoop: HOOP_100, overlap: 10 });
    expect(a.sections.map((s) => s.source)).toEqual(b.sections.map((s) => s.source));
  });
});

// ---------------------------------------------------------------------------

describe('splitIntoHoops registration marks', () => {
  /**
   * Centres of the registration crosses in a section, converted back to
   * DESIGN coordinates by undoing that section's own translation.
   *
   * The two halves of a join are translated differently, so the crosses only
   * compare equal once each one's offset has been taken back off - which is
   * exactly the property the feature depends on.
   */
  function crossCentres(section: {
    stitches: Stitch[];
    offset: { x: number; y: number };
  }): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const c = section.stitches;

    for (let i = 0; i + 3 < c.length; i++) {
      if (
        c[i]!.command !== 'jump' ||
        c[i + 1]!.command !== 'stitch' ||
        c[i + 2]!.command !== 'jump' ||
        c[i + 3]!.command !== 'stitch'
      ) {
        continue;
      }
      const [a, b, d, e] = [c[i]!, c[i + 1]!, c[i + 2]!, c[i + 3]!];
      // One bar level, one bar plumb, sharing a centre - a cross and nothing
      // else in these designs has that shape.
      if (!(a.y === b.y && b.x > a.x)) continue;
      if (!(d.x === e.x && e.y > d.y)) continue;
      const hx = (a.x + b.x) / 2;
      const hy = (a.y + b.y) / 2;
      if (Math.abs(hx - (d.x + e.x) / 2) > 1e-9 || Math.abs(hy - (d.y + e.y) / 2) > 1e-9) continue;

      out.push({ x: hx - section.offset.x, y: hy - section.offset.y });
    }
    return out;
  }

  const WIDE = (): StitchSequence => runSequence({ objects: 6, blobW: 40, blobY: 50 });

  it('sews the same cross into both halves of every join', () => {
    const res = splitIntoHoops(WIDE(), LIBRARY, {
      hoop: HOOP_100,
      registrationMarks: true,
    });
    expect(res.sections.length).toBeGreaterThan(1);

    const centres = res.sections.map(crossCentres);
    // The first section only ends on a join, the last only begins one.
    expect(centres[0]).toHaveLength(1);
    expect(centres[centres.length - 1]).toHaveLength(1);

    for (let i = 0; i + 1 < res.sections.length; i++) {
      const endingHere = centres[i]![centres[i]!.length - 1]!;
      const startingThere = centres[i + 1]![0]!;
      // Same point in the design: line these two up on the fabric and the
      // halves are in register.
      expect(startingThere.x).toBeCloseTo(endingHere.x, 9);
      expect(startingThere.y).toBeCloseTo(endingHere.y, 9);
    }

    // A middle section gets one cross per neighbour.
    for (let i = 1; i + 1 < res.sections.length; i++) expect(centres[i]).toHaveLength(2);
  });

  it('keeps every cross inside the hoop field', () => {
    const res = splitIntoHoops(WIDE(), LIBRARY, {
      hoop: HOOP_100,
      registrationMarks: true,
    });

    for (const section of res.sections) {
      expect(section.validation.ok).toBe(true);
      expect(crossCentres(section).length).toBeGreaterThan(0);
    }
  });

  it('sews no crosses into a design that needs only one hooping', () => {
    // Positioned inside the safe margin, so this is the passthrough case.
    const seq = runSequence({ objects: 2, blobW: 30, blobY: 50, x0: 10 });
    const res = splitIntoHoops(seq, LIBRARY, {
      hoop: HOOP_100,
      registrationMarks: true,
      registrationMarkSize: 6,
      overlap: 5,
    });

    expect(res.sections).toHaveLength(1);
    // Nothing to align to, so the design comes back untouched rather than
    // with marks the operator would have to pick out for no reason.
    expect(res.sections[0]!.stitches).toEqual(seq.stitches);
    expect(res.message).toMatch(/single hooping/);
    expect(res.message).not.toContain('registration crosses');
  });

  it('names the crosses in the summary when they are sewn', () => {
    const res = splitIntoHoops(WIDE(), LIBRARY, {
      hoop: HOOP_100,
      registrationMarks: true,
    });
    expect(res.message).toContain('registration crosses');
  });

  it('crosses are sewn in the colour of the join, not a new one', () => {
    const res = splitIntoHoops(WIDE(), LIBRARY, {
      hoop: HOOP_100,
      registrationMarks: true,
    });
    for (const section of res.sections) {
      expect(section.colorCount).toBe(1);
      for (const mark of crossCentres(section)) {
        expect(mark.x).not.toBeNaN();
        expect(mark.y).not.toBeNaN();
      }
    }
  });
});
