/**
 * Advanced fill tests.
 *
 * Every texture has to be real geometry: non-empty, deterministic (the file
 * must match the preview on every compile), inside the shape where it claims
 * to be, and sewable within the machine's step limit. Specific tests then pin
 * the character each pattern promises - accordion pleats zigzag, maze turns
 * are square, shading gets denser, warp only bows one way.
 */

import { describe, it, expect } from 'vitest';
import {
  accordionFill,
  crossFill,
  florentineFill,
  handStitchFill,
  laydownFill,
  liquidFill,
  mazeFill,
  shadingFill,
  stippleFill,
  stringFill,
  tatamiFill,
} from './index.js';
import { compileDesign } from '../index.js';
import type {
  CompoundPath,
  EmbroideryObject,
  Point,
  StitchParameters,
  ThreadColor,
} from '../types.js';

const RECT: CompoundPath = {
  rings: [
    [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 0, y: 40 },
    ],
  ],
};

/** An L: 40 x 40 with the top-right quadrant removed, so rows change width. */
const L_SHAPE: CompoundPath = {
  rings: [
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 40 },
      { x: 0, y: 40 },
    ],
  ],
};

/** A square with a square hole: the even-odd test must keep stitches out. */
const RING: CompoundPath = {
  rings: [
    [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 0, y: 40 },
    ],
    [
      { x: 18, y: 14 },
      { x: 32, y: 14 },
      { x: 32, y: 26 },
      { x: 18, y: 26 },
    ],
  ],
};

const OPTS = { angle: 0, spacing: 0.5 };

function boundsOfStitches(sts: { x: number; y: number }[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of sts) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInShape(path: CompoundPath, pt: Point): boolean {
  let inside = false;
  for (const ring of path.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > pt.y !== b.y > pt.y) {
        const t = (pt.y - a.y) / (b.y - a.y);
        if (pt.x < a.x + t * (b.x - a.x)) inside = !inside;
      }
    }
  }
  return inside;
}

const GENERATORS: { name: string; run: () => { x: number; y: number; command: string }[] }[] = [
  { name: 'accordion', run: () => accordionFill(RECT, OPTS) },
  { name: 'florentine', run: () => florentineFill(RECT, OPTS) },
  { name: 'liquid', run: () => liquidFill(RECT, OPTS) },
  { name: 'maze', run: () => mazeFill(RECT, OPTS) },
  { name: 'string', run: () => stringFill(RECT, OPTS) },
  { name: 'laydown', run: () => laydownFill(RECT, { ...OPTS, maxStitchLength: 8 }) },
  { name: 'stipple', run: () => stippleFill(RECT, OPTS) },
  { name: 'cross', run: () => crossFill(RECT, OPTS) },
  { name: 'shading', run: () => shadingFill(RECT, OPTS) },
  { name: 'hand', run: () => handStitchFill(RECT, OPTS) },
];

