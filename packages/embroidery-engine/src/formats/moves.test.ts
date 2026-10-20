import { describe, it, expect } from 'vitest';
import { planMove, roundHalfToEven } from './moves.js';

/**
 * One walk of a move, shared by DST, EXP and JEF.
 *
 * Each of those formats caps a single record, so a longer move has to be
 * written as a chain of hops, and how a hop that lands on exactly half a unit
 * is rounded decides which side of that line the needle comes down on. The
 * reference implementation rounds halves to the even unit, and getting that
 * wrong is the difference between a file that reads back byte for byte and
 * one that is subtly, untraceably out by a tenth of a millimetre.
 */
describe('roundHalfToEven', () => {
  it('sends halves to the even side, in both directions', () => {
    expect(roundHalfToEven(100.5)).toBe(100);
    expect(roundHalfToEven(101.5)).toBe(102);
    expect(roundHalfToEven(2.5)).toBe(2);
    expect(roundHalfToEven(3.5)).toBe(4);
    // Negative halves are the ones Math.round gets most wrong.
    expect(roundHalfToEven(-83.5)).toBe(-84);
    expect(roundHalfToEven(-82.5)).toBe(-82);
  });

  it('leaves everything else to ordinary rounding', () => {
    expect(roundHalfToEven(2.4)).toBe(2);
    expect(roundHalfToEven(2.6)).toBe(3);
    expect(roundHalfToEven(-2.6)).toBe(-3);
    expect(roundHalfToEven(0)).toBe(0);
  });
});

describe('planMove', () => {
  it('leaves a move that fits in one record alone', () => {
    expect(planMove(50, 40, 121)).toEqual([{ x: 50, y: 40, fx: 50, fy: 40 }]);
  });

  it('walks from the last landing, so halves alternate instead of drifting', () => {
    // 402 over four parts is 100.5 a part. Measured from the origin each hop
    // would round to 101 four times over; measured from where the needle last
    // landed they alternate, which is what the reference writes.
    expect(planMove(402, 0, 127).map((h) => h.x)).toEqual([100, 101, 100, 101]);
  });

  it('closes the move exactly and stays inside the limit on any route', () => {
    const routes: Array<[number, number]> = [
      [402, 0],
      [1004, 403],
      [-1002, -1404],
      [363, 363],
      [121, 121],
      [-1, -600],
    ];

    for (const [dx, dy] of routes) {
      const hops = planMove(dx, dy, 121);
      expect(
        hops.reduce((s, h) => s + h.x, 0),
        `dx=${dx}`,
      ).toBe(dx);
      expect(
        hops.reduce((s, h) => s + h.y, 0),
        `dy=${dy}`,
      ).toBe(dy);
      for (const hop of hops) {
        expect(Math.abs(hop.x), `dx=${dx} dy=${dy}`).toBeLessThanOrEqual(121);
        expect(Math.abs(hop.y), `dx=${dx} dy=${dy}`).toBeLessThanOrEqual(121);
      }
      // The needle's real position tracks the whole route, and the last hop
      // is exactly on the target rather than merely near it.
      expect(hops[hops.length - 1]!.fx).toBe(dx);
      expect(hops[hops.length - 1]!.fy).toBe(dy);
    }
  });

  it('keeps every hop inside the limit across a sweep of routes', () => {
    // A hop can be pushed past the limit by rounding alone when the parts do
    // not divide evenly, so the planner takes another step rather than hand a
    // machine a record it cannot carry.
    for (let dx = 1; dx <= 700; dx += 7) {
      const hops = planMove(dx, 0, 121);
      for (const hop of hops) expect(Math.abs(hop.x), `dx=${dx}`).toBeLessThanOrEqual(121);
      expect(
        hops.reduce((s, h) => s + h.x, 0),
        `dx=${dx}`,
      ).toBe(dx);
    }
  });
});
