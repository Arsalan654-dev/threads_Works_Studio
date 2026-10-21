/**
 * Top bar: file operations, history and export.
 *
 * Save is optimistic-concurrency aware: the version the document was loaded
 * at travels with the request, so a stale save is rejected rather than
 * silently overwriting someone else's work.
 */

import { useCallback, useState } from 'react';
import type React from 'react';
import { useDesignStore } from '../store/designStore.js';
import type { ExportFormat } from '../store/designStore.js';
import { saveDesign } from '../store/save.js';
import { referenceStore } from '../store/referenceStore.js';
import { ProjectBrowser } from './ProjectBrowser.js';
import { VersionHistory } from './VersionHistory.js';
import { Preferences } from './Preferences.js';
import { ImageTraceDialog } from './ImageTraceDialog.js';
import { PhotoStitchDialog } from './PhotoStitchDialog.js';
import { ImportDialog } from './ImportDialog.js';
import { ClipartBrowser } from './ClipartBrowser.js';
import { ArtworkDialog } from './ArtworkDialog.js';
import { downloadBytes } from '../files/download.js';

export type { ExportFormat };

const EXPORT_FORMATS: ReadonlyArray<{ id: ExportFormat; label: string; hint: string }> = [
  { id: 'dst', label: 'DST', hint: 'Tajima - commercial machines' },
  { id: 'pes', label: 'PES', hint: 'Brother / Babylock home machines' },
  { id: 'exp', label: 'EXP', hint: 'Melco / Bernina' },
  { id: 'jef', label: 'JEF', hint: 'Janome / Elna / New Home' },
  { id: 'vp3', label: 'VP3', hint: 'Husqvarna Viking / Pfaff' },
  { id: 'tbf', label: 'TBF', hint: 'Babylock / Bernina / Barudan' },
  { id: 'hus', label: 'HUS', hint: 'Husqvarna Viking' },
];

