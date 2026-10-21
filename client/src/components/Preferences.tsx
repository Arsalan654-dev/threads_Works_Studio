/**
 * Preferences dialog.
 *
 * Preferences are stored server-side in MongoDB rather than in the browser,
 * so they follow the machine instead of a browser profile. For a single
 * workstation that is the right trade-off: a browser reset does not silently
 * throw away the operator's setup.
 *
 * Every control here is wired to something that reads it. A preference with
 * no reader is not a feature - it is a control that lies - so anything the
 * application does not yet act on is either shown as read-only (`units`,
 * which only supports millimeters) or described in plain words on the control
 * itself, as `default stitch type` is: it sets what a newly drawn complex
 * fill starts as, and says so.
 */

import { useEffect, useState } from 'react';
import type React from 'react';
import { referenceStore } from '../store/referenceStore.js';
import { useDesignStore } from '../store/designStore.js';
import { FILL_STITCH_TYPES } from '../model/stitchTypes.js';
import type { AppSettings } from '../api/client.js';

/** Matches the steps offered by the stitch player. */
const PLAYER_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;

/** Autosave cannot be switched off - see the note on the control below. */
const AUTOSAVE_CHOICES = [15, 30, 60, 120, 300] as const;

export function Preferences({ onClose }: { onClose: () => void }): React.ReactElement {
  const settings = referenceStore((s) => s.settings);
  const hoops = referenceStore((s) => s.hoops);
  const saveSettings = referenceStore((s) => s.saveSettings);

  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Escape closes, as it does for every other dialog. Focus is deliberately
  // not trapped: the dialog is a short list of controls, and a trap would
  // add a lot of machinery for very little benefit here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = async (patch: Partial<AppSettings>): Promise<void> => {
    setSaving(true);
    setMessage(null);
    try {
      await saveSettings(patch);
      // Lowering the depth has to bite immediately, not on the next edit:
      // the panel has just told the operator the editor keeps N steps, and a
      // stack still holding the old depth would make that a lie until the
      // next change. Only on success - a failed save reverts the setting, and
      // there is no way to put dropped history back.
      if (patch.undoDepth !== undefined) {
        useDesignStore.getState().trimHistory(patch.undoDepth);
      }
    } catch {
      // `saveSettings` has already put the previous value back, so the screen
      // the user is looking at is the honest one; only the reason needs saying.
      setMessage('Could not save - the change was undone.');
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<AppSettings>): void => {
    void apply(patch);
  };

  if (!settings) {
    return (
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <div className="modal" role="dialog" aria-modal="true" aria-label="Preferences">
          <div className="modal-header">
            <h2>Preferences</h2>
            <button type="button" onClick={onClose} aria-label="Close">
              &times;
            </button>
          </div>
          <div className="empty-state">
            Preferences could not be loaded. The server stores them, so they are unavailable while
            it is offline.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        data-testid="preferences-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Preferences</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="preferences-close"
          >
            &times;
          </button>
        </div>

        <div className="pref-grid">
          <label className="field">
            <span>Default hoop</span>
            <select
              value={settings.defaultHoopId ?? ''}
              onChange={(e) =>
                update({ defaultHoopId: e.target.value === '' ? null : e.target.value })
              }
              data-testid="pref-default-hoop"
            >
              <option value="">Built-in default (180 x 130 mm)</option>
              {hoops.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <small className="muted">Used for designs created with File &gt; New.</small>
          </label>

          <label className="field">
            <span>New fill stitch type</span>
            <select
              value={settings.defaultStitchType}
              onChange={(e) =>
                update({ defaultStitchType: e.target.value as AppSettings['defaultStitchType'] })
              }
              data-testid="pref-default-stitch-type"
            >
              {FILL_STITCH_TYPES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <small className="muted">
              What a newly drawn complex fill starts as. Column, run and bean tools already mean one
              stitch type each, so they keep theirs.
            </small>
          </label>

          <label className="field">
            <span>Autosave interval</span>
            <select
              value={settings.autosaveIntervalMs / 1000}
              onChange={(e) => update({ autosaveIntervalMs: Number(e.target.value) * 1000 })}
              data-testid="pref-autosave"
            >
              {AUTOSAVE_CHOICES.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minute(s)`}
                </option>
              ))}
            </select>
            <small className="muted">
              Applies to designs that already have a name; autosave cannot be turned off.
            </small>
          </label>

          <label className="field">
            <span>Undo steps</span>
            <input
              type="number"
              min={5}
              max={500}
              step={5}
              value={settings.undoDepth}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value)) return;
                update({ undoDepth: Math.round(Math.min(500, Math.max(5, value))) });
              }}
              data-testid="pref-undo-depth"
            />
            <small className="muted">
              How far back Ctrl+Z reaches. History older than this is dropped as the design is
              edited.
            </small>
          </label>

          <label className="field">
            <span>Grid size (mm)</span>
            <input
              type="number"
              min={1}
              max={50}
              step={0.5}
              value={settings.gridSize}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value)) return;
                const minor = Math.min(50, Math.max(1, value));
                update({
                  gridSize: minor,
                  // The major spacing is never allowed to fall behind the
                  // minor one; pulling it along is clearer than silently
                  // drawing an all-major grid.
                  ...(settings.gridMajorSize < minor ? { gridMajorSize: minor } : {}),
                });
              }}
              data-testid="pref-grid-size"
            />
            <small className="muted">Minor grid lines, and the step snap-to-grid uses.</small>
          </label>

          <label className="field">
            <span>Major grid (mm)</span>
            <input
              type="number"
              min={1}
              max={250}
              step={1}
              value={settings.gridMajorSize}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value)) return;
                update({
                  gridMajorSize: Math.min(250, Math.max(settings.gridSize, value)),
                });
              }}
              data-testid="pref-grid-major"
            />
            <small className="muted">
              Heavier lines every this many mm, for measuring at a glance.
            </small>
          </label>

          <label className="field">
            <span>Stitch player speed</span>
            <select
              value={settings.stitchSimulationSpeed}
              onChange={(e) => update({ stitchSimulationSpeed: Number(e.target.value) })}
              data-testid="pref-player-speed"
            >
              {PLAYER_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}x
                </option>
              ))}
            </select>
            <small className="muted">Starting speed; the player can override it per session.</small>
          </label>

          <label className="field checkbox">
            <input
              type="checkbox"
              checked={settings.showGrid}
              onChange={(e) => update({ showGrid: e.target.checked })}
              data-testid="pref-show-grid"
            />
            <span>Show grid</span>
          </label>

          <label className="field checkbox">
            <input
              type="checkbox"
              checked={settings.showRulers}
              onChange={(e) => update({ showRulers: e.target.checked })}
              data-testid="pref-show-rulers"
            />
            <span>Show rulers</span>
          </label>

          <label className="field checkbox">
            <input
              type="checkbox"
              checked={settings.snapToGrid}
              onChange={(e) => update({ snapToGrid: e.target.checked })}
              data-testid="pref-snap"
            />
            <span>Snap drawing to grid</span>
          </label>

          <label className="field checkbox">
            <input
              type="checkbox"
              checked={settings.snapToObjects}
              onChange={(e) => update({ snapToObjects: e.target.checked })}
              data-testid="pref-snap-objects"
            />
            <span>Snap to objects</span>
            <small className="muted">
              Drawing and node drags catch nearby nodes first, then edges, then object centres.
            </small>
          </label>

          <label className="field checkbox">
            <input
              type="checkbox"
              checked={settings.preview3d ?? false}
              onChange={(e) => update({ preview3d: e.target.checked })}
              data-testid="pref-preview-3d"
            />
            <span>Lit / 3D thread preview</span>
            <small className="muted">
              Adds a shadow and highlight pass over the stitches. It changes only the screen image,
              never the exported file.
            </small>
          </label>

          <label className="field checkbox">
            <input
              type="checkbox"
              checked={settings.previewUnderlay}
              onChange={(e) => update({ previewUnderlay: e.target.checked })}
              data-testid="pref-preview-underlay"
            />
            <span>Show underlay in preview</span>
          </label>

          <div className="field">
            <span>Units</span>
            <p className="muted small">
              Millimeters. This build digitizes in millimeters only; the setting exists so imported
              designs have somewhere to declare their units.
            </p>
          </div>
        </div>

        <div className="pref-footer">
          <span className="muted small" data-testid="pref-status" role="status">
            {saving ? 'Saving...' : (message ?? 'Changes are saved as you make them.')}
          </span>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
