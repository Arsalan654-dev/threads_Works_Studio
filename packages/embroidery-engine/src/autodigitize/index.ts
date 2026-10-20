/**
 * Auto-digitizing: raster image -> embroidery regions.
 *
 * The pipeline is four pure steps with no I/O and no DOM, so it runs both in
 * the browser (where the editor decodes the image) and in tests:
 *
 *   1. quantise   reduce the image to a small thread palette
 *   2. trace      walk each colour's boundary into closed polygons
 *   3. assemble   attach holes, drop noise, measure each region
 *   4. convert    scale pixels to millimetres and simplify the staircase
 *
 * What comes out is geometry plus measurements, not stitches and not
 * documents. Turning regions into objects (ids, params, undo) is the caller's
 * job, which keeps this module free of store concerns.
 */

import type { Bounds, Point, Ring, ThreadColor } from '../types.js';
import { scanlineSpans, simplifyPath } from '../geometry/index.js';
import { BACKGROUND, paletteHex, quantize, type RasterImage } from './quantize.js';
import { interiorPoint, pointInRing, traceMask, type PixelLoop } from './trace.js';

export { BACKGROUND, paletteHex } from './quantize.js';
export type { RasterImage } from './quantize.js';
export { traceMask, signedArea, pointInRing, interiorPoint } from './trace.js';
export type { PixelLoop } from './trace.js';
export { quantize } from './quantize.js';

export interface AutoDigitizeOptions {
  /** Thread colours to reduce to (1-24). Default 8. */
  colorCount?: number;
  /** Finished width of the traced design in mm. Default 100. */
  widthMm?: number;
  /** Regions smaller than this are dropped as noise. Default 0.8 mm². */
  minRegionMm2?: number;
  /** Regions thinner than this cannot be sewn reliably and are dropped. Default 0.6 mm. */
  minThicknessMm?: number;
  /** Alpha below this counts as background. Default 128. */
  alphaThreshold?: number;
  /** Extra contour simplification in mm. Default 0.15. */
  simplifyMm?: number;
  /**
   * Treat a colour that dominates the image border as an unpicked background.
   *
   * A JPEG logo almost always sits on a solid white surround; without this the
   * surround traces into a huge white fill. The test is deliberately strict
   * (see {@link BACKGROUND_BORDER_SHARE}) so a photo that simply runs off the
   * edges is left alone. Default true.
   */
  dropBackground?: boolean;
}

export interface AutoDigitizeRegion {
  colorIndex: number;
  /** Outer ring first, then its holes. Millimetres, y-down. */
  rings: Point[][];
  /** Outer area minus its holes, in mm². */
  areaMm2: number;
  bounds: Bounds;
  /** Twice the largest inscribed radius: roughly, how wide the region sews. */
  thicknessMm: number;
  /** Row direction for a fill, in degrees, along the region's long axis. */
  angleDeg: number;
}

export interface AutoDigitizeResult {
  /** Thread palette, most-used first; index matches `colorIndex`. */
  palette: ThreadColor[];
  /** Regions, grouped by colour and largest first within each colour. */
  regions: AutoDigitizeRegion[];
  /** One palette index per pixel, or BACKGROUND. Useful for a preview. */
  labels: Int16Array;
  imageWidth: number;
  imageHeight: number;
  /** Size of the traced design in mm. */
  widthMm: number;
  heightMm: number;
  mmPerPixel: number;
  /** Regions dropped for being below the area threshold. */
  droppedSmall: number;
  /** Regions dropped for being too thin to sew. */
  droppedThin: number;
  /** True when a dominant border colour was treated as background and removed. */
  droppedBackground: boolean;
}

const DEFAULTS = {
  colorCount: 8,
  widthMm: 100,
  minRegionMm2: 0.8,
  minThicknessMm: 0.6,
  alphaThreshold: 128,
  simplifyMm: 0.15,
  dropBackground: true,
} as const;

/**
 * A border colour has to cover this share of the border before it is treated
 * as background, and this share of the whole image for good measure. Together
 * they keep a full-bleed photo (border colours scattered, background huge but
 * not dominant on the edge alone) from losing a real colour.
 */
const BACKGROUND_BORDER_SHARE = 0.6;
const BACKGROUND_AREA_SHARE = 0.15;

/**
 * Does the candidate colour wrap around something?
 *
 * A page the design sits on does; a colour that simply covers the whole image
 * does not, and dropping that would erase the artwork entirely. Implemented as
 * a flood fill: any other colour the fill cannot reach from the border is
 * enclosed, which is exactly what a background does.
 */
