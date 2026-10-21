/**
 * Bring a picture into the studio.
 *
 * Two jobs share one import because they start from the same file:
 *
 * - **Tracing guide** - the picture is placed under the canvas at its real
 *   size, at full clarity, and the user digitizes over it with the ordinary
 *   tools. It is never compiled, sewn or exported.
 * - **Auto stitch** - the user is asked whether to generate stitches, then for
 *   the finished size. Photographs default to the cell mosaic (which keeps far
 *   more of the picture than colour-region tracing), while logos can use the
 *   cleaner region tracer. Both keep the source behind the result at the same
 *   size, so the picture and the stitches line up exactly.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  PHOTO_LIMITS,
  paletteHex,
  planPhotoStitch,
  quantize,
  type PhotoPlan,
} from '@threadworks/engine';
import { useDesignStore } from '../store/designStore.js';
import { decodeImageAsset, type DecodedImageAsset } from '../image/decodeImage.js';

export interface ImageTraceDialogProps {
  onClose: () => void;
  notify: (text: string, isError?: boolean) => void;
}

type Intent = 'auto' | 'reference' | null;
type AutoMethod = 'photo' | 'shapes';

const DETAIL_LEVELS = [
  { id: 'coarse', label: 'Coarse - big shapes only', minRegionMm2: 4 },
  { id: 'normal', label: 'Normal', minRegionMm2: 0.8 },
  { id: 'fine', label: 'Fine - keep small details', minRegionMm2: 0.15 },
] as const;

const PHOTO_DETAILS = [
  { id: 'fine', label: 'Fine - 1.2 mm cells', cellMm: 1.2 },
  { id: 'normal', label: 'Normal - 1.5 mm cells', cellMm: 1.5 },
  { id: 'coarse', label: 'Coarse - 2.5 mm cells', cellMm: 2.5 },
] as const;

/**
 * Keep a detail photo inside the stored-project budget.
 *
 * The engine allows 20,000 cells, but each cell is four points in the saved
 * JSON and the hosted request is capped at 4 MB. 12,000 leaves room for the
 * tracing guide and thread palette. At a large width the requested fine cell
 * size is widened just enough to respect that ceiling.
 */
const AUTO_MAX_CELLS = 12_000;

const COLOR_CHOICES = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Default finished width: most of the hoop, but never a distorted sliver. */
function defaultWidthFor(designWidth: number, designHeight: number, aspect: number): number {
  const fit = Math.min(designWidth * 0.8, (designHeight * 0.8) / Math.max(0.01, aspect));
  return clamp(Math.round(fit / 5) * 5, 10, PHOTO_LIMITS.maxWidth);
}