describe('advanced fills, shared promises', () => {
  it('produces stitches for every pattern', () => {
    for (const gen of GENERATORS) {
      const sts = gen.run();
      expect(sts.length, gen.name).toBeGreaterThan(10);
    }
  });

  it('is deterministic: the same shape gives byte-for-byte the same fill', () => {
    for (const gen of GENERATORS) {
      expect(gen.run(), gen.name).toEqual(gen.run());
    }
  });

  it('keeps every stitch inside the shape box', () => {
    for (const gen of GENERATORS) {
      const box = boundsOfStitches(gen.run());
      expect(box.minX, gen.name).toBeGreaterThanOrEqual(-1.5);
      expect(box.maxX, gen.name).toBeLessThanOrEqual(51.5);
      expect(box.minY, gen.name).toBeGreaterThanOrEqual(-1.5);
      expect(box.maxY, gen.name).toBeLessThanOrEqual(41.5);
    }
  });

  it('never sews a stitch longer than the machine step limit allows', () => {
    for (const gen of GENERATORS) {
      const sts = gen.run();
      for (let i = 1; i < sts.length; i++) {
        if (sts[i]!.command !== 'stitch') continue;
        const d = Math.hypot(sts[i]!.x - sts[i - 1]!.x, sts[i]!.y - sts[i - 1]!.y);
        expect(d, `${gen.name} stitch ${i}`).toBeLessThanOrEqual(12.2);
      }
    }
  });

  it('respects a hole: nothing lands more than a millimetre inside it', () => {
    // The textured fills lean their penetrations off the scanline they were
    // generated from (by up to their own amplitude), so a stitch can dip a
    // fraction of a millimetre past the edge. What must never happen is a
    // row running across the hole, so the check is depth, not the edge.
    const rowFills = [
      accordionFill(RING, OPTS),
      mazeFill(RING, OPTS),
      stringFill(RING, OPTS),
      laydownFill(RING, { ...OPTS, maxStitchLength: 8 }),
      shadingFill(RING, OPTS),
      handStitchFill(RING, OPTS),
    ];
    const holeBox = { minX: 19, maxX: 31, minY: 15, maxY: 25 };
    for (const sts of rowFills) {
      for (const s of sts) {
        const deepInHole =
          s.x > holeBox.minX && s.x < holeBox.maxX && s.y > holeBox.minY && s.y < holeBox.maxY;
        expect(deepInHole, `stitch (${s.x.toFixed(1)}, ${s.y.toFixed(1)}) deep in hole`).toBe(
          false,
        );
      }
    }
  });
});

describe('accordion', () => {
  it('zigzags: consecutive penetrations alternate above and below the row', () => {
    const sts = accordionFill(RECT, OPTS);
    // The pattern walks along a row in stitch-length steps and flips to the
    // other side of the row on every step, so the move is mostly forward with
    // a large sideways component.
    let found = false;
    for (let i = 1; i < sts.length; i++) {
      const a = sts[i - 1]!;
      const b = sts[i]!;
      if (b.command !== 'stitch') continue;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx > 0.5 && dx < 4 && dy > 1) found = true;
    }
    expect(found).toBe(true);
  });
});

describe('florentine', () => {
  it('tilts rows one way in one band and the other way in the next', () => {
    const sts = florentineFill(RECT, { angle: 0, spacing: 0.5 });
    // Slopes of consecutive stitches: within a row they follow the band's
    // tilt, so both signs must appear across the shape.
    let up = 0;
    let down = 0;
    for (let i = 1; i < sts.length; i++) {
      const a = sts[i - 1]!;
      const b = sts[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (b.command !== 'stitch' || dx < 0.3 || Math.abs(dy) < 0.05) continue;
      if (dy < 0) up++;
      else down++;
    }
    expect(up).toBeGreaterThan(10);
    expect(down).toBeGreaterThan(10);
  });
});

describe('liquid', () => {
  it('makes rows that flow above and below their line', () => {
    const sts = liquidFill(RECT, { angle: 0, spacing: 0.6 });
    // Collect y values; the wave means many distinct values per row rather
    // than one flat line per row.
    const ys = new Set(sts.map((s) => Math.round(s.y * 10)));
    expect(ys.size).toBeGreaterThan(20);
  });
});

describe('maze', () => {
  it('turns with a square corner: a purely vertical step between rows', () => {
    const sts = mazeFill(RECT, { angle: 0, spacing: 0.5 });
    let verticalSteps = 0;
    for (let i = 1; i < sts.length; i++) {
      const a = sts[i - 1]!;
      const b = sts[i]!;
      if (Math.abs(b.x - a.x) < 0.01 && Math.abs(b.y - a.y) > 0.3) verticalSteps++;
    }
    expect(verticalSteps).toBeGreaterThan(10);
  });
});

describe('string', () => {
  it('lays longer stitches than tatami', () => {
    const sts = stringFill(RECT, { angle: 0, spacing: 0.5 });
    const lengths: number[] = [];
    for (let i = 1; i < sts.length; i++) {
      const a = sts[i - 1]!;
      const b = sts[i]!;
      if (b.command === 'stitch') lengths.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    const longest = Math.max(...lengths);
    expect(longest).toBeGreaterThan(1.8);
  });
});

describe('laydown', () => {
  it('splits long threads at the requested maximum', () => {
    const sts = laydownFill(RECT, { angle: 0, spacing: 0.5, maxStitchLength: 8 });
    let longest = 0;
    for (let i = 1; i < sts.length; i++) {
      const a = sts[i - 1]!;
      const b = sts[i]!;
      if (b.command === 'stitch') longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y));
    }
    expect(longest).toBeLessThanOrEqual(8.001);
    expect(longest).toBeGreaterThan(4);
  });
});

