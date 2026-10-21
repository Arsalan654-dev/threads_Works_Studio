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
/** Long edge of the image kept behind the artwork as a tracing guide. */
export const REFERENCE_MAX_DIMENSION = 1400;
/**
 * Hard ceiling for the stored data URL.
 *
 * A project travels through a JSON request body, and the hosted API is capped
 * at 4 MB. Keeping the guide well below that leaves room for the stitch
 * geometry, while 1400 px is still sharp enough to trace fine detail at a
 * useful zoom.
 */
export const REFERENCE_DATA_URL_LIMIT = 1_800_000;

export interface DecodedImageAsset {
  /** Downscaled RGBA pixels for the tracer and photo planner. */
  raster: RasterImage;
  /** Compressed data URL kept as a clear on-canvas reference. */
  dataUrl: string;
  name: string;
  width: number;
  height: number;
}

function drawBitmap(
  bitmap: ImageBitmap,
  maxDimension: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
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
  return { canvas, width, height };
}

export async function decodeImageFile(
  file: File | Blob,
  maxDimension: number = TRACE_MAX_DIMENSION,
): Promise<RasterImage> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode images for tracing.');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const { canvas, width, height } = drawBitmap(bitmap, maxDimension);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('This browser cannot decode images for tracing.');
    const data = ctx.getImageData(0, 0, width, height).data;
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}

/**
 * Decode once for both jobs an imported picture has in the studio.
 *
 * The tracer needs small RGBA pixels; the canvas guide needs a compressed
 * image the project document can carry. Doing both from one bitmap avoids
 * decoding a large photograph twice. If WebP is unavailable the canvas falls
 * back to JPEG, and if the first encoding is still too large the guide is
 * stepped down until it fits.
 */
export async function decodeImageAsset(
  file: File | Blob,
  options: {
    traceMaxDimension?: number;
    referenceMaxDimension?: number;
    dataUrlLimit?: number;
  } = {},
): Promise<DecodedImageAsset> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode images for tracing.');
  }

  const traceMax = options.traceMaxDimension ?? TRACE_MAX_DIMENSION;
  const referenceMax = options.referenceMaxDimension ?? REFERENCE_MAX_DIMENSION;
  const limit = options.dataUrlLimit ?? REFERENCE_DATA_URL_LIMIT;

  const bitmap = await createImageBitmap(file);
  try {
    const trace = drawBitmap(bitmap, traceMax);
    const traceCtx = trace.canvas.getContext('2d', { willReadFrequently: true });
    if (traceCtx === null) throw new Error('This browser cannot decode images for tracing.');
    const raster: RasterImage = {
      width: trace.width,
      height: trace.height,
      data: traceCtx.getImageData(0, 0, trace.width, trace.height).data,
    };

    let dimension = Math.min(referenceMax, Math.max(bitmap.width, bitmap.height));
    let dataUrl = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const preview = drawBitmap(bitmap, dimension);
      try {
        dataUrl = preview.canvas.toDataURL('image/webp', 0.82);
      } catch {
        dataUrl = '';
      }
      if (!dataUrl.startsWith('data:image/')) {
        dataUrl = preview.canvas.toDataURL('image/jpeg', 0.85);
      }
      if (dataUrl.length <= limit) break;
      dimension = Math.round(dimension * 0.76);
    }

    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('This browser could not prepare the image as a tracing guide.');
    }
    if (dataUrl.length > limit) {
      throw new Error('This picture is too complex to keep as a tracing guide. Try a smaller image.');
    }

    return {
      raster,
      dataUrl,
      name: file instanceof File ? file.name : 'Reference image',
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}
