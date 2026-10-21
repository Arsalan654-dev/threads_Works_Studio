import { useState } from 'react';
import type React from 'react';
/**
 * Right-hand inspector: object parameters, thread palette and hoop.
 *
 * Every control writes straight through to the store, so what the panel shows
 * and what the engine compiles are the same object - there is no local form
 * state that could get out of step with the document.
 */

import type {
  EmbroideryObject,
  LetteringOrder,
  LetteringSpec,
  RedworkStyle,
  StitchParameters,
  StitchType,
  ThreadColor,
} from '@threadworks/engine';
import { objectCenter } from '@threadworks/engine';
import { DEFAULT_APPLIQUE, appliqueProblem } from '@threadworks/engine';
import { FONT_LIBRARY, capWrapProblem, isSpecialtyStitch } from '@threadworks/engine';
import { useDesignStore } from '../store/designStore.js';
import { referenceStore, type HoopEntry } from '../store/referenceStore.js';
import { defaultParams, nextObjectId } from '../model/defaults.js';
import { STITCH_TYPES } from '../model/stitchTypes.js';
import { MotifPicker } from './MotifPicker.js';

/** Ways a tatami fill can lay its stitches. Drives `params.fillPattern`. */
const FILL_PATTERNS: { id: StitchParameters['fillPattern']; label: string }[] = [
  { id: 'tatami', label: 'Tatami (plain weave)' },
  { id: 'programmedSplit', label: 'Programmed split (block breaks)' },
  { id: 'flexiSplit', label: 'Flexi split (breaks follow the shape)' },
  { id: 'motif', label: 'Motif stamps' },
  { id: 'contour', label: 'Contour (follows the edge)' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'accordion', label: 'Accordion (pleated bands)' },
  { id: 'florentine', label: 'Florentine (leaf weave)' },
  { id: 'liquid', label: 'Liquid (flowing waves)' },
  { id: 'maze', label: 'Maze (square wandering line)' },
  { id: 'string', label: 'String (loose meander)' },
  { id: 'laydown', label: 'Laydown (long laid threads)' },
  { id: 'stipple', label: 'Stipple (dot texture)' },
  { id: 'cross', label: 'Cross hatch' },
  { id: 'shading', label: 'Shading (open to dense)' },
  { id: 'hand', label: 'Hand stitch' },
  { id: 'jagged', label: 'Jagged edge' },
  { id: 'warp', label: '3D warp (arched rows)' },
];

/** Gradient defaults: one uniform size, no extra rotation. */
const DEFAULT_MOTIF_GRADIENT = { scaleFrom: 1, scaleTo: 1, angleFrom: 0, angleTo: 0 };

/** The built-in split the engine sews when no user definition is stored. */
const DEFAULT_CUSTOM_SPLIT = { segmentLength: 12, gap: 1.5, stagger: 0.5 };

const UNDERLAY_TYPES = [
  { id: 'none', label: 'None' },
  { id: 'centerRun', label: 'Center run' },
  { id: 'edgeRun', label: 'Edge run' },
  { id: 'zigzag', label: 'Zigzag' },
  { id: 'tatami', label: 'Tatami' },
] as const;

/** Keep the lettering width factor inside the range the schema stores. */
function clampStretch(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0.25, value));
}

