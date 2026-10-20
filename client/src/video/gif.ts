/**
 * Stitch-video encoding, off the main thread.
 *
 * Rendering a movie is the slowest thing the editor does by a wide margin: a
 * ten-thousand-stitch design takes about a second, and a second is long
 * enough for the browser to drop every frame the canvas draws while it is
 * busy - the editor freezes, the "rendering" note cannot blink, and the whole
 * page feels broken for the duration.
 *
 * The encoder itself is a pure function of the stitch list, so the work is
 * handed to a Web Worker and the page stays live throughout. Where a worker
 * cannot be created - a test environment, a file:// page, or a browser that
 * refuses - the same engine function runs here instead: one code path, one
 * result, only a different thread.
 */

import {
  encodeStitchMovie,
  type Stitch,
  type StitchMovieOptions,
  type StitchMovieResult,
} from '@threadworks/engine';
import type { GifReply } from './gifWorker.js';

/** One long-lived worker, created on demand and reused for every render. */
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (r: StitchMovieResult) => void; reject: (e: Error) => void }
>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;

  try {
    const created = new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<GifReply>) => {
      const reply = event.data;
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id);

      if (reply.ok && reply.result) {
        const { buffer, ...rest } = reply.result;
        entry.resolve({ ...rest, bytes: new Uint8Array(buffer) });
      } else {
        entry.reject(new Error(reply.error ?? 'Stitch video rendering failed in the worker.'));
      }
    };
    created.onerror = (event) => {
      // A worker that fails to start or load fails every render waiting on it,
      // and says why, rather than leaving the caller hanging.
      const error = new Error(
        event.message ||
          'The stitch video worker could not be started; rendering fell back to the page.',
      );
      for (const [, entry] of pending) entry.reject(error);
      pending.clear();
      created.terminate();
      worker = null;
    };
    worker = created;
    return created;
  } catch {
    // Constructing a worker can throw outright (blocked by policy, no module
    // workers). The encoder still works on this thread; only the page's
    // responsiveness pays for it.
    return null;
  }
}

/** Release the worker. Called when the page is torn down or a test needs a
 * clean slate; the next render simply starts a fresh one. */
export function closeGifWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const [, entry] of pending) entry.reject(new Error('Stitch video rendering was cancelled.'));
  pending.clear();
}

/**
 * Render a stitch movie, on a worker thread when one can be had.
 *
 * Resolves with the engine's own result - bytes, frame count, size - so the
 * caller sees exactly what a synchronous call would have returned.
 */
export function encodeGif(
  stitches: Stitch[],
  options: StitchMovieOptions = {},
): Promise<StitchMovieResult> {
  const scope = ensureWorker();
  if (!scope) {
    // No worker here: encode in place. This is the path jsdom tests take, and
    // the path a page without module workers takes in the browser.
    return Promise.resolve(encodeStitchMovie(stitches, options));
  }

  const id = nextId++;
  return new Promise<StitchMovieResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    scope.postMessage({ id, stitches, options });
  });
}
