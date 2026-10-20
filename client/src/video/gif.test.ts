import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encodeStitchMovie, type Stitch } from '@threadworks/engine';
import { encodeGif, closeGifWorker } from './gif.js';
import type { GifReply } from './gifWorker.js';

/**
 * The seam between the editor and the encoder.
 *
 * There are two ways this runs: on a worker thread in the browser, and right
 * here when a worker cannot be had - which is what jsdom gives us by default,
 * and what every test below without a stubbed `Worker` exercises. The stubbed
 * tests cover the other half: the reply is dispatched to the waiting promise,
 * a failed render rejects instead of hanging, and cancelling tears the worker
 * down rather than leaving promises pending forever.
 */

const STITCHES: Stitch[] = Array.from({ length: 40 }, (_, i) => ({
  x: i * 1.5,
  y: (i % 5) * 2,
  command: i === 0 ? 'jump' : 'stitch',
  colorIndex: 0,
  objectId: null,
  sequence: i,
}));

/** What the worker is asked to do, kept visible so replies can echo the id. */
interface Request {
  id: number;
  stitches: Stitch[];
  options: { size?: number; maxFrames?: number };
}

describe('encodeGif', () => {
  afterEach(() => {
    closeGifWorker();
    vi.unstubAllGlobals();
  });

  it('renders without a worker by running the same engine function here', async () => {
    // jsdom has no Worker, so this is the fallback path a browser without
    // module workers would also take.
    expect(typeof Worker).toBe('undefined');

    const movie = await encodeGif(STITCHES, { size: 64, maxFrames: 8 });

    expect(String.fromCharCode(...movie.bytes.slice(0, 6))).toBe('GIF89a');
    // Byte for byte what the engine produces on its own: a different thread
    // must not mean a different movie.
    expect(Array.from(movie.bytes)).toEqual(
      Array.from(encodeStitchMovie(STITCHES, { size: 64, maxFrames: 8 }).bytes),
    );
  });

  it('hands the work to a worker and resolves with the bytes it returns', async () => {
    const posted: Request[] = [];
    const buffer = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]).buffer;

    class ReplyingWorker {
      onmessage: ((event: { data: GifReply }) => void) | null = null;
      onerror: ((event: { message?: string }) => void) | null = null;
      postMessage(request: Request): void {
        posted.push(request);
        this.onmessage?.({
          data: {
            id: request.id,
            ok: true,
            result: { buffer, width: 64, height: 64, frames: 3, stitches: 40, fps: 12 },
          },
        });
      }
      terminate(): void {
        /* nothing to tear down */
      }
    }
    vi.stubGlobal('Worker', ReplyingWorker);

    const movie = await encodeGif(STITCHES, { size: 64, maxFrames: 8 });

    expect(posted).toHaveLength(1);
    expect(posted[0]!.stitches).toHaveLength(40);
    expect(Array.from(movie.bytes)).toEqual(Array.from(new Uint8Array(buffer)));
    expect(movie.frames).toBe(3);
    expect(movie.width).toBe(64);
  });

  it("rejects with the worker's own words when the render fails", async () => {
    const buffer = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer;
    let calls = 0;
    // Fails the first render, succeeds the next: a failure has to be able to
    // clear itself out of the way of the render that follows it.
    class FailingWorker {
      onmessage: ((event: { data: GifReply }) => void) | null = null;
      onerror: ((event: { message?: string }) => void) | null = null;
      postMessage(request: Request): void {
        calls += 1;
        this.onmessage?.({
          data:
            calls === 1
              ? { id: request.id, ok: false, error: 'thread ran out of frames' }
              : {
                  id: request.id,
                  ok: true,
                  result: { buffer, width: 64, height: 64, frames: 3, stitches: 40, fps: 12 },
                },
        });
      }
      terminate(): void {
        /* nothing to tear down */
      }
    }
    vi.stubGlobal('Worker', FailingWorker);

    await expect(encodeGif(STITCHES)).rejects.toThrow('thread ran out of frames');
    // The failed render must not poison the next one: the id map is cleaned
    // up, so a later render still finds its own reply.
    await expect(encodeGif(STITCHES)).resolves.toBeDefined();
    expect(calls).toBe(2);
  });

  it('rejects anything still waiting when the worker is torn down', async () => {
    class SilentWorker {
      onmessage: ((event: { data: GifReply }) => void) | null = null;
      onerror: ((event: { message?: string }) => void) | null = null;
      postMessage(): void {
        // Deliberately never replies: this is the shape of a worker that died
        // between the request and the answer.
      }
      terminate(): void {
        /* nothing to tear down */
      }
    }
    vi.stubGlobal('Worker', SilentWorker);

    const pending = encodeGif(STITCHES);
    closeGifWorker();

    await expect(pending).rejects.toThrow(/cancelled/i);
  });
});

describe('a worker that fails to start', () => {
  beforeEach(() => {
    closeGifWorker();
  });

  afterEach(() => {
    closeGifWorker();
    vi.unstubAllGlobals();
  });

  it('falls back to rendering here instead of failing the request', async () => {
    class RefusingWorker {
      constructor() {
        throw new Error('workers are blocked by policy');
      }
    }
    vi.stubGlobal('Worker', RefusingWorker);

    const movie = await encodeGif(STITCHES, { size: 48, maxFrames: 6 });

    expect(String.fromCharCode(...movie.bytes.slice(0, 6))).toBe('GIF89a');
  });
});
