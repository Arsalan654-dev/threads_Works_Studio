/**
 * Handing bytes to the browser as a download.
 *
 * Shared by every export path so they cannot drift apart: the object URL is
 * always revoked on a delay, because revoking immediately cancels the download
 * in some browsers, and the bytes are always copied into a fresh view, because
 * an exporter may hand back a window into a larger ArrayBuffer.
 */

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error('This browser cannot save files.');
  }
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Make a file-system-safe stem out of a design name. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? 'design' : cleaned;
}
