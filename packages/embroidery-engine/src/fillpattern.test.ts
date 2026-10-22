import { describe, it, expect } from 'vitest';
import { generateObjectStitches } from './index.js';
import type { EmbroideryObject, FillPattern, StitchParameters } from './types.js';

const BASE_PARAMS: StitchParameters = {
  stitchType: 'tatami',
  angle: 0,
  spacing: 0.4,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0.2,
  fillPattern: 'tatami',
  underlay: { type: 'edgeRun', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: false, length: 0.4, count: 3 },
  tieOff: { enabled: false, length: 0.4, count: 3 },
};

/**
 * `fillPattern` used to be a value that travelled from the UI to MongoDB and
 * straight back without ever reaching a needle: the engine branched on
 * `stitchType` and never once read this field. These tests pin it down.
 */
function fillObject(fillPattern: FillPattern): EmbroideryObject {
  return {
    id: 'f1',
    name: 'Fill',
    type: 'fill',
    path: {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: 40 },
          { x: 0, y: 40 },
        ],
      ],
    },
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: { ...BASE_PARAMS, fillPattern },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

const sewn = (p: FillPattern) =>
  generateObjectStitches(fillObject(p)).filter((s) => s.command === 'stitch');

describe('fillPattern', () => {
  it('different patterns really do produce different stitches', () => {
    const tatami = sewn('tatami');
    const motif = sewn('motif');
    const contour = sewn('contour');
    const spiral = sewn('spiral');
    const split = sewn('programmedSplit');

    // Every one of them must actually sew something - a pattern that silently
    // produced nothing would look like "the setting does nothing" all over
    // again, which is the bug being fixed.
    for (const [name, list] of [
      ['tatami', tatami],
      ['motif', motif],
      ['contour', contour],
      ['spiral', spiral],
      ['programmedSplit', split],
    ] as const) {
      expect(list.length, `${name} produced no stitches`).toBeGreaterThan(10);
    }

    const signatures = [tatami, motif, contour, spiral, split].map((l) =>
      JSON.stringify(l.slice(0, 200)),
    );
    // Four of the five layouts are genuinely different generators, so no two
    // may open with the same points.
    expect(new Set(signatures.slice(0, 4)).size).toBe(4);
    expect(JSON.stringify(split)).not.toBe(JSON.stringify(tatami));
  });

  it('the default plain tatami is unchanged from before the field was read', () => {
    // 'tatami' is what every existing design already stores, so it must
    // reproduce exactly - no drift, no "equivalent but re-ordered" output.
    const first = generateObjectStitches(fillObject('tatami'));
    const second = generateObjectStitches(fillObject('tatami'));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // And the plain pattern must be the dense continuous one, not split.
    expect(sewn('tatami').length).toBeGreaterThan(sewn('programmedSplit').length);
  });

  it('programmed split leaves real gaps between blocks', () => {
    const split = sewn('programmedSplit');
    const plain = sewn('tatami');

    // The split must not be a label: it has to remove some penetrations
    // inside the shape, otherwise nothing was split.
    expect(split.length).toBeLessThan(plain.length);

    // Row ends survive - the outline still closes.
    const xs = (l: typeof split) => l.map((s) => s.x);
    expect(Math.min(...xs(split))).toBeCloseTo(Math.min(...xs(plain)), 4);
    expect(Math.max(...xs(split))).toBeCloseTo(Math.max(...xs(plain)), 4);
  });

  it('programmed split travels across each break instead of sewing it', () => {
    const split = generateObjectStitches(fillObject('programmedSplit'));
    const jumps = split.filter((s) => s.command === 'jump').length;
    const plainJumps = generateObjectStitches(fillObject('tatami')).filter(
      (s) => s.command === 'jump',
    ).length;

    // Sewing across the gap would draw thread straight through it and the
    // split would not exist on the fabric.
    expect(jumps).toBeGreaterThan(plainJumps);
  });

  it('programmed split staggers its breaks rather than ruling one line', () => {
    // Alternate rows start half a block later, so the gap positions must not
    // line up. Compare the gap x-positions of two rows.
    const split = sewn('programmedSplit');
    // Group into rows by y, then find the largest x-gap inside each row.
    const rows = new Map<number, number[]>();
    for (const s of split) {
      const key = Math.round(s.y * 10) / 10;
      const list = rows.get(key) ?? [];
      list.push(s.x);
      rows.set(key, list);
    }

    const gapCentres: number[] = [];
    for (const xs of rows.values()) {
      const sorted = [...new Set(xs.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
      let biggest = 0;
      let at = 0;
      for (let i = 1; i < sorted.length; i++) {
        const d = sorted[i]! - sorted[i - 1]!;
        if (d > biggest) {
          biggest = d;
          at = (sorted[i]! + sorted[i - 1]!) / 2;
        }
      }
      // Only a real break counts; ordinary row spacing is far smaller.
      if (biggest > 1) gapCentres.push(Math.round(at));
    }

    expect(gapCentres.length).toBeGreaterThan(1);
    // Staggering means the breaks are not all at one x.
    expect(new Set(gapCentres).size).toBeGreaterThan(1);
  });

  it('motif fill lays a repeating motif grid, not continuous rows', () => {
    const list = generateObjectStitches(fillObject('motif'));
    const tatami = generateObjectStitches(fillObject('tatami'));

    // Count the separate sewn runs: a motif fill stamps a little shape at each
    // grid point, so it lifts the needle between motifs; a tatami is one
    // continuous serpentine. If motif stitches were continuous rows, the
    // pattern would not be a motif grid at all.
    const runs = (l: typeof list): number => {
      let count = 0;
      let sewing = false;
      for (const s of l) {
        if (s.command === 'stitch') {
          if (!sewing) count++;
          sewing = true;
        } else {
          sewing = false;
        }
      }
      return count;
    };

    expect(runs(list)).toBeGreaterThan(50);
    expect(runs(list)).toBeGreaterThan(runs(tatami) * 10);
  });

  it('contour fill follows the outline inward', () => {
    const contour = sewn('contour');
    // Contour rows run parallel to the boundary, so the outermost points sit
    // on the shape edge rather than being inset the way tatami rows are.
    const xs = contour.map((s) => s.x);
    expect(Math.max(...xs)).toBeCloseTo(60, 1);
  });

  it('spiral fill never repeats a full row', () => {
    const spiral = sewn('spiral');
    const rows = new Set(spiral.map((s) => Math.round(s.y * 20) / 20));
    // A spiral has no repeated y-levels in the way a stepped fill does; the
    // point set must be spread rather than concentrated on band lines.
    expect(rows.size).toBeGreaterThan(10);
  });

  it('splits serpentine rows too, not just left-to-right ones', () => {
    // Alternate tatami rows walk right-to-left. Measuring the gap from the
    // row's start instead of its left edge made every such row's offset
    // negative, and JS % keeps the sign - so half the fill came out unsplit
    // and the pattern only appeared on alternating rows.
    const obj = fillObject('programmedSplit');
    // Force many rows so both directions are exercised.
    const list = generateObjectStitches({ ...obj, params: { ...obj.params, spacing: 1.5 } });
    const rows = new Map<number, number>();
    for (const s of list) {
      if (s.command !== 'stitch') continue;
      const key = Math.round(s.y * 10) / 10;
      rows.set(key, (rows.get(key) ?? 0) + 1);
    }

    const counts = [...rows.values()];
    expect(counts.length).toBeGreaterThan(6);

    // With the bug, unsplit rows had every point and split rows had fewer -
    // a clean two-way split in the counts. Both directions must break now.
    const dense = counts.filter((c) => c > 0).sort((a, b) => a - b);
    const median = dense[Math.floor(dense.length / 2)]!;
    const unsplit = dense.filter((c) => c > median * 1.4).length;
    expect(unsplit).toBeLessThan(Math.ceil(counts.length / 4));
  });

  it('is deterministic for the same pattern', () => {
    for (const p of ['tatami', 'motif', 'contour', 'spiral', 'programmedSplit'] as const) {
      expect(JSON.stringify(generateObjectStitches(fillObject(p)))).toBe(
        JSON.stringify(generateObjectStitches(fillObject(p))),
      );
    }
  });

  it('every pattern still fits inside the shape it was given', () => {
    for (const p of ['tatami', 'motif', 'contour', 'spiral', 'programmedSplit'] as const) {
      const list = sewn(p);
      for (const s of list) {
        expect(s.x).toBeGreaterThanOrEqual(-6);
        expect(s.x).toBeLessThanOrEqual(66);
        expect(s.y).toBeGreaterThanOrEqual(-6);
        expect(s.y).toBeLessThanOrEqual(46);
      }
    }
  });

  it('is not consulted for satin columns, which have no fill to lay', () => {
    const satin = generateObjectStitches({
      ...fillObject('programmedSplit'),
      path: {
        rings: [
          [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
          ],
          [
            { x: 0, y: 4 },
            { x: 60, y: 4 },
          ],
        ],
      },
      params: { ...BASE_PARAMS, stitchType: 'satin', fillPattern: 'programmedSplit' },
    });
    const same = generateObjectStitches({
      ...fillObject('tatami'),
      path: {
        rings: [
          [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
          ],
          [
            { x: 0, y: 4 },
            { x: 60, y: 4 },
          ],
        ],
      },
      params: { ...BASE_PARAMS, stitchType: 'satin', fillPattern: 'tatami' },
    });

    // Satin stitches rail-to-rail; the fill pattern is meaningless there and
    // must not perturb the column.
    expect(JSON.stringify(satin)).toBe(JSON.stringify(same));
  });
});
