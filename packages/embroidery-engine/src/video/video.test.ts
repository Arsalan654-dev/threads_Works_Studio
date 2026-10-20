import { describe, it, expect } from 'vitest';
import {
  GifEncoder,
  lzwCompress,
  Raster,
  encodeStitchMovie,
  renderStitchPreview,
  drawText,
  type Rgb,
} from './movie.js';
import type { Stitch, StitchCommand } from '../types.js';

const stitch = (
  x: number,
  y: number,
  command: StitchCommand = 'stitch',
  colorIndex = 0,
): Stitch => ({
  x,
  y,
  command,
  colorIndex,
  objectId: null,
  sequence: 0,
});

// ---------------------------------------------------------------------------
// A GIF reader, so the encoder is verified by decoding what it wrote rather
// than by inspection. It follows the spec: LZW with a growing code width and
// two's-complement-free index values.
// ---------------------------------------------------------------------------

interface DecodedGif {
  width: number;
  height: number;
  palette: Rgb[];
  frames: Uint8Array[];
}

function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  let dict: number[][] = [];
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;

  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push([]); // clear
    dict.push([]); // end
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  };
  reset();

  const out: number[] = [];
  let bitPos = 0;
  let previous: number[] | null = null;

  const readCode = (): number | null => {
    if (bitPos + codeSize > data.length * 8) return null;
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const bit = (data[(bitPos + i) >> 3]! >> ((bitPos + i) & 7)) & 1;
      code |= bit << i;
    }
    bitPos += codeSize;
    return code;
  };

  for (;;) {
    const code = readCode();
    if (code === null) break;
    if (code === clearCode) {
      reset();
      previous = null;
      continue;
    }
    if (code === endCode) break;

    let entry: number[];
    if (dict[code] !== undefined && dict[code]!.length > 0) {
      entry = dict[code]!;
    } else if (previous !== null) {
      // KwKwK: the code refers to the entry being defined right now.
      entry = [...previous, previous[0]!];
    } else {
      break;
    }

    for (const value of entry) out.push(value);

    if (previous !== null && nextCode < 4096) {
      dict[nextCode] = [...previous, entry[0]!];
      nextCode++;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
    }
    previous = entry;
  }

  const pixels = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount && i < out.length; i++) pixels[i] = out[i]!;
  return pixels;
}

function decodeGif(bytes: Uint8Array): DecodedGif {
  const text = (start: number, length: number): string =>
    String.fromCharCode(...bytes.slice(start, start + length));

  expect(text(0, 6)).toBe('GIF89a');
  const width = bytes[6]! | (bytes[7]! << 8);
  const height = bytes[8]! | (bytes[9]! << 8);
  const packed = bytes[10]!;
  const gctSize = 1 << ((packed & 0x07) + 1);

  const palette: Rgb[] = [];
  let pos = 13;
  for (let i = 0; i < gctSize; i++) {
    palette.push({ r: bytes[pos]!, g: bytes[pos + 1]!, b: bytes[pos + 2]! });
    pos += 3;
  }

  const frames: Uint8Array[] = [];
  const pixelCount = width * height;

  while (pos < bytes.length) {
    const marker = bytes[pos]!;
    if (marker === 0x3b) break;

    if (marker === 0x21) {
      // Extension: skip its sub-blocks.
      pos += 2;
      for (;;) {
        const size = bytes[pos]!;
        pos += 1;
        if (size === 0) break;
        pos += size;
      }
      continue;
    }

    if (marker === 0x2c) {
      pos += 1;
      const left = bytes[pos]! | (bytes[pos + 1]! << 8);
      const top = bytes[pos + 2]! | (bytes[pos + 3]! << 8);
      const frameWidth = bytes[pos + 4]! | (bytes[pos + 5]! << 8);
      const frameHeight = bytes[pos + 6]! | (bytes[pos + 7]! << 8);
      pos += 9; // descriptor + packed byte

      const minCodeSize = bytes[pos]!;
      pos += 1;

      const chunks: number[] = [];
      for (;;) {
        const size = bytes[pos]!;
        pos += 1;
        if (size === 0) break;
        for (let i = 0; i < size; i++) chunks.push(bytes[pos + i]!);
        pos += size;
      }

      const decoded = lzwDecode(Uint8Array.from(chunks), minCodeSize, frameWidth * frameHeight);
      // Place the frame into a full-canvas buffer: our encoder always writes
      // full-frame images, so this is a straight copy.
      const canvas = new Uint8Array(pixelCount);
      for (let y = 0; y < frameHeight; y++) {
        const dy = top + y;
        if (dy < 0 || dy >= height) continue;
        for (let x = 0; x < frameWidth; x++) {
          const dx = left + x;
          if (dx < 0 || dx >= width) continue;
          canvas[dy * width + dx] = decoded[y * frameWidth + x]!;
        }
      }
      frames.push(canvas);
      continue;
    }

    break; // unknown block: stop rather than wander
  }

  return { width, height, palette, frames };
}