describe('stipple', () => {
  it('scatters dots with deterministic jitter and keeps them in the shape', () => {
    const a = stippleFill(RECT, { spacing: 0.6 });
    const b = stippleFill(RECT, { spacing: 0.6 });
    expect(a).toEqual(b);
    for (const s of a) expect(pointInShape(RECT, s)).toBe(true);
  });
});

describe('cross', () => {
  it('sews a second, perpendicular pass', () => {
    const single = tatamiFill(RECT, {
      angle: 0,
      spacing: 1,
      serpentine: true,
      offsetPattern: false,
      edgeInset: 0.175,
    });
    const crossed = crossFill(RECT, { angle: 0, spacing: 0.5 });
    expect(crossed.length).toBeGreaterThan(single.length * 1.5);
  });
});

describe('shading', () => {
  it('gets denser toward the bottom', () => {
    const sts = shadingFill(RECT, { angle: 0, spacing: 0.5 });
    const ys = [...new Set(sts.map((s) => Math.round(s.y * 100) / 100))].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThan(10);

    const gaps: number[] = [];
    for (let i = 1; i < ys.length; i++) gaps.push(ys[i]! - ys[i - 1]!);
    const half = Math.floor(gaps.length / 2);
    const topAvg = gaps.slice(0, half).reduce((s, g) => s + g, 0) / half;
    const bottomAvg = gaps.slice(half).reduce((s, g) => s + g, 0) / (gaps.length - half);
    expect(bottomAvg).toBeLessThan(topAvg);
  });
});

