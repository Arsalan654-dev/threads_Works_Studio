/**
 * Application shell.
 *
 * Startup loads reference data once. Failure is not fatal: the editor still
 * works with a locally constructed hoop, and the reason is shown in the status
 * bar rather than hidden behind a blank screen.
 */

import { useEffect } from 'react';
import { TopBar } from './components/TopBar.js';
import { Toolbar } from './components/Toolbar.js';
import { RightPanel } from './components/RightPanel.js';
import { StatusBar } from './components/StatusBar.js';
import { EditorCanvas } from './components/EditorCanvas.js';
import { StitchPlayer } from './components/StitchPlayer.js';
import { referenceStore } from './store/referenceStore.js';
import { useDesignStore } from './store/designStore.js';
import { saveDesign } from './store/save.js';

export function App(): React.ReactElement {
  const loadStatus = referenceStore((s) => s.status);
  const loadError = referenceStore((s) => s.error);
  const autosaveMs = referenceStore((s) => s.settings?.autosaveIntervalMs ?? 30_000);

  useEffect(() => {
    void referenceStore.getState().loadAll();
  }, []);

  // Autosave: only when something actually changed, and only for designs
  // that already have a home - a new design still needs its first name, which
  // cannot be supplied on the user's behalf.
  useEffect(() => {
    if (loadStatus !== 'ready') return;

    const handle = window.setInterval(
      () => {
        const store = useDesignStore.getState();
        if (!store.dirty || store.saving || !store.design.projectId) return;
        void saveDesign({});
      },
      Math.max(5_000, autosaveMs),
    );

    return () => window.clearInterval(handle);
  }, [loadStatus, autosaveMs]);

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <Toolbar />
        <main className="editor-area">
          <EditorCanvas />
          <StitchPlayer />
        </main>
        <RightPanel />
      </div>
      <StatusBar />
      {loadStatus === 'error' && loadError && (
        <div className="startup-warning" role="status">
          Reference data could not be loaded: {loadError}
        </div>
      )}
    </div>
  );
}
