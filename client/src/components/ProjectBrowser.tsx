/**
 * Open-project dialog.
 *
 * Lists what is actually in MongoDB, with live search. Deletion is guarded by
 * a confirm because there is no undo for a removed project - the version
 * history goes with it.
 */

import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import {
  ApiError,
  projects,
  recentFiles,
  validationMessages,
  type ProjectListItem,
  type RecentFile,
} from '../api/client.js';
import { useDesignStore } from '../store/designStore.js';

interface Props {
  onClose: () => void;
  onOpened: () => void;
}

export function ProjectBrowser({ onClose, onOpened }: Props): React.ReactElement {
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<RecentFile[]>([]);

  const refresh = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await projects.list(term ? { search: term } : {});
      setItems(result.items);
    } catch (err) {
      setError(validationMessages(err).join(' | '));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Recent files are a convenience on top of the real list, so a failure to
  // fetch them shows the projects regardless rather than an empty dialog.
  const loadRecent = useCallback(async () => {
    try {
      const result = await recentFiles.list();
      setRecent(result.items);
    } catch {
      setRecent([]);
    }
  }, []);

  // Search is debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => void refresh(search), 250);
    return () => window.clearTimeout(handle);
  }, [search, refresh]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  /**
   * Fetch a project and put it in the store.
   *
   * Throws rather than reporting, so a caller that needs to distinguish
   * "gone from the library" from "some other failure" can - the recent-files
   * list has to do exactly that.
   */
  const loadIntoStore = async (projectId: string): Promise<void> => {
    const fresh = await projects.get(projectId);
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
      capWrap: fresh.design.capWrap,
    });
  };

  const open = async (projectId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await loadIntoStore(projectId);
      onOpened();
    } catch (err) {
      setError(validationMessages(err).join(' | '));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Open an entry from the recent list.
   *
   * The design behind it may have been deleted since - recent files are a
   * pointer, not a copy - so a 404 drops the stale row and says why, rather
   * than leaving a dead entry to click again next time.
   */
  const openRecent = async (entry: RecentFile): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await loadIntoStore(entry.id);
      onOpened();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setRecent((prev) => prev.filter((r) => r.id !== entry.id));
        setError(`"${entry.name}" is no longer in the library.`);
      } else {
        setError(validationMessages(err).join(' | '));
      }
    } finally {
      setBusy(false);
    }
  };

  const clearRecent = async (): Promise<void> => {
    setBusy(true);
    try {
      await recentFiles.remove();
      setRecent([]);
    } catch (err) {
      setError(validationMessages(err).join(' | '));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (project: ProjectListItem): Promise<void> => {
    const ok = window.confirm(
      `Delete "${project.name}"?\n\nThis cannot be undone. Take a backup first if you need it.`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      await projects.remove(project.id);
      if (useDesignStore.getState().design.projectId === project.id) {
        useDesignStore.getState().newDesign();
      }
      await refresh(search);
      await loadRecent();
    } catch (err) {
      setError(
        err instanceof ApiError && err.isOffline
          ? err.message
          : validationMessages(err).join(' | '),
      );
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
        aria-label="Open design"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Open design</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <input
          className="search-input"
          placeholder="Search designs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          data-testid="project-search"
        />

        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}

        {!loading && recent.length > 0 && !search && (
          <section className="recent-files" data-testid="recent-files">
            <div className="recent-header">
              <h3>Recently opened</h3>
              <button
                type="button"
                className="link-button"
                onClick={() => void clearRecent()}
                disabled={busy}
                data-testid="clear-recent"
              >
                Clear
              </button>
            </div>
            <ul>
              {recent.map((r) => (
                <li key={r.id} className="project-row">
                  <button
                    type="button"
                    className="project-open"
                    onClick={() => void openRecent(r)}
                    disabled={busy}
                  >
                    <span className="project-name">{r.name}</span>
                    <span className="project-meta">
                      {r.summary.objectCount} object
                      {r.summary.objectCount === 1 ? '' : 's'} &middot; {r.summary.colorCount}{' '}
                      colour{r.summary.colorCount === 1 ? '' : 's'} &middot; {r.summary.width}
                      &times;
                      {r.summary.height} mm
                    </span>
                    <span className="project-date">{new Date(r.openedAt).toLocaleString()}</span>
                  </button>
                  <button
                    type="button"
                    className="project-delete"
                    onClick={() => void recentFiles.remove(r.id).then(loadRecent)}
                    disabled={busy}
                    aria-label={`Remove ${r.name} from recent files`}
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="project-list" data-testid="project-list">
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : error && items.length === 0 ? (
            // A failed search must not claim the library is empty - "no saved
            // designs" is a statement about the database, and the request that
            // would have checked it just failed.
            <div className="empty-state">Could not read the design library.</div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              {search ? `No designs match "${search}"` : 'No saved designs yet'}
            </div>
          ) : (
            <ul>
              {items.map((p) => (
                <li key={p.id} className="project-row">
                  <button
                    type="button"
                    className="project-open"
                    onClick={() => void open(p.id)}
                    disabled={busy}
                  >
                    <span className="project-name">{p.name}</span>
                    <span className="project-meta">
                      {p.summary.objectCount} object{p.summary.objectCount === 1 ? '' : 's'}{' '}
                      &middot; {p.summary.colorCount} colour{p.summary.colorCount === 1 ? '' : 's'}{' '}
                      &middot; {p.summary.width}&times;{p.summary.height} mm
                    </span>
                    <span className="project-date">{new Date(p.updatedAt).toLocaleString()}</span>
                  </button>
                  <button
                    type="button"
                    className="project-delete"
                    onClick={() => void remove(p)}
                    disabled={busy}
                    aria-label={`Delete ${p.name}`}
                  >
                    Delete
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
