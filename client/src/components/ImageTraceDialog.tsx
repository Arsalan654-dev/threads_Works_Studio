/**
 * Trace an image into stitches.
 *
 * The dialog decodes the picked file, shows the reduced palette so the user can
 * judge whether the colour count is right before committing, and hands the
 * pixel data to the store - which runs the engine's tracer and creates the
 * objects as a single undo step.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { quantize, paletteHex, type RasterImage } from '@threadworks/engine';
import { useDesignStore } from '../store/designStore.js';
import { decodeImageFile } from '../image/decodeImage.js';

export interface ImageTraceDialogProps {
  onClose: () => void;
  notify: (text: string, isError?: boolean) => void;
}

const DETAIL_LEVELS = [
  { id: 'coarse', label: 'Coarse - big shapes only', minRegionMm2: 4 },
  { id: 'normal', label: 'Normal', minRegionMm2: 0.8 },
  { id: 'fine', label: 'Fine - keep small details', minRegionMm2: 0.15 },
] as const;

export function ImageTraceDialog({ onClose, notify }: ImageTraceDialogProps): React.ReactElement {
  const designWidth = useDesignStore((s) => s.design.width);
  const designHeight = useDesignStore((s) => s.design.height);

  const [image, setImage] = useState<RasterImage | null>(null);
  const [colorCount, setColorCount] = useState(6);
  const [widthMm, setWidthMm] = useState(100);
  const [detailId, setDetailId] = useState<(typeof DETAIL_LEVELS)[number]['id']>('normal');
  const [spacing, setSpacing] = useState(0.4);
  const [dropBackground, setDropBackground] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Default the finished width to something that comfortably fits the field.
  useEffect(() => {
    const room = Math.min(designWidth, designHeight);
    setWidthMm(Math.max(20, Math.min(120, Math.round(room * 0.8))));
  }, [designWidth, designHeight]);

  const preview = useMemo(() => {
    if (image === null) return null;
    return quantize(image, colorCount, 128);
  }, [image, colorCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || image === null || preview === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return; // jsdom and headless canvases: preview is optional

    canvas.width = image.width;
    canvas.height = image.height;
    const out = ctx.createImageData(image.width, image.height);
    for (let i = 0; i < preview.labels.length; i++) {
      const label = preview.labels[i]!;
      const o = i * 4;
      if (label < 0) {
        out.data[o + 3] = 0;
        continue;
      }
      const entry = preview.palette[label]!;
      out.data[o] = entry.r;
      out.data[o + 1] = entry.g;
      out.data[o + 2] = entry.b;
      out.data[o + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, [image, preview]);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setImage(await decodeImageFile(file));
    } catch (err) {
      setImage(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleApply = useCallback((): void => {
    if (image === null) return;
    const detail = DETAIL_LEVELS.find((d) => d.id === detailId) ?? DETAIL_LEVELS[1];

    const summary = useDesignStore.getState().digitizeImage(image, {
      colorCount,
      widthMm,
      minRegionMm2: detail.minRegionMm2,
      spacing,
      dropBackground,
    });

    if (summary.objects === 0) {
      notify(
        'Nothing to sew - every region was too small or too thin. Try fewer colours or a finer detail level.',
        true,
      );
      return;
    }

    const dropped = summary.droppedSmall + summary.droppedThin;
    const parts: string[] = [];
    if (dropped > 0) parts.push(`${dropped} tiny region${dropped === 1 ? '' : 's'} ignored`);
    if (summary.droppedBackground) parts.push('background ignored');
    const note = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    notify(
      `Traced ${summary.objects} region${summary.objects === 1 ? '' : 's'} in ${summary.colors} colour${summary.colors === 1 ? '' : 's'}${note}`,
    );
    onClose();
  }, [image, colorCount, widthMm, detailId, spacing, dropBackground, notify, onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal trace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Trace an image"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Trace an image</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <p className="dialog-hint">
          Turns a photo or logo into fills. This <strong>replaces</strong> the current design - undo
          brings it straight back.
        </p>

        <label className="trace-field">
          <span>Image</span>
          <input
            type="file"
            accept="image/*"
            data-testid="trace-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>

        {error !== null && <p className="trace-error">{error}</p>}
        {busy && <p className="dialog-hint">Reading the image...</p>}

        {image !== null && (
          <>
            <div className="trace-preview">
              <canvas ref={canvasRef} data-testid="trace-preview" />
            </div>

            {preview !== null && (
              <div className="trace-palette" data-testid="trace-palette">
                {preview.palette.map((entry, i) => (
                  <span
                    key={i}
                    className="trace-swatch"
                    title={paletteHex(entry)}
                    style={{ background: paletteHex(entry) }}
                  />
                ))}
              </div>
            )}

            <label className="trace-field">
              <span>Width</span>
              <input
                type="number"
                min={10}
                max={400}
                step={5}
                value={widthMm}
                data-testid="trace-width"
                onChange={(e) =>
                  setWidthMm(Math.max(10, Math.min(400, Number(e.target.value) || 10)))
                }
              />
              <span className="trace-unit">mm</span>
            </label>

            <label className="trace-field">
              <span>Colours</span>
              <select
                value={colorCount}
                data-testid="trace-colors"
                onChange={(e) => setColorCount(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="trace-field">
              <span>Detail</span>
              <select
                value={detailId}
                data-testid="trace-detail"
                onChange={(e) =>
                  setDetailId(e.target.value as (typeof DETAIL_LEVELS)[number]['id'])
                }
              >
                {DETAIL_LEVELS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="trace-field">
              <span>Density</span>
              <input
                type="range"
                min={0.15}
                max={1.2}
                step={0.05}
                value={spacing}
                data-testid="trace-spacing"
                onChange={(e) => setSpacing(Number(e.target.value))}
              />
              <output>{spacing.toFixed(2)} mm</output>
            </label>

            <label className="trace-check">
              <input
                type="checkbox"
                checked={dropBackground}
                data-testid="trace-background"
                onChange={(e) => setDropBackground(e.target.checked)}
              />
              <span>
                Ignore background - drop a solid surround, like the white page behind a logo
              </span>
            </label>
          </>
        )}

        <footer className="dialog-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={image === null || busy}
            data-testid="trace-apply"
          >
            Trace
          </button>
        </footer>
      </div>
    </div>
  );
}
