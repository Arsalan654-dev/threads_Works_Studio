/**
 * Bottom status bar: stitch statistics and validation.
 *
 * Counts come from the compiled sequence, never from an estimate, so what is
 * shown here is exactly what the exported file will contain.
 */

import { useDesignStore } from '../store/designStore.js';

export function StatusBar(): React.ReactElement {
  const rev = useDesignStore((s) => s.rev);
  const lastError = useDesignStore((s) => s.lastError);

  // `rev` is a dependency so the stats refresh after every edit.
  void rev;

  let stats:
    | ReturnType<ReturnType<typeof useDesignStore.getState>['getCompiled']>['sequence']['stats']
    | null = null;
  let issues: ReturnType<
    ReturnType<typeof useDesignStore.getState>['getCompiled']
  >['validation']['issues'] = [];
  let compileFailed: string | null = null;

  try {
    const compiled = useDesignStore.getState().getCompiled();
    stats = compiled.sequence.stats;
    issues = compiled.validation.issues;
  } catch (err) {
    compileFailed = err instanceof Error ? err.message : String(err);
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return (
    <footer className="statusbar">
      <span className="status-item" data-testid="stitch-count">
        {stats ? `${stats.totalStitches.toLocaleString()} stitches` : '0 stitches'}
      </span>
      {stats && (
        <>
          <span className="status-item" title="Needle penetrations only">
            {stats.sewStitches.toLocaleString()} sewn
          </span>
          <span className="status-item" title="Jumps and trims between objects">
            {stats.jumps} jumps / {stats.trims} trims
          </span>
          <span className="status-item" title="Colour changes">
            {stats.colorChanges} changes
          </span>
          <span className="status-item" title="Tie-in and tie-off locks">
            {stats.locks} locks
          </span>
          <span className="status-item" title="Longest single stitch">
            {stats.maxStitchLength.toFixed(1)} mm max
          </span>
        </>
      )}

      <span className="status-spacer" />

      {compileFailed && (
        <span className="status-issue error" role="alert" data-testid="compile-error">
          {compileFailed}
        </span>
      )}
      {lastError && (
        <span className="status-issue error" role="alert">
          {lastError}
        </span>
      )}
      {errors.length > 0 && (
        <span className="status-issue error" data-testid="validation-errors">
          {errors.length} error{errors.length === 1 ? '' : 's'}: {errors[0]!.message}
        </span>
      )}
      {warnings.length > 0 && (
        <span className="status-issue warning" data-testid="validation-warnings">
          {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        </span>
      )}
      {!compileFailed && !lastError && errors.length === 0 && warnings.length === 0 && (
        <span className="status-issue ok" data-testid="validation-ok">
          Ready to sew
        </span>
      )}
    </footer>
  );
}
