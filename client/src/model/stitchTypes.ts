/**
 * Stitch types as the UI names them, in the order the properties panel lists
 * them. Kept out of the panel so the preferences dialog can offer the same
 * names for the same types instead of inventing a second set of words.
 */

import type { StitchType } from '@threadworks/engine';

export const STITCH_TYPES: { id: StitchType; label: string }[] = [
  { id: 'tatami', label: 'Tatami fill' },
  { id: 'satin', label: 'Satin column' },
  { id: 'run', label: 'Run' },
  { id: 'bean', label: 'Bean / triple run' },
  { id: 'contour', label: 'Contour' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'motif', label: 'Motif' },
];

/** The types a complex fill can be sewn as - what the "new fill stitch type"
 * preference chooses. A column, a run and a bean each already mean one type,
 * so they have no place in this list. */
const FILL_TYPES: StitchType[] = ['tatami', 'motif', 'contour', 'spiral'];

export const FILL_STITCH_TYPES = STITCH_TYPES.filter((entry) => FILL_TYPES.includes(entry.id));
