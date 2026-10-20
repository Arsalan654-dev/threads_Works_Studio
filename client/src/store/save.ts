/**
 * Saving the design document.
 *
 * One code path for explicit save and autosave, so an autosaved revision is
 * guarded by exactly the same version check as a deliberate Ctrl+S - otherwise
 * background saves could quietly win a race that a manual save would lose.
 */

import { ApiError, projects, validationMessages, type ProjectSummary } from '../api/client.js';
import { useDesignStore, type DesignState } from './designStore.js';

export interface SaveResult {
  ok: boolean;
  /** Present only when the caller must ask the user what to do. */
  conflict?: { currentVersion: number };
  message: string;
}

function designPayload(design: DesignState) {
  return {
    units: design.units,
    width: design.width,
    height: design.height,
    hoopId: design.hoopId,
    objects: design.objects,
    threadPalette: design.threadPalette,
  };
}

/**
 * Save the current document.
 *
 * `name` is required for a new design; passing `null` on a new design cancels.
 * `allowConflict` means "the user already agreed to overwrite" - it still
 * re-reads the current version first, so the overwrite is a single deliberate
 * step rather than a blind clobber.
 */
export async function saveDesign(
  options: { name?: string | null; allowConflict?: boolean } = {},
): Promise<SaveResult> {
  const store = useDesignStore.getState();
  const design = store.design;

  useDesignStore.setState({ saving: true });

  try {
    if (design.projectId) {
      let expectedVersion = design.version;

      if (options.allowConflict) {
        const current = await projects.get(design.projectId);
        expectedVersion = current.version;
      }

      const updated: ProjectSummary = await projects.update(design.projectId, {
        design: designPayload(design),
        expectedVersion,
      });

      useDesignStore.getState().markSaved(updated.id, updated.version);
      return { ok: true, message: 'Saved' };
    }

    const name = options.name;
    if (name === null || name === undefined) {
      return { ok: false, message: 'Cancelled' };
    }
    if (name.trim().length === 0) {
      return { ok: false, message: 'Name cannot be empty' };
    }

    const trimmed = name.trim();
    const created = await projects.create(trimmed, designPayload(design));
    useDesignStore.setState((s) => ({ design: { ...s.design, name: trimmed } }));
    useDesignStore.getState().markSaved(created.id, created.version);
    return { ok: true, message: 'Saved' };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'CONFLICT') {
      const details = err.details as { currentVersion?: number } | undefined;
      return {
        ok: false,
        conflict: { currentVersion: details?.currentVersion ?? -1 },
        message: err.message,
      };
    }

    const message = validationMessages(err).join('\n');
    useDesignStore.getState().setError(message);
    return { ok: false, message };
  } finally {
    useDesignStore.setState({ saving: false });
  }
}
