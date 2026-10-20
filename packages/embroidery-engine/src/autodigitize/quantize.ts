/**
 * Colour quantisation for auto-digitizing.
 *
 * Median cut over a histogram that buckets each channel to 5 bits. Median cut
 * is chosen over k-means deliberately: it is deterministic, so the same image
 * always produces the same palette and the same stitches, which is what makes
 * an auto-digitized design reproducible (and testable).
 */

/** A raster image as raw RGBA bytes, row-major. */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Pixels that must not be stitched at all (transparent background). */
export const BACKGROUND = -1;

export interface QuantizedImage {
  /** Thread colours, most-used first. */
  palette: Array<{ r: number; g: number; b: number }>;
  /** One palette index per pixel, or {@link BACKGROUND}. */
  labels: Int16Array;
}

const BITS = 5;
const SHIFT = 8 - BITS;

interface Bucket {
  r: number;
  g: number;
  b: number;
  count: number;
}

type Axis = 'r' | 'g' | 'b';

function axisValue(entry: Bucket, axis: Axis): number {
  return axis === 'r' ? entry.r : axis === 'g' ? entry.g : entry.b;
}

/** Widest channel spread in a box - the axis median cut will split along. */
function widestAxis(box: Bucket[]): { axis: Axis; range: number } {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (const entry of box) {
    if (entry.r < minR) minR = entry.r;
    if (entry.r > maxR) maxR = entry.r;
    if (entry.g < minG) minG = entry.g;
    if (entry.g > maxG) maxG = entry.g;
    if (entry.b < minB) minB = entry.b;
    if (entry.b > maxB) maxB = entry.b;
  }
  const rRange = (maxR - minR) * 0.3; // eye weight: green carries more detail
  const gRange = (maxG - minG) * 0.59;
  const bRange = (maxB - minB) * 0.11;
  if (gRange >= rRange && gRange >= bRange) return { axis: 'g', range: gRange };
  if (rRange >= bRange) return { axis: 'r', range: rRange };
  return { axis: 'b', range: bRange };
}

function boxCount(box: Bucket[]): number {
  let total = 0;
  for (const entry of box) total += entry.count;
  return total;
}

/**
 * Reduce an image to `colorCount` representative colours.
 *
 * @param alphaThreshold pixels with alpha below this are background
 */
export function quantize(
  image: RasterImage,
  colorCount: number,
  alphaThreshold = 128,
): QuantizedImage {
  const { width, height, data } = image;
  const pixelCount = width * height;

  // --- histogram ---------------------------------------------------------
  const histogram = new Map<number, Bucket>();
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    if (data[o + 3]! < alphaThreshold) continue;
    const r = data[o]!;
    const g = data[o + 1]!;
    const b = data[o + 2]!;
    const key = ((r >> SHIFT) << (BITS * 2)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);
    const hit = histogram.get(key);
    if (hit) hit.count++;
    else histogram.set(key, { r, g, b, count: 1 });
  }

  if (histogram.size === 0) {
    return { palette: [], labels: new Int16Array(pixelCount).fill(BACKGROUND) };
  }

  // --- median cut --------------------------------------------------------
  const target = Math.max(1, Math.min(Math.floor(colorCount), histogram.size));
  const boxes: Bucket[][] = [[...histogram.values()]];

  while (boxes.length < target) {
    let bestIndex = -1;
    let bestRange = -1;
    let bestCount = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.length < 2) continue;
      const { range } = widestAxis(box);
      const count = boxCount(box);
      if (range > bestRange || (range === bestRange && count > bestCount)) {
        bestIndex = i;
        bestRange = range;
        bestCount = count;
      }
    }
    if (bestIndex < 0) break; // every box is a single colour already

    const box = boxes[bestIndex]!;
    const { axis } = widestAxis(box);
    box.sort((a, b) => axisValue(a, axis) - axisValue(b, axis));

    // Split where half the pixels lie on either side, and never leave a side
    // empty - a box with no colours would waste a palette entry.
    const total = boxCount(box);
    let accumulated = 0;
    let split = 0;
    for (let i = 0; i < box.length - 1; i++) {
      accumulated += box[i]!.count;
      if (accumulated * 2 >= total) {
        split = i + 1;
        break;
      }
    }
    if (split <= 0 || split >= box.length) split = Math.max(1, box.length >> 1);

    boxes.splice(bestIndex, 1, box.slice(0, split), box.slice(split));
  }

  // --- representative colours -------------------------------------------
  interface Entry {
    r: number;
    g: number;
    b: number;
    weight: number;
  }
  const entries: Entry[] = boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (const entry of box) {
      r += entry.r * entry.count;
      g += entry.g * entry.count;
      b += entry.b * entry.count;
      weight += entry.count;
    }
    return {
      r: Math.round(r / weight),
      g: Math.round(g / weight),
      b: Math.round(b / weight),
      weight,
    };
  });

  // Most-used colour first: the machine's thread list then reads in the order
  // the design actually sews.
  entries.sort((a, b) => b.weight - a.weight);

  // --- per-pixel assignment ---------------------------------------------
  const labels = new Int16Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    if (data[o + 3]! < alphaThreshold) {
      labels[i] = BACKGROUND;
      continue;
    }
    const r = data[o]!;
    const g = data[o + 1]!;
    const b = data[o + 2]!;
    let best = 0;
    let bestDistance = Infinity;
    for (let k = 0; k < entries.length; k++) {
      const entry = entries[k]!;
      const dr = r - entry.r;
      const dg = g - entry.g;
      const db = b - entry.b;
      // Weighted like the median-cut axis choice, so the assignment agrees with
      // how the boxes were built.
      const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = k;
      }
    }
    labels[i] = best;
  }

  return {
    palette: entries.map((e) => ({ r: e.r, g: e.g, b: e.b })),
    labels,
  };
}

/** `#RRGGBB` for a palette entry. */
export function paletteHex(entry: { r: number; g: number; b: number }): string {
  const hex = (v: number): string => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${hex(entry.r)}${hex(entry.g)}${hex(entry.b)}`.toUpperCase();
}