/** Increase the requested cell size only when the width would exceed the cap. */
function fitPhotoCell(
  widthMm: number,
  aspect: number,
  requested: number,
  maxCells: number = AUTO_MAX_CELLS,
): number {
  const cell = clamp(requested, PHOTO_LIMITS.minCell, PHOTO_LIMITS.maxCell);
  const columns = Math.max(1, Math.min(1000, Math.floor(widthMm / cell)));
  const actual = widthMm / columns;
  const rows = Math.max(1, Math.round((widthMm * aspect) / actual));
  if (columns * rows <= maxCells) return cell;

  // Columns x rows is approximately width * height / cell²; solve for the
  // cell that lands just under the ceiling, with a small safety margin.
  const needed = Math.sqrt((widthMm * widthMm * aspect) / (maxCells * 0.95));
  return clamp(Math.max(cell, needed), PHOTO_LIMITS.minCell, PHOTO_LIMITS.maxCell);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function ImageTraceDialog({ onClose, notify }: ImageTraceDialogProps): React.ReactElement {
  const designWidth = useDesignStore((s) => s.design.width);
  const designHeight = useDesignStore((s) => s.design.height);

  const [asset, setAsset] = useState<DecodedImageAsset | null>(null);
  const [intent, setIntent] = useState<Intent>(null);
  const [autoMethod, setAutoMethod] = useState<AutoMethod>('photo');
  const [widthMm, setWidthMm] = useState(100);
  const [colorCount, setColorCount] = useState(12);
  const [photoDetailId, setPhotoDetailId] =
    useState<(typeof PHOTO_DETAILS)[number]['id']>('normal');
  const [detailId, setDetailId] = useState<(typeof DETAIL_LEVELS)[number]['id']>('normal');
  const [spacing, setSpacing] = useState(0.4);
  const [dropBackground, setDropBackground] = useState(true);
  const [referenceOpacity, setReferenceOpacity] = useState(0.85);
  const [keepReference, setKeepReference] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aspect = asset ? asset.raster.height / asset.raster.width : 1;
  const heightMm = widthMm * aspect;
  const photoDetail =
    PHOTO_DETAILS.find((d) => d.id === photoDetailId) ?? PHOTO_DETAILS[1]!;
  const photoCell = fitPhotoCell(widthMm, aspect, photoDetail.cellMm);

  const photoPlan = useMemo((): { plan: PhotoPlan | null; error: string | null } => {
    if (!asset || intent !== 'auto' || autoMethod !== 'photo') {
      return { plan: null, error: null };
    }
    try {
      return {
        plan: planPhotoStitch(asset.raster, {
          widthMm,
          colorCount,
          cellMm: photoCell,
          style: 'satin',
          spacing: 0.4,
          angle: 45,
          maxCells: AUTO_MAX_CELLS,
        }),
        error: null,
      };
    } catch (err) {
      return { plan: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [asset, intent, autoMethod, widthMm, colorCount, photoCell]);

  const shapePalette = useMemo(() => {
    if (!asset || intent !== 'auto' || autoMethod !== 'shapes') return [];
    return quantize(asset.raster, colorCount, 128).palette.map((colour) => paletteHex(colour));
  }, [asset, intent, autoMethod, colorCount]);

  const palette =
    autoMethod === 'photo' && photoPlan.plan
      ? photoPlan.plan.palette.map((colour) => colour.hex)
      : shapePalette;

  useEffect(() => {
    // The dialog opens with the current hoop; give the picture a comfortable
    // default that fits both dimensions rather than always filling the width.
    setWidthMm(defaultWidthFor(designWidth, designHeight, aspect));
  }, [designWidth, designHeight, aspect]);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const decoded = await decodeImageAsset(file);
      setAsset(decoded);
      setIntent(null);
      setAutoMethod('photo');
      setError(null);
    } catch (err) {
      setAsset(null);
      setIntent(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const chooseMethod = useCallback((method: AutoMethod): void => {
    setAutoMethod(method);
    if (method === 'shapes' && colorCount > 16) setColorCount(12);
  }, [colorCount]);

  const finishWith = useCallback(
    (message: string): void => {
      notify(message);
      onClose();
    },
    [notify, onClose],
  );

  const handleApply = useCallback((): void => {
    if (!asset || intent === null) return;
    const store = useDesignStore.getState();
    setBusy(true);
    setError(null);

    try {
      if (intent === 'reference') {
        store.placeReferenceImage({
          dataUrl: asset.dataUrl,
          name: asset.name,
          width: widthMm,
          height: heightMm,
          opacity: referenceOpacity,
          visible: true,
        });
        finishWith(
          'Reference image placed. Any tool can now be drawn over it; the guide is never sewn or exported.',
        );
        return;
      }

      const attachment = keepReference
        ? { dataUrl: asset.dataUrl, name: asset.name, opacity: 0.28 }
        : undefined;

      if (autoMethod === 'photo') {
        const plan = photoPlan.plan;
        if (!plan) {
          setError(photoPlan.error ?? 'The photo could not be planned at this size.');
          return;
        }
        const summary = store.photoStitch(asset.raster, {
          widthMm,
          colorCount,
          cellMm: photoCell,
          style: 'satin',
          spacing: 0.4,
          angle: 45,
          maxCells: AUTO_MAX_CELLS,
          reference: attachment,
        });
        if (summary.objects === 0) {
          setError('Nothing to sew - every cell was transparent. Try another image.');
          return;
        }
        const referenceNote = keepReference ? ' The source is kept behind it as a guide.' : '';
        finishWith(
          `Auto-stitched: ${summary.cells.toLocaleString()} cells in ${plural(
            summary.colors,
            'colour',
          )} at ${summary.widthMm.toFixed(1)} x ${summary.heightMm.toFixed(
            1,
          )} mm (${summary.cellMm.toFixed(2)} mm cells).${referenceNote}`,
        );
        return;
      }

      const detail = DETAIL_LEVELS.find((d) => d.id === detailId) ?? DETAIL_LEVELS[1];
      const summary = store.digitizeImage(asset.raster, {
        colorCount,
        widthMm,
        minRegionMm2: detail.minRegionMm2,
        spacing,
        dropBackground,
        reference: attachment,
      });

      if (summary.objects === 0) {
        setError(
          'Nothing to sew - every region was too small or too thin. Try fewer colours or a finer detail level.',
        );
        return;
      }

      const dropped = summary.droppedSmall + summary.droppedThin;
      const parts: string[] = [];
      if (dropped > 0) parts.push(`${plural(dropped, 'tiny region')} ignored`);
      if (summary.droppedBackground) parts.push('background ignored');
      const note = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      finishWith(
        `Auto-traced ${plural(summary.objects, 'region')} in ${plural(
          summary.colors,
          'colour',
        )}${note}.${keepReference ? ' The source is kept behind it as a guide.' : ''}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    asset,
    intent,
    autoMethod,
    widthMm,
    heightMm,
    referenceOpacity,
    keepReference,
    photoPlan,
    colorCount,
    photoCell,
    detailId,
    spacing,
    dropBackground,
    finishWith,
  ]);

  const photoPlanError = autoMethod === 'photo' ? photoPlan.error : null;
  const blocked =
    asset === null ||
    intent === null ||
    busy ||
    (intent === 'auto' && autoMethod === 'photo' && photoPlan.plan === null);
  const applyLabel =
    intent === 'reference'
      ? 'Place reference image'
      : intent === 'auto' && autoMethod === 'photo'
        ? 'Generate photo stitch'
        : 'Generate stitches';

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal trace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Image to embroidery"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Image to embroidery</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <p className="dialog-hint">
          Use the picture as a clear tracing guide and draw over it with any tool, or let the studio
          generate stitches at the size you choose. The source stays in the project as a guide, never
          as something the machine sews.
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
        {busy && <p className="dialog-hint">Preparing the image...</p>}

        {asset !== null && (
          <>
            <div className="trace-preview trace-source-preview">
              <img
                src={asset.dataUrl}
                alt="Source for tracing"
                data-testid="trace-preview"
              />
            </div>
            <p className="dialog-hint" data-testid="trace-source-meta">
              {asset.name} - {asset.width} x {asset.height} px
            </p>

            <div className="trace-choice" data-testid="trace-choice">
              <p className="trace-question">Auto-generate embroidery stitches from this image?</p>
              <div className="button-row">
                <button
                  type="button"
                  className={intent === 'auto' ? 'primary' : ''}
                  onClick={() => setIntent('auto')}
                  data-testid="trace-auto-yes"
                >
                  Yes - auto stitch
                </button>
                <button
                  type="button"
                  className={intent === 'reference' ? 'primary' : ''}
                  onClick={() => setIntent('reference')}
                  data-testid="trace-auto-no"
                >
                  No - use as tracing guide
                </button>
              </div>
            </div>

            {intent === 'auto' && (
              <>
                <label className="trace-field">
                  <span>Method</span>
                  <select
                    value={autoMethod}
                    data-testid="trace-auto-style"
                    onChange={(e) => chooseMethod(e.target.value as AutoMethod)}
                  >
                    <option value="photo">Photo mosaic - best for photographs</option>
                    <option value="shapes">Auto trace - logos and flat art</option>
                  </select>
                </label>

                <label className="trace-field">
                  <span>Width</span>
                  <input
                    type="number"
                    min={10}
                    max={PHOTO_LIMITS.maxWidth}
                    step={5}
                    value={widthMm}
                    data-testid="trace-width"
                    onChange={(e) =>
                      setWidthMm(
                        clamp(Number(e.target.value) || 10, 10, PHOTO_LIMITS.maxWidth),
                      )
                    }
                  />
                  <span className="trace-unit">mm</span>
                </label>

                <label className="trace-field">
                  <span>Height</span>
                  <output data-testid="trace-height">
                    {(photoPlan.plan?.heightMm ?? heightMm).toFixed(1)} mm
                  </output>
                </label>

                <label className="trace-field">
                  <span>Colours</span>
                  <select
                    value={colorCount}
                    data-testid="trace-colors"
                    onChange={(e) => setColorCount(Number(e.target.value))}
                  >
                    {COLOR_CHOICES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>

                {autoMethod === 'photo' ? (
                  <>
                    <label className="trace-field">
                      <span>Detail</span>
                      <select
                        value={photoDetailId}
                        data-testid="trace-photo-detail"
                        onChange={(e) =>
                          setPhotoDetailId(
                            e.target.value as (typeof PHOTO_DETAILS)[number]['id'],
                          )
                        }
                      >
                        {PHOTO_DETAILS.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {photoPlan.plan && (
                      <p className="dialog-hint" data-testid="trace-plan-summary">
                        {photoPlan.plan.columns} x {photoPlan.plan.rows} cells,{' '}
                        {photoPlan.plan.cells.toLocaleString()} stitched,{' '}
                        {photoPlan.plan.widthMm.toFixed(1)} x {photoPlan.plan.heightMm.toFixed(1)}{' '}
                        mm at {photoPlan.plan.cellMm.toFixed(2)} mm per cell.
                      </p>
                    )}
                    {photoPlanError !== null && <p className="trace-error">{photoPlanError}</p>}
                  </>
                ) : (
                  <>
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
                        Ignore background - drop a solid surround, like the white page behind a
                        logo
                      </span>
                    </label>
                    <p className="dialog-hint">
                      Auto trace turns colours into clean fills. For a photograph, Photo mosaic
                      keeps far more of the picture.
                    </p>
                  </>
                )}

                <label className="trace-check">
                  <input
                    type="checkbox"
                    checked={keepReference}
                    data-testid="trace-keep-reference"
                    onChange={(e) => setKeepReference(e.target.checked)}
                  />
                  <span>
                    Keep the source picture behind the stitches as a guide (the image is never sewn)
                  </span>
                </label>
              </>
            )}

            {intent === 'reference' && (
              <>
                <label className="trace-field">
                  <span>Width</span>
                  <input
                    type="number"
                    min={10}
                    max={PHOTO_LIMITS.maxWidth}
                    step={5}
                    value={widthMm}
                    data-testid="trace-width"
                    onChange={(e) =>
                      setWidthMm(
                        clamp(Number(e.target.value) || 10, 10, PHOTO_LIMITS.maxWidth),
                      )
                    }
                  />
                  <span className="trace-unit">mm</span>
                </label>

                <p className="dialog-hint" data-testid="trace-height">
                  Finished height follows the picture ratio: {heightMm.toFixed(1)} mm. The guide is
                  centred in the hoop; move or resize it later in the Reference image panel.
                </p>

                <label className="trace-field">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={referenceOpacity}
                    data-testid="trace-opacity"
                    onChange={(e) => setReferenceOpacity(Number(e.target.value))}
                  />
                  <output>{Math.round(referenceOpacity * 100)}%</output>
                </label>

                <p className="dialog-hint">
                  Pick any drawing tool - fills, runs, lettering - and trace the picture at full
                  clarity. It is not sewn or exported.
                </p>
              </>
            )}

            {intent === 'auto' && palette.length > 0 && (
              <div className="trace-palette" data-testid="trace-palette">
                {palette.map((hex, i) => (
                  <span
                    key={`${hex}-${i}`}
                    className="trace-swatch"
                    title={hex}
                    style={{ background: hex }}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <footer className="dialog-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={intent === 'auto' ? 'primary' : ''}
            onClick={handleApply}
            disabled={blocked}
            data-testid="trace-apply"
          >
            {applyLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
