import { describe, it, expect } from 'vitest';
import { LIMITS, validateSequence } from './index.js';
import type { EmbroideryObject, Hoop, Stitch } from '../types.js';

/**
 * Machine-facing checks, with the stitch ceiling in the middle of it.
 *
 * The ceiling is a refusal, not a truncation: a design that reaches it is
 * rejected whole so nothing is written half way. What the number *is* changed
 * once - it used to sit at 500,000, below what the exporters were measured
 * handling - so the boundary is pinned from both sides here: exactly at the
 * limit a design passes, one stitch past it the design is refused.
 */

/** A long straight run of stitches `step` mm apart. */
function run(count: number, step: number): Stitch[] {
  // One shared record, repeated: two million distinct objects would make the
  // test measure memory allocation rather than the rule being checked.
  const template = { x: 0, y: 0, command: 'stitch' as const, colorIndex: 0, objectId: null };
  const out: Stitch[] = Array.from({ length: count }, (_, i) => ({
    ...template,
    x: i * step,
    sequence: i,
  }));
  return out;
}

const HOOP: Hoop = {
  id: 'test-hoop',
  name: 'Test',
  width: 400,
  height: 400,
  shape: 'rect',
  safeMargin: 5,
};

describe('validateSequence', () => {
  it('reports an empty design as an error', () => {
    const result = validateSequence([], [] as EmbroideryObject[], HOOP);

    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'EMPTY_DESIGN')).toBe(true);
  });

  it('accepts a design sitting exactly on the stitch ceiling', () => {
    // 2,000,000 stitches at 5 mm spacing run 10,000 mm - far past any hoop,
    // but the hoop is not what is being checked here, so it is left out.
    const result = validateSequence(run(LIMITS.maxStitches, 5), [], null);

    expect(result.issues.some((i) => i.code === 'TOO_MANY_STITCHES')).toBe(false);
  });

  it('refuses one stitch past the ceiling, whole', () => {
    const result = validateSequence(run(LIMITS.maxStitches + 1, 5), [], null);

    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'TOO_MANY_STITCHES');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain(String(LIMITS.maxStitches));
  });
});