export function RightPanel(): React.ReactElement {
  const selection = useDesignStore((s) => s.selection);
  const objects = useDesignStore((s) => s.design.objects);
  const palette = useDesignStore((s) => s.design.threadPalette);
  const hoopId = useDesignStore((s) => s.design.hoopId);

  // Selection order is click order, so the object the user picked first
  // drives the inspector. That matters for multi-object workflows such as
  // picking a text and shift-clicking the shape it should follow: the text
  // stays the target while the shape rides along.
  const selected = selection
    .map((id) => objects.find((o) => o.id === id))
    .filter((o): o is EmbroideryObject => o !== undefined);
  const target = selected[0];

  return (
    <aside className="right-panel">
      <HoopSection hoopId={hoopId} />
      <MultiHoopSection />
      <SequencingSection />

      {target ? (
        <ObjectSection object={target} multiCount={selected.length} palette={palette} />
      ) : (
        <section className="panel-section">
          <h2>No selection</h2>
          <p className="muted">
            Pick an object on the canvas to edit its stitch parameters, or use a tool on the left to
            digitize something new.
          </p>
        </section>
      )}

      <RedworkSection />

      <ShapeSection count={selected.length} objectCount={objects.length} />

      {selected.length >= 2 && <BlendSection count={selected.length} />}

      <PaletteSection
        palette={palette}
        activeColorIndex={target?.colorIndex ?? 0}
        hasSelection={!!target}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------

/**
 * Colour blending controls.
 *
 * Only offered when several objects are selected, because a blend is a
 * relationship between fills rather than a property of one. The preview
 * message comes back from the store so a refusal - too few objects, or a run
 * that cannot share coverage - reads as an explanation rather than a dead
 * button.
 */
function BlendSection({ count }: { count: number }): React.ReactElement {
  const blendSelected = useDesignStore((s) => s.blendSelected);
  // Below 1 lightens the blend, above 1 fattens it. 1 leaves the combined
  // coverage where a single full fill would be.
  const [density, setDensity] = useState(1);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section className="panel-section" data-testid="blend-section">
      <h2>Colour blend</h2>
      <p className="muted small">
        Thins {count} fills so they share the area and their threads mix where they overlap.
      </p>

      <label className="field">
        <span>Density</span>
        <input
          type="range"
          min="0.4"
          max="1.6"
          step="0.1"
          value={density}
          onChange={(e) => setDensity(Number(e.target.value))}
          data-testid="blend-density"
        />
        <span className="muted small">{Math.round(density * 100)}%</span>
      </label>

      <button
        type="button"
        onClick={() => setMessage(blendSelected({ densityMultiplier: density }))}
        data-testid="blend-button"
      >
        Blend {count} fills
      </button>

      {message && (
        <p className="muted small" role="status" data-testid="blend-message">
          {message}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * Shape commands: boolean combines, offsets, borders and corner rounding.
 *
 * The boolean buttons need two or more objects, the rest work on one. Every
 * action returns a sentence, and it is shown rather than swallowed: "the
 * shapes do not overlap" is a real answer, and a button that appears to do
 * nothing is worse than one that explains itself.
 */
function ShapeSection({
  count,
  objectCount,
}: {
  count: number;
  objectCount: number;
}): React.ReactElement {
  const shapeSelected = useDesignStore((s) => s.shapeSelected);
  const offsetSelected = useDesignStore((s) => s.offsetSelected);
  const borderSelected = useDesignStore((s) => s.borderSelected);
  const roundSelectedCorners = useDesignStore((s) => s.roundSelectedCorners);
  const centerAll = useDesignStore((s) => s.centerAll);

  const [offset, setOffset] = useState(2);
  const [copies, setCopies] = useState(1);
  const [join, setJoin] = useState<'miter' | 'bevel' | 'round'>('miter');
  const [border, setBorder] = useState(3);
  const [radius, setRadius] = useState(2);
  const [message, setMessage] = useState<string | null>(null);

  const run = (action: () => string | null): void => {
    setMessage(action());
  };

  return (
    <section className="panel-section" data-testid="shape-section">
      <h2>Shape</h2>
      <p className="muted small">
        Change the outline itself. A combine needs two or more selected shapes; the rest work on
        one.
      </p>

      <div className="button-row">
        <button
          type="button"
          disabled={count < 2}
          onClick={() => run(() => shapeSelected('weld'))}
          title="Merge overlapping outlines into one"
          data-testid="shape-weld"
        >
          Weld
        </button>
        <button
          type="button"
          disabled={count < 2}
          onClick={() => run(() => shapeSelected('combine'))}
          title="Keep the area covered an odd number of times, so an overlap becomes a hole"
          data-testid="shape-combine"
        >
          Combine
        </button>
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={count < 2}
          onClick={() => run(() => shapeSelected('subtract'))}
          title="Cut every other selected shape out of the first"
          data-testid="shape-subtract"
        >
          Subtract
        </button>
        <button
          type="button"
          disabled={count < 2}
          onClick={() => run(() => shapeSelected('intersect'))}
          title="Keep only the area every selected shape covers"
          data-testid="shape-intersect"
        >
          Intersect
        </button>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Offset (mm)</span>
          <input
            type="number"
            step="0.5"
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value))}
            data-testid="offset-distance"
          />
        </label>
        <label className="field">
          <span>Corners</span>
          <select
            value={join}
            onChange={(e) => setJoin(e.target.value as 'miter' | 'bevel' | 'round')}
            data-testid="offset-join"
          >
            <option value="miter">Miter</option>
            <option value="bevel">Bevel</option>
            <option value="round">Round</option>
          </select>
        </label>
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={count === 0}
          onClick={() => run(() => offsetSelected(offset, { join, copies }))}
          title="Create an offset copy: positive grows, negative shrinks"
          data-testid="offset-apply"
        >
          Offset {offset >= 0 ? '+' : ''}
          {offset} mm
        </button>
        <label className="field compact">
          <span>Copies</span>
          <input
            type="number"
            step="1"
            min="1"
            max="50"
            value={copies}
            onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            title="How many concentric outlines to create; each is one step further out"
            data-testid="offset-copies"
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Border (mm)</span>
          <input
            type="number"
            step="0.5"
            min="0.1"
            value={border}
            onChange={(e) => setBorder(Number(e.target.value))}
            data-testid="border-distance"
          />
        </label>
        <label className="field">
          <span>Corner radius</span>
          <input
            type="number"
            step="0.5"
            min="0.1"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            data-testid="round-radius"
          />
        </label>
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={count === 0}
          onClick={() => run(() => borderSelected(border))}
          title="Sew a run outline around the selection at this distance"
          data-testid="border-apply"
        >
          Border
        </button>
        <button
          type="button"
          disabled={count === 0}
          onClick={() => run(() => roundSelectedCorners(radius))}
          title="Replace sharp corners with arcs of this radius"
          data-testid="round-apply"
        >
          Round corners
        </button>
      </div>

      <button
        type="button"
        disabled={objectCount === 0}
        onClick={() => {
          centerAll();
          setMessage('Centred the design in the hoop.');
        }}
        title="Move every object so the design sits in the middle of the frame"
        data-testid="center-all"
      >
        Center all
      </button>

      {message && (
        <p className="muted small" role="status" data-testid="shape-message">
          {message}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function HoopSection({ hoopId }: { hoopId: string | null }): React.ReactElement {
  const hoops = referenceStore((s) => s.hoops);
  const setSize = useDesignStore((s) => s.setSize);
  const autoHoop = useDesignStore((s) => s.autoHoop);
  const capWrap = useDesignStore((s) => s.design.capWrap);
  const designWidth = useDesignStore((s) => s.design.width);
  const setCapWrap = useDesignStore((s) => s.setCapWrap);
  const [message, setMessage] = useState<string | null>(null);
  const [allowRotation, setAllowRotation] = useState(true);
  const capProblem = capWrapProblem(capWrap, designWidth);

  const apply = (value: string): void => {
    if (value === '') {
      setSize(200, 200, null);
      return;
    }
    const entry = hoops.find((h) => h.id === value);
    if (!entry) return;
    setSize(entry.width, entry.height, entry.id);
    if (entry.cap) setCapWrap({ enabled: true });
  };

  const runAutoHoop = (): void => {
    // The store returns a short description of what it did, or why it could
    // not - shown rather than swallowed so a refusal reads as an explanation
    // instead of a dead button.
    setMessage(autoHoop({ allowRotation }));
  };

  return (
    <section className="panel-section">
      <h2>Hoop</h2>
      <label className="field">
        <span>Frame</span>
        <select
          value={hoopId ?? ''}
          onChange={(e) => apply(e.target.value)}
          data-testid="hoop-select"
        >
          <option value="">Custom size</option>
          {hoops.map((h: HoopEntry) => (
            <option key={h.id} value={h.id}>
              {h.name}
              {h.cap ? ' (cap)' : ''}
            </option>
          ))}
        </select>
      </label>
      {hoops.length === 0 && (
        <p className="muted small">
          No hoop presets loaded. Run <code>npm run seed</code> to add the standard frames.
        </p>
      )}

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={allowRotation}
          onChange={(e) => setAllowRotation(e.target.checked)}
          data-testid="autohoop-rotate"
        />
        <span>Allow turning the design 90&deg;</span>
      </label>

      <button
        type="button"
        onClick={runAutoHoop}
        disabled={hoops.length === 0}
        data-testid="autohoop-button"
      >
        Auto-hoop
      </button>

      {message && (
        <p className="muted small" role="status" data-testid="autohoop-message">
          {message}
        </p>
      )}

      <hr />
      <h3>Cap frame</h3>
      <label className="field checkbox">
        <input
          type="checkbox"
          checked={capWrap.enabled}
          onChange={(e) => setCapWrap({ enabled: e.target.checked })}
          data-testid="cap-frame-enabled"
        />
        <span>Wrap on a curved cap frame</span>
      </label>
      {capWrap.enabled && (
        <>
          <label className="field">
            <span>Crown radius (mm)</span>
            <input
              type="number"
              min="40"
              max="250"
              step="1"
              value={capWrap.radiusMm}
              onChange={(e) => setCapWrap({ radiusMm: Number(e.target.value) })}
              data-testid="cap-frame-radius"
            />
            <small className="muted">The arc the front panel follows, not the cap diameter.</small>
          </label>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={capWrap.compensate}
              onChange={(e) => setCapWrap({ compensate: e.target.checked })}
              data-testid="cap-frame-compensate"
            />
            <span>Compensate exported stitches for the driver</span>
          </label>
          <p className="muted small">
            The preview projects the flat design onto the crown. Compensation applies the inverse
            arcsin stretch to every exported file, so the cap sews at the drawn width. Turn it off
            only for a machine driver that already compensates.
          </p>
          {capProblem && (
            <p className="status-issue error" role="alert" data-testid="cap-frame-problem">
              {capProblem}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * Multi-hoop join controls.
 *
 * These only ever bite when the design is too big for one hooping and the
 * operator uses **Export sections** - a design that fits a single frame never
 * reaches the splitter at all. The copy therefore says what the current
 * setting will do rather than describing the feature in the abstract, and
 * neither is framed as a property of the design, because neither changes a
 * stitch that a single-file export would sew.
 */
/**
 * Sequencing controls.
 *
 * Two different jobs live here. **Optimise thread changes** regroups objects by
 * colour at compile time and only changes the stitch order; **Auto-sequence**
 * rewrites the object order itself, which is why it is a real undoable edit.
 */
function SequencingSection(): React.ReactElement {
  const optimize = useDesignStore((s) => s.optimizeColors);
  const setOptimize = useDesignStore((s) => s.setOptimizeColors);
  const autoSequence = useDesignStore((s) => s.autoSequence);
  const objectCount = useDesignStore((s) => s.design.objects.length);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section className="panel-section" data-testid="sequencing-section">
      <h2>Sequencing</h2>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={optimize}
          onChange={(e) => {
            setOptimize(e.target.checked);
            setMessage(null);
          }}
          data-testid="optimize-colors"
        />
        <span>Optimise thread changes</span>
      </label>

      <button
        type="button"
        onClick={() => {
          const moved = autoSequence({ respectColors: optimize });
          setMessage(
            moved === 0
              ? 'Already in the shortest order.'
              : `Reordered ${moved} object${moved === 1 ? '' : 's'} to cut travel.`,
          );
        }}
        disabled={objectCount < 2}
        data-testid="auto-sequence"
      >
        Auto-sequence
      </button>

      {message !== null && (
        <p className="muted small" role="status" data-testid="sequence-message">
          {message}
        </p>
      )}

      <p className="muted small">
        {optimize
          ? 'Same threads are grouped when the design compiles, and the nearest colour block sews next.'
          : 'Objects sew in the listed order. Turn this on to group each thread and pick the nearest colour block next.'}{' '}
        Auto-sequence rewrites the object order itself; undo puts it back.
      </p>
    </section>
  );
}

const REDWORK_STYLES: { id: RedworkStyle; label: string }[] = [
  { id: 'single', label: 'Single line' },
  { id: 'triple', label: 'Triple run' },
  { id: 'backstitch', label: 'Backstitch' },
  { id: 'stem', label: 'Stem stitch' },
];

/**
 * Redwork automation.
 *
 * The conversion is deliberately reversible: it sets `params.redwork` and
 * leaves the rings, id, order and every other parameter untouched. Removing
 * it therefore returns the original fill rather than a flattened outline.
 */
function RedworkSection(): React.ReactElement {
  const selection = useDesignStore((s) => s.selection);
  const objects = useDesignStore((s) => s.design.objects);
  const redworkSelected = useDesignStore((s) => s.redworkSelected);
  const removeRedworkSelected = useDesignStore((s) => s.removeRedworkSelected);
  const [style, setStyle] = useState<RedworkStyle>('single');
  const [width, setWidth] = useState(1.2);
  const [stitch, setStitch] = useState(2.5);
  const [color, setColor] = useState('#C8102E');
  const [message, setMessage] = useState<string | null>(null);

  const active = objects.some(
    (o) => selection.includes(o.id) && o.params.redwork?.enabled === true,
  );

  return (
    <section className="panel-section" data-testid="redwork-section">
      <h2>Redwork</h2>
      <p className="muted small">
        Sew the selected outlines as one-colour line work. The geometry is kept, so removing redwork
        brings back the normal fill.
      </p>

      <label className="field">
        <span>Line style</span>
        <select
          value={style}
          onChange={(e) => {
            setStyle(e.target.value as RedworkStyle);
            setMessage(null);
          }}
          data-testid="redwork-style"
        >
          {REDWORK_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Stitch length (mm)</span>
        <input
          type="number"
          min="0.5"
          max="8"
          step="0.1"
          value={stitch}
          onChange={(e) => setStitch(Number(e.target.value))}
          data-testid="redwork-stitch"
        />
      </label>

      <label className="field">
        <span>Stem width (mm)</span>
        <input
          type="number"
          min="0.2"
          max="6"
          step="0.1"
          value={width}
          disabled={style !== 'stem'}
          onChange={(e) => setWidth(Number(e.target.value))}
          data-testid="redwork-width"
        />
        <small className="muted">
          Only the stem stitch uses this; the other styles follow the line itself.
        </small>
      </label>

      <label className="field">
        <span>Thread colour</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          data-testid="redwork-color"
        />
      </label>

      <button
        type="button"
        disabled={selection.length === 0}
        onClick={() =>
          setMessage(redworkSelected({ style, widthMm: width, stitchMm: stitch, color }))
        }
        data-testid="redwork-apply"
      >
        Convert to redwork
      </button>

      {active && (
        <button
          type="button"
          onClick={() => setMessage(removeRedworkSelected())}
          data-testid="redwork-remove"
        >
          Remove redwork
        </button>
      )}

      {message !== null && (
        <p className="muted small" role="status" data-testid="redwork-message">
          {message}
        </p>
      )}
    </section>
  );
}

function MultiHoopSection(): React.ReactElement {
  const overlap = useDesignStore((s) => s.sectionOverlap);
  const marks = useDesignStore((s) => s.sectionMarks);
  const setOverlap = useDesignStore((s) => s.setSectionOverlap);
  const setMarks = useDesignStore((s) => s.setSectionMarks);

  return (
    <section className="panel-section" data-testid="multihoop-section">
      <h2>Multi-hoop joins</h2>

      <label className="field">
        <span>Shared overlap (mm)</span>
        <input
          type="number"
          step="1"
          min="0"
          max="100"
          value={overlap}
          onChange={(e) => setOverlap(Number(e.target.value))}
          data-testid="section-overlap"
          title="How much of each join both hoopings sew. 0 means the two files meet exactly on the cut."
        />
      </label>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={marks}
          onChange={(e) => setMarks(e.target.checked)}
          data-testid="section-marks"
        />
        <span>Sew registration crosses</span>
      </label>

      <p className="muted small">
        Used by <strong>Export sections</strong>, which cuts the design across several hoopings.{' '}
        {overlap > 0
          ? `Both hoopings will sew ${overlap} mm of every join, so a slightly-off re-hoop stays covered.`
          : 'With no overlap the two files meet exactly on the cut.'}
        {marks
          ? ' A cross goes into each half of every join, at the same spot in the design, to line the second hooping up on.'
          : ' No alignment marks are sewn.'}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * Lettering controls.
 *
 * Lettering is generated from this spec rather than from path geometry, so
 * every field here changes what the machine will actually sew - there is no
 * separate outline to keep in step. Empty text is allowed while typing; the
 * object simply sews nothing and the status bar reports it.
 */
function LetteringSection({
  object,
  spec,
}: {
  object: EmbroideryObject;
  spec: LetteringSpec;
}): React.ReactElement {
  const updateObject = useDesignStore((s) => s.updateObject);
  const selection = useDesignStore((s) => s.selection);
  const objects = useDesignStore((s) => s.design.objects);
  const [pathMessage, setPathMessage] = useState<string | null>(null);

  const setSpec = (patch: Partial<LetteringSpec>): void => {
    updateObject(object.id, {
      lettering: { ...spec, ...patch },
      // Keep the object's name in step with its text, so the layer list and
      // the object browser stay readable without manual renaming.
      ...(patch.text !== undefined ? { name: `Text "${patch.text || 'Untitled'}"` } : {}),
    });
  };

  // The path comes from another selected object: pick the text and a shape
  // together, then say "use this shape". Lettering objects themselves have no
  // outline to follow.
  const shape = objects.find(
    (o) => o.id !== object.id && selection.includes(o.id) && o.path.rings.length > 0,
  );

  const applySelectedPath = (): void => {
    if (!shape) {
      setPathMessage('Select a shape together with this text, then use it as the path.');
      return;
    }
    const ring = shape.path.rings[0]!;
    const points = ring.map((p) => ({ ...p }));
    const first = points[0]!;
    const last = points[points.length - 1]!;
    // Close the loop when the shape does not already repeat its first point,
    // so text on a circle has the whole circumference to run around.
    if (first.x !== last.x || first.y !== last.y) points.push({ ...first });

    setSpec({
      onPath: {
        points,
        upright: spec.onPath?.upright ?? false,
        offsetMm: spec.onPath?.offsetMm ?? 0,
        align: spec.onPath?.align ?? 'start',
      },
    });
    setPathMessage(null);
  };

  const togglePath = (on: boolean): void => {
    if (!on) {
      setSpec({ onPath: null });
      setPathMessage(null);
      return;
    }
    if (shape) {
      applySelectedPath();
    } else {
      setPathMessage('Select a shape together with this text, then press "Use selected shape".');
    }
  };

  return (
    <div data-testid="lettering-section">
      <label className="field">
        <span>Text</span>
        <input
          type="text"
          value={spec.text}
          onChange={(e) => setSpec({ text: e.target.value })}
          data-testid="lettering-text"
        />
      </label>

      <label className="field">
        <span>Font</span>
        <select
          value={spec.font ?? 'studio'}
          onChange={(e) => setSpec({ font: e.target.value as NonNullable<LetteringSpec['font']> })}
          data-testid="lettering-font"
        >
          {FONT_LIBRARY.map((font) => (
            <option key={font.id} value={font.id}>
              {font.name} — {font.category}
            </option>
          ))}
        </select>
        <small className="muted">
          {FONT_LIBRARY.find((font) => font.id === (spec.font ?? 'studio'))?.description}
        </small>
      </label>

      <label className="field">
        <span>Size (cap height, mm)</span>
        <input
          type="number"
          min="2"
          max="150"
          step="1"
          value={spec.height}
          onChange={(e) => setSpec({ height: Number(e.target.value) })}
          data-testid="lettering-height"
        />
      </label>

      <label className="field">
        <span>Stroke width (mm)</span>
        <input
          type="number"
          min="0.3"
          max="10"
          step="0.1"
          value={spec.width}
          onChange={(e) => setSpec({ width: Number(e.target.value) })}
          data-testid="lettering-width"
        />
      </label>

      <label className="field">
        <span>Character spacing (mm)</span>
        <input
          type="number"
          min="-5"
          max="20"
          step="0.5"
          value={spec.spacing}
          onChange={(e) => setSpec({ spacing: Number(e.target.value) })}
          data-testid="lettering-spacing"
        />
      </label>

      <label className="field">
        <span>Slant (degrees)</span>
        <input
          type="number"
          min="-30"
          max="30"
          step="1"
          value={spec.slant}
          onChange={(e) => setSpec({ slant: Number(e.target.value) })}
          data-testid="lettering-slant"
        />
      </label>

      <label className="field">
        <span>Width scale</span>
        <input
          type="number"
          min="0.25"
          max="4"
          step="0.05"
          value={spec.stretch ?? 1}
          onChange={(e) => setSpec({ stretch: clampStretch(Number(e.target.value)) })}
          data-testid="lettering-stretch"
        />
        <small className="muted">
          1 keeps the font's proportions; lower condenses, higher widens.
        </small>
      </label>

      <label className="field">
        <span>Rotation (degrees)</span>
        <input
          type="number"
          min="-180"
          max="180"
          step="1"
          value={spec.rotation}
          onChange={(e) => setSpec({ rotation: Number(e.target.value) })}
          data-testid="lettering-rotation"
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={spec.mirror?.x ?? false}
          onChange={(e) => setSpec({ mirror: { x: e.target.checked, y: spec.mirror?.y ?? false } })}
          data-testid="lettering-mirror-x"
        />
        <span>Mirror horizontally</span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={spec.mirror?.y ?? false}
          onChange={(e) => setSpec({ mirror: { x: spec.mirror?.x ?? false, y: e.target.checked } })}
          data-testid="lettering-mirror-y"
        />
        <span>Mirror vertically</span>
      </label>

      <label className="field">
        <span>Sewing order</span>
        <select
          value={spec.order ?? 'default'}
          onChange={(e) => setSpec({ order: e.target.value as LetteringOrder })}
          data-testid="lettering-order"
        >
          <option value="default">Reading order</option>
          <option value="reverse">Reverse (right to left)</option>
          <option value="outsideIn">Outside in</option>
          <option value="insideOut">Inside out</option>
        </select>
        <small className="muted">Resequencing changes the needle order only; nothing moves.</small>
      </label>

      <div data-testid="lettering-path-section">
        <label className="check">
          <input
            type="checkbox"
            checked={spec.onPath != null}
            onChange={(e) => togglePath(e.target.checked)}
            data-testid="lettering-path-enable"
          />
          <span>Text on a path</span>
        </label>

        {spec.onPath != null && (
          <>
            <button type="button" onClick={applySelectedPath} data-testid="lettering-path-use">
              Use selected shape
            </button>
            <button
              type="button"
              onClick={() => setSpec({ onPath: null })}
              data-testid="lettering-path-clear"
            >
              Clear path
            </button>

            <label className="field">
              <span>Offset from path (mm)</span>
              <input
                type="number"
                min="-50"
                max="50"
                step="0.5"
                value={spec.onPath.offsetMm}
                onChange={(e) =>
                  setSpec({
                    onPath: { ...spec.onPath!, offsetMm: Number(e.target.value) },
                  })
                }
                data-testid="lettering-path-offset"
              />
            </label>

            <label className="field">
              <span>Along the path</span>
              <select
                value={spec.onPath.align}
                onChange={(e) =>
                  setSpec({
                    onPath: { ...spec.onPath!, align: e.target.value as 'start' | 'center' },
                  })
                }
                data-testid="lettering-path-align"
              >
                <option value="start">Start at the first point</option>
                <option value="center">Centred on the path</option>
              </select>
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={spec.onPath.upright}
                onChange={(e) =>
                  setSpec({ onPath: { ...spec.onPath!, upright: e.target.checked } })
                }
                data-testid="lettering-path-upright"
              />
              <span>Keep letters upright</span>
            </label>
          </>
        )}

        {pathMessage !== null && (
          <p className="muted small" role="status" data-testid="lettering-path-message">
            {pathMessage}
          </p>
        )}
      </div>

      <div data-testid="lettering-monogram-section">
        <label className="check">
          <input
            type="checkbox"
            checked={spec.monogram?.enabled === true}
            onChange={(e) =>
              setSpec({
                monogram: e.target.checked
                  ? { enabled: true, frame: 'none', mirrorSides: false, frameWidth: 1.5 }
                  : null,
              })
            }
            data-testid="lettering-monogram"
          />
          <span>Monogram</span>
        </label>

        {spec.monogram?.enabled === true && (
          <>
            <label className="field">
              <span>Frame</span>
              <select
                value={spec.monogram.frame}
                onChange={(e) =>
                  setSpec({
                    monogram: {
                      ...spec.monogram!,
                      frame: e.target.value as NonNullable<LetteringSpec['monogram']>['frame'],
                    },
                  })
                }
                data-testid="lettering-monogram-frame"
              >
                <option value="none">None</option>
                <option value="circle">Circle</option>
                <option value="oval">Oval</option>
                <option value="diamond">Diamond</option>
              </select>
            </label>

            <label className="field">
              <span>Frame width (mm)</span>
              <input
                type="number"
                min="0.5"
                max="5"
                step="0.1"
                value={spec.monogram.frameWidth}
                disabled={spec.monogram.frame === 'none'}
                onChange={(e) =>
                  setSpec({
                    monogram: { ...spec.monogram!, frameWidth: Number(e.target.value) },
                  })
                }
                data-testid="lettering-monogram-frame-width"
              />
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={spec.monogram.mirrorSides}
                onChange={(e) =>
                  setSpec({ monogram: { ...spec.monogram!, mirrorSides: e.target.checked } })
                }
                data-testid="lettering-monogram-mirror"
              />
              <span>Mirror the side initials</span>
            </label>

            <p className="muted small">
              With three letters the middle one is the honoured initial and sews larger. Monogram
              takes the first three letters and overrides the path layout.
            </p>
          </>
        )}
      </div>

      <div data-testid="lettering-drop-section">
        <label className="check">
          <input
            type="checkbox"
            checked={spec.drop?.enabled === true}
            onChange={(e) =>
              setSpec({ drop: e.target.checked ? { enabled: true, index: 0, scale: 1.6 } : null })
            }
            data-testid="lettering-drop"
          />
          <span>Dropped letter (team name)</span>
        </label>

        {spec.drop?.enabled === true && (
          <>
            <label className="field">
              <span>Which letter</span>
              <input
                type="number"
                min="0"
                max="64"
                step="1"
                value={spec.drop.index}
                onChange={(e) =>
                  setSpec({ drop: { ...spec.drop!, index: Math.max(0, Number(e.target.value)) } })
                }
                data-testid="lettering-drop-index"
              />
              <small className="muted">The first letter is 0.</small>
            </label>

            <label className="field">
              <span>Scale</span>
              <input
                type="number"
                min="0.5"
                max="3"
                step="0.1"
                value={spec.drop.scale}
                onChange={(e) =>
                  setSpec({
                    drop: { ...spec.drop!, scale: Math.max(0.5, Number(e.target.value)) },
                  })
                }
                data-testid="lettering-drop-scale"
              />
            </label>
          </>
        )}
      </div>

      {spec.text.trim() === '' && (
        <p className="muted small" role="status">
          No text yet - this object will not sew anything.
        </p>
      )}
    </div>
  );
}

/**
 * One axis of an entry/exit point.
 *
 * Deliberately not a `<label className="field">` wrapping the input: it is
 * one of a pair shown side by side, so it renders the caption above a bare
 * control. An empty box means "auto" rather than zero - an empty number
 * input reads as 0 only if you force it, and a point at (0,0) is a real
 * place a needle could be told to start, which is not what a blank meant.
 */
function CoordinateField({
  label,
  value,
  onValue,
  testId,
}: {
  label: string;
  value: number | undefined;
  onValue: (v: number | null) => void;
  testId: string;
}): React.ReactElement {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step="0.5"
        value={value === undefined ? '' : value}
        placeholder="auto"
        onChange={(e) => {
          const raw = e.target.value;
          onValue(raw === '' ? null : Number(raw));
        }}
        data-testid={testId}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------

function ObjectSection({
  object,
  multiCount,
  palette,
}: {
  object: EmbroideryObject;
  multiCount: number;
  palette: ThreadColor[];
}): React.ReactElement {
  const updateObject = useDesignStore((s) => s.updateObject);
  const updateParams = useDesignStore((s) => s.updateParams);
  const assignMachineToSelected = useDesignStore((s) => s.assignMachineToSelected);
  const spreadMachinesAcrossSelected = useDesignStore((s) => s.spreadMachinesAcrossSelected);
  const armed = useDesignStore((s) => s.pendingEntryExit);

  const p = object.params;
  const applique = p.applique?.enabled ? { ...DEFAULT_APPLIQUE, ...p.applique } : null;
  const appliqueIssue = appliqueProblem(applique ?? undefined);

  const setUnderlay = (patch: Partial<typeof p.underlay>): void =>
    updateParams(object.id, { underlay: { ...p.underlay, ...patch } });

  /**
   * Write one field of the carving stamp.
   *
   * Merge rather than replace, because the stamp carries a shape as well as
   * its numbers: a control that rebuilt the object from its own fields alone
   * would quietly drop a library motif the moment anyone touched the spacing.
   */
  const setCarve = (patch: Partial<NonNullable<typeof p.carve>>): void =>
    updateParams(object.id, {
      carve: {
        enabled: true,
        pattern: 'diamond',
        spacing: 6,
        scale: 3,
        rotation: 0,
        outline: true,
        ...p.carve,
        ...patch,
      },
    });

  /**
   * Write one field of the appliqué settings.
   *
   * Merged onto the defaults and then onto whatever the object already had, so
   * flipping the enable box on cannot silently reset widths the operator set
   * on a previous visit.
   */
  const setApplique = (patch: Partial<typeof DEFAULT_APPLIQUE>): void =>
    updateParams(object.id, {
      applique: {
        ...DEFAULT_APPLIQUE,
        ...p.applique,
        enabled: true,
        ...patch,
      },
    });

  /**
   * Write one axis of an entry/exit point.
   *
   * The two axes are independent fields showing on one object, so this has to
   * cope with the case where neither point exists yet - typing only X still
   * has to leave Y as something, and `auto` is the honest answer: the engine
   * then picks the part you did not specify rather than the two fighting.
   * Clearing both axes drops the point entirely, which is what "empty box"
   * should mean.
   */
  const setPoint = (which: 'entry' | 'exit', axis: 'x' | 'y', value: number | null): void => {
    const current = object.entryExit[which];
    const otherAxis = axis === 'x' ? 'y' : 'x';

    if (value === null && current?.[otherAxis] == null) {
      updateObject(object.id, { entryExit: { ...object.entryExit, [which]: null } });
      return;
    }

    // A point with only one axis is not a point; the second coordinate comes
    // from the object's own centre so the pair is meaningful.
    const base = current ?? objectCenter(object);
    const next = { ...base, [axis]: value ?? base[axis] };
    updateObject(object.id, { entryExit: { ...object.entryExit, [which]: next } });
  };

  return (
    <section className="panel-section" data-testid="object-section">
      <h2>
        {object.name || 'Object'}
        {multiCount > 1 && <span className="badge">{multiCount} selected</span>}
      </h2>

      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={object.name}
          onChange={(e) => updateObject(object.id, { name: e.target.value })}
        />
      </label>

      <label className="field">
        <span>Production machine</span>
        <input
          type="number"
          min="1"
          max="64"
          step="1"
          value={object.machine ?? 1}
          onChange={(e) =>
            updateObject(object.id, {
              machine: Math.min(64, Math.max(1, Math.round(Number(e.target.value) || 1))),
            })
          }
          data-testid="object-machine"
        />
        <small className="muted">
          Export by machine writes one independently valid file for each number. Objects default to
          machine 1.
        </small>
      </label>
      {multiCount > 1 && (
        <div className="button-row">
          <button
            type="button"
            onClick={() => assignMachineToSelected(object.machine ?? 1)}
            data-testid="assign-machine-selected"
          >
            Use machine {object.machine ?? 1} for all selected
          </button>
          <button
            type="button"
            className="secondary"
            onClick={spreadMachinesAcrossSelected}
            data-testid="spread-machines"
          >
            Spread one per machine
          </button>
        </div>
      )}

      {object.type === 'lettering' && object.lettering ? (
        <LetteringSection object={object} spec={object.lettering} />
      ) : (
        <label className="field">
          <span>Stitch type</span>
          <select
            value={p.stitchType}
            onChange={(e) => {
              const type = e.target.value as StitchType;
              // Switching type changes what the density means (satin spacing vs
              // fill spacing), so adopt that type's defaults rather than
              // carrying over a number tuned for the previous one.
              const defaults = defaultParams(type);
              updateParams(object.id, {
                stitchType: type,
                spacing: defaults.spacing,
                pullCompensation: defaults.pullCompensation,
                fillPattern: defaults.fillPattern,
                underlay: defaults.underlay,
              });
            }}
            data-testid="stitch-type"
          >
            {STITCH_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {isSpecialtyStitch(p.stitchType) && (
        <p className="muted small" data-testid="specialty-note">
          This is a sewn simulation: standard needle penetrations recreate the look, because
          DST/PES/EXP/JEF/VP3/TBF/HUS do not carry sequin, bead or chenille machine codes. Density
          controls the repeat pitch for this style.
        </p>
      )}

      <label className="field">
        <span>Density (spacing, mm)</span>
        <input
          type="number"
          step="0.05"
          min="0.05"
          max="20"
          value={p.spacing}
          onChange={(e) => updateParams(object.id, { spacing: Number(e.target.value) })}
          data-testid="spacing-input"
        />
        <small>Lower = denser. 0.3-0.6 mm suits most fills.</small>
      </label>

      <label className="field">
        <span>Angle (deg)</span>
        <input
          type="number"
          step="5"
          min="-360"
          max="360"
          value={p.angle}
          onChange={(e) => updateParams(object.id, { angle: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Pull compensation (mm)</span>
        <input
          type="number"
          step="0.1"
          min="-5"
          max="5"
          value={p.pullCompensation}
          onChange={(e) => updateParams(object.id, { pullCompensation: Number(e.target.value) })}
        />
        <small>Offsets row ends to counteract fabric pull.</small>
      </label>

      {object.type !== 'lettering' && p.stitchType === 'satin' && (
        <>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={!!p.separatePullCompensation}
              onChange={(e) =>
                updateParams(object.id, {
                  separatePullCompensation: e.target.checked
                    ? { left: p.pullCompensation, right: p.pullCompensation }
                    : null,
                })
              }
              data-testid="separate-pull"
            />
            <span>Separate pull compensation</span>
            <small className="muted">
              The two sides of a column can pull differently against the fabric.
            </small>
          </label>

          {p.separatePullCompensation && (
            <>
              <label className="field">
                <span>Left side (mm)</span>
                <input
                  type="number"
                  step="0.1"
                  min="-5"
                  max="5"
                  value={p.separatePullCompensation.left}
                  onChange={(e) =>
                    updateParams(object.id, {
                      separatePullCompensation: {
                        ...p.separatePullCompensation!,
                        left: Number(e.target.value),
                      },
                    })
                  }
                  data-testid="pull-left"
                />
              </label>

              <label className="field">
                <span>Right side (mm)</span>
                <input
                  type="number"
                  step="0.1"
                  min="-5"
                  max="5"
                  value={p.separatePullCompensation.right}
                  onChange={(e) =>
                    updateParams(object.id, {
                      separatePullCompensation: {
                        ...p.separatePullCompensation!,
                        right: Number(e.target.value),
                      },
                    })
                  }
                  data-testid="pull-right"
                />
              </label>
            </>
          )}
        </>
      )}

      {p.stitchType === 'tatami' && (
        <label className="field">
          <span>Fill pattern</span>
          <select
            value={p.fillPattern}
            onChange={(e) =>
              updateParams(object.id, {
                fillPattern: e.target.value as StitchParameters['fillPattern'],
              })
            }
            data-testid="fill-pattern"
          >
            {FILL_PATTERNS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <small>
            {p.fillPattern === 'stipple'
              ? 'A jittered dot texture: no rows, so the angle does not apply.'
              : p.fillPattern === 'cross'
                ? 'Two passes: the fill angle, then the same grid crossed at 90 degrees.'
                : 'How the stitches are laid inside the shape.'}
          </small>
        </label>
      )}

      {p.stitchType === 'tatami' && p.fillPattern === 'programmedSplit' ? (
        <details open>
          <summary>User-defined split</summary>
          <label className="field">
            <span>Block length (mm)</span>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="50"
              value={(p.customSplit ?? DEFAULT_CUSTOM_SPLIT).segmentLength}
              onChange={(e) =>
                updateParams(object.id, {
                  customSplit: {
                    ...(p.customSplit ?? DEFAULT_CUSTOM_SPLIT),
                    segmentLength: Number(e.target.value),
                  },
                })
              }
              data-testid="custom-split-length"
            />
            <small>A block sews this far, then the fill breaks for a moment.</small>
          </label>
          <label className="field">
            <span>Break (mm)</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="10"
              value={(p.customSplit ?? DEFAULT_CUSTOM_SPLIT).gap}
              onChange={(e) =>
                updateParams(object.id, {
                  customSplit: {
                    ...(p.customSplit ?? DEFAULT_CUSTOM_SPLIT),
                    gap: Number(e.target.value),
                  },
                })
              }
              data-testid="custom-split-gap"
            />
            <small>The gap left between blocks; 0 sews straight through.</small>
          </label>
          <label className="field">
            <span>Stagger (%)</span>
            <input
              type="number"
              step="5"
              min="0"
              max="100"
              value={Math.round((p.customSplit ?? DEFAULT_CUSTOM_SPLIT).stagger * 100)}
              onChange={(e) =>
                updateParams(object.id, {
                  customSplit: {
                    ...(p.customSplit ?? DEFAULT_CUSTOM_SPLIT),
                    stagger: Math.min(1, Math.max(0, Number(e.target.value) / 100)),
                  },
                })
              }
              data-testid="custom-split-stagger"
            />
            <small>How far alternate rows shift the breaks; 0 rules one line.</small>
          </label>
          {p.customSplit ? (
            <button
              type="button"
              onClick={() => updateParams(object.id, { customSplit: null })}
              data-testid="custom-split-reset"
            >
              Use the built-in 12 mm / 1.5 mm / 50%
            </button>
          ) : null}
        </details>
      ) : null}

      {p.stitchType === 'motif' || p.fillPattern === 'motif' ? (
        <>
          <MotifPicker
            label="Motif"
            hint="The shape stamped at each grid point. Bigger spacing stamps fewer, further apart."
            testId="motif-picker"
            value={p.motif}
            onChange={(motif) => updateParams(object.id, { motif })}
          />
          <label className="field">
            <span>Motif layout</span>
            <select
              value={p.motifMode ?? 'fill'}
              onChange={(e) =>
                updateParams(object.id, {
                  motifMode: e.target.value as NonNullable<StitchParameters['motifMode']>,
                })
              }
              data-testid="motif-mode"
            >
              <option value="fill">Fill (stamp a grid)</option>
              <option value="run">Run (along the outline)</option>
              <option value="single">Single stamp (fills the shape)</option>
              <option value="column">Column (motifs across the width)</option>
            </select>
            <small>
              {(p.motifMode ?? 'fill') === 'run'
                ? 'One motif after another along the outline, each turned to follow it.'
                : (p.motifMode ?? 'fill') === 'single'
                  ? 'Exactly one motif, scaled to the box you drew.'
                  : (p.motifMode ?? 'fill') === 'column'
                    ? 'Each motif spans the column between its two rails, stepping along it.'
                    : 'The shape stamped at each grid point. Bigger spacing stamps fewer, further apart.'}
            </small>
          </label>

          {(p.motifMode ?? 'fill') !== 'single' ? (
            <details>
              <summary>Motif gradient</summary>
              <label className="field">
                <span>Scale at the start</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.05"
                  max="20"
                  value={(p.motifGradient ?? DEFAULT_MOTIF_GRADIENT).scaleFrom}
                  onChange={(e) =>
                    updateParams(object.id, {
                      motifGradient: {
                        ...(p.motifGradient ?? DEFAULT_MOTIF_GRADIENT),
                        scaleFrom: Number(e.target.value),
                      },
                    })
                  }
                  data-testid="motif-gradient-scale-from"
                />
              </label>
              <label className="field">
                <span>Scale at the end</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.05"
                  max="20"
                  value={(p.motifGradient ?? DEFAULT_MOTIF_GRADIENT).scaleTo}
                  onChange={(e) =>
                    updateParams(object.id, {
                      motifGradient: {
                        ...(p.motifGradient ?? DEFAULT_MOTIF_GRADIENT),
                        scaleTo: Number(e.target.value),
                      },
                    })
                  }
                  data-testid="motif-gradient-scale-to"
                />
                <small>Size fades from the first motif to the last, across the fill.</small>
              </label>
              <label className="field">
                <span>Rotation at the start (°)</span>
                <input
                  type="number"
                  step="5"
                  min="-360"
                  max="360"
                  value={(p.motifGradient ?? DEFAULT_MOTIF_GRADIENT).angleFrom}
                  onChange={(e) =>
                    updateParams(object.id, {
                      motifGradient: {
                        ...(p.motifGradient ?? DEFAULT_MOTIF_GRADIENT),
                        angleFrom: Number(e.target.value),
                      },
                    })
                  }
                  data-testid="motif-gradient-angle-from"
                />
              </label>
              <label className="field">
                <span>Rotation at the end (°)</span>
                <input
                  type="number"
                  step="5"
                  min="-360"
                  max="360"
                  value={(p.motifGradient ?? DEFAULT_MOTIF_GRADIENT).angleTo}
                  onChange={(e) =>
                    updateParams(object.id, {
                      motifGradient: {
                        ...(p.motifGradient ?? DEFAULT_MOTIF_GRADIENT),
                        angleTo: Number(e.target.value),
                      },
                    })
                  }
                  data-testid="motif-gradient-angle-to"
                />
                <small>Extra rotation added to each motif, first to last.</small>
              </label>
              {p.motifGradient ? (
                <button
                  type="button"
                  onClick={() => updateParams(object.id, { motifGradient: null })}
                  data-testid="motif-gradient-clear"
                >
                  Remove gradient
                </button>
              ) : null}
            </details>
          ) : null}
        </>
      ) : null}

      <details open>
        <summary>Stitch length limits</summary>
        <label className="field">
          <span>Minimum (mm)</span>
          <input
            type="number"
            step="0.05"
            min="0"
            max="5"
            value={p.minStitchLength}
            onChange={(e) => updateParams(object.id, { minStitchLength: Number(e.target.value) })}
            data-testid="min-stitch-input"
          />
          <small>
            Anything shorter is collapsed: a machine cannot sew below a needle width without looping
            the thread. 0 turns it off.
          </small>
        </label>
        <label className="field">
          <span>Maximum (mm)</span>
          <input
            type="number"
            step="0.5"
            min="1"
            max="12.1"
            value={p.maxStitchLength}
            onChange={(e) => updateParams(object.id, { maxStitchLength: Number(e.target.value) })}
            data-testid="max-stitch-input"
          />
          <small>
            Longer single moves are split. 12.1 mm is the hard Tajima DST ceiling, so the value is
            capped there.
          </small>
        </label>
      </details>

      <details open>
        <summary>Underlay</summary>
        <label className="field">
          <span>Strategy</span>
          <select
            value={p.underlay.type}
            onChange={(e) => setUnderlay({ type: e.target.value as typeof p.underlay.type })}
            data-testid="underlay-type"
          >
            {UNDERLAY_TYPES.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        {p.underlay.type !== 'none' && (
          <>
            <label className="field">
              <span>Row spacing (mm)</span>
              <input
                type="number"
                step="0.5"
                min="0.1"
                max="20"
                value={p.underlay.spacing}
                onChange={(e) => setUnderlay({ spacing: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Edge offset (mm)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="20"
                value={p.underlay.offset}
                onChange={(e) => setUnderlay({ offset: Number(e.target.value) })}
              />
            </label>
          </>
        )}
      </details>

      {p.stitchType === 'satin' && (
        <details open={p.foam?.enabled ?? false}>
          <summary>3D Foam</summary>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={p.foam?.enabled ?? false}
              onChange={(e) =>
                updateParams(object.id, {
                  foam: {
                    enabled: e.target.checked,
                    thicknessMm: p.foam?.thicknessMm ?? 2,
                    tackUnderlay: p.foam?.tackUnderlay ?? true,
                  },
                })
              }
              data-testid="foam-enabled"
            />
            <span>Sew over foam (puff)</span>
          </label>
          <small>
            Foam is laid on the fabric and the satin traps it. The column sews denser and wider so
            no foam shows, and the underlay is replaced by a light tack so it does not skate the
            sheet.
          </small>
          {(p.foam?.enabled ?? false) && (
            <>
              <label className="field">
                <span>Foam thickness (mm)</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="10"
                  value={p.foam?.thicknessMm ?? 2}
                  onChange={(e) =>
                    updateParams(object.id, {
                      foam: {
                        enabled: true,
                        thicknessMm: Number(e.target.value),
                        tackUnderlay: p.foam?.tackUnderlay ?? true,
                      },
                    })
                  }
                  data-testid="foam-thickness"
                />
                <small>Drives how much wider the column pulls.</small>
              </label>
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={p.foam?.tackUnderlay ?? true}
                  onChange={(e) =>
                    updateParams(object.id, {
                      foam: {
                        enabled: true,
                        thicknessMm: p.foam?.thicknessMm ?? 2,
                        tackUnderlay: e.target.checked,
                      },
                    })
                  }
                  data-testid="foam-tack"
                />
                <span>Tack the foam first</span>
              </label>
            </>
          )}
        </details>
      )}

      {p.stitchType === 'tatami' && (
        <details open={p.carve?.enabled ?? false}>
          <summary>Carving Stamp</summary>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={p.carve?.enabled ?? false}
              onChange={(e) => setCarve({ enabled: e.target.checked })}
              data-testid="carve-enabled"
            />
            <span>Carve a pattern into the fill</span>
          </label>
          <small>
            A repeating stamp is pressed into the fill by removing the stitches inside it, so the
            shape stays a solid fill with a debossed texture punched through. The gaps are the
            design.
          </small>
          {p.carve?.enabled === true && (
            <>
              {/*
                The picker lists the built-in stamps and the library shapes in
                one place. A library shape is stored under `motif` and a
                built-in under `pattern`, so picking one leaves the other as
                the fallback the engine uses if the carried shape is missing.
              */}
              <MotifPicker
                label="Stamp"
                hint="Pressed into the fill by removing the stitches inside it."
                testId="carve-motif-picker"
                value={p.carve?.motif ?? { id: p.carve?.pattern ?? 'diamond' }}
                onChange={(choice) =>
                  setCarve(
                    choice.points
                      ? { motif: choice }
                      : // A built-in is named, not carried: clearing the carried
                        // shape is what stops an old library stamp from winning
                        // over the one just picked.
                        {
                          pattern: choice.id as NonNullable<typeof p.carve>['pattern'],
                          motif: undefined,
                        },
                  )
                }
              />
              <label className="field">
                <span>Stamp spacing (mm)</span>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="50"
                  value={p.carve?.spacing ?? 6}
                  onChange={(e) => setCarve({ spacing: Number(e.target.value) })}
                  data-testid="carve-spacing"
                />
                <small>Distance between stamps. Smaller packs them tighter.</small>
              </label>
              <label className="field">
                <span>Stamp size (mm)</span>
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  max="50"
                  value={p.carve?.scale ?? 3}
                  onChange={(e) => setCarve({ scale: Number(e.target.value) })}
                  data-testid="carve-scale"
                />
              </label>
              <label className="field">
                <span>Stamp rotation (degrees)</span>
                <input
                  type="number"
                  step="5"
                  min="-360"
                  max="360"
                  value={p.carve?.rotation ?? 0}
                  onChange={(e) => setCarve({ rotation: Number(e.target.value) })}
                  data-testid="carve-rotation"
                />
              </label>
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={p.carve?.outline ?? true}
                  onChange={(e) => setCarve({ outline: e.target.checked })}
                  data-testid="carve-outline"
                />
                <span>Sew an outline around each stamp</span>
              </label>
            </>
          )}
        </details>
      )}

      <details>
        <summary>Tie-in / Tie-off</summary>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={p.tieIn.enabled}
            onChange={(e) =>
              updateParams(object.id, { tieIn: { ...p.tieIn, enabled: e.target.checked } })
            }
          />
          <span>Lock at start</span>
        </label>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={p.tieOff.enabled}
            onChange={(e) =>
              updateParams(object.id, { tieOff: { ...p.tieOff, enabled: e.target.checked } })
            }
          />
          <span>Lock at end</span>
        </label>
      </details>

      {object.type !== 'lettering' && (
        <details className="subsection" data-testid="applique-section">
          <summary>Appliqué</summary>
          <p className="muted small">
            Placement run, stop for the fabric, tack, stop for trimming, then a satin finish over
            the raw edge.
          </p>

          <label className="field checkbox">
            <input
              type="checkbox"
              checked={applique !== null}
              onChange={(e) =>
                e.target.checked
                  ? setApplique({})
                  : updateParams(object.id, {
                      applique: { ...DEFAULT_APPLIQUE, ...p.applique, enabled: false },
                    })
              }
              data-testid="applique-enabled"
            />
            <span>Appliqué object</span>
          </label>

          {applique && (
            <>
              <label className="field">
                <span>Mode</span>
                <select
                  value={applique.mode}
                  onChange={(e) => setApplique({ mode: e.target.value as 'full' | 'partial' })}
                  data-testid="applique-mode"
                >
                  <option value="full">Full patch (all edges)</option>
                  <option value="partial">Partial (one open edge)</option>
                </select>
              </label>

              {applique.mode === 'partial' && (
                <div className="field-row">
                  <label className="field">
                    <span>Start (%)</span>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      step="1"
                      value={Math.round(applique.start * 100)}
                      onChange={(e) =>
                        setApplique({
                          start: Math.max(0, Math.min(99, Number(e.target.value) || 0)) / 100,
                        })
                      }
                      data-testid="applique-start"
                    />
                  </label>
                  <label className="field">
                    <span>Length (%)</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={Math.round(applique.length * 100)}
                      onChange={(e) =>
                        setApplique({
                          length: Math.max(1, Math.min(100, Number(e.target.value) || 1)) / 100,
                        })
                      }
                      data-testid="applique-length"
                    />
                  </label>
                </div>
              )}

              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={applique.placement}
                  onChange={(e) => setApplique({ placement: e.target.checked })}
                  data-testid="applique-placement"
                />
                <span>Placement run</span>
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Tack</span>
                  <select
                    value={applique.tack}
                    onChange={(e) =>
                      setApplique({
                        tack: e.target.value as 'none' | 'run' | 'zigzag' | 'satin',
                      })
                    }
                    data-testid="applique-tack"
                  >
                    <option value="none">None</option>
                    <option value="run">Run</option>
                    <option value="zigzag">Zigzag</option>
                    <option value="satin">Satin</option>
                  </select>
                </label>
                <label className="field">
                  <span>Tack width</span>
                  <input
                    type="number"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={applique.tackWidth}
                    onChange={(e) => setApplique({ tackWidth: Number(e.target.value) })}
                    data-testid="applique-tack-width"
                  />
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Finish</span>
                  <select
                    value={applique.finish}
                    onChange={(e) =>
                      setApplique({
                        finish: e.target.value as 'none' | 'run' | 'zigzag' | 'satin',
                      })
                    }
                    data-testid="applique-finish"
                  >
                    <option value="none">None</option>
                    <option value="run">Run</option>
                    <option value="zigzag">Zigzag</option>
                    <option value="satin">Satin</option>
                  </select>
                </label>
                <label className="field">
                  <span>Finish width</span>
                  <input
                    type="number"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={applique.finishWidth}
                    onChange={(e) => setApplique({ finishWidth: Number(e.target.value) })}
                    data-testid="applique-finish-width"
                  />
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Finish offset</span>
                  <input
                    type="number"
                    min="-10"
                    max="10"
                    step="0.5"
                    value={applique.finishOffset}
                    onChange={(e) => setApplique({ finishOffset: Number(e.target.value) })}
                    data-testid="applique-offset"
                  />
                </label>
                <label className="field">
                  <span>Finish spacing</span>
                  <input
                    type="number"
                    min="0.2"
                    max="6"
                    step="0.1"
                    value={applique.finishSpacing}
                    onChange={(e) => setApplique({ finishSpacing: Number(e.target.value) })}
                    data-testid="applique-finish-spacing"
                  />
                </label>
              </div>

              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={applique.fill}
                  onChange={(e) => setApplique({ fill: e.target.checked })}
                  data-testid="applique-fill"
                />
                <span>Sew the fill under the patch</span>
              </label>

              {appliqueIssue && (
                <p className="muted small" role="alert" data-testid="applique-problem">
                  {appliqueIssue}
                </p>
              )}
            </>
          )}
        </details>
      )}

      <details className="subsection" open data-testid="transform-section">
        <summary>Transform</summary>
        <p className="muted small">
          Baked into the outline: what you see is what the machine sews.
        </p>
        <div className="button-row">
          <button
            type="button"
            onClick={() => useDesignStore.getState().flipSelected('x')}
            title="Mirror across a vertical line through the middle"
            data-testid="flip-h"
          >
            Flip H
          </button>
          <button
            type="button"
            onClick={() => useDesignStore.getState().flipSelected('y')}
            title="Mirror across a horizontal line through the middle"
            data-testid="flip-v"
          >
            Flip V
          </button>
        </div>
        <div className="button-row">
          <button
            type="button"
            onClick={() => useDesignStore.getState().rotateSelected(-90)}
            title="Turn 90 degrees anticlockwise about the middle"
            data-testid="rotate-ccw"
          >
            ⟲ 90°
          </button>
          <button
            type="button"
            onClick={() => useDesignStore.getState().rotateSelected(90)}
            title="Turn 90 degrees clockwise about the middle"
            data-testid="rotate-cw"
          >
            ⟳ 90°
          </button>
        </div>
        <div className="button-row">
          <button
            type="button"
            onClick={() => useDesignStore.getState().scaleSelected(1.1, 1.1)}
            title="Grow by 10% about the middle"
            data-testid="scale-up"
          >
            Scale +10%
          </button>
          <button
            type="button"
            onClick={() => useDesignStore.getState().scaleSelected(0.9, 0.9)}
            title="Shrink by 10% about the middle"
            data-testid="scale-down"
          >
            Scale −10%
          </button>
        </div>
        <div className="button-row">
          <button
            type="button"
            onClick={() => useDesignStore.getState().groupSelected()}
            disabled={multiCount < 2}
            title="Select and move these as one piece"
            data-testid="group-button"
          >
            Group
          </button>
          <button
            type="button"
            onClick={() => useDesignStore.getState().ungroupSelected()}
            disabled={!object.groupId}
            title="Break the group back into separate objects"
            data-testid="ungroup-button"
          >
            Ungroup
          </button>
        </div>
      </details>

      <details className="subsection" open data-testid="entryexit-section">
        <summary>Entry / exit</summary>
        <p className="muted small">
          Where this colour starts and stops. The engine picks sensible points on its own; setting
          them by hand overrides that guess.
        </p>
        <div className="button-row">
          <button
            type="button"
            onClick={() => {
              const store = useDesignStore.getState();
              if (store.pendingEntryExit === 'entry') store.cancelEntryExit();
              else store.armEntryExit('entry');
            }}
            disabled={multiCount === 0}
            title="Click on the canvas to choose where the needle starts"
            data-testid="arm-entry"
          >
            {armed === 'entry' ? 'Click the canvas…' : 'Set entry'}
          </button>
          <button
            type="button"
            onClick={() => {
              const store = useDesignStore.getState();
              if (store.pendingEntryExit === 'exit') store.cancelEntryExit();
              else store.armEntryExit('exit');
            }}
            disabled={multiCount === 0}
            title="Click on the canvas to choose where the needle stops"
            data-testid="arm-exit"
          >
            {armed === 'exit' ? 'Click the canvas…' : 'Set exit'}
          </button>
        </div>

        {/* Typing a coordinate is the precise alternative to clicking: a
            digitizer who knows the hoop knows the number. Each field writes
            one axis and leaves the other alone, so X and Y can be typed in
            either order without the second wiping out the first. */}
        <div className="field-pair">
          <CoordinateField
            label="Entry X"
            value={object.entryExit.entry?.x}
            onValue={(v) => setPoint('entry', 'x', v)}
            testId="entry-x"
          />
          <CoordinateField
            label="Entry Y"
            value={object.entryExit.entry?.y}
            onValue={(v) => setPoint('entry', 'y', v)}
            testId="entry-y"
          />
        </div>
        <div className="field-pair">
          <CoordinateField
            label="Exit X"
            value={object.entryExit.exit?.x}
            onValue={(v) => setPoint('exit', 'x', v)}
            testId="exit-x"
          />
          <CoordinateField
            label="Exit Y"
            value={object.entryExit.exit?.y}
            onValue={(v) => setPoint('exit', 'y', v)}
            testId="exit-y"
          />
        </div>

        <div className="button-row">
          <button
            type="button"
            onClick={() =>
              useDesignStore.getState().updateObject(object.id, {
                entryExit: { entry: null, exit: null },
              })
            }
            disabled={!object.entryExit.entry && !object.entryExit.exit}
            title="Let the engine choose both again"
            data-testid="clear-entryexit"
          >
            Reset to automatic
          </button>
        </div>
      </details>

      <div className="button-row">
        <button
          type="button"
          onClick={() => useDesignStore.getState().bringForward(object.id)}
          title="Move above the others"
        >
          Bring forward
        </button>
        <button
          type="button"
          onClick={() => useDesignStore.getState().sendBackward(object.id)}
          title="Move below the others"
        >
          Send back
        </button>
      </div>

      <div className="button-row">
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={object.hidden}
            onChange={(e) => updateObject(object.id, { hidden: e.target.checked })}
          />
          <span>Hidden</span>
        </label>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={object.locked}
            onChange={(e) => updateObject(object.id, { locked: e.target.checked })}
          />
          <span>Locked</span>
        </label>
      </div>

      <label className="field">
        <span>Thread colour</span>
        <select
          value={object.colorIndex}
          onChange={(e) => updateObject(object.id, { colorIndex: Number(e.target.value) })}
          data-testid="color-select"
        >
          {palette.map((c, i) => (
            <option key={c.id} value={i}>
              {i + 1}. {c.name || c.code || c.hex}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

// ---------------------------------------------------------------------------

function PaletteSection({
  palette,
  activeColorIndex,
  hasSelection,
}: {
  palette: ThreadColor[];
  activeColorIndex: number;
  hasSelection: boolean;
}): React.ReactElement {
  const addColor = useDesignStore((s) => s.addColor);
  const updateColor = useDesignStore((s) => s.updateColor);
  const removeColor = useDesignStore((s) => s.removeColor);

  const applyPreset = (presetId: string): void => {
    const preset = referenceStore.getState().palettes.find((p) => p.presetId === presetId);
    if (preset) useDesignStore.getState().setPalette(preset.colors.map((c) => ({ ...c })));
  };

  const presets = referenceStore((s) => s.palettes);

  const active = palette[activeColorIndex];

  return (
    <section className="panel-section">
      <h2>Thread palette</h2>

      {presets.length > 0 && (
        <label className="field">
          <span>Load palette</span>
          <select value="" onChange={(e) => e.target.value && applyPreset(e.target.value)}>
            <option value="">Choose...</option>
            {presets.map((p) => (
              <option key={p.presetId} value={p.presetId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <ul className="swatch-list" data-testid="palette-list">
        {palette.map((c, i) => (
          <li key={c.id} className={i === activeColorIndex && hasSelection ? 'active' : ''}>
            <input
              type="color"
              value={c.hex}
              aria-label={`Colour ${c.name}`}
              onChange={(e) => updateColor(c.id, { hex: e.target.value.toUpperCase() })}
            />
            <input
              type="text"
              value={c.name}
              aria-label="Colour name"
              onChange={(e) => updateColor(c.id, { name: e.target.value })}
            />
            <button
              type="button"
              aria-label={`Remove ${c.name}`}
              disabled={palette.length <= 1}
              onClick={() => removeColor(c.id)}
            >
              &times;
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="full-width"
        onClick={() =>
          addColor({
            id: nextObjectId(),
            code: String(palette.length + 1).padStart(4, '0'),
            name: `Colour ${palette.length + 1}`,
            hex: '#808080',
          })
        }
      >
        Add colour
      </button>

      {active && (
        <p className="muted small">
          Active: {active.name} ({active.hex})
        </p>
      )}
    </section>
  );
}
