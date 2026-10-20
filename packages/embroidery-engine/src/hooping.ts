/**
 * Automatic hoop selection.
 *
 * Given how much room a design actually needs, choose the smallest frame from
 * the machine's hoop library that will hold it. Two things make this more
 * than a sort by area:
 *
 *  - Every hoop carries a safe margin, so the usable field is smaller than the
 *    hoop's nominal size. A 100x100 frame with a 4 mm margin only stitches
 *    inside 92x92, and choosing on nominal size would pick frames the design
 *    cannot legally reach.
 *  - A tall, narrow design (a name on a cap, a vertical border) often fits a
 *    wide, shallow hoop once turned a quarter turn. Rotation is offered
 *    rather than assumed, because turning the design changes what the user
 *    drew.
 *
 * Everything here is a pure function of its inputs so the choice is
 * reproducible and testable without a machine or a canvas.
 */

import type { Bounds, Hoop } from './types.js';

/** How much room a design needs, in millimetres. */
export interface HoopNeed {
  width: number;
  height: number;
}

/** A hoop together with whether the design has to be turned to fit it. */
export interface HoopFit {
  hoop: Hoop;
  /** True when the design only fits this hoop after a 90-degree turn. */
  rotated: boolean;
}

export interface PickHoopOptions {
  /**
   * Allow a 90-degree turn when considering whether a design fits.
   *
   * Defaults to true. Callers that must not alter the design's orientation -
   * because turning it would be surprising, or the design is already
   * committed to a direction - pass false and get a stricter answer.
   */
  allowRotation?: boolean;
}

/**
 * The stitching area actually available inside a hoop, in millimetres.
 *
 * Returns a zero-or-negative size for a hoop whose margin eats the whole
 * field, so such a hoop can never be selected by accident.
 */
export function usableField(hoop: Hoop): { width: number; height: number } {
  return {
    width: hoop.width - hoop.safeMargin * 2,
    height: hoop.height - hoop.safeMargin * 2,
  };
}

/**
 * Choose the smallest hoop that fits a design of the given size.
 *
 * Selection order, most to least important:
 *   1. It has to fit at all, after subtracting the safe margin.
 *   2. Smaller area wins, so a 100x100 beats a 180x130 for a small logo.
 *   3. On equal area, an unrotated fit beats a rotated one - all else being
 *      equal, leaving the design as the user drew it is the better answer.
 *   4. Still tied, the roomier frame wins, so the needle is not working right
 *      against the edge of the field.
 *
 * Returns null when nothing in the library is large enough, which the caller
 * should report rather than silently pick a too-small frame.
 */
export function pickHoop(
  need: HoopNeed,
  hoops: Hoop[],
  options: PickHoopOptions = {},
): HoopFit | null {
  const allowRotation = options.allowRotation ?? true;
  const needW = Math.max(0, need.width);
  const needH = Math.max(0, need.height);

  let best: HoopFit | null = null;
  let bestArea = Infinity;
  let bestSlack = -Infinity;

  for (const hoop of hoops) {
    const field = usableField(hoop);
    if (field.width <= 0 || field.height <= 0) continue;

    // Does the design fit without turning it?
    const direct = needW <= field.width && needH <= field.height;
    // Does it fit turned a quarter turn? The axes swap.
    const turned = allowRotation && needW <= field.height && needH <= field.width;

    if (!direct && !turned) continue;

    const area = hoop.width * hoop.height;
    // How much spare room is left on the tighter axis - used only to break
    // ties between hoops of equal area.
    const slack = direct
      ? Math.min(field.width - needW, field.height - needH)
      : Math.min(field.height - needW, field.width - needH);

    const better =
      area < bestArea ||
      (area === bestArea && best !== null && best.rotated && !turned) ||
      (area === bestArea && best !== null && best.rotated === turned && slack > bestSlack);

    if (best === null || better) {
      best = { hoop, rotated: !direct && turned };
      bestArea = area;
      bestSlack = slack;
    }
  }

  return best;
}

/**
 * Rotate an object's geometry about a point.
 *
 * The engine deliberately does not apply `obj.transform` at stitch time, so a
 * rotation has to be baked into the source geometry to be real - and baking it
 * keeps the editable outline correct on screen rather than drifting away from
 * what will sew. The result is what the user sees and what the machine gets.
 */
export function rotateObject<T extends { path: { rings: { x: number; y: number }[][] } }>(
  obj: T,
  angleDegrees: number,
  about: { x: number; y: number },
): T {
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rings = obj.path.rings.map((ring) =>
    ring.map((p) => {
      const dx = p.x - about.x;
      const dy = p.y - about.y;
      return {
        x: about.x + dx * cos - dy * sin,
        y: about.y + dx * sin + dy * cos,
      };
    }),
  );

  return { ...obj, path: { ...obj.path, rings } };
}

/** Centre of a bounding box - where a design should sit inside a hoop. */
export function boundsMidpoint(b: Bounds): { x: number; y: number } {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/**
 * Mirror an object's geometry across a vertical axis.
 *
 * Like `rotateObject`, this bakes the flip into the source coordinates rather
 * than storing a flag: the engine never applies `transform` at stitch time, so
 * a flag would be invisible to the machine while the outline on screen stayed
 * unflipped. Baking keeps what you see and what you sew identical, and leaves
 * the editable outline correct for node editing afterwards.
 *
 * `about.x` is the vertical line to mirror across - usually the object's own
 * bounds centre so the shape flips in place instead of jumping sideways.
 */
export function flipObjectX<T extends { path: { rings: { x: number; y: number }[][] } }>(
  obj: T,
  aboutX: number,
): T {
  const rings = obj.path.rings.map((ring) => ring.map((p) => ({ x: 2 * aboutX - p.x, y: p.y })));
  return { ...obj, path: { ...obj.path, rings } };
}

/**
 * Scale an object's geometry about a point.
 *
 * Baked for the same reason as `flipObjectX`. A uniform scale keeps the shape's
 * proportions; a non-uniform one (different sx/sy) stretches it, which is what
 * a "stretch to fit" handle does. The caller passes the object's bounds centre
 * so scaling grows the shape outward from its middle rather than from the
 * canvas origin.
 */
export function scaleObject<T extends { path: { rings: { x: number; y: number }[][] } }>(
  obj: T,
  sx: number,
  sy: number,
  about: { x: number; y: number },
): T {
  const rings = obj.path.rings.map((ring) =>
    ring.map((p) => ({
      x: about.x + (p.x - about.x) * sx,
      y: about.y + (p.y - about.y) * sy,
    })),
  );
  return { ...obj, path: { ...obj.path, rings } };
}
