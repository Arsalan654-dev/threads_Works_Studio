/**
 * Photo stitch dialog.
 *
 * The picked photograph is decoded once, planned into cells as the controls
 * change, and previewed at the real cell resolution. Nothing is committed until
 * Apply, which creates one fill object per thread colour as a single undo step.
 *
 * Two presets cover the two Wilcom workflows: Colour Photo Stitch is a fine
 * satin mosaic, Photo Flash is the fast coarse run mosaic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  PHOTO_LIMITS,
  planPhotoStitch,
  type PhotoPlan,
  type PhotoStyle,
  type RasterImage,
} from '@threadworks/engine';
import { useDesignStore } from '../store/designStore.js';
import { decodeImageFile } from '../image/decodeImage.js';

export interface PhotoStitchDialogProps {
  onClose: () => void;
  notify: (text: string, isError?: boolean) => void;
}

type PresetId = 'colour' | 'flash';

const PRESETS: Record<
  PresetId,
  { label: string; colorCount: number; cellMm: number; style: PhotoStyle; spacing: number }
> = {
  colour: {
    label: 'Colour Photo Stitch',
    colorCount: 16,
    cellMm: 1.4,
    style: 'satin',
    spacing: 0.4,
  },
  flash: { label: 'Photo Flash', colorCount: 8, cellMm: 3, style: 'run', spacing: 0.4 },
};

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function PhotoStitchDialog({ onClose, notify }: PhotoStitchDialogProps): React.ReactElement {
  const designWidth = useDesignStore((s) => s.design.width);
  const designHeight = useDesignStore((s) => s.design.height);

  const [image, setImage] = useState<RasterImage | null>(null);
  const [widthMm, setWidthMm] = useState(100);
  const [colorCount, setColorCount] = useState(PRESETS.colour.colorCount);
  const [cellMm, setCellMm] = useState(PRESETS.colour.cellMm);
  const [style, setStyle] = useState<PhotoStyle>(PRESETS.colour.style);
  const [spacing, setSpacing] = useState(PRESETS.colour.spacing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const room = Math.min(designWidth, designHeight);
    setWidthMm(Math.max(20, Math.min(160, Math.round(room * 0.8))));
  }, [designWidth, designHeight]);

  const planned = useMemo((): { plan: PhotoPlan | null; error: string | null } => {
    if (image === null) return { plan: null, error: null };
    try {
      return {
        plan: planPhotoStitch(image, { widthMm, colorCount, cellMm, style, spacing, angle: 45 }),
        error: null,
      };
    } catch (err) {
      return { plan: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [image, widthMm, colorCount, cellMm, style, spacing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const plan = planned.plan;
    if (canvas === null || plan === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return; // jsdom and headless canvases: preview is optional

    canvas.width = plan.columns;
    canvas.height = plan.rows;
    const out = ctx.createImageData(plan.columns, plan.rows);
    for (let i = 0; i < plan.labels.length; i++) {
      const label = plan.labels[i]!;
      const o = i * 4;
      if (label < 0) {
        out.data[o + 3] = 0;
        continue;
      }
      const colour = plan.palette[label];
      if (!colour) continue;
      const [r, g, b] = hexToRgb(colour.hex);
      out.data[o] = r;
      out.data[o + 1] = g;
      out.data[o + 2] = b;
      out.data[o + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, [planned]);

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

  const choosePreset = useCallback((id: PresetId): void => {
    const preset = PRESETS[id];
    setColorCount(preset.colorCount);
    setCellMm(preset.cellMm);
    setStyle(preset.style);
    setSpacing(preset.spacing);
  }, []);

  const handleApply = useCallback((): void => {
    const plan = planned.plan;
    if (image === null || plan === null) return;

    const summary = useDesignStore
      .getState()
      .photoStitch(image, { widthMm, colorCount, cellMm, style, spacing, angle: 45 });

    if (summary.objects === 0) {
      notify('Nothing to sew - every cell was transparent.', true);
      return;
    }

    notify(
      `Photo stitched: ${summary.cells.toLocaleString()} cells in ${summary.colors} colour${
        summary.colors === 1 ? '' : 's'
      } (${summary.cellMm.toFixed(2)} mm cells)`,
    );
    onClose();
  }, [image, planned, widthMm, colorCount, cellMm, style, spacing, notify, onClose]);

  const blocked = image === null || planned.plan === null;
  const planError = planned.error;
  const plan = planned.plan;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal trace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Stitch a photo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Photo stitch</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <p className="dialog-hint">
          Sews a photograph as a mosaic of small thread blocks, one object per colour. This{' '}
          <strong>replaces</strong> the current design - undo brings it straight back.
        </p>

        <div className="button-row" data-testid="photo-presets">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => choosePreset(id)}
              data-testid={`photo-preset-${id}`}
              title={
                id === 'colour'
                  ? 'Fine satin mosaic, 16 colours'
                  : 'Fast run mosaic, 8 colours, larger cells'
              }
            >
              {PRESETS[id].label}
            </button>
          ))}
        </div>

        <label className="trace-field">
          <span>Image</span>
          <input
            type="file"
            accept="image/*"
            data-testid="photo-file"
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
              <canvas
                ref={canvasRef}
                data-testid="photo-preview"
                style={{ imageRendering: 'pixelated', width: '100%' }}
              />
            </div>

            {plan !== null && (
              <div className="trace-palette" data-testid="photo-palette">
                {plan.palette.map((colour, i) => (
                  <span
                    key={i}
                    className="trace-swatch"
                    title={colour.hex}
                    style={{ background: colour.hex }}
                  />
                ))}
              </div>
            )}

            {planError !== null && <p className="trace-error">{planError}</p>}

            <label className="trace-field">
              <span>Width</span>
              <input
                type="number"
                min={PHOTO_LIMITS.minWidth}
                max={PHOTO_LIMITS.maxWidth}
                step={5}
                value={widthMm}
                data-testid="photo-width"
                onChange={(e) =>
                  setWidthMm(
                    Math.max(
                      PHOTO_LIMITS.minWidth,
                      Math.min(
                        PHOTO_LIMITS.maxWidth,
                        Number(e.target.value) || PHOTO_LIMITS.minWidth,
                      ),
                    ),
                  )
                }
              />
              <span className="trace-unit">mm</span>
            </label>

            <label className="trace-field">
              <span>Colours</span>
              <select
                value={colorCount}
                data-testid="photo-colors"
                onChange={(e) => setColorCount(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="trace-field">
              <span>Cell size</span>
              <input
                type="number"
                min={PHOTO_LIMITS.minCell}
                max={PHOTO_LIMITS.maxCell}
                step={0.1}
                value={cellMm}
                data-testid="photo-cell"
                onChange={(e) =>
                  setCellMm(
                    Math.max(
                      PHOTO_LIMITS.minCell,
                      Math.min(
                        PHOTO_LIMITS.maxCell,
                        Number(e.target.value) || PHOTO_LIMITS.minCell,
                      ),
                    ),
                  )
                }
              />
              <span className="trace-unit">mm</span>
            </label>

            <label className="trace-field">
              <span>Style</span>
              <select
                value={style}
                data-testid="photo-style"
                onChange={(e) => setStyle(e.target.value as PhotoStyle)}
              >
                <option value="satin">Satin - photoreal</option>
                <option value="run">Run - fast</option>
                <option value="cross">Cross - textured</option>
              </select>
            </label>

            <label className="trace-field">
              <span>Satin density</span>
              <input
                type="range"
                min={PHOTO_LIMITS.minSpacing}
                max={PHOTO_LIMITS.maxSpacing}
                step={0.05}
                value={spacing}
                data-testid="photo-spacing"
                onChange={(e) => setSpacing(Number(e.target.value))}
                disabled={style !== 'satin'}
              />
              <output>{spacing.toFixed(2)} mm</output>
            </label>

            {plan !== null && (
              <p className="dialog-hint" data-testid="photo-summary">
                {plan.columns} x {plan.rows} cells, {plan.cells.toLocaleString()} stitched,{' '}
                {plan.widthMm.toFixed(1)} x {plan.heightMm.toFixed(1)} mm
              </p>
            )}
          </>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleApply}
            disabled={blocked}
            data-testid="photo-apply"
          >
            Stitch photo
          </button>
        </div>
      </div>
    </div>
  );
}
