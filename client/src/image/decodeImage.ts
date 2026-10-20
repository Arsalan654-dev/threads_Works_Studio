/**
 * Decode a picked image file into raw RGBA for the tracer.
 *
 * Browser-only by design: the engine takes plain pixel data so it stays pure
 * and testable without a DOM, and this is the thin adapter that produces it.
 *
 * The image is downscaled first. Tracing cost grows with pixel count, and a
 * twelve-megapixel photo carries far more detail than a stitch fill can
 * express - 900 px on the long edge is already finer than the thinnest thread.
 */

import type { RasterImage } from '@threadworks/engine';

export const TRACE_MAX_DIMENSION = 900;

export async function decodeImageFile(
  file: File | Blob,
  maxDimension: number = TRACE_MAX_DIMENSION,
): Promise<RasterImage> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode images for tracing.');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest < 1) throw new Error('The image has no pixels.');

    const scale = Math.min(1, maxDimension / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('This browser cannot decode images for tracing.');

    ctx.drawImage(bitmap, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}