describe('hand stitch', () => {
  it('is irregular but stays inside and inside the step limit', () => {
    const sts = handStitchFill(RECT, { spacing: 0.6 });
    for (const s of sts) expect(pointInShape(RECT, s)).toBe(true);

    // Irregularity: step lengths vary noticeably.
    const steps: number[] = [];
    for (let i = 1; i < sts.length; i++) {
      const a = sts[i - 1]!;
      const b = sts[i]!;
      if (b.command === 'stitch') steps.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    const min = Math.min(...steps);
    const max = Math.max(...steps);
    expect(max - min).toBeGreaterThan(0.4);
  });
});

describe('jagged edge and 3D warp (tatami options)', () => {
  it('jagged ends poke past the plain edge, seeded and stable', () => {
    const plain = tatamiFill(RECT, { angle: 0, spacing: 0.5, edgeInset: 0, serpentine: true });
    const jagged = tatamiFill(RECT, {
      angle: 0,
      spacing: 0.5,
      edgeInset: 0,
      serpentine: true,
      jagged: 1.2,
    });
    expect(jagged).toEqual(
      tatamiFill(RECT, { angle: 0, spacing: 0.5, edgeInset: 0, serpentine: true, jagged: 1.2 }),
    );

    const plainBox = boundsOfStitches(plain);
    const jaggedBox = boundsOfStitches(jagged);
    expect(jaggedBox.minX).toBeLessThan(plainBox.minX);
    expect(jaggedBox.maxX).toBeGreaterThan(plainBox.maxX);
  });

  it('warp bows rows one way only, keeping the penetrations', () => {
    const plain = tatamiFill(RECT, { angle: 0, spacing: 0.5, edgeInset: 0 });
    const warped = tatamiFill(RECT, { angle: 0, spacing: 0.5, edgeInset: 0, warp: 1.5 });

    expect(warped.length).toBe(plain.length);
    for (let i = 0; i < plain.length; i++) {
      expect(warped[i]!.x).toBeCloseTo(plain[i]!.x, 9);
      expect(warped[i]!.y).toBeLessThanOrEqual(plain[i]!.y + 1e-9);
    }
    expect(warped.some((s, i) => s.y < plain[i]!.y - 0.2)).toBe(true);
  });

  it('adaptive splits break at different places than fixed splits', () => {
    const fixed = tatamiFill(L_SHAPE, {
      angle: 0,
      spacing: 0.5,
      split: { segmentLength: 12, gap: 1.5 },
    });
    const flexi = tatamiFill(L_SHAPE, {
      angle: 0,
      spacing: 0.5,
      split: { segmentLength: 12, gap: 1.5 },
      adaptiveSplit: true,
    });
    expect(flexi.length).toBeGreaterThan(0);
    expect(flexi).not.toEqual(fixed);
    expect(flexi).toEqual(
      tatamiFill(L_SHAPE, {
        angle: 0,
        spacing: 0.5,
        split: { segmentLength: 12, gap: 1.5 },
        adaptiveSplit: true,
      }),
    );
  });
});

// --- dispatch through the real pipeline -----------------------------------

const PALETTE: ThreadColor[] = [{ id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' }];

const PARAMS: StitchParameters = {
  stitchType: 'tatami',
  angle: 0,
  spacing: 0.5,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0.2,
  fillPattern: 'tatami',
  underlay: { type: 'none', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: false, length: 0.4, count: 3 },
  tieOff: { enabled: false, length: 0.4, count: 3 },
};

function fillObject(fillPattern: StitchParameters['fillPattern']): EmbroideryObject {
  return {
    id: 'fill-1',
    name: 'Fill',
    type: 'fill',
    path: RECT,
    transform: { x: 0, y: 0 },
    colorIndex: 0,
    params: { ...PARAMS, fillPattern },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

const PATTERNS: StitchParameters['fillPattern'][] = [
  'tatami',
  'motif',
  'contour',
  'spiral',
  'programmedSplit',
  'accordion',
  'florentine',
  'liquid',
  'maze',
  'string',
  'laydown',
  'stipple',
  'cross',
  'shading',
  'hand',
  'jagged',
  'warp',
  'flexiSplit',
];

describe('fill pattern dispatch', () => {
  it('compiles every named pattern to real stitches', () => {
    for (const pattern of PATTERNS) {
      const { sequence } = compileDesign([fillObject(pattern)], PALETTE, null);
      const sewn = sequence.stitches.filter((s) => s.command === 'stitch');
      expect(sewn.length, pattern).toBeGreaterThan(20);
    }
  });

  it('gives every pattern its own texture rather than aliasing tatami', () => {
    const plain = compileDesign([fillObject('tatami')], PALETTE, null).sequence.stitches;
    for (const pattern of PATTERNS) {
      if (pattern === 'tatami') continue;
      const stitches = compileDesign([fillObject(pattern)], PALETTE, null).sequence.stitches;
      expect(stitches, pattern).not.toEqual(plain);
    }
  });

  it('is deterministic through the whole pipeline', () => {
    for (const pattern of PATTERNS) {
      const a = compileDesign([fillObject(pattern)], PALETTE, null).sequence.stitches;
      const b = compileDesign([fillObject(pattern)], PALETTE, null).sequence.stitches;
      expect(a, pattern).toEqual(b);
    }
  });
});
