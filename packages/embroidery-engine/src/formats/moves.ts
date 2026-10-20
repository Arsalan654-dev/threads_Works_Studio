/**
 * Dividing a move that is too long for one machine record.
 *
 * Every format here caps a single record - Tajima DST at 12.1 mm, Melco EXP and
 * Janome JEF at 12.7 mm - so a longer move has to be written as a chain of
 * hops. How those hops are rounded is not cosmetic: a hop that lands exactly
 * halfway between two 0.1 mm units can go either way, and the reference
 * implementation (pyembroidery, the reader behind Ink/Stitch) rounds halves to
 * the even unit, the same as Python's `round()`. Walking the route in floating
 * point and rounding each hop that way is what makes our records agree with it
 * byte for byte.
 *
 * This is the single place that division happens, so DST, EXP and JEF cannot
 * drift apart from each other - or from the reference - one format at a time.
 */

/**
 * Banker's rounding: a value ending in .5 goes to the nearest even whole
 * number, in both directions. Plain `Math.round` goes the other way on every
 * odd value (`Math.round(100.5) === 101`).
 */
export function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * One hop of a planned move: where to write the record, and where the needle
 * actually ends up along the route (which can fall between two 0.1 mm units).
 */
export interface PlannedHop {
  /** Whole 0.1 mm hop to write, measured from the last landing. */
  x: number;
  y: number;
  /** Where the needle is along the route after this hop. */
  fx: number;
  fy: number;
}

/**
 * Plan a move as the chain of records that carries it.
 *
 * The route is divided into equal parts in floating point, and each part is
 * written as a whole hop measured from where the needle last *landed* rather
 * than from the origin. The difference shows up whenever a part ends halfway
 * between two units: measured from the last landing the hops alternate either
 * side of that line instead of all drifting the same way, which is why a long
 * move comes out in the reference's order rather than the obvious one.
 *
 * The final hop always closes the move exactly, so the records cannot drift
 * away from their destination.
 */
export function planMove(dx: number, dy: number, maxStep: number): PlannedHop[] {
  if (Math.abs(dx) <= maxStep && Math.abs(dy) <= maxStep) {
    return [{ x: dx, y: dy, fx: dx, fy: dy }];
  }

  let parts = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep);
  for (;;) {
    const out: PlannedHop[] = [];
    let qx = 0;
    let qy = 0;
    let wx = 0;
    let wy = 0;
    let fits = true;

    for (let i = 0; i < parts; i++) {
      qx += dx / parts;
      qy += dy / parts;
      const last = i === parts - 1;
      const hx = last ? dx - wx : roundHalfToEven(qx - wx);
      const hy = last ? dy - wy : roundHalfToEven(qy - wy);
      if (Math.abs(hx) > maxStep || Math.abs(hy) > maxStep) {
        fits = false;
        break;
      }
      out.push({ x: hx, y: hy, fx: last ? dx : qx, fy: last ? dy : qy });
      wx += hx;
      wy += hy;
    }
    if (fits) return out;
    // Rounding has pushed a hop past the limit that one more step would avoid.
    parts += 1;
  }
}
