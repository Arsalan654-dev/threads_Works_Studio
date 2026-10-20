/**
 * Design history browser.
 *
 * Every save snapshots the design as it was *before* that save, so this list
 * is a genuine timeline of states that existed - not a log of what was
 * overwritten. Restoring one writes over the project, which is why:
 *
 *  - the current design is checkpointed first (the server does this), so a
 *    restore is itself undoable;
 *  - the dialog confirms before going, because the in-editor undo stack does
 *    not reach across a reload;
 *  - restoring loads the result into the store rather than telling the user
 *    to reopen the file, so what is on screen matches what was just restored.
 */

import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { validationMessages, versions, type VersionSummary } from '../api/client.js';
import { useDesignStore } from '../store/designStore.js';

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  notify: (message: string, isError?: boolean) => void;
}

const KIND_LABEL: Record<VersionSummary['kind'], string> = {
  auto: 'Auto save',
  manual: 'Checkpoint',
  restore: 'Before a restore',
};

export function VersionHistory({
  projectId,
  projectName,
  onClose,
  notify,
}: Props): React.ReactElement {
  const [items, setItems] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await versions.list(projectId);
      setItems(result.items);
    } catch (err) {
      setError(validationMessages(err).join(' | '));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checkpoint = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await versions.checkpoint(projectId);
      await refresh();
      notify('Checkpoint saved');
    } catch (err) {
      setError(validationMessages(err).join(' | '));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (entry: VersionSummary): Promise<void> => {
    // The checkpoint list comes from the database, so anything edited since
    // the last save is not in it and would be silently lost. Saying so before
    // the fact is the difference between a restore and a surprise.
    const unsaved = useDesignStore.getState().dirty;
    const ok = window.confirm(
      `Restore "${projectName}" to the version saved ${new Date(
        entry.createdAt,
      ).toLocaleString()}?\n\nEverything done since then will be replaced.` +
        (unsaved ? '\n\nYou have UNSAVED changes right now - they will be discarded too.' : '') +
        '\n\nThe state being replaced is checkpointed first, so this is reversible\n' +
        'from this list.',
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      const fresh = await versions.restore(projectId, entry.id);
      useDesignStore.getState().loadDesign({
        projectId: fresh.id,
        name: fresh.name,
        version: fresh.version,
        units: fresh.design.units,
        width: fresh.design.width,
        height: fresh.design.height,
        hoopId: fresh.design.hoopId,
        objects: fresh.design.objects,
        threadPalette: fresh.design.threadPalette,
      });
      notify('Design restored');
      onClose();
    } catch (err) {
      setError(validationMessages(err).join(' | '));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: VersionSummary): Promise<void> => {
    const ok = window.confirm('Forget this checkpoint? It cannot be recovered.');
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      await versions.remove(projectId, entry.id);
      await refresh();
    } catch (err) {
      setError(validationMessages(err).join(' | '));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Design history"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Design history &mdash; {projectName}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="history-actions">
          <button
            type="button"
            onClick={() => void checkpoint()}
            disabled={busy || loading}
            data-testid="history-checkpoint"
            title="Snapshot the saved design now, so it can be come back to later"
          >
            Checkpoint now
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy || loading}
            data-testid="history-refresh"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}

        <div className="project-list" data-testid="history-list">
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : error ? (
            // Deliberately NOT "No checkpoints yet": a read that failed says
            // nothing about whether checkpoints exist, and an empty timeline
            // here would read as "you have no history" when the truth is
            // "we could not look".
            <div className="empty-state">History could not be loaded.</div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              No checkpoints yet. Every save adds one automatically.
            </div>
          ) : (
            <ul>
              {items.map((entry) => (
                <li key={entry.id} className="project-row">
                  <div className="history-entry">
                    <span className="project-name">
                      {KIND_LABEL[entry.kind]} &middot; version {entry.projectVersion}
                    </span>
                    <span className="project-meta">
                      {entry.summary.objectCount} object
                      {entry.summary.objectCount === 1 ? '' : 's'} &middot;{' '}
                      {entry.summary.colorCount} colour{entry.summary.colorCount === 1 ? '' : 's'}{' '}
                      &middot; {entry.summary.width}&times;{entry.summary.height} mm
                    </span>
                    <span className="project-date">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void restore(entry)}
                    disabled={busy}
                    data-testid={`restore-${entry.id}`}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="project-delete"
                    onClick={() => void remove(entry)}
                    disabled={busy}
                    aria-label="Forget this checkpoint"
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
