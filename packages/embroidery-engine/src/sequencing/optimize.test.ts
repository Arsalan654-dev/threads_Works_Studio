import { describe, it, expect } from 'vitest';
import { buildSequence, optimizeObjectOrder } from './index.js';
import type {
  EmbroideryObject,
  ObjectStitchGroup,
  StitchParameters,
  ThreadColor,
} from '../types.js';

/**
 * Ordering is a cost decision, not a cosmetic one: every wrong hop is a jump
 * (or a trim) the machine performs on the fabric. These tests pin the two
 * decisions that matter - which object is nearest next, and whether colour
 * blocks are finished before the thread changes.
 */

const PARAMS: StitchParameters = {
  stitchType: 'tatami',
  angle: 45,
  spacing: 0.4,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0.2,
  fillPattern: 'tatami',
  underlay: { type: 'none', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: false, length: 0.4, count: 3 },
  tieOff: { enabled: false, length: 0.4, count: 3 },
};

const PALETTE: ThreadColor[] = [
  { id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' },
  { id: 'c2', code: '1002', name: 'Blue', hex: '#1C4FBF' },
  { id: 'c3', code: '1003', name: 'Green', hex: '#2E8B57' },
];

/** A 10 x 10 square whose top-left corner sits at (x, y). */
function object(id: string, order: number, x: number, y: number, colorIndex = 0): EmbroideryObject {
  return {
    id,
    name: id,
    type: 'fill',
    path: {
      rings: [
        [
          { x, y },
          { x: x + 10, y },
          { x: x + 10, y: y + 10 },
          { x, y: y + 10 },
        ],
      ],
    },
    transform: { x: 0, y: 0 },
    colorIndex,
    params: { ...PARAMS },
    entryExit: { entry: null, exit: null },
    lettering: null,
    order,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

function group(id: string, colorIndex: number, x: number): ObjectStitchGroup {
  const point = { x, y: 5 };
  return {
    objectId: id,
    colorIndex,
    stitches: [{ x, y: 5, command: 'stitch' }],
    entry: point,
    exit: point,
    lockStart: false,
    lockEnd: false,
    lockLength: 0.4,
    lockCount: 3,
  };
}

function sewnOrder(stitches: { objectId: string | null; command: string }[]): string[] {
  const out: string[] = [];
  for (const stitch of stitches) {
    if (stitch.command !== 'stitch' || stitch.objectId === null) continue;
    if (out[out.length - 1] !== stitch.objectId) out.push(stitch.objectId);
  }
  return out;
}

describe('optimizeObjectOrder', () => {
  it('starts near the origin and keeps taking the nearest object', () => {
    const input = [object('a', 0, 0, 0), object('b', 1, 50, 0), object('c', 2, 10, 0)];

    const out = optimizeObjectOrder(input);

    expect(out.map((o) => o.id)).toEqual(['a', 'c', 'b']);
    expect(out.map((o) => o.order)).toEqual([0, 1, 2]);
  });

  it('finishes the current thread first when colours are respected', () => {
    const input = [object('a', 0, 0, 0, 0), object('b', 1, 10, 0, 1), object('c', 2, 100, 0, 0)];

    expect(optimizeObjectOrder(input, { respectColors: true }).map((o) => o.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
    // Pure travel ignores the thread and takes the near blue block.
    expect(optimizeObjectOrder(input).map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic for an exact tie', () => {
    const input = [object('a', 0, 0, 0), object('b', 1, -10, 0)];
    expect(optimizeObjectOrder(input).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('reassigns order without mutating the input objects', () => {
    const input = [object('a', 0, 0, 0), object('b', 1, 50, 0), object('c', 2, 10, 0)];

    const out = optimizeObjectOrder(input);

    expect(input.map((o) => o.order)).toEqual([0, 1, 2]);
    expect(out[0]).not.toBe(input[0]);
  });

  it('leaves an empty or single design alone', () => {
    expect(optimizeObjectOrder([])).toEqual([]);
    const one = object('a', 0, 0, 0);
    expect(optimizeObjectOrder([one]).map((o) => o.id)).toEqual(['a']);
  });
});

describe('colour sort', () => {
  it('takes the nearest colour block next', () => {
    // Plain stable grouping would go red -> blue -> green; the nearest block
    // after red is the green one at x = 2, so the machine hops less.
    const groups = [group('red', 0, 0), group('blue', 1, 100), group('green', 2, 2)];

    const { stitches, colorChanges } = buildSequence(groups, PALETTE, { optimizeColors: true });

    expect(sewnOrder(stitches)).toEqual(['red', 'green', 'blue']);
    expect(colorChanges).toBe(2);
  });

  it('sews every object of a colour before changing thread', () => {
    const groups = [group('red1', 0, 0), group('blue', 1, 100), group('red2', 0, 5)];

    const { stitches, colorChanges } = buildSequence(groups, PALETTE, { optimizeColors: true });

    expect(sewnOrder(stitches)).toEqual(['red1', 'red2', 'blue']);
    // Without sorting the thread changes twice; sorting sews both reds first.
    expect(colorChanges).toBe(1);

    const naive = buildSequence(groups, PALETTE, { optimizeColors: false });
    expect(sewnOrder(naive.stitches)).toEqual(['red1', 'blue', 'red2']);
    expect(naive.colorChanges).toBe(2);
  });

  it('keeps the incoming order when optimization is off', () => {
    const groups = [group('red', 0, 0), group('blue', 1, 100), group('green', 2, 2)];

    const { stitches } = buildSequence(groups, PALETTE);

    expect(sewnOrder(stitches)).toEqual(['red', 'blue', 'green']);
  });
});