function surroundsOtherColours(
  labels: Int16Array,
  width: number,
  height: number,
  candidate: number,
): boolean {
  const total = width * height;
  const reached = new Uint8Array(total);
  const stack: number[] = [];

  const isOther = (i: number): boolean => labels[i] !== candidate && labels[i]! >= 0;

  const seed = (i: number): void => {
    if (isOther(i) && reached[i] === 0) {
      reached[i] = 1;
      stack.push(i);
    }
  };

  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) seed(i - 1);
    if (x + 1 < width) seed(i + 1);
    if (y > 0) seed(i - width);
    if (y + 1 < height) seed(i + width);
  }

  for (let i = 0; i < total; i++) {
    if (isOther(i) && reached[i] === 0) return true;
  }
  return false;
}

/**
 * Find a colour that reads as "the page the design sits on": dominant along the
 * image border, a serious share of the whole image, and wrapping around at
 * least one other colour. Returns -1 when nothing qualifies, which is the
 * common case for a full-bleed photograph.
 */
function findBackgroundLabel(
  labels: Int16Array,
  width: number,
  height: number,
  paletteSize: number,
): number {
  const borderCounts = new Array<number>(paletteSize).fill(0);
  const totalCounts = new Array<number>(paletteSize).fill(0);
  let borderTotal = 0;

  for (let y = 0; y < height; y++) {
    const borderRow = y === 0 || y === height - 1;
    for (let x = 0; x < width; x++) {
      const label = labels[y * width + x]!;
      if (label < 0) continue;
      totalCounts[label]!++;
      if (!borderRow && x !== 0 && x !== width - 1) continue;
      borderCounts[label]!++;
      borderTotal++;
    }
  }

  if (borderTotal === 0) return -1;
  const totalPixels = width * height;

  let best = -1;
  let bestBorder = 0;
  for (let label = 0; label < paletteSize; label++) {
    if (borderCounts[label]! > bestBorder) {
      bestBorder = borderCounts[label]!;
      best = label;
    }
  }
  if (best < 0) return -1;
  if (bestBorder / borderTotal < BACKGROUND_BORDER_SHARE) return -1;
  if (totalCounts[best]! / totalPixels < BACKGROUND_AREA_SHARE) return -1;
  if (!surroundsOtherColours(labels, width, height, best)) return -1;
  return best;
}

/**
 * 3-4 chamfer distance transform: for each inside pixel, the distance (in
 * thirds of a pixel) to the nearest outside pixel. One pass forward, one back.
 *
 * Exported for tests: the auto-digitize planner reads thickness straight out
 * of it, so a wrong transform would silently mis-classify every region.
 */
export function chamferDistances(mask: Uint8Array, width: number, height: number): Int32Array {
  const pixelCount = width * height;
  const INF = 1 << 24;
  const dist = new Int32Array(pixelCount).fill(INF);

  // Outside pixels are the sources. A region that runs off the image edge also
  // has a boundary there, so its border pixels start one pixel in - the same
  // depth they would get from a real outside pixel just beyond the edge.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] === 0) {
        dist[i] = 0;
      } else if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        dist[i] = 3;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let d = dist[i]!;
      if (x > 0) d = Math.min(d, dist[i - 1]! + 3);
      if (y > 0) d = Math.min(d, dist[i - width]! + 3);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - width - 1]! + 4);
      if (x + 1 < width && y > 0) d = Math.min(d, dist[i - width + 1]! + 4);
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let d = dist[i]!;
      if (x + 1 < width) d = Math.min(d, dist[i + 1]! + 3);
      if (y + 1 < height) d = Math.min(d, dist[i + width]! + 3);
      if (x + 1 < width && y + 1 < height) d = Math.min(d, dist[i + width + 1]! + 4);
      if (x > 0 && y + 1 < height) d = Math.min(d, dist[i + width - 1]! + 4);
      dist[i] = d;
    }
  }

  return dist;
}

/**
 * Rasterise a region's rings back into a mask (even-odd, so holes cut out),
 * used to measure that one region rather than its whole colour.
 *
 * Exported for tests.
 */
