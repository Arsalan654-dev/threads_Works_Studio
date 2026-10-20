/**
 * The motif library: shapes a motif fill repeats or a carve presses in.
 *
 * A motif is just a closed outline, so there is nothing here that could not be
 * drawn in the design and saved — what the library adds is that the shape
 * becomes *reusable*. It can be placed in fifty fills, resized without
 * redrawing, and renamed without hunting through the document.
 *
 * Shapes are stored in a unit box, which is what lets one "size" number mean
 * the same thing whichever motif is picked. Every shape is checked before it
 * is saved, using the same test the engine applies when it is sewn, so a
 * shape that would fail on the machine is refused at the door.
 */

import { useCallback, useMemo, useState } from 'react';
import type React from 'react';
import {
  MOTIF_MAX_POINTS,
  MOTIF_MAX_SIZE,
  MOTIF_MIN_SIZE,
  builtinMotifs,
  motifProblem,
  normalizeMotif,
  ringFromPointsText,
  ringFromSvgPath,
  type Ring,
} from '@threadworks/engine';
import { motifs as motifApi, validationMessages, type MotifPayload } from '../api/client.js';
import { referenceStore, type MotifEntry } from '../store/referenceStore.js';
import { useDesignStore } from '../store/designStore.js';
import { motifPath } from './MotifPicker.js';

export interface MotifLibraryProps {
  onClose: () => void;
}

/** How a new shape arrives: pasted as a path, pasted as points, or captured. */
type Source = 'path' | 'points' | 'selection';

