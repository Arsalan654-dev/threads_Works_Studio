/**
 * A tiny software rasteriser.
 *
 * The movie pipeline deliberately cannot use a canvas: the engine runs without
 * a DOM, which is what lets the whole thing be tested in Node and produced from
 * a script. Everything needed is a byte buffer and flat colours - no
 * antialiasing, so every pixel is exactly one palette entry.
 */

import type { Rgb } from './gif.js';

export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, background: Rgb) {
    if (width < 1 || height < 1) {
      throw new RangeError(`raster must be at least 1x1 (got ${width}x${height})`);
    }
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    this.fill(background);
  }

  /** Flood the whole buffer with one colour. */
  fill(colour: Rgb): void {
    const { data } = this;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = colour.r;
      data[i + 1] = colour.g;
      data[i + 2] = colour.b;
      data[i + 3] = 255;
    }
  }

  /** Fill an axis-aligned rectangle, clipped to the raster. */
  rect(x: number, y: number, width: number, height: number, colour: Rgb): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + width));
    const y1 = Math.min(this.height, Math.ceil(y + height));
    for (let py = y0; py < y1; py++) {
      let offset = (py * this.width + x0) * 4;
      for (let px = x0; px < x1; px++) {
        this.data[offset] = colour.r;
        this.data[offset + 1] = colour.g;
        this.data[offset + 2] = colour.b;
        this.data[offset + 3] = 255;
        offset += 4;
      }
    }
  }

  /** Fill a disc, clipped to the raster. */
  disc(cx: number, cy: number, radius: number, colour: Rgb): void {
    this.stamp(cx, cy, radius, colour, cx, cy);
  }

  /**
   * Draw a thick segment with round caps.
   *
   * Every pixel in the segment's bounding box is tested against the segment
   * itself, which is exact and, at stitch sizes, cheaper than walking the line.
   */
  line(x0: number, y0: number, x1: number, y1: number, radius: number, colour: Rgb): void {
    this.stamp(x0, y0, radius, colour, x1, y1);
  }

  private stamp(x0: number, y0: number, radius: number, colour: Rgb, x1: number, y1: number): void {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1) + radius));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1) + radius));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    const radiusSquared = radius * radius;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const vx = px + 0.5 - x0;
        const vy = py + 0.5 - y0;
        let t = lengthSquared > 0 ? (vx * dx + vy * dy) / lengthSquared : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const ex = vx - dx * t;
        const ey = vy - dy * t;
        if (ex * ex + ey * ey > radiusSquared) continue;

        const offset = (py * this.width + px) * 4;
        this.data[offset] = colour.r;
        this.data[offset + 1] = colour.g;
        this.data[offset + 2] = colour.b;
        this.data[offset + 3] = 255;
      }
    }
  }

  /** Draw an open polyline as capsule segments. */
  polyline(points: Array<{ x: number; y: number }>, radius: number, colour: Rgb): void {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      this.line(a.x, a.y, b.x, b.y, radius, colour);
    }
  }

  /**
   * Convert to palette indices, building the colour lookup once per call.
   *
   * Colours come from a fixed set the renderer itself chose, so this is a
   * lookup rather than a nearest-colour search; anything unexpected falls back
   * to the first entry rather than failing the whole movie.
   */
  toIndices(palette: Rgb[]): Uint8Array {
    const lookup = new Map<number, number>();
    for (let i = 0; i < palette.length; i++) {
      const entry = palette[i]!;
      const key = (entry.r << 16) | (entry.g << 8) | entry.b;
      // First match wins, so a deliberate duplicate cannot shadow the colour
      // that earlier code referred to by index.
      if (!lookup.has(key)) lookup.set(key, i);
    }

    const out = new Uint8Array(this.width * this.height);
    const { data } = this;
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      const key = (data[p]! << 16) | (data[p + 1]! << 8) | data[p + 2]!;
      out[i] = lookup.get(key) ?? 0;
    }
    return out;
  }
}