export function rasterizeRings(rings: Ring[], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const spans = scanlineSpans(rings, y + 0.5);
    for (const [start, end] of spans) {
      const x0 = Math.max(0, Math.ceil(start - 0.5));
      const x1 = Math.min(width - 1, Math.floor(end - 0.5));
      for (let x = x0; x <= x1; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * Sewn width of a rasterised region, in pixels.
 *
 * The chamfer gives the distance from each pixel centre to the nearest outside
 * pixel centre, so twice it overstates a hairline by one pixel. Subtracting
 * that pixel leaves the estimate exact for one-pixel lines and within about
 * 10% for wide shapes - which is all the planner needs.
 */
function regionThicknessPx(
  rings: Ring[],
  width: number,
  height: number,
  colourDistances: Int32Array,
): number {
  const mask = rasterizeRings(rings, width, height);
  let max = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0 && colourDistances[i]! > max) max = colourDistances[i]!;
  }
  return Math.max(0, (2 * max) / 3 - 1);
}

/**
 * Angle of the region's long axis, in degrees. A fill sewn along this
 * direction crosses the region's short dimension, which is what keeps rows
 * from turning into long stitches on narrow shapes.
 */
function principalAngle(rings: Ring[]): number {
  // Boundary vertices, not pixels: cheap, and the elongation of a contour's
  // vertices tracks the elongation of the contour itself.
  let count = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  for (const ring of rings) {
    for (const p of ring) {
      count++;
      sx += p.x;
      sy += p.y;
      sxx += p.x * p.x;
      syy += p.y * p.y;
      sxy += p.x * p.y;
    }
  }
  if (count < 3) return 0;

  const mx = sx / count;
  const my = sy / count;
  const cxx = sxx / count - mx * mx;
  const cyy = syy / count - my * my;
  const cxy = sxy / count - mx * my;

  if (Math.abs(cxx) < 1e-9 && Math.abs(cyy) < 1e-9 && Math.abs(cxy) < 1e-9) return 0;
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  let degrees = (theta * 180) / Math.PI;
  // A row direction is symmetric, so fold it into [0, 180).
  while (degrees < 0) degrees += 180;
  while (degrees >= 180) degrees -= 180;
  return degrees;
}

function ringToMm(ring: Ring, scale: number, tolerance: number): Point[] {
  const closed: Ring = [...ring, { ...ring[0]! }];
  const simplified = simplifyPath(closed, tolerance);
  // Drop the repeated closing point: rings never repeat their first point.
  if (simplified.length > 1) simplified.pop();
  return simplified.map((p) => ({ x: p.x * scale, y: p.y * scale }));
}

/** Trace one colour's mask into regions, with holes attached and noise dropped. */
function regionsForColor(
  mask: Uint8Array,
  distances: Int32Array,
  width: number,
  height: number,
  colorIndex: number,
  scale: number,
  tolerance: number,
  minRegionMm2: number,
  minThicknessMm: number,
  counters: { droppedSmall: number; droppedThin: number },
): AutoDigitizeRegion[] {
  const loops = traceMask(mask, width, height);
  const outers: PixelLoop[] = [];
  const holes: PixelLoop[] = [];
  for (const loop of loops) {
    if (loop.area > 0) outers.push(loop);
    else if (loop.area < 0) holes.push(loop);
  }

  // Attach each hole to the smallest outer ring that contains it.
  const holesByOuter = new Map<PixelLoop, PixelLoop[]>();
  for (const hole of holes) {
    const probe = interiorPoint(hole.points);
    let owner: PixelLoop | null = null;
    for (const outer of outers) {
      if (!pointInRing(probe, outer.points)) continue;
      if (owner === null || outer.area < owner.area) owner = outer;
    }
    if (owner === null) continue; // orphan hole: nothing sensible to do with it
    const list = holesByOuter.get(owner);
    if (list === undefined) holesByOuter.set(owner, [hole]);
    else list.push(hole);
  }

  const regions: AutoDigitizeRegion[] = [];

  for (const outer of outers) {
    const attached = holesByOuter.get(outer) ?? [];

    let pixelArea = outer.area;
    for (const hole of attached) pixelArea += hole.area; // holes are negative

    const areaMm2 = pixelArea * scale * scale;
    if (areaMm2 < minRegionMm2) {
      counters.droppedSmall++;
      continue;
    }

    const pixelRings: Ring[] = [outer.points];
    for (const hole of attached) pixelRings.push(hole.points);

    const thicknessMm = regionThicknessPx(pixelRings, width, height, distances) * scale;
    if (thicknessMm < minThicknessMm) {
      counters.droppedThin++;
      continue;
    }

    const outerRing = ringToMm(outer.points, scale, tolerance);
    if (outerRing.length < 3) {
      counters.droppedSmall++;
      continue;
    }

    const rings: Point[][] = [outerRing];
    for (const hole of attached) {
      const holeRing = ringToMm(hole.points, scale, tolerance);
      if (holeRing.length >= 3) rings.push(holeRing);
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of outerRing) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    regions.push({
      colorIndex,
      rings,
      areaMm2,
      bounds: { minX, minY, maxX, maxY },
      thicknessMm,
      angleDeg: principalAngle(pixelRings),
    });
  }

  return regions;
}

/**
 * Digitize a raster image into embroidery regions.
 *
 * The result spans `[0, widthMm] x [0, heightMm]`; placing and scaling it into
 * a hoop is the caller's decision.
 */
export function autoDigitize(
  image: RasterImage,
  options: AutoDigitizeOptions = {},
): AutoDigitizeResult {
  const colorCount = Math.max(
    1,
    Math.min(24, Math.floor(options.colorCount ?? DEFAULTS.colorCount)),
  );
  const widthMm = Math.max(1, options.widthMm ?? DEFAULTS.widthMm);
  const minRegionMm2 = Math.max(0, options.minRegionMm2 ?? DEFAULTS.minRegionMm2);
  const minThicknessMm = Math.max(0, options.minThicknessMm ?? DEFAULTS.minThicknessMm);
  const alphaThreshold = options.alphaThreshold ?? DEFAULTS.alphaThreshold;
  const simplifyMm = Math.max(0, options.simplifyMm ?? DEFAULTS.simplifyMm);
  const dropBackground = options.dropBackground ?? DEFAULTS.dropBackground;

  const { width, height } = image;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new RangeError(`image must have positive dimensions (got ${width}x${height})`);
  }
  if (image.data.length < width * height * 4) {
    throw new RangeError(
      `image data is too short: ${image.data.length} bytes for ${width}x${height} RGBA`,
    );
  }

  const scale = widthMm / width;
  const heightMm = height * scale;
  // Simplification happens in pixel space, so the tolerance has to be in
  // pixels too - never below one, or a contour that is already minimal would
  // collapse into a stub.
  const tolerance = Math.max(simplifyMm / scale, 1.05);

  const { palette, labels } = quantize(image, colorCount, alphaThreshold);

  // A logo sitting on a solid surround should not trace the surround. Detect
  // it before anything else looks at the labels, then renumber so the exported
  // thread list only names threads the design actually uses.
  let droppedBackground = false;
  if (dropBackground) {
    const backgroundLabel = findBackgroundLabel(labels, width, height, palette.length);
    if (backgroundLabel >= 0) {
      droppedBackground = true;
      palette.splice(backgroundLabel, 1);
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i]!;
        if (label === backgroundLabel) labels[i] = BACKGROUND;
        else if (label > backgroundLabel) labels[i] = label - 1;
      }
    }
  }

  const counters = { droppedSmall: 0, droppedThin: 0 };
  const regions: AutoDigitizeRegion[] = [];
  const mask = new Uint8Array(width * height);

  for (let colorIndex = 0; colorIndex < palette.length; colorIndex++) {
    mask.fill(0);
    let any = false;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === colorIndex) {
        mask[i] = 1;
        any = true;
      }
    }
    if (!any) continue;

    const distances = chamferDistances(mask, width, height);
    regions.push(
      ...regionsForColor(
        mask,
        distances,
        width,
        height,
        colorIndex,
        scale,
        tolerance,
        minRegionMm2,
        minThicknessMm,
        counters,
      ),
    );
  }

  // Grouped by colour so the design sews one thread at a time; largest first
  // inside a colour, which is both a sane default and a stable order.
  regions.sort((a, b) => a.colorIndex - b.colorIndex || b.areaMm2 - a.areaMm2);

  const threads: ThreadColor[] = palette.map((entry, i) => ({
    id: `auto-${i + 1}`,
    code: `AUTO${i + 1}`,
    name: `Colour ${i + 1}`,
    hex: paletteHex(entry),
    brand: 'Digitized',
  }));

  return {
    palette: threads,
    regions,
    labels,
    imageWidth: width,
    imageHeight: height,
    widthMm,
    heightMm,
    mmPerPixel: scale,
    droppedSmall: counters.droppedSmall,
    droppedThin: counters.droppedThin,
    droppedBackground,
  };
}
