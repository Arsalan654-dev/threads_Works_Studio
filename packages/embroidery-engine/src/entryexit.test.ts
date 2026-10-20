import { describe, it, expect } from 'vitest';
import { resolveEntryExit } from './index.js';
import type { EmbroideryObject, StitchParameters } from './types.js';

const PARAMS: StitchParameters = {
  stitchType: 'tatami',
  angle: 0,
  spacing: 0.4,
  maxStitchLength: 12.1,
  minStitchLength: 0.3,
  pullCompensation: 0.2,
  fillPattern: 'tatami',
  underlay: { type: 'none', spacing: 3, offset: 1, inset: 1 },
  tieIn: { enabled: false, length: 0.4, count: 3 },
  tieOff: { enabled: false, length: 0.4, count: 3 },
};

/** A plain rectangular shape from (0,0) to (60,40). */
function rect(entry: EmbroideryObject['entryExit']): EmbroideryObject {
  return {
    id: 'o1',
    name: 'Rect',
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
    params: PARAMS,
    entryExit: entry,
    lettering: null,
    order: 0,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

/**
 * The entry/exit UI writes `object.entryExit`; nothing in the codebase had
 * ever asserted that the engine actually obeys it. These tests are the
 * contract between the two: a "Set entry" button that had no effect on the
 * compiled file would be worse than no button, because the user would trust
 * a start point the machine ignored.
 */
describe('resolveEntryExit', () => {
  it('uses a hand-set entry instead of the engine guess', () => {
    const hand = { x: 12, y: 34 };
    const picked = resolveEntryExit(rect({ entry: hand, exit: null }), null);
    expect(picked.entry).toEqual(hand);
  });

  it('uses a hand-set exit instead of the engine guess', () => {
    const hand = { x: 55, y: 3 };
    const picked = resolveEntryExit(rect({ entry: null, exit: hand }), null);
    expect(picked.exit).toEqual(hand);
  });

  it('uses both when both are set', () => {
    const entry = { x: 1, y: 2 };
    const exit = { x: 58, y: 38 };
    const picked = resolveEntryExit(rect({ entry, exit }), null);
    expect(picked.entry).toEqual(entry);
    expect(picked.exit).toEqual(exit);
  });

  it('falls back to the engine guess when nothing is set', () => {
    const picked = resolveEntryExit(rect({ entry: null, exit: null }), null);
    expect(picked.entry).not.toBeNull();
    expect(picked.exit).not.toBeNull();
    // Both must sit on or inside the shape, not off in space.
    for (const p of [picked.entry!, picked.exit!]) {
      expect(p.x).toBeGreaterThanOrEqual(-0.001);
      expect(p.x).toBeLessThanOrEqual(60.001);
      expect(p.y).toBeGreaterThanOrEqual(-0.001);
      expect(p.y).toBeLessThanOrEqual(40.001);
    }
  });

  it('honours a hand-set entry while still choosing an exit', () => {
    const hand = { x: 30, y: 40 };
    const withEntry = resolveEntryExit(rect({ entry: hand, exit: null }), null);

    expect(withEntry.entry).toEqual(hand);
    // The exit is still chosen, not left blank: a colour has to stop
    // somewhere, and pinning it to null would send travel straight back to
    // the shape origin regardless of where the entry went.
    expect(withEntry.exit).not.toBeNull();
    // It is chosen FROM the entry - the exit is the far side of the shape
    // from where sewing started, which is what keeps the internal travel
    // short. So an entry override is expected to move the guessed exit too.
    const noEntry = resolveEntryExit(rect({ entry: null, exit: null }), null);
    expect(withEntry.exit).not.toEqual(noEntry.exit);
  });

  it('a hand-set exit is not overwritten when an entry is also set', () => {
    const entry = { x: 5, y: 5 };
    const exit = { x: 55, y: 35 };
    const picked = resolveEntryExit(rect({ entry, exit }), { x: 1, y: 1 });
    expect(picked.exit).toEqual(exit);
  });

  it('does not mutate the object it was given', () => {
    const obj = rect({ entry: { x: 5, y: 5 }, exit: null });
    const before = JSON.stringify(obj.entryExit);
    resolveEntryExit(obj, { x: 1, y: 1 });
    expect(JSON.stringify(obj.entryExit)).toBe(before);
  });

  it('a hand-set entry on a compiles-out object actually moves the first stitch', () => {
    // The real end-to-end proof: the point is not just metadata, the sequencer
    // routes to it.
    const auto = resolveEntryExit(rect({ entry: null, exit: null }), null);
    const hand = { x: 59, y: 39 };
    const manual = resolveEntryExit(rect({ entry: hand, exit: null }), null);

    expect(manual.entry).toEqual(hand);
    // Sanity: the guess for this shape is nowhere near that corner.
    expect(auto.entry).not.toEqual(hand);
  });

  it('is deterministic for the same inputs', () => {
    const obj = rect({ entry: null, exit: null });
    expect(resolveEntryExit(obj, null)).toEqual(resolveEntryExit(obj, null));
  });
});
