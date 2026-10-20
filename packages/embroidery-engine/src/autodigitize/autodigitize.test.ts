import { describe, it, expect } from 'vitest';
import {
  autoDigitize,
  quantize,
  traceMask,
  rasterizeRings,
  BACKGROUND,
  type RasterImage,
} from './index.js';
import { signedArea } from './trace.js';

/** A fully transparent RGBA image of the given size. */
function blank(width: number, height: number): RasterImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function setPixel(
  image: RasterImage,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const o = (y * image.width + x) * 4;
  image.data[o] = r;
  image.data[o + 1] = g;
  image.data[o + 2] = b;
  image.data[o + 3] = a;
}

function fillRect(
  image: RasterImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(image, x, y, r, g, b, a);
  }
}

const RED = [220, 30, 40] as const;
const BLUE = [30, 60, 200] as const;

// ---------------------------------------------------------------------------
// quantisation
// ---------------------------------------------------------------------------

describe('quantize', () => {
  it('keeps a single flat colour as one palette entry', () => {
    const image = blank(8, 8);
    fillRect(image, 0, 0, 8, 8, ...RED);

    const { palette, labels } = quantize(image, 8, 128);

    expect(palette).toHaveLength(1);
    expect(palette[0]).toEqual({ r: RED[0], g: RED[1], b: RED[2] });
    for (const label of labels) expect(label).toBe(0);
  });

  it('separates two well-spread colours', () => {
    const image = blank(8, 4);
    fillRect(image, 0, 0, 4, 4, ...RED);
    fillRect(image, 4, 0, 4, 4, ...BLUE);

    const { palette, labels } = quantize(image, 8, 128);

    expect(palette).toHaveLength(2);
    // Most-used first is a tie here, so just check both colours survived.
    const asHex = palette.map((p) => `${p.r},${p.g},${p.b}`).sort();
    expect(asHex).toEqual(
      [`${BLUE[0]},${BLUE[1]},${BLUE[2]}`, `${RED[0]},${RED[1]},${RED[2]}`].sort(),
    );
    // Left half and right half must not share a label.
    expect(labels[0]).not.toBe(labels[7]);
  });

  it('orders the palette by how much of the image each colour covers', () => {
    const image = blank(10, 4);
    fillRect(image, 0, 0, 7, 4, ...RED); // 28 px
    fillRect(image, 7, 0, 3, 4, ...BLUE); // 12 px

    const { palette } = quantize(image, 8, 128);

    expect(palette[0]).toEqual({ r: RED[0], g: RED[1], b: RED[2] });
    expect(palette[1]).toEqual({ r: BLUE[0], g: BLUE[1], b: BLUE[2] });
  });

  it('treats transparent pixels as background', () => {
    const image = blank(4, 1);
    fillRect(image, 0, 0, 2, 1, ...RED);
    // The right half stays transparent.

    const { labels } = quantize(image, 4, 128);

    expect(labels[0]).toBe(0);
    expect(labels[2]).toBe(BACKGROUND);
    expect(labels[3]).toBe(BACKGROUND);
  });

  it('returns an empty palette for a fully transparent image', () => {
    const { palette, labels } = quantize(blank(4, 4), 8, 128);
    expect(palette).toHaveLength(0);
    expect(Array.from(labels).every((l) => l === BACKGROUND)).toBe(true);
  });

  it('merges colours when asked for fewer than are present', () => {
    const image = blank(3, 1);
    setPixel(image, 0, 0, 10, 10, 10);
    setPixel(image, 1, 0, 250, 250, 250);
    setPixel(image, 2, 0, 130, 130, 130);

    const { palette, labels } = quantize(image, 2, 128);

    expect(palette).toHaveLength(2);
    // The mid grey must join one of the two extremes, not create a third.
    expect(new Set(Array.from(labels)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// contour tracing
// ---------------------------------------------------------------------------

describe('traceMask', () => {
  it('traces a filled rectangle as one ring with positive area', () => {
    const width = 6;
    const height = 4;
    const mask = new Uint8Array(width * height).fill(1);

    const loops = traceMask(mask, width, height);

    expect(loops).toHaveLength(1);
    // Shoelace area of a w x h pixel block is exactly w * h.
    expect(loops[0]!.area).toBe(width * height);
    expect(loops[0]!.points).toHaveLength(2 * (width + height));
  });

  it('returns no loops for an empty mask', () => {
    expect(traceMask(new Uint8Array(16), 4, 4)).toHaveLength(0);
  });

  it('traces disconnected regions separately', () => {
    // Two 2x2 blocks with a gap between them.
    const width = 6;
    const height = 2;
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < 2; y++) {
      for (const x of [0, 1, 4, 5]) mask[y * width + x] = 1;
    }

    const loops = traceMask(mask, width, height);

    expect(loops).toHaveLength(2);
    for (const loop of loops) expect(loop.area).toBe(4);
  });

  it('traces a hole as a ring winding the other way', () => {
    // A 6x6 block with the middle 2x2 removed: one outer ring plus one hole.
    const width = 6;
    const height = 6;
    const mask = new Uint8Array(width * height).fill(1);
    for (let y = 2; y < 4; y++) {
      for (let x = 2; x < 4; x++) mask[y * width + x] = 0;
    }

    const loops = traceMask(mask, width, height);

    expect(loops).toHaveLength(2);
    const outer = loops.find((l) => l.area > 0);
    const hole = loops.find((l) => l.area < 0);
    expect(outer?.area).toBe(36);
    expect(hole?.area).toBe(-4);
  });

  it('encloses diagonally touching blocks even if the walk welds their rings', () => {
    // (0,0) and (1,1) touch only at a corner. The boundary walk may join them
    // into one figure-eight, which the even-odd fill still reads correctly, so
    // assert the enclosed area rather than a ring count.
    const width = 2;
    const height = 2;
    const mask = new Uint8Array([1, 0, 0, 1]);

    const loops = traceMask(mask, width, height);

    expect(loops.length).toBeGreaterThanOrEqual(1);
    for (const loop of loops) expect(loop.points.length).toBeGreaterThanOrEqual(3);
    const total = loops.reduce((sum, loop) => sum + loop.area, 0);
    expect(total).toBe(2);

    // Rasterising the traced rings must light up exactly the two pixels.
    const raster = rasterizeRings(
      loops.map((loop) => loop.points),
      width,
      height,
    );
    expect(Array.from(raster)).toEqual([1, 0, 0, 1]);
  });

  it('closes a region that runs off the image edge', () => {
    const mask = new Uint8Array([1, 1, 1, 1]); // 2x2, all inside
    const loops = traceMask(mask, 2, 2);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.area).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// full pipeline
// ---------------------------------------------------------------------------

describe('autoDigitize', () => {
  it('turns a solid block into one region spanning the requested width', () => {
    const image = blank(20, 10);
    fillRect(image, 0, 0, 20, 10, ...RED);

    const result = autoDigitize(image, { widthMm: 100, colorCount: 4 });

    expect(result.regions).toHaveLength(1);
    const region = result.regions[0]!;
    expect(region.rings).toHaveLength(1);
    expect(region.bounds.minX).toBeCloseTo(0, 6);
    expect(region.bounds.maxX).toBeCloseTo(100, 6);
    expect(region.bounds.minY).toBeCloseTo(0, 6);
    expect(region.bounds.maxY).toBeCloseTo(50, 6);
    expect(region.areaMm2).toBeCloseTo(5000, 3);
    expect(result.widthMm).toBe(100);
    expect(result.heightMm).toBe(50);
    expect(result.mmPerPixel).toBeCloseTo(5, 9);
  });

  it('measures thickness as the region short dimension', () => {
    const image = blank(20, 10);
    fillRect(image, 0, 0, 20, 10, ...RED);

    const result = autoDigitize(image, { widthMm: 100, colorCount: 4 });

    // 5 mm per pixel and a 10 px tall block: the estimate lands within a pixel
    // of the true 50 mm without ever overstating a hairline.
    const thickness = result.regions[0]!.thicknessMm;
    expect(thickness).toBeGreaterThan(40);
    expect(thickness).toBeLessThanOrEqual(50);
  });

  it('points the fill angle along a tall region', () => {
    const image = blank(6, 30);
    fillRect(image, 0, 0, 6, 30, ...RED);

    const result = autoDigitize(image, { widthMm: 30, colorCount: 4 });

    // Vertical elongation means a 90 degree row direction.
    expect(result.regions[0]!.angleDeg).toBeCloseTo(90, 0);
  });

  it('points the fill angle along a wide region', () => {
    const image = blank(30, 6);
    fillRect(image, 0, 0, 30, 6, ...RED);

    const result = autoDigitize(image, { widthMm: 30, colorCount: 4 });

    const angle = result.regions[0]!.angleDeg;
    expect(Math.min(angle, 180 - angle)).toBeLessThan(1);
  });

  it('keeps a hole attached to its outer ring', () => {
    const image = blank(20, 20);
    fillRect(image, 0, 0, 20, 20, ...RED);
    // Punch a transparent hole in the middle.
    fillRect(image, 8, 8, 4, 4, 0, 0, 0, 0);

    const result = autoDigitize(image, { widthMm: 100, colorCount: 4 });

    expect(result.regions).toHaveLength(1);
    const region = result.regions[0]!;
    expect(region.rings).toHaveLength(2);

    const outer = region.rings[0]!;
    const hole = region.rings[1]!;
    expect(signedArea(outer)).toBeGreaterThan(0);
    expect(signedArea(hole)).toBeLessThan(0);
    // 400 px minus a 16 px hole, at 5 mm/px.
    expect(region.areaMm2).toBeCloseTo((400 - 16) * 25, 3);
  });

  it('separates colours and groups the result by colour', () => {
    const image = blank(20, 10);
    fillRect(image, 0, 0, 10, 10, ...RED);
    fillRect(image, 10, 0, 10, 10, ...BLUE);

    const result = autoDigitize(image, { widthMm: 50, colorCount: 4 });

    expect(result.palette).toHaveLength(2);
    expect(result.regions).toHaveLength(2);
    expect(result.regions[0]!.colorIndex).toBe(0);
    expect(result.regions[1]!.colorIndex).toBe(1);
  });

  it('orders regions inside a colour by size, largest first', () => {
    const image = blank(30, 10);
    fillRect(image, 0, 0, 6, 10, ...RED); // 60 px
    fillRect(image, 10, 0, 18, 10, ...RED); // 180 px

    const result = autoDigitize(image, { widthMm: 30, colorCount: 4, minRegionMm2: 0.01 });

    expect(result.regions).toHaveLength(2);
    expect(result.regions[0]!.areaMm2).toBeGreaterThan(result.regions[1]!.areaMm2);
  });

  it('drops noise below the area threshold and reports it', () => {
    const image = blank(40, 20);
    fillRect(image, 0, 0, 30, 20, ...RED);
    setPixel(image, 38, 18, ...RED); // a single stray pixel

    const result = autoDigitize(image, { widthMm: 40, colorCount: 4, minRegionMm2: 0.5 });

    expect(result.regions).toHaveLength(1);
    expect(result.droppedSmall).toBe(1);
  });

  it('drops slivers that are too thin to sew and reports it', () => {
    // 200 px across scaled to 40 mm: one pixel is 0.2 mm, well under the
    // 0.6 mm minimum, so the hairline must be dropped rather than sewn.
    const image = blank(200, 40);
    fillRect(image, 0, 0, 200, 20, ...RED);
    fillRect(image, 0, 30, 200, 1, ...BLUE);

    const result = autoDigitize(image, {
      widthMm: 40,
      colorCount: 4,
      minThicknessMm: 0.6,
      minRegionMm2: 0.01,
    });

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]!.colorIndex).toBe(0);
    expect(result.droppedThin).toBe(1);
  });

  it('is deterministic for the same input', () => {
    const image = blank(24, 12);
    fillRect(image, 0, 0, 12, 12, ...RED);
    fillRect(image, 12, 0, 12, 12, ...BLUE);
    setPixel(image, 20, 6, 200, 200, 200);

    const a = autoDigitize(image, { widthMm: 60, colorCount: 3 });
    const b = autoDigitize(image, { widthMm: 60, colorCount: 3 });

    expect(JSON.stringify(a.regions)).toBe(JSON.stringify(b.regions));
    expect(a.palette).toEqual(b.palette);
  });

  it('treats a dominant surround as background', () => {
    // A logo on a white page: the page must not become a white fill.
    const image = blank(20, 20);
    fillRect(image, 0, 0, 20, 20, 255, 255, 255);
    fillRect(image, 6, 6, 8, 8, ...RED);

    const result = autoDigitize(image, { widthMm: 40, colorCount: 4 });

    expect(result.droppedBackground).toBe(true);
    expect(result.palette).toHaveLength(1);
    expect(result.regions).toHaveLength(1);
    // The surviving region was renumbered onto the shrunken palette.
    expect(result.regions[0]!.colorIndex).toBe(0);
  });

  it('keeps the surround when background detection is off', () => {
    const image = blank(20, 20);
    fillRect(image, 0, 0, 20, 20, 255, 255, 255);
    fillRect(image, 6, 6, 8, 8, ...RED);

    const result = autoDigitize(image, { widthMm: 40, colorCount: 4, dropBackground: false });

    expect(result.droppedBackground).toBe(false);
    expect(result.palette).toHaveLength(2);
    expect(result.regions).toHaveLength(2);
  });

  it('does not mistake a full-bleed split for a background', () => {
    // Each colour owns half the border, so neither dominates the edge.
    const image = blank(20, 10);
    fillRect(image, 0, 0, 10, 10, ...RED);
    fillRect(image, 10, 0, 10, 10, ...BLUE);

    const result = autoDigitize(image, { widthMm: 40, colorCount: 4 });

    expect(result.droppedBackground).toBe(false);
    expect(result.regions).toHaveLength(2);
  });

  it('produces a palette entry per colour with a hex value', () => {
    const image = blank(8, 4);
    fillRect(image, 0, 0, 4, 4, ...RED);
    fillRect(image, 4, 0, 4, 4, ...BLUE);

    const result = autoDigitize(image, { widthMm: 10, colorCount: 4 });

    expect(result.palette).toHaveLength(2);
    for (const thread of result.palette) expect(thread.hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('returns an empty result for a fully transparent image', () => {
    const result = autoDigitize(blank(10, 10), { widthMm: 20 });
    expect(result.regions).toHaveLength(0);
    expect(result.palette).toHaveLength(0);
    expect(result.droppedSmall).toBe(0);
  });

  it('rejects a malformed image instead of guessing', () => {
    expect(() => autoDigitize({ width: 0, height: 4, data: new Uint8Array(0) })).toThrow(
      RangeError,
    );
    expect(() => autoDigitize({ width: 4, height: 4, data: new Uint8Array(8) })).toThrow(
      RangeError,
    );
  });

  it('honours the requested colour count', () => {
    const image = blank(9, 1);
    setPixel(image, 0, 0, 0, 0, 0);
    setPixel(image, 1, 0, 255, 0, 0);
    setPixel(image, 2, 0, 0, 255, 0);
    setPixel(image, 3, 0, 0, 0, 255);
    setPixel(image, 4, 0, 255, 255, 0);
    setPixel(image, 5, 0, 255, 0, 255);
    setPixel(image, 6, 0, 0, 255, 255);
    setPixel(image, 7, 0, 128, 128, 128);
    setPixel(image, 8, 0, 255, 255, 255);

    expect(autoDigitize(image, { widthMm: 9, colorCount: 3 }).palette).toHaveLength(3);
    expect(autoDigitize(image, { widthMm: 9, colorCount: 24 }).palette.length).toBeLessThanOrEqual(
      9,
    );
  });
});