export function TopBar(): React.ReactElement {
  const design = useDesignStore((s) => s.design);
  const dirty = useDesignStore((s) => s.dirty);
  const saving = useDesignStore((s) => s.saving);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);

  const [showBrowser, setShowBrowser] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showClipart, setShowClipart] = useState(false);
  const [showArtwork, setShowArtwork] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('dst');
  const [rendering, setRendering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const store = useDesignStore;

  const notify = useCallback((text: string, isError = false) => {
    setMessage(text);
    if (isError) {
      // Errors are cleared on the next action rather than on a timer, so a
      // message cannot disappear before the user has read it.
      return;
    }
    window.setTimeout(() => setMessage((current) => (current === text ? null : current)), 4000);
  }, []);

  const handleNew = (): void => {
    if (dirty && !window.confirm('Discard unsaved changes and start a new design?')) return;
    store.getState().newDesign();
    notify('New design created');
  };

  const handleSave = useCallback(async () => {
    const state = store.getState();

    // A brand-new design has no id yet, so ask where to file it first.
    let name: string | null | undefined = undefined;
    if (!state.design.projectId) {
      const answer = window.prompt('Save design as:', state.design.name);
      if (answer === null) return;
      name = answer;
    }

    const result = await saveDesign(name === undefined ? {} : { name });

    if (result.ok) {
      notify(result.message);
      return;
    }

    if (result.conflict) {
      const overwrite = window.confirm(
        `${result.message}\n\nClick OK to overwrite with your version, or Cancel to keep the newer copy.`,
      );
      if (overwrite) {
        const retry = await saveDesign({ allowConflict: true });
        notify(retry.ok ? 'Saved (overwrote the newer copy)' : retry.message, !retry.ok);
      } else {
        // Saying nothing here would look like the Save button had stopped
        // working. The message is kept on screen (error styling = no timer)
        // so it cannot vanish before the user reads it.
        notify('Not saved - the newer copy was kept.', true);
      }
      return;
    }

    notify(result.message, true);
  }, [notify, store]);

  const handleExport = (format: ExportFormat): void => {
    try {
      const state = store.getState();
      const exporters: Record<
        ExportFormat,
        () => { filename: string; bytes: Uint8Array; mime: string }
      > = {
        dst: state.exportDst,
        pes: state.exportPes,
        exp: state.exportExp,
        jef: state.exportJef,
        vp3: state.exportVp3,
        tbf: state.exportTbf,
        hus: state.exportHus,
      };
      const { filename, bytes, mime } = exporters[format]();
      downloadBytes(bytes, filename, mime);
      notify(`Exported ${filename}`);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      store.getState().setError(text);
      notify(text, true);
    }
  };

  const handleExportSections = (): void => {
    try {
      const { hoopName, message, warnings, files } = store.getState().exportSections(exportFormat);
      for (const file of files) downloadBytes(file.bytes, file.filename, file.mime);
      // The plan matters as much as the files: the operator needs to know
      // which frame to mount and whether any cut landed mid-object before
      // they start sewing.
      const warn = warnings.length > 0 ? ` ${warnings.join(' ')}` : '';
      notify(`${message} Exported ${files.length} file(s) for hoop "${hoopName}".${warn}`);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      store.getState().setError(text);
      notify(text, true);
    }
  };

  const handleExportMachines = (): void => {
    try {
      const result = store.getState().exportByMachine(exportFormat);
      for (const file of result.files) downloadBytes(file.bytes, file.filename, file.mime);
      notify(`${result.message} Exported ${result.files.length} file(s).`);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      store.getState().setError(text);
      notify(text, true);
    }
  };

  const handleExportMovie = async (): Promise<void> => {
    setRendering(true);
    try {
      // The render itself runs on a worker thread, so the page keeps painting
      // while a large design draws its frames - the busy note stays on screen
      // because nothing here blocks the thread it is drawn on.
      const { filename, bytes, mime } = await store.getState().exportMovie();
      downloadBytes(bytes, filename, mime);
      notify(`Exported ${filename}`);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      store.getState().setError(text);
      notify(text, true);
    } finally {
      setRendering(false);
    }
  };

  const server = referenceStore((s) => s.server);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          &#9998;
        </span>
        <span className="brand-name">ThreadWorks Studio</span>
      </div>

      <div className="topbar-group">
        <button type="button" onClick={handleNew}>
          New
        </button>
        <button type="button" onClick={() => setShowBrowser(true)}>
          Open
        </button>
        <button type="button" onClick={() => setShowTrace(true)} data-testid="trace-open">
          Trace image
        </button>
        <button
          type="button"
          onClick={() => setShowPhoto(true)}
          data-testid="photo-open"
          title="Sew a photograph as a fine colour mosaic or a fast Photo Flash"
        >
          Photo stitch
        </button>
        <button
          type="button"
          onClick={() => setShowClipart(true)}
          data-testid="clipart-open"
          title="Browse original built-in clipart and add a shape"
        >
          Clipart
        </button>
        <button
          type="button"
          onClick={() => setShowArtwork(true)}
          data-testid="artwork-open"
          title="Export SVG, PNG or PDF artwork, or a printable 1:1 placement sheet"
        >
          Artwork
        </button>
        <button
          type="button"
          onClick={() => setShowImport(true)}
          data-testid="import-open"
          title="Open a DST, PES, PEC or EXP file to preview, convert or film it"
        >
          Import
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          data-testid="save-button"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          // History lives with the project in the database, so an unsaved
          // design has none to show yet - the button would open an empty
          // dialog and look broken.
          disabled={!design.projectId}
          data-testid="history-button"
          title={
            design.projectId
              ? 'Browse checkpoints of this design and restore one'
              : 'Save the design first to start a history'
          }
        >
          History
        </button>
        <label className="export-format">
          <span className="sr-only">Export format</span>
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
            data-testid="export-format"
          >
            {EXPORT_FORMATS.map((f) => (
              <option key={f.id} value={f.id} title={f.hint}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => handleExport(exportFormat)} data-testid="export-dst">
          Export
        </button>
        <button
          type="button"
          onClick={handleExportSections}
          data-testid="export-sections"
          title="Split the design across multiple hoopings and export one file per section"
        >
          Export sections
        </button>
        <button
          type="button"
          onClick={handleExportMachines}
          data-testid="export-machines"
          title="Write one independently valid file per assigned production machine"
        >
          Export machines
        </button>
        <button
          type="button"
          onClick={() => void handleExportMovie()}
          disabled={rendering}
          data-testid="export-movie"
          title="Render the design sewing as an animated GIF"
        >
          {rendering ? 'Rendering...' : 'Stitch video'}
        </button>
      </div>

      <div className="topbar-group">
        <button type="button" onClick={() => useDesignStore.getState().undo()} disabled={!canUndo}>
          Undo
        </button>
        <button type="button" onClick={() => useDesignStore.getState().redo()} disabled={!canRedo}>
          Redo
        </button>
      </div>

      <div className="topbar-title">
        <input
          className="title-input"
          value={design.name}
          aria-label="Design name"
          onChange={(e) =>
            useDesignStore.setState((s) => ({
              design: { ...s.design, name: e.target.value },
              dirty: true,
            }))
          }
        />
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
      </div>

      <div className="topbar-group">
        <button
          type="button"
          onClick={() => setShowPreferences(true)}
          data-testid="preferences-button"
        >
          Preferences
        </button>
      </div>

      <div className="topbar-status" data-testid="server-status">
        <span
          className={`status-dot ${server?.database === 'connected' ? 'ok' : 'warn'}`}
          aria-hidden
        />
        {server?.database === 'connected'
          ? server.databaseMode === 'remote'
            ? 'Cloud database'
            : 'Local database'
          : 'Database offline'}
      </div>

      {message && (
        <div className="toast" role="status" data-testid="toast">
          {message}
        </div>
      )}

      {showPreferences && <Preferences onClose={() => setShowPreferences(false)} />}

      {showTrace && <ImageTraceDialog onClose={() => setShowTrace(false)} notify={notify} />}

      {showPhoto && <PhotoStitchDialog onClose={() => setShowPhoto(false)} notify={notify} />}

      {showImport && <ImportDialog onClose={() => setShowImport(false)} notify={notify} />}

      {showClipart && (
        <ClipartBrowser onClose={() => setShowClipart(false)} notify={notify} />
      )}

      {showArtwork && (
        <ArtworkDialog onClose={() => setShowArtwork(false)} notify={notify} />
      )}

      {showBrowser && (
        <ProjectBrowser
          onClose={() => setShowBrowser(false)}
          onOpened={() => {
            setShowBrowser(false);
            notify('Design opened');
          }}
        />
      )}

      {showHistory && design.projectId && (
        <VersionHistory
          projectId={design.projectId}
          projectName={design.name}
          onClose={() => setShowHistory(false)}
          notify={notify}
        />
      )}
    </header>
  );
}
