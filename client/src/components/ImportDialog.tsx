/**
 * Open a machine file someone sent you.
 *
 * A machine file is a flattened stitch list, so it cannot come back as editable
 * shapes - that is a property of the format, not a missing feature. What it can
 * become is everything else: a preview, a conversion to another machine format,
 * or a stitch video for the client.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  DST_MIME,
  EXP_MIME,
  FORMAT_LABELS,
  GIF_MIME,
  JEF_MIME,
  PES_MIME,
  importMachineFile,
  renderStitchPreview,
  validateSequence,
  writeDst,
  writeExp,
  writeJef,
  writePes,
  type ImportedDesign,
} from '@threadworks/engine';
import { downloadBytes, safeFileName } from '../files/download.js';
import { readFileBytes } from '../files/readBytes.js';
import { encodeGif } from '../video/gif.js';

export interface ImportDialogProps {
  onClose: () => void;
  notify: (text: string, isError?: boolean) => void;
}

type OutputFormat = 'dst' | 'pes' | 'exp' | 'jef' | 'gif';

const OUTPUTS: ReadonlyArray<{ id: OutputFormat; label: string }> = [
  { id: 'dst', label: 'DST - Tajima' },
  { id: 'pes', label: 'PES - Brother' },
  { id: 'exp', label: 'EXP - Melco' },
  { id: 'jef', label: 'JEF - Janome' },
  { id: 'gif', label: 'Stitch video (GIF)' },
];

const PREVIEW_SIZE = 320;

export function ImportDialog({ onClose, notify }: ImportDialogProps): React.ReactElement {
  const [imported, setImported] = useState<ImportedDesign | null>(null);
  const [output, setOutput] = useState<OutputFormat>('dst');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const preview = useMemo(
    () =>
      imported === null
        ? null
        : renderStitchPreview(imported.stitches, {
            size: PREVIEW_SIZE,
            threads: imported.palette,
          }),
    [imported],
  );

  const issues = useMemo(
    () => (imported === null ? [] : validateSequence(imported.stitches, [], null).issues),
    [imported],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || preview === null) return;
    const ctx = canvas.getContext('2d');
    // A headless canvas can hand back a context with no pixel methods at all;
    // the preview is decoration, so it degrades to an empty box rather than
    // taking the dialog down with it.
    if (
      ctx === null ||
      typeof ctx.createImageData !== 'function' ||
      typeof ctx.putImageData !== 'function'
    ) {
      return;
    }

    canvas.width = preview.width;
    canvas.height = preview.height;
    const image = ctx.createImageData(preview.width, preview.height);
    image.data.set(preview.rgba);
    ctx.putImageData(image, 0, 0);
  }, [preview]);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const bytes = await readFileBytes(file);
      setImported(importMachineFile(bytes, { filename: file.name }));
    } catch (err) {
      setImported(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDownload = useCallback(async (): Promise<void> => {
    if (imported === null) return;
    setBusy(true);
    try {
      const stem = safeFileName(imported.name);
      // DST keeps its label to 8 useful characters, so trim the encoder name.
      const label = stem.slice(0, 16);
      let bytes: Uint8Array;
      let filename: string;
      let mime: string;

      switch (output) {
        case 'pes':
          bytes = writePes(imported.stitches, {
            name: label,
            colorCount: imported.colorCount,
            threads: imported.palette,
          });
          filename = `${stem}.pes`;
          mime = PES_MIME;
          break;
        case 'exp':
          bytes = writeExp(imported.stitches);
          filename = `${stem}.exp`;
          mime = EXP_MIME;
          break;
        case 'gif': {
          // The render runs on a worker thread, exactly as it does from the
          // editor, so saving a movie from an imported file does not freeze
          // the dialog either.
          const movie = await encodeGif(imported.stitches, { threads: imported.palette });
          bytes = movie.bytes;
          filename = `${stem}-stitch.gif`;
          mime = GIF_MIME;
          break;
        }
        case 'jef':
          bytes = writeJef(imported.stitches, { threads: imported.palette });
          filename = `${stem}.jef`;
          mime = JEF_MIME;
          break;
        case 'dst':
        default:
          bytes = writeDst(imported.stitches, { name: label, colorCount: imported.colorCount });
          filename = `${stem}.dst`;
          mime = DST_MIME;
          break;
      }

      downloadBytes(bytes, filename, mime);
      notify(`Saved ${filename}`);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      notify(text, true);
    } finally {
      setBusy(false);
    }
  }, [imported, output, notify]);

  const sewStitches = imported?.stitches.filter((s) => s.command === 'stitch').length ?? 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Open a machine file"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Open a machine file</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <p className="dialog-hint">
          Reads DST, PES, PEC, EXP and JEF. A machine file is a flattened stitch list, so it opens
          for preview and conversion rather than for editing shapes.
        </p>

        <label className="trace-field">
          <span>File</span>
          <input
            type="file"
            accept=".dst,.pes,.pec,.exp,.jef"
            data-testid="import-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>

        {error !== null && <p className="trace-error">{error}</p>}
        {busy && <p className="dialog-hint">Reading the file...</p>}

        {imported !== null && (
          <>
            <dl className="import-summary" data-testid="import-summary">
              <div>
                <dt>Format</dt>
                <dd>{FORMAT_LABELS[imported.format]}</dd>
              </div>
              <div>
                <dt>Name</dt>
                <dd>{imported.name}</dd>
              </div>
              <div>
                <dt>Stitches</dt>
                <dd>
                  {sewStitches} sewing of {imported.stitches.length} records
                </dd>
              </div>
              <div>
                <dt>Colours</dt>
                <dd>{imported.colorCount}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>
                  {(imported.bounds.maxX - imported.bounds.minX).toFixed(1)} x{' '}
                  {(imported.bounds.maxY - imported.bounds.minY).toFixed(1)} mm
                </dd>
              </div>
            </dl>

            <div className="trace-palette" data-testid="import-palette">
              {imported.palette.map((thread) => (
                <span
                  key={thread.id}
                  className="trace-swatch"
                  title={`${thread.code} ${thread.name}`}
                  style={{ background: thread.hex }}
                />
              ))}
            </div>

            <div className="trace-preview">
              <canvas ref={canvasRef} data-testid="import-preview" />
            </div>

            {imported.notes.length > 0 && (
              <ul className="import-notes">
                {imported.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}

            {issues.length > 0 && (
              <p className="dialog-hint" data-testid="import-issues">
                {issues.length} thing{issues.length === 1 ? '' : 's'} worth knowing — long moves are
                split automatically when saving. {issues[0]!.message}
              </p>
            )}

            <label className="trace-field">
              <span>Save as</span>
              <select
                value={output}
                data-testid="import-output"
                onChange={(e) => setOutput(e.target.value as OutputFormat)}
              >
                {OUTPUTS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <footer className="dialog-footer">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={imported === null || busy}
            data-testid="import-save"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
