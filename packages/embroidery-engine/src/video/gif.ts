/**
 * A GIF89a encoder.
 *
 * Written out longhand rather than pulled in as a dependency: the studio is
 * local-only, so every byte it ships has to be ours, and the encoder is small
 * enough to test properly. Frames are added one at a time and compressed as
 * they arrive, so a long movie never holds more than one frame of pixels.
 *
 * The colour table is exact - the movie renders with flat colours, so there is
 * nothing to quantise.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface GifOptions {
  width: number;
  height: number;
  /** Global colour table. At most 256 entries; the table is padded to a power of two. */
  palette: Rgb[];
  /** Delay between frames, in hundredths of a second (GIF's own unit). */
  delayCs: number;
  /** Loop forever. Default true. */
  loop?: boolean;
}

/** Bits a palette of `size` entries needs, as GIF's 3-bit size code. */
function colourTableCode(size: number): number {
  let code = 0;
  while (1 << (code + 1) < size) code++;
  return Math.min(7, code);
}

/**
 * Compress one frame's colour indices with GIF's variable-width LZW.
 *
 * The code width grows in lockstep with what a decoder will infer: after each
 * dictionary entry the decoder adds, if the next free code no longer fits in
 * the current width, both sides move up together.
 */
export function lzwCompress(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  const bytes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;

  const pushCode = (code: number, size: number): void => {
    accumulator |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(accumulator & 0xff);
      accumulator >>>= 8;
      bitCount -= 8;
    }
  };

  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let table = new Map<number, number>();

  pushCode(clearCode, codeSize);

  if (indices.length > 0) {
    let prefix = indices[0]!;
    for (let i = 1; i < indices.length; i++) {
      const next = indices[i]!;
      const key = (prefix << 8) | next;
      const known = table.get(key);
      if (known !== undefined) {
        prefix = known;
        continue;
      }

      pushCode(prefix, codeSize);

      if (nextCode < 4096) {
        table.set(key, nextCode);
        nextCode++;
        // The decoder is always one dictionary entry behind the encoder, so
        // the widths agree when the encoder grows strictly *after* passing the
        // limit and the decoder grows exactly *on* it.
        if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        pushCode(clearCode, codeSize);
        table = new Map<number, number>();
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      }
      prefix = next;
    }
    pushCode(prefix, codeSize);
  }

  pushCode(endCode, codeSize);
  if (bitCount > 0) bytes.push(accumulator & 0xff);

  return Uint8Array.from(bytes);
}

/** Wrap compressed bytes in GIF's 255-byte sub-blocks, terminated by a zero. */
function subBlocks(out: number[], data: Uint8Array): void {
  let offset = 0;
  while (offset < data.length) {
    const chunk = Math.min(255, data.length - offset);
    out.push(chunk);
    for (let i = 0; i < chunk; i++) out.push(data[offset + i]!);
    offset += chunk;
  }
  out.push(0x00);
}

export class GifEncoder {
  private readonly out: number[] = [];
  private readonly palette: Rgb[];
  private readonly sizeCode: number;
  private readonly minCodeSize: number;
  private finished = false;

  constructor(private readonly options: GifOptions) {
    if (options.width < 1 || options.height < 1) {
      throw new RangeError(
        `GIF dimensions must be positive (got ${options.width}x${options.height})`,
      );
    }
    if (options.palette.length === 0) {
      throw new RangeError('a GIF needs at least one colour');
    }
    if (options.palette.length > 256) {
      throw new RangeError(`a GIF colour table holds 256 entries (got ${options.palette.length})`);
    }
    this.palette = options.palette.slice();
    this.sizeCode = colourTableCode(this.palette.length);
    // Minimum LZW code size: at least two bits, as the spec requires.
    this.minCodeSize = Math.max(2, this.sizeCode + 1);
    this.writeHeader();
  }

  private writeHeader(): void {
    const { width, height, loop = true } = this.options;
    const out = this.out;

    // Header.
    for (const c of 'GIF89a') out.push(c.charCodeAt(0));

    // Logical screen descriptor.
    out.push(width & 0xff, (width >> 8) & 0xff);
    out.push(height & 0xff, (height >> 8) & 0xff);
    out.push(0x80 | (this.sizeCode << 4) | 0x00 | this.sizeCode);
    out.push(0x00); // background colour index
    out.push(0x00); // pixel aspect ratio

    // Global colour table, padded to the power-of-two size the code promises.
    const tableEntries = 1 << (this.sizeCode + 1);
    for (let i = 0; i < tableEntries; i++) {
      const entry = this.palette[i] ?? { r: 0, g: 0, b: 0 };
      out.push(entry.r & 0xff, entry.g & 0xff, entry.b & 0xff);
    }

    // Netscape looping extension.
    if (loop) {
      out.push(0x21, 0xff, 0x0b);
      for (const c of 'NETSCAPE2.0') out.push(c.charCodeAt(0));
      out.push(0x03, 0x01, 0x00, 0x00, 0x00);
    }
  }

  /** Add one frame. `indices` must hold width * height palette indices. */
  addFrame(indices: Uint8Array): void {
    const { width, height, delayCs } = this.options;
    const expected = width * height;
    if (indices.length !== expected) {
      throw new RangeError(`frame needs ${expected} pixels, got ${indices.length}`);
    }

    const out = this.out;

    // Graphic control extension: keep the frame in place (disposal 1) so the
    // movie accumulates rather than flashing.
    out.push(0x21, 0xf9, 0x04);
    out.push(0x04);
    out.push(delayCs & 0xff, (delayCs >> 8) & 0xff);
    out.push(0x00); // transparent index (unused)
    out.push(0x00);

    // Image descriptor: full frame, no local colour table.
    out.push(0x2c);
    out.push(0x00, 0x00, 0x00, 0x00);
    out.push(width & 0xff, (width >> 8) & 0xff);
    out.push(height & 0xff, (height >> 8) & 0xff);
    out.push(0x00);

    out.push(this.minCodeSize);
    subBlocks(out, lzwCompress(indices, this.minCodeSize));
  }

  /** Write the trailer and hand back the file. Safe to call once. */
  finish(): Uint8Array {
    if (!this.finished) {
      this.out.push(0x3b);
      this.finished = true;
    }
    return Uint8Array.from(this.out);
  }
}
