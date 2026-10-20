import type React from 'react';
/**
 * Left tool rail.
 *
 * Tools map onto the engine's object types rather than a bespoke vocabulary,
 * so picking "Input A" and then drawing produces exactly the object the
 * satin generator expects - there is no translation layer to drift.
 */

import { useDesignStore, type Tool } from '../store/designStore.js';

interface ToolDef {
  id: Tool;
  label: string;
  hint: string;
  /** Shape drawn beside the label. */
  glyph: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', hint: 'Click to select, drag to move (V)', glyph: 'arrow' },
  {
    id: 'nodeEdit',
    label: 'Node Edit',
    hint: 'Reshape a selected outline: drag points, click an edge to add one, Del to remove (N)',
    glyph: 'nodes',
  },
  { id: 'pan', label: 'Pan', hint: 'Drag the canvas (H)', glyph: 'hand' },
  {
    id: 'inputA',
    label: 'Input A',
    hint: 'Satin column: click around the column outline, then Enter',
    glyph: 'column',
  },
  {
    id: 'complexFill',
    label: 'Complex Fill',
    hint: 'Filled shape: click the outline, then Enter',
    glyph: 'fill',
  },
  { id: 'run', label: 'Run', hint: 'Single run outline', glyph: 'line' },
  { id: 'bean', label: 'Bean', hint: 'Triple run / bean stitch', glyph: 'line3' },
  { id: 'rectangle', label: 'Rectangle', hint: 'Drag to draw a rectangle', glyph: 'rect' },
  { id: 'circle', label: 'Circle', hint: 'Drag to draw a circle', glyph: 'circle' },
  {
    id: 'lettering',
    label: 'Text',
    hint: 'Click to place lettering, then edit it in the right panel',
    glyph: 'text',
  },
];

const GLYPHS: Record<string, React.ReactNode> = {
  arrow: <path d="M4 3 L4 17 L8 13 L11 19 L13 18 L10 12 L15 12 Z" />,
  hand: (
    <path d="M6 11V6a1.5 1.5 0 013 0v4V4.5a1.5 1.5 0 013 0V10V6a1.5 1.5 0 013 0v7a5 5 0 01-5 5h-1a5 5 0 01-5-5v-3a1.5 1.5 0 013 0" />
  ),
  column: (
    <>
      <path d="M5 4 L14 6 M5 16 L14 14" />
      <path d="M6 5 L6 15 M9 5.5 L9 14.5 M12 6 L12 14" />
    </>
  ),
  fill: <path d="M4 6 L16 4 L15 15 L6 16 Z" />,
  line: <path d="M3 15 L17 5" />,
  line3: <path d="M3 16 L17 4 M3 13 L17 1 M6 17 L18 7" />,
  rect: <rect x="4" y="5" width="13" height="11" />,
  circle: <circle cx="10" cy="10" r="6.5" />,
  text: (
    <>
      <path d="M4 5 L16 5" />
      <path d="M10 5 L10 16" />
      <path d="M6 16 L14 16" />
    </>
  ),
  nodes: (
    <>
      <path d="M4 15 L10 5 L16 15" />
      <rect x="2" y="13" width="4" height="4" />
      <rect x="8" y="3" width="4" height="4" />
      <rect x="14" y="13" width="4" height="4" />
    </>
  ),
};

export function Toolbar(): React.ReactElement {
  const tool = useDesignStore((s) => s.tool);
  const continuingId = useDesignStore((s) => s.continuingId);
  const selectionCount = useDesignStore((s) => s.selection.length);
  const setTool = useDesignStore((s) => s.setTool);

  return (
    <nav className="toolbar" aria-label="Tools">
      <ul>
        {TOOLS.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={tool === t.id ? 'active' : ''}
              aria-pressed={tool === t.id}
              title={`${t.label} - ${t.hint}`}
              data-testid={`tool-${t.id}`}
              onClick={() => setTool(t.id)}
            >
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden focusable="false">
                {GLYPHS[t.glyph]}
              </svg>
              <span className="tool-label">{t.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="toolbar-footer">
        <button
          type="button"
          className={continuingId ? 'active' : ''}
          aria-pressed={!!continuingId}
          title={
            continuingId
              ? 'Resuming this outline - click to add points, Enter to finish, Escape to cancel'
              : 'Resume the selected outline without redrawing it'
          }
          data-testid="continue-digitizing"
          disabled={!!continuingId || selectionCount !== 1}
          onClick={() => useDesignStore.getState().beginContinueDigitizing()}
        >
          Continue
        </button>
        <button
          type="button"
          title="Delete selection (Del)"
          data-testid="delete-selection"
          disabled={selectionCount === 0}
          onClick={() => useDesignStore.getState().removeSelected()}
        >
          Delete
        </button>
        <button
          type="button"
          title="Duplicate selection (Ctrl+D)"
          disabled={selectionCount === 0}
          onClick={() => useDesignStore.getState().duplicateSelected()}
        >
          Duplicate
        </button>
      </div>

      <p className="tool-hint">
        {continuingId
          ? 'Resuming the outline - click to add points, Enter to finish, Escape to cancel.'
          : TOOLS.find((t) => t.id === tool)?.hint}
      </p>
    </nav>
  );
}
