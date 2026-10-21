/**
 * Customer artwork and print-sheet export.
 *
 * Machine formats are deliberately in a separate control: sending a client an
 * SVG is not the same job as sending a Tajima file to a machine. The dialog
 * keeps those choices apart and states the scale, because a print sheet is
 * only useful when it is actually 1:1.
 */

import { useState } from 'react';
import type React from 'react';
import type { ArtworkFormat } from '../store/designStore.js';
import { useDesignStore } from '../store/designStore.js';
import { downloadBytes } from '../files/download.js';

export interface ArtworkDialogProps {
  onClose: () => void;
  notify: (message: string, isError?: boolean) => void;
}

const FORMATS: Array<{ id: ArtworkFormat; label: string; hint: string }> = [
  { id: 'pdf', label: 'PDF artwork', hint: 'Vector proof on a paper page' },
  { id: 'svg', label: 'SVG vector', hint: '1 unit = 1 mm, editable in vector software' },
  { id: 'png', label: 'PNG image', hint: 'Raster proof for email and web' },
  { id: 'print', label: 'Printable placement sheet', hint: 'Tiled 1:1 with crop marks and thread legend' },
];

export function ArtworkDialog({ onClose, notify }: ArtworkDialogProps): React.ReactElement {
  const [format, setFormat] = useState<ArtworkFormat>('pdf');
  const [paper, setPaper] = useState<'a4' | 'letter'>('a4');
  const [landscape, setLandscape] = useState(false);
  const [scale, setScale] = useState<'fit' | '1:1'>('fit');
  const [includeHoop, setIncludeHoop] = useState(true);
  const [includeLegend, setIncludeLegend] = useState(true);
  const [widthMm, setWidthMm] = useState(200);
  const [dpi, setDpi] = useState(200);
  const [busy, setBusy] = useState(false);

  const exportArtwork = useDesignStore((s) => s.exportArtwork);
  const design = useDesignStore((s) => s.design);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await exportArtwork({
        format,
        paper,
        landscape,
        scale,
        includeHoop,
        includeLegend,
        widthMm,
        dpi,
        background: format === 'png' ? '#ffffff' : null,
      });
      downloadBytes(result.bytes, result.filename, result.mime);
      notify(`Exported ${result.filename}`);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal artwork-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Artwork export"
        data-testid="artwork-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Artwork &amp; print</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <p className="dialog-hint">
          Artwork is built from the same compiled stitches as the machine file. {design.name} has{' '}
          {design.objects.length} object{design.objects.length === 1 ? '' : 's'}.
        </p>

        <div className="field">
          <span>Output</span>
          <div className="radio-list">
            {FORMATS.map((entry) => (
              <label className="check" key={entry.id}>
                <input
                  type="radio"
                  name="artwork-format"
                  value={entry.id}
                  checked={format === entry.id}
                  onChange={() => setFormat(entry.id)}
                  data-testid={`artwork-format-${entry.id}`}
                />
                <span>
                  {entry.label}
                  <small className="muted">{entry.hint}</small>
                </span>
              </label>
            ))}
          </div>
        </div>

        {format === 'png' ? (
          <div className="field-pair">
            <label className="field">
              <span>Image width (mm)</span>
              <input
                type="number"
                min="20"
                max="2000"
                value={widthMm}
                onChange={(event) => setWidthMm(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Resolution (DPI)</span>
              <select value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
                <option value={96}>96</option>
                <option value={150}>150</option>
                <option value={200}>200</option>
                <option value={300}>300</option>
                <option value={600}>600</option>
              </select>
            </label>
          </div>
        ) : (
          <div className="field-pair">
            <label className="field">
              <span>Paper</span>
              <select
                value={paper}
                onChange={(event) => setPaper(event.target.value as 'a4' | 'letter')}
              >
                <option value="a4">A4 (210 x 297 mm)</option>
                <option value="letter">Letter (8.5 x 11 in)</option>
              </select>
            </label>
            <label className="field">
              <span>Orientation</span>
              <select
                value={landscape ? 'landscape' : 'portrait'}
                onChange={(event) => setLandscape(event.target.value === 'landscape')}
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
          </div>
        )}

        {format !== 'png' && format !== 'svg' && (
          <label className="field">
            <span>{format === 'print' ? 'Placement scale' : 'Artwork scale'}</span>
            <select
              value={scale}
              onChange={(event) => setScale(event.target.value as 'fit' | '1:1')}
              data-testid="artwork-scale"
            >
              <option value="fit">Fit the page</option>
              <option value="1:1">1:1 actual size</option>
            </select>
            <small className="muted">
              {format === 'print'
                ? '1:1 tiles across pages and adds crop marks. Printing at 100% gives a true template.'
                : '1:1 may run off the paper if the design is larger than the printable area.'}
            </small>
          </label>
        )}

        {format === 'svg' && (
          <p className="dialog-hint" data-testid="artwork-svg-hint">
            SVG has no paper page: one user unit is one millimetre, so the file is
            always at actual size and can be scaled by the receiving application.
          </p>
        )}

        <label className="field checkbox">
          <input
            type="checkbox"
            checked={includeHoop}
            onChange={(event) => setIncludeHoop(event.target.checked)}
          />
          <span>Draw the hoop outline</span>
        </label>

        {format === 'print' && (
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={includeLegend}
              onChange={(event) => setIncludeLegend(event.target.checked)}
              data-testid="artwork-legend"
            />
            <span>Add a thread legend page</span>
          </label>
        )}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => void run()} disabled={busy} data-testid="artwork-run">
            {busy ? 'Rendering...' : 'Export artwork'}
          </button>
        </div>
      </div>
    </div>
  );
}