export function MotifLibrary({ onClose }: MotifLibraryProps): React.ReactElement {
  const library = referenceStore((s) => s.motifs);
  const reload = referenceStore((s) => s.reloadMotifs);

  const objects = useDesignStore((s) => s.design.objects);
  const selection = useDesignStore((s) => s.selection);

  const [name, setName] = useState('');
  const [source, setSource] = useState<Source>('selection');
  const [pathText, setPathText] = useState('');
  const [pointsText, setPointsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  /**
   * The outline of the shape currently selected, if there is one.
   *
   * Capturing from the canvas is the common case: the operator has already
   * drawn the shape they want as a motif, and re-typing its points into a
   * text box would be a step that exists only for the software's benefit.
   */
  const captured = useMemo<Ring | null>(() => {
    const object = objects.find((o) => o.id === selection[0]);
    const ring = object?.path.rings[0];
    return ring && ring.length >= 3 ? ring : null;
  }, [objects, selection]);

  /** The ring the current form would save, or null if it cannot be read. */
  const candidate = useMemo<Ring | null>(() => {
    if (source === 'path') return pathText.trim() === '' ? null : ringFromSvgPath(pathText);
    if (source === 'points')
      return pointsText.trim() === '' ? null : ringFromPointsText(pointsText);
    return captured;
  }, [source, pathText, pointsText, captured]);

  // Checked against the engine's own test before anything is written, so the
  // message names the real limit rather than a generic "invalid shape".
  const candidateProblem = useMemo(
    () => (candidate === null ? null : motifProblem(candidate)),
    [candidate],
  );

  const add = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Give the shape a name so you can find it again.');
      return;
    }
    if (candidate === null) {
      setError(
        source === 'selection'
          ? 'Select a shape on the canvas first, or switch to pasting a path or points.'
          : 'Nothing could be read from what was pasted.',
      );
      return;
    }
    if (candidateProblem !== null) {
      setError(candidateProblem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Stored at unit size so `scale` means one thing across the whole
      // picker, whatever the shape was drawn at.
      const data: MotifPayload = { points: normalizeMotif(candidate) };
      await motifApi.create(trimmed, data);
      await reload();
      setName('');
      setPathText('');
      setPointsText('');
    } catch (err) {
      setError(
        validationMessages(err).join(' ') || (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setBusy(false);
    }
  }, [name, candidate, candidateProblem, source, reload]);

  const remove = useCallback(
    async (entry: MotifEntry): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await motifApi.remove(entry.presetId);
        await reload();
      } catch (err) {
        setError(
          validationMessages(err).join(' ') || (err instanceof Error ? err.message : String(err)),
        );
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const commitRename = useCallback(async (): Promise<void> => {
    if (renaming === null) return;
    const trimmed = renaming.name.trim();
    if (trimmed === '') {
      setError('A shape needs a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await motifApi.update(renaming.id, { name: trimmed });
      await reload();
      setRenaming(null);
    } catch (err) {
      setError(
        validationMessages(err).join(' ') || (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setBusy(false);
    }
  }, [renaming, reload]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal motif-library"
        role="dialog"
        aria-modal="true"
        aria-label="Motif library"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Motif library</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <p className="dialog-hint">
          Shapes a motif fill repeats or a carve presses in. Built-ins cannot be deleted; anything
          you add is yours to rename or remove.
        </p>

        <ul className="motif-library-list" data-testid="motif-library-list">
          {builtinMotifs().map((motif) => (
            <MotifRow key={`builtin-${motif.id}`} name={motif.name} points={motif.points} builtin />
          ))}
          {library.map((entry) => (
            <MotifRow
              key={entry.presetId}
              name={entry.name}
              points={entry.points}
              builtin={entry.builtin}
              note={entry.note}
              renaming={renaming?.id === entry.presetId ? renaming.name : null}
              onRenameInput={(value) => setRenaming({ id: entry.presetId, name: value })}
              onRenameCommit={() => void commitRename()}
              onRenameCancel={() => setRenaming(null)}
              onDelete={() => void remove(entry)}
            />
          ))}
        </ul>

        <details open>
          <summary>Add a shape</summary>

          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              placeholder="Shop crest"
              onChange={(e) => setName(e.target.value)}
              data-testid="motif-name"
            />
          </label>

          <label className="field">
            <span>Shape from</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as Source)}
              data-testid="motif-source"
            >
              <option value="selection">the shape selected on the canvas</option>
              <option value="path">a pasted SVG path</option>
              <option value="points">pasted coordinates</option>
            </select>
          </label>

          {source === 'selection' && (
            <small>
              {captured === null
                ? 'Select a shape on the canvas to capture its outline.'
                : `Capturing the outline of the selected shape (${captured.length} points).`}
            </small>
          )}

          {source === 'path' && (
            <label className="field">
              <span>SVG path</span>
              <textarea
                rows={3}
                value={pathText}
                placeholder="M 0 0 L 10 0 L 10 10 L 0 10 Z"
                onChange={(e) => setPathText(e.target.value)}
                data-testid="motif-path"
              />
              <small>
                Move, line, horizontal, vertical, cubic and quadratic commands, absolute or
                relative. Arcs are refused rather than approximated.
              </small>
            </label>
          )}

          {source === 'points' && (
            <label className="field">
              <span>Coordinates (mm)</span>
              <textarea
                rows={3}
                value={pointsText}
                placeholder="0,0  10,0  10,10  0,10"
                onChange={(e) => setPointsText(e.target.value)}
                data-testid="motif-points"
              />
              <small>At least three x,y pairs, separated by commas, spaces or new lines.</small>
            </label>
          )}

          {candidate !== null && candidateProblem === null && (
            <svg
              className="motif-preview"
              width={96}
              height={96}
              viewBox="0 0 96 96"
              aria-hidden="true"
            >
              <path d={motifPath(candidate, 96)} />
            </svg>
          )}

          {candidateProblem !== null && candidate !== null && (
            <p className="trace-error" data-testid="motif-problem">
              {candidateProblem}
            </p>
          )}

          {error !== null && <p className="trace-error">{error}</p>}

          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || candidate === null || candidateProblem !== null}
            data-testid="motif-add"
          >
            {busy ? 'Saving...' : 'Add to library'}
          </button>
        </details>

        <p className="dialog-hint">
          A shape may be {MOTIF_MIN_SIZE}-{MOTIF_MAX_SIZE} mm across and hold at most{' '}
          {MOTIF_MAX_POINTS} points, and it cannot cross itself.
        </p>

        <footer className="dialog-footer">
          <button type="button" onClick={onClose} data-testid="motif-library-close">
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

interface MotifRowProps {
  name: string;
  points: Ring;
  builtin: boolean;
  note?: string;
  /** Non-null while this row is being renamed. */
  renaming?: string | null;
  onRenameInput?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onDelete?: () => void;
}

function MotifRow({
  name,
  points,
  builtin,
  note,
  renaming,
  onRenameInput,
  onRenameCommit,
  onRenameCancel,
  onDelete,
}: MotifRowProps): React.ReactElement {
  // `undefined` and `null` both mean "not renaming" — the prop is optional so
  // the built-in rows can omit it entirely.
  const renameValue = renaming ?? null;

  return (
    <li className="motif-library-row">
      <svg width={40} height={40} viewBox="0 0 40 40" aria-hidden="true">
        <path d={motifPath(points, 40)} />
      </svg>
      {renameValue !== null ? (
        <span className="motif-rename">
          <input
            type="text"
            value={renameValue}
            maxLength={80}
            onChange={(e) => onRenameInput?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit?.();
              if (e.key === 'Escape') onRenameCancel?.();
            }}
            data-testid="motif-rename-input"
          />
          <button type="button" onClick={onRenameCommit} data-testid="motif-rename-save">
            Save
          </button>
          <button type="button" className="secondary" onClick={onRenameCancel}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="motif-row-name">
          {name}
          {builtin && <em>built-in</em>}
          {note !== undefined && note !== '' && <small>{note}</small>}
        </span>
      )}
      <span className="motif-row-actions">
        {!builtin && renameValue === null && (
          <button
            type="button"
            className="secondary"
            onClick={() => onRenameInput?.(name)}
            data-testid={`motif-rename-${name}`}
          >
            Rename
          </button>
        )}
        {!builtin && (
          <button
            type="button"
            className="danger"
            onClick={onDelete}
            data-testid={`motif-delete-${name}`}
          >
            Delete
          </button>
        )}
      </span>
    </li>
  );
}