// ---------------------------------------------------------------------------
// LZW
// ---------------------------------------------------------------------------

describe('GIF LZW', () => {
  it('round-trips a repetitive run', () => {
    const indices = new Uint8Array(500).fill(3);
    const compressed = lzwCompress(indices, 8);
    expect(Array.from(lzwDecode(compressed, 8, indices.length))).toEqual(Array.from(indices));
  });

  it('round-trips every byte value', () => {
    const indices = new Uint8Array(256 * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i % 256;

    const compressed = lzwCompress(indices, 8);
    expect(Array.from(lzwDecode(compressed, 8, indices.length))).toEqual(Array.from(indices));
  });

  it('round-trips data long enough to grow the code width several times', () => {
    // Pseudo-random but deterministic: forces real dictionary work.
    const indices = new Uint8Array(20000);
    let seed = 12345;
    for (let i = 0; i < indices.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      indices[i] = seed % 7;
    }

    const compressed = lzwCompress(indices, 4);
    expect(Array.from(lzwDecode(compressed, 4, indices.length))).toEqual(Array.from(indices));
  });

  it('compresses a flat image to far less than its raw size', () => {
    const indices = new Uint8Array(10000).fill(1);
    expect(lzwCompress(indices, 8).length).toBeLessThan(indices.length / 10);
  });

  it('handles an empty frame', () => {
    expect(lzwDecode(lzwCompress(new Uint8Array(0), 8), 8, 0).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GIF container
// ---------------------------------------------------------------------------

describe('GifEncoder', () => {
  const palette: Rgb[] = [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ];

  it('writes a header, colour table, frames and trailer', () => {
    const encoder = new GifEncoder({ width: 4, height: 2, palette, delayCs: 8 });
    encoder.addFrame(new Uint8Array([0, 1, 2, 3, 0, 1, 2, 3]));
    encoder.addFrame(new Uint8Array([3, 2, 1, 0, 3, 2, 1, 0]));
    const bytes = encoder.finish();

    const decoded = decodeGif(bytes);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(2);
    expect(decoded.frames).toHaveLength(2);
    expect(Array.from(decoded.frames[0]!)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(Array.from(decoded.frames[1]!)).toEqual([3, 2, 1, 0, 3, 2, 1, 0]);
    expect(decoded.palette[1]).toEqual({ r: 255, g: 0, b: 0 });
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it('pads the colour table up to a power of two', () => {
    const encoder = new GifEncoder({
      width: 1,
      height: 1,
      palette: palette.slice(0, 3),
      delayCs: 4,
    });
    encoder.addFrame(new Uint8Array([2]));
    const decoded = decodeGif(encoder.finish());
    // Three colours still need a four-entry table, and the extra reads as black.
    expect(decoded.palette).toHaveLength(4);
    expect(decoded.palette[3]).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('records the frame delay in centiseconds', () => {
    const encoder = new GifEncoder({ width: 1, height: 1, palette, delayCs: 8 });
    encoder.addFrame(new Uint8Array([0]));
    const bytes = encoder.finish();
    // Graphic control extension: 21 F9 04 <packed> <delay lo> <delay hi> ...
    const gce = bytes.indexOf(0xf9);
    expect(gce).toBeGreaterThan(0);
    expect(bytes[gce + 1]).toBe(0x04);
    expect(bytes[gce + 3]).toBe(8);
    expect(bytes[gce + 4]).toBe(0);
  });

  it('rejects a frame with the wrong pixel count', () => {
    const encoder = new GifEncoder({ width: 4, height: 2, palette, delayCs: 4 });
    expect(() => encoder.addFrame(new Uint8Array(3))).toThrow(RangeError);
  });

  it('rejects impossible geometry and oversized palettes', () => {
    expect(() => new GifEncoder({ width: 0, height: 4, palette, delayCs: 4 })).toThrow(RangeError);
    expect(
      () =>
        new GifEncoder({
          width: 4,
          height: 4,
          palette: new Array(257).fill(palette[0]),
          delayCs: 4,
        }),
    ).toThrow(RangeError);
    expect(() => new GifEncoder({ width: 4, height: 4, palette: [], delayCs: 4 })).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// Rasteriser
// ---------------------------------------------------------------------------

describe('Raster', () => {
  const black: Rgb = { r: 0, g: 0, b: 0 };
  const white: Rgb = { r: 255, g: 255, b: 255 };

  it('starts filled with the background', () => {
    const raster = new Raster(3, 2, white);
    expect(Array.from(raster.toIndices([black, white]))).toEqual(new Array(6).fill(1));
  });

  it('fills a clipped rectangle', () => {
    const raster = new Raster(4, 4, white);
    raster.rect(-2, -2, 4, 4, black); // half off-canvas
    const indices = raster.toIndices([black, white]);
    expect(indices[0]).toBe(0); // (0,0)
    expect(indices[1]).toBe(0); // (1,0)
    expect(indices[2]).toBe(1); // (2,0) untouched
    expect(indices[4 * 2]).toBe(1);
  });

  it('draws a disc with the expected radius', () => {
    const raster = new Raster(9, 9, white);
    raster.disc(4.5, 4.5, 2, black);
    const indices = raster.toIndices([black, white]);
    expect(indices[4 * 9 + 4]).toBe(0); // centre
    expect(indices[4 * 9 + 7]).toBe(1); // outside the radius
  });

  it('draws a segment between two points', () => {
    const raster = new Raster(11, 3, white);
    raster.line(0.5, 1.5, 10.5, 1.5, 0.6, black);
    const indices = raster.toIndices([black, white]);
    for (let x = 0; x < 11; x++) expect(indices[1 * 11 + x]).toBe(0);
    expect(indices[0]).toBe(1); // row above untouched
  });

  it('clips a segment that leaves the canvas', () => {
    const raster = new Raster(4, 4, white);
    raster.line(-50, 2, 50, 2, 1, black);
    const indices = raster.toIndices([black, white]);
    expect(indices[2 * 4 + 0]).toBe(0);
    expect(indices[2 * 4 + 3]).toBe(0);
    expect(indices[0]).toBe(1);
  });

  it('falls back to the first palette entry for an unknown colour', () => {
    const raster = new Raster(1, 1, { r: 7, g: 8, b: 9 });
    expect(raster.toIndices([black, white])[0]).toBe(0);
  });

  it('rejects a zero-sized raster', () => {
    expect(() => new Raster(0, 4, black)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

describe('drawText', () => {
  it('draws glyphs and advances the pen', () => {
    const raster = new Raster(80, 20, { r: 0, g: 0, b: 0 });
    const end = drawText(raster, '11', 2, 15, 12, { r: 255, g: 255, b: 255 }, 2);

    expect(end).toBeGreaterThan(2);
    const lit = raster.toIndices([
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
    ]);
    expect(Array.from(lit).some((v) => v === 1)).toBe(true);
  });

  it('skips characters the font does not have', () => {
    const raster = new Raster(40, 20, { r: 0, g: 0, b: 0 });
    const withUnknown = drawText(raster, '1\u2603', 0, 15, 12, { r: 255, g: 255, b: 255 }, 1);
    const without = drawText(raster, '1', 0, 15, 12, { r: 255, g: 255, b: 255 }, 1);
    expect(withUnknown).toBeCloseTo(without, 9);
  });
});

// ---------------------------------------------------------------------------
// Movie
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Still preview
// ---------------------------------------------------------------------------

describe('renderStitchPreview', () => {
  function sample(): Stitch[] {
    const stitches: Stitch[] = [];
    for (let i = 0; i <= 20; i++) stitches.push(stitch(i, 0, 'stitch', 0));
    for (let i = 0; i <= 20; i++) stitches.push(stitch(i, 6, 'stitch', 1));
    return stitches;
  }

  it('renders thread over the fabric', () => {
    const preview = renderStitchPreview(sample(), { size: 96 });

    expect(preview.width).toBe(96);
    expect(preview.height).toBe(96);
    expect(preview.rgba.length).toBe(96 * 96 * 4);

    const fabric = preview.palette[0]!;
    let painted = 0;
    for (let i = 0; i < preview.rgba.length; i += 4) {
      if (
        preview.rgba[i] !== fabric.r ||
        preview.rgba[i + 1] !== fabric.g ||
        preview.rgba[i + 2] !== fabric.b
      ) {
        painted++;
      }
    }
    expect(painted).toBeGreaterThan(0);
  });

  it('uses the supplied thread colours', () => {
    const preview = renderStitchPreview(sample(), {
      size: 64,
      threads: [{ hex: '#FF0000' }, { hex: '#00FF00' }],
    });
    expect(preview.palette[1]).toEqual({ r: 255, g: 0, b: 0 });
    expect(preview.palette[2]).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('is deterministic and survives an empty sequence', () => {
    const a = renderStitchPreview(sample(), { size: 48 });
    const b = renderStitchPreview(sample(), { size: 48 });
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));

    const empty = renderStitchPreview([], { size: 32 });
    expect(empty.rgba.length).toBe(32 * 32 * 4);
  });

  it('rejects non-array input', () => {
    expect(() => renderStitchPreview(null as unknown as Stitch[])).toThrow(TypeError);
  });
});

describe('encodeStitchMovie', () => {
  /** A short two-colour design: a bar, a jump, then a second bar. */
  function sample(): Stitch[] {
    const stitches: Stitch[] = [];
    for (let i = 0; i <= 20; i++) stitches.push(stitch(i, 0, 'stitch', 0));
    stitches.push(stitch(20, 10, 'jump', 0));
    for (let i = 0; i <= 20; i++) stitches.push(stitch(20 - i, 10, 'stitch', 1));
    return stitches;
  }

  it('produces a decodable GIF with one frame per slice', () => {
    const result = encodeStitchMovie(sample(), { size: 96, fps: 10, stitchesPerFrame: 8 });

    expect(result.width).toBe(96);
    expect(result.height).toBe(96);
    expect(result.fps).toBe(10);
    expect(result.stitches).toBe(43);

    const decoded = decodeGif(result.bytes);
    expect(decoded.width).toBe(96);
    expect(decoded.height).toBe(96);
    expect(decoded.frames.length).toBe(result.frames);
    // 43 stitches at 8 per frame is 6 frames, plus the hold.
    expect(result.frames).toBe(6 + 12);
  });

  it('lays down thread as the frames advance', () => {
    const result = encodeStitchMovie(sample(), {
      size: 96,
      stitchesPerFrame: 8,
      holdFrames: 0,
      hud: false,
    });
    const decoded = decodeGif(result.bytes);

    // The first frame already has thread; later frames have more of it.
    const threadPixels = (frame: Uint8Array): number => {
      let count = 0;
      for (let i = 0; i < frame.length; i++) if (frame[i] === 1 || frame[i] === 2) count++;
      return count;
    };
    const first = threadPixels(decoded.frames[0]!);
    const last = threadPixels(decoded.frames[decoded.frames.length - 1]!);

    expect(first).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(first);
  });

  it('is deterministic for the same input', () => {
    const a = encodeStitchMovie(sample(), { size: 64, stitchesPerFrame: 8 });
    const b = encodeStitchMovie(sample(), { size: 64, stitchesPerFrame: 8 });
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });

  it('keeps the design inside the frame at any size', () => {
    // A design far from the origin: the renderer must centre it, not clip it.
    const stitches: Stitch[] = [];
    for (let i = 0; i <= 30; i++) stitches.push(stitch(200 + i, 500, 'stitch', 0));

    const result = encodeStitchMovie(stitches, { size: 80, stitchesPerFrame: 32, hud: false });
    const decoded = decodeGif(result.bytes);
    const frame = decoded.frames[0]!;

    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        if (frame[y * 80 + x] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    expect(minX).toBeGreaterThan(0);
    expect(maxX).toBeLessThan(79);
  });

  it('draws the HUD when asked and leaves the bottom row alone when not', () => {
    // The design can never reach the very last row, so it is a clean probe for
    // whether the status strip was painted.
    const lastRowIsClear = (bytes: Uint8Array): boolean => {
      const decoded = decodeGif(bytes);
      const frame = decoded.frames[decoded.frames.length - 1]!;
      for (let x = 0; x < 96; x++) if (frame[95 * 96 + x] !== 0) return false;
      return true;
    };

    const withHud = encodeStitchMovie(sample(), { size: 96, stitchesPerFrame: 8, hud: true });
    const without = encodeStitchMovie(sample(), { size: 96, stitchesPerFrame: 8, hud: false });

    expect(lastRowIsClear(without.bytes)).toBe(true);
    expect(lastRowIsClear(withHud.bytes)).toBe(false);
  });

  it('survives an empty design with a single frame', () => {
    const result = encodeStitchMovie([], { size: 64 });
    expect(result.frames).toBe(1);
    expect(result.stitches).toBe(0);
    const decoded = decodeGif(result.bytes);
    expect(decoded.frames).toHaveLength(1);
  });

  it('honours the frame cap on a long design', () => {
    const stitches: Stitch[] = [];
    for (let i = 0; i < 5000; i++) stitches.push(stitch(i % 100, Math.floor(i / 100), 'stitch', 0));

    const result = encodeStitchMovie(stitches, { size: 64, maxFrames: 40, holdFrames: 5 });
    expect(result.frames).toBeLessThanOrEqual(40);
  });

  it('uses the supplied thread colours', () => {
    const result = encodeStitchMovie(sample(), {
      size: 64,
      stitchesPerFrame: 42,
      holdFrames: 0,
      hud: false,
      threads: [{ hex: '#FF0000' }, { hex: '#00FF00' }],
    });
    const decoded = decodeGif(result.bytes);
    // Palette layout: fabric, threads, needle, hud, track, marker, jump.
    expect(decoded.palette[1]).toEqual({ r: 255, g: 0, b: 0 });
    expect(decoded.palette[2]).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('rejects non-array input', () => {
    expect(() => encodeStitchMovie(null as unknown as Stitch[])).toThrow(TypeError);
  });
});
