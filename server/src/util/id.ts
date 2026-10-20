/**
 * Converting stored identifiers to the shape the API returns.
 *
 * `_id` is not always an `ObjectId`. Seeded reference data deliberately uses
 * readable fixed keys (`hoop-100x100`, `palette-basic`) so they can be
 * referenced from scripts and re-seeded idempotently, and a document that has
 * been through a JSON backup/restore round trip comes back with a plain
 * string. Assuming `toHexString()` therefore works right up until the first
 * list request returns a 500.
 */

export function wireId(id: unknown): string {
  if (id === null || id === undefined) return '';

  if (typeof id === 'string') return id;
  if (typeof id === 'number' || typeof id === 'bigint') return String(id);

  const candidate = id as { toHexString?: () => string; toString?: () => string };
  if (typeof candidate.toHexString === 'function') return candidate.toHexString();
  if (typeof candidate.toString === 'function') return candidate.toString();

  return String(id);
}

/** True for a value shaped like a 24-character ObjectId hex string. */
export function isObjectIdHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}
