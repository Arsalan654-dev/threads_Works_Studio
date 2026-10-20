/**
 * Pick a motif: the small shape a motif fill repeats, or the stamp a carve
 * presses into a fill.
 *
 * Both controls ask for the same thing, so both get the same field. What
 * differs is only what happens to the answer — a motif fill *is* motifs, a
 * carve removes them from an otherwise plain fill — and the engine reads the
 * result the same way either time.
 *
 * Every shape is drawn from its own outline rather than described by name,
 * because that is how a digitiser chooses a motif: by looking at it.
 */

import { useState } from 'react';
import type React from 'react';
import { builtinMotifs, labelFor, type MotifChoice } from '@threadworks/engine';
import { referenceStore, type MotifEntry } from '../store/referenceStore.js';
import { MotifLibrary } from './MotifLibrary.js';

/** The id used when nothing has been picked: the built-in the engine falls back to. */
export const DEFAULT_MOTIF_ID = 'star';

export interface MotifPickerProps {
  /** What is currently chosen, or undefined for the built-in default. */
  value: MotifChoice | undefined;
  onChange: (choice: MotifChoice) => void;
  /** Label shown above the grid. */
  label: string;
  /** Explains the control under the grid. */
  hint: string;
  testId: string;
}

interface ShapeOption {
  /** Value written into `MotifChoice.id` when this one is picked. */
  id: string;
  name: string;
  points: { x: number; y: number }[];
  builtin: boolean;
  /** Library entries carry their shape; built-ins are resolved by the engine. */
  entry?: MotifEntry;
}

/**
 * An SVG path for a ring, fitted into a square box.
 *
 * Fitted rather than drawn at its own scale: built-ins are authored inside a
 * unit circle while library shapes are stored in a unit box, so drawing both
 * at their literal coordinates would make one set look half the size of the
 * other for no reason the operator can see. Fitting each to the same box is
 * what lets the thumbnails be compared at a glance.
 */
export function motifPath(points: { x: number; y: number }[], size: number): string {
  if (points.length < 3) return '';
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  // One scale for both axes keeps the shape's proportions; the smaller of the
  // two is what fits it inside the box without cropping.
  const scale = (size * 0.86) / Math.max(spanX, spanY);
  const offsetX = (size - spanX * scale) / 2;
  const offsetY = (size - spanY * scale) / 2;

  const move = (p: { x: number; y: number }): string =>
    `${((p.x - minX) * scale + offsetX).toFixed(2)} ${((p.y - minY) * scale + offsetY).toFixed(2)}`;

  return (
    `M ${move(points[0]!)} ` +
    points
      .slice(1)
      .map((p) => `L ${move(p)}`)
      .join(' ') +
    ' Z'
  );
}

export function MotifPicker({
  value,
  onChange,
  label,
  hint,
  testId,
}: MotifPickerProps): React.ReactElement {
  const library = referenceStore((s) => s.motifs);
  const [editing, setEditing] = useState(false);

  // Built-ins first, then whatever the operator has saved. Built-ins cannot be
  // deleted, so the first entry in the list is always there to fall back on.
  const options: ShapeOption[] = [
    ...builtinMotifs().map((m) => ({ id: m.id, name: m.name, points: m.points, builtin: true })),
    ...library.map((entry) => ({
      // The library id is what a design stores, so that is the option's value.
      id: entry.presetId,
      name: entry.name,
      points: entry.points,
      builtin: entry.builtin,
      entry,
    })),
  ];

  const currentId = value?.id ?? DEFAULT_MOTIF_ID;
  const current = options.find((o) => o.id === currentId);

  const pick = (option: ShapeOption): void => {
    if (option.builtin) {
      // A built-in is named, not carried: the engine owns its geometry, and
      // storing a copy would mean a fix here never reached a saved design.
      onChange({ id: option.id });
      return;
    }
    // A library shape is carried alongside its id. The id lets a later edit to
    // the library reach the design; the points keep the design sewable even if
    // that entry is deleted. Both travel, and the engine prefers the points.
    onChange({ id: option.id, points: option.entry?.points ?? option.points });
  };

  return (
    <div className="motif-picker" data-testid={testId}>
      <span className="field-label">{label}</span>
      <div className="motif-grid" role="listbox" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={option.id === currentId}
            title={option.name}
            className={`motif-chip${option.id === currentId ? ' is-selected' : ''}`}
            onClick={() => pick(option)}
            data-testid={`motif-option-${option.id}`}
          >
            <svg width={44} height={44} viewBox="0 0 44 44" aria-hidden="true">
              <path d={motifPath(option.points, 44)} />
            </svg>
            <span className="motif-chip-name">{option.name}</span>
          </button>
        ))}
      </div>
      <small>{hint}</small>
      <small>
        {current
          ? `Selected: ${current.name}${current.builtin ? '' : ' (saved in your library)'}`
          : `Selected: ${labelFor(DEFAULT_MOTIF_ID)}`}
      </small>
      <button
        type="button"
        className="secondary"
        onClick={() => setEditing(true)}
        data-testid="motif-edit-library"
      >
        Edit motif library...
      </button>
      {editing && <MotifLibrary onClose={() => setEditing(false)} />}
    </div>
  );
}
