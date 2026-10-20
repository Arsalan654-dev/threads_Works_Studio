/**
 * Read a picked file into raw bytes.
 *
 * `Blob.arrayBuffer` is the direct route, but older jsdom and a few embedded
 * browsers do not have it, so FileReader is kept as a fallback rather than
 * failing a legitimate import.
 */

export async function readFileBytes(file: File | Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.onload = () => {
      const result = reader.result;
      if (!(result instanceof ArrayBuffer)) {
        reject(new Error('The file could not be read.'));
        return;
      }
      resolve(new Uint8Array(result));
    };
    reader.readAsArrayBuffer(file);
  });
}
