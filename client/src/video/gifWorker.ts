/// <reference lib="webworker" />
/**
 * The worker that renders a stitch movie.
 *
 * Deliberately thin: it receives the stitch list and the render options,
 * calls the engine's encoder - a pure function with no DOM anywhere under it,
 * which is exactly why it can live here - and hands the bytes back. The
 * buffer is transferred rather than copied, so a seven-megabyte movie does not
 * cost a second copy on its way out of the thread.
 *
 * Everything the encoder can throw is caught and returned as a message: a
 * worker error cannot reach the page's own error handling, and a silent
 * failure would leave "rendering" on screen forever.
 */

import { encodeStitchMovie, type Stitch, type StitchMovieOptions } from '@threadworks/engine';

export interface GifRequest {
  id: number;
  stitches: Stitch[];
  options: StitchMovieOptions;
}

export interface GifReply {
  id: number;
  ok: boolean;
  /** Encoded movie, as the engine reports it, with the bytes detached. */
  result?: {
    buffer: ArrayBuffer;
    width: number;
    height: number;
    frames: number;
    stitches: number;
    fps: number;
  };
  error?: string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<GifRequest>) => {
  const { id, stitches, options } = event.data;
  try {
    const movie = encodeStitchMovie(stitches, options);
    // `slice()` rather than the underlying buffer: the encoder may hand back a
    // view into something larger, and transferring that would send whatever
    // else is in the allocation along with the movie.
    const bytes = movie.bytes.slice();
    const buffer = bytes.buffer as ArrayBuffer;
    const reply: GifReply = {
      id,
      ok: true,
      result: {
        buffer,
        width: movie.width,
        height: movie.height,
        frames: movie.frames,
        stitches: movie.stitches,
        fps: movie.fps,
      },
    };
    scope.postMessage(reply, [buffer]);
  } catch (err) {
    const reply: GifReply = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    scope.postMessage(reply);
  }
});
