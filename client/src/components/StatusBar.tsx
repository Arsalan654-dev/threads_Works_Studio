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

  // A brand-new canvas has no stitches, which the validator correctly reports
  // as EMPTY_DESIGN. That is a starting state, not a mistake: showing it as a
  // red error made the app look broken before the first shape was drawn.
  const emptyDesign = errors.length === 1 && errors[0]?.code === 'EMPTY_DESIGN';
  const visibleErrors = errors.filter((i) => i.code !== 'EMPTY_DESIGN');

  return (
    <footer className="statusbar">
      <span className="status-item" data-testid="stitch-count">
        {stats ? `${stats.totalStitches.toLocaleString()} stitches` : '0 stitches'}
      </span>
      {stats && (
        <>
          <span className="status-item" title="Needle penetrations only" data-testid="sew-count">
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
      {visibleErrors.length > 0 && (
        <span className="status-issue error" data-testid="validation-errors">
          {visibleErrors.length} error{visibleErrors.length === 1 ? '' : 's'}:{' '}
          {visibleErrors[0]!.message}
        </span>
      )}
      {emptyDesign && (
        <span className="status-issue" data-testid="empty-design">
          Empty design — draw a shape to begin
        </span>
      )}
      {warnings.length > 0 && (
        <span
          className="status-issue warning"
          data-testid="validation-warnings"
          // A bare count tells the operator something is wrong but not what:
          // the message itself has to reach the screen, and the full list is
          // one hover away when several warnings stack up.
          title={warnings.map((w) => w.message).join('\n')}
        >
          {warnings.length} warning{warnings.length === 1 ? '' : 's'}:{' '}
          {warnings[0]!.message}
        </span>
      )}
      {!compileFailed &&
        !lastError &&
        visibleErrors.length === 0 &&
        !emptyDesign &&
        warnings.length === 0 && (
          <span className="status-issue ok" data-testid="validation-ok">
            Ready to sew
          </span>
        )}
    </footer>
  );
}
