/**
 * The editable design document.
 *
 * Everything the user can change lives here: geometry, parameters, palette,
 * selection and the active tool. `compiled` is a *derived* cache - the engine
 * is a pure function of the document, so it is recomputed only when `rev`
 * moves, which keeps panning and hovering cheap while guaranteeing the
 * preview can never disagree with what gets exported.
 *
 * History is a plain snapshot stack. Stitch sequences are deliberately not
 * stored in history: they are large and fully reproducible, so keeping them
 * would cost memory without adding any undo capability.
 */

import { create } from 'zustand';
import {
  compileDesign,
  writeDst,
  writePes,
  writeExp,
  writeJef,
  writeVp3,
  writeTbf,
  writeHus,
  autoDigitize,
  planPhotoStitch,
  optimizeObjectOrder,
  DST_EXTENSION,
  DST_MIME,
  PES_EXTENSION,
  PES_MIME,
  EXP_EXTENSION,
  EXP_MIME,
  JEF_EXTENSION,
  JEF_MIME,
  VP3_EXTENSION,
  VP3_MIME,
  TBF_EXTENSION,
  TBF_MIME,
  HUS_EXTENSION,
  HUS_MIME,
  GIF_EXTENSION,
  GIF_MIME,
  boundsOfObjects,
  translateObject,
  rotateObject,
  pickHoop,
  boundsMidpoint,
  objectCenter,
  planBlend,
  canBlend,
  splitIntoHoops,
  combinePaths,
  subtractPaths,
  offsetPath,
  borderPath,
  roundCorners,
  REDWORK_LIMITS,
  DEFAULT_CAP_WRAP,
  spreadAcrossMachines,
  designToSvg,
  designToPdf,
  buildPrintSheet,
  splitObjectsByMachine,
  type AutoDigitizeOptions,
  type CapWrapSettings,
  type CompoundPath,
  type EmbroideryObject,
  type Hoop,
  type ObjectOrderOptions,
  type PhotoStitchOptions,
  type Point,
  type RasterImage,
  type RedworkStyle,
  type StitchParameters,
  type StitchSequence,
  type StitchMovieOptions,
  type ThreadColor,
  type ValidationResult,
  type PaperSize,
} from '@threadworks/engine';
import {
  HISTORY_LIMIT,
  createEmptyDesign,
  createObject,
  DEFAULT_SPACING,
  DEFAULT_STITCH_LENGTH,
  nextObjectId,
  defaultParams,
} from '../model/defaults.js';
import { referenceStore } from './referenceStore.js';
import { encodeGif } from '../video/gif.js';
import { artworkPng } from '../files/artwork.js';

export type Tool =
  | 'select'
  | 'nodeEdit'
  | 'pan'
  | 'inputA'
  | 'inputB'
  | 'complexFill'
  | 'run'
  | 'bean'
  | 'rectangle'
  | 'circle'
  | 'ellipseTool'
  | 'polyline'
  | 'lettering';

/** Machine formats the studio can write out. */
export type ExportFormat = 'dst' | 'pes' | 'exp' | 'jef' | 'vp3' | 'tbf' | 'hus';

/** Customer-facing artwork formats, separate from machine files. */
export type ArtworkFormat = 'svg' | 'png' | 'pdf' | 'print';

export interface ArtworkRequest {
  format: ArtworkFormat;
  paper?: PaperSize;
  landscape?: boolean;
  scale?: 'fit' | '1:1';
  includeHoop?: boolean;
  includeLegend?: boolean;
  /** PNG output width in mm. */
  widthMm?: number;
  dpi?: number;
  background?: string | null;
}

/**
 * A picture kept under the artwork as a tracing guide.
 *
 * It is document data, not a stitch object: it is never compiled, exported or
 * counted by validation. The compressed data URL is stored with the project so
 * reopening a design still shows the picture the user was drawing over.
 */
export interface ReferenceImage {
  dataUrl: string;
  name: string;
  /** Top-left corner in design millimetres. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1; the guide can be faded without changing the stitch preview. */
  opacity: number;
  visible: boolean;
}

/** What an image import needs to place a guide; the store centres it. */
export interface ReferenceImagePlacement {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  opacity?: number;
  visible?: boolean;
}

/** The compressed picture attached to an auto-digitized or photo-stitched design. */
export interface ReferenceImageAttachment {
  dataUrl: string;
  name: string;
  opacity?: number;
  visible?: boolean;
}

/**
 * How several selected shapes can be combined.
 *
 * `weld` merges their outlines, `combine` keeps the area covered an odd number
 * of times (so a double-covered spot becomes a hole), `subtract` cuts the rest
 * out of the first, and `intersect` keeps only what they all share.
 */
export type ShapeOp = 'weld' | 'combine' | 'subtract' | 'intersect';

/** Join style for an offset outline. */
export type OffsetJoin = 'miter' | 'bevel' | 'round';

export interface DesignState {
  /** Mongo project id, or null for an unsaved design. */
  projectId: string | null;
  name: string;
  /** Optimistic-concurrency token from the last load/save. */
  version: number;
  units: 'mm' | 'cm' | 'in';
  width: number;
  height: number;
  hoopId: string | null;
  objects: EmbroideryObject[];
  threadPalette: ThreadColor[];
  capWrap: CapWrapSettings;
  /** Clear picture shown under the artwork, never sewn. */
  referenceImage: ReferenceImage | null;
}

export interface CompiledDesign {
  sequence: StitchSequence;
  validation: ValidationResult;
}

interface HistoryEntry {
  design: DesignState;
  selection: string[];
}

interface DesignStore {
  design: DesignState;
  selection: string[];
  tool: Tool;
  /**
   * Object whose outline is being resumed by Continue Digitizing, or null.
   *
   * Session-only: it describes what the canvas is currently doing, not what
   * the design contains. The object itself is only changed on commit.
   */
  continuingId: string | null;

  /**
   * Which entry/exit point the next canvas click will place, or null.
   *
   * Set from the inspector, resolved by a click in the editor. Keeping it in
   * the store rather than in the canvas means Escape can cancel it from
   * anywhere and the panel can show that a placement is pending.
   */
  pendingEntryExit: 'entry' | 'exit' | null;

  // --- multi-hoop export preferences ---
  /**
   * mm of every section join that BOTH hoopings sew, when the design is cut
   * into several files.
   *
   * Session-only on purpose: it says how the operator wants the design CUT
   * into machine files, not what the design contains, so it is not part of
   * the document and does not travel into the project record. Anything that
   * changed the sewn stitches would belong in `design`.
   */
  sectionOverlap: number;
  /** Sew a registration cross at every join, into both of the halves. */
  sectionMarks: boolean;

  /**
   * Regroup objects by colour when compiling, to cut thread changes.
   *
   * Session-only, like the split settings above: it changes how the same
   * design is sewn, not what the design contains, so it never travels into the
   * project record.
   */
  optimizeColors: boolean;

  /** Monotonic counter bumped by every document mutation. */
  rev: number;
  compiled: CompiledDesign | null;

  dirty: boolean;
  saving: boolean;
  lastError: string | null;

  past: HistoryEntry[];
  future: HistoryEntry[];

  // --- document lifecycle ---
  newDesign: (name?: string) => void;
  loadDesign: (input: {
    projectId: string;
    name: string;
    version: number;
    units: 'mm' | 'cm' | 'in';
    width: number;
    height: number;
    hoopId: string | null;
    objects: EmbroideryObject[];
    threadPalette: ThreadColor[];
    capWrap?: CapWrapSettings;
    referenceImage?: ReferenceImage | null;
  }) => void;

  // --- editing ---
  addObject: (obj: EmbroideryObject) => void;
  updateObject: (id: string, patch: Partial<EmbroideryObject>) => void;
  updateParams: (id: string, patch: Partial<StitchParameters>) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  moveSelected: (dx: number, dy: number, options?: { history?: boolean }) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  setOrder: (id: string, order: number) => void;

  // --- transform (baked into path geometry) ---
  /** Mirror every selected object across a vertical axis through its centre. */
  flipSelected: (axis: 'x' | 'y') => void;
  /** Scale every selected object about its own centre. */
  scaleSelected: (sx: number, sy: number) => void;
  /** Rotate every selected object about its own centre. */
  rotateSelected: (angleDegrees: number) => void;

  // --- grouping ---
  /** Assign a shared groupId to every selected object. */
  groupSelected: () => void;
  /** Drop the groupId from every selected object that has one. */
  ungroupSelected: () => void;

  // --- entry / exit placement ---
  /**
   * Arm the next canvas click to place `which` on the selected objects.
   * The engine honours a hand-set entry/exit over its own guess, so this is
   * the control that lets a digitizer decide where a colour actually starts.
   */
  armEntryExit: (which: 'entry' | 'exit') => void;
  /** Cancel a pending placement without changing the document. */
  cancelEntryExit: () => void;
  /**
   * Record the placed point on every selected object.
   *
   * Accepts null to clear, so the same action serves "place" and "remove".
   */
  placeEntryExit: (point: Point | null) => void;

  // --- multi-hoop export preferences ---
  /**
   * Set how many mm of every join the two hoopings will both sew.
   *
   * Clamped here as well as in the engine so the panel can never show a
   * number the export would quietly ignore.
   */
  setSectionOverlap: (mm: number) => void;
  /** Turn registration crosses at every join on or off. */
  setSectionMarks: (on: boolean) => void;

  /** Turn automatic colour sort on or off for this session. */
  setOptimizeColors: (on: boolean) => void;

  /**
   * Reorder the objects into a shorter sewing path.
   *
   * One undo step. Returns how many objects changed position, so the caller
   * can report honestly when nothing needed moving.
   */
  autoSequence: (options?: ObjectOrderOptions) => number;

  // --- node editing ---
  /**
   * Push exactly one undo snapshot without changing the document.
   *
   * A drag is many store writes but one user action, so the canvas calls
   * this once when a drag begins and then moves nodes with history off.
   * Without this, undoing a drag would step back one pixel at a time.
   */
  beginGesture: () => void;
  /** Move one path node. History-less so a drag stays a single undo step. */
  moveNode: (objectId: string, ring: number, index: number, x: number, y: number) => void;
  /** Insert a node on the segment between `index-1` and `index` of a ring. */
  insertNode: (objectId: string, ring: number, afterIndex: number, at: Point) => void;
  /** Delete the given nodes of a ring, keeping at least three points. */
  deleteNodes: (objectId: string, ring: number, indices: number[]) => void;

  // --- colour blending ---
  /**
   * Blend the selected fills so overlapping threads read as a mixed colour.
   *
   * Each selected fill is thinned to share the area (N fills each cover 1/N
   * of the rows) and their angles are spread so no two run the same way -
   * fills at the same angle stack into stripes rather than mixing. The total
   * stitch count stays about where a single full fill would be, so blending
   * does not double the thread and pucker the fabric.
   *
   * Returns a short message describing what happened, including a refusal
   * when the selection cannot be blended, so the panel can explain itself
   * instead of appearing broken.
   */
  blendSelected: (options?: { densityMultiplier?: number }) => string | null;

  // --- redwork -----------------------------------------------------------
  /**
   * Sew the selected outlines as one-colour redwork lines.
   *
   * The geometry is kept and only `params.redwork` changes, so the conversion
   * is reversible and the original fill is one click away. Returns a message
   * for the panel, including why nothing happened.
   */
  redworkSelected: (options: {
    style: RedworkStyle;
    widthMm: number;
    stitchMm: number;
    color: string;
  }) => string | null;
  /** Turn redwork off on the selected objects, restoring their normal sewing. */
  removeRedworkSelected: () => string | null;

  // --- shaping -----------------------------------------------------------
  /**
   * Combine the selected shapes with one boolean operation.
   *
   * Returns a message for the panel, because a refusal has to say why: two
   * shapes that do not overlap have no intersection, and silently doing
   * nothing would look like a broken button.
   */
  shapeSelected: (op: ShapeOp) => string | null;
  /** Create an offset copy of every selected shape, leaving the originals. */
  offsetSelected: (
    distance: number,
    options?: { join?: OffsetJoin; miterLimit?: number; copies?: number },
  ) => string | null;
  /** Create a run outline around every selected shape at `distance`. */
  borderSelected: (distance: number) => string | null;
  /** Round the corners of every selected shape by `radius`. */
  roundSelectedCorners: (radius: number) => string | null;
  /** Move every object so the design sits in the middle of the hoop. */
  centerAll: () => void;

  // --- palette ---
  addColor: (color: ThreadColor) => void;
  updateColor: (id: string, patch: Partial<ThreadColor>) => void;
  removeColor: (id: string) => void;
  setPalette: (colors: ThreadColor[]) => void;

  // --- canvas ---
  setSize: (width: number, height: number, hoopId: string | null) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setTool: (tool: Tool) => void;
  /**
   * Resume the selected object's outline instead of drawing a new one.
   *
   * Returns false when the selection cannot be continued (nothing selected,
   * a multi-selection, lettering, or an object with no editable outline), so
   * the toolbar can disable the action honestly.
   */
  beginContinueDigitizing: () => boolean;
  /** Leave resume mode without changing the object. */
  cancelContinueDigitizing: () => void;
  /** Replace an object's rings in one undoable step. */
  replacePath: (objectId: string, rings: Point[][]) => void;

  // --- history ---
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /**
   * Drop history beyond `depth`.
   *
   * The limit is read on every push, so without this a lowered depth would
   * only bite on the next edit - leaving Preferences saying "N steps" while
   * the stack in memory still held far more.
   */
  trimHistory: (depth: number) => void;

  // --- derived ---
  getCompiled: () => CompiledDesign;
  isDirty: () => boolean;
  markSaved: (projectId: string, version: number) => void;
  setError: (message: string | null) => void;

  // --- hoop ---
  /**
   * Pick the smallest hoop from the library that holds the design, and
   * centre the design inside it.
   *
   * The choice is made against the bounds of the stitches that will actually
   * sew - not the editable outlines - because lettering and any future
   * text-derived object carry no path geometry at all, so outline bounds
   * would quietly under-measure them and select a hoop that is too small.
   *
   * `allowRotation` lets the design be turned a quarter turn when that finds
   * a smaller frame. The rotation is a real, undoable edit of the geometry,
   * not a promise the user has to keep by hand.
   *
   * Returns a short message describing what happened, so the panel can say
   * why it did nothing rather than appearing broken.
   */
  autoHoop: (options?: { allowRotation?: boolean; center?: boolean }) => string | null;

  /** Encode the compiled design as a Tajima DST file. */
  exportDst: () => { filename: string; bytes: Uint8Array; mime: string };

  /** Encode the compiled design as a Brother PES file. */
  exportPes: () => { filename: string; bytes: Uint8Array; mime: string };

  /** Encode the compiled design as a Melco EXP file. */
  exportExp: () => { filename: string; bytes: Uint8Array; mime: string };

  /** Encode the compiled design as a Janome JEF file. */
  exportJef: () => { filename: string; bytes: Uint8Array; mime: string };

  /** Encode the compiled design as a Husqvarna VP3 file. */
  exportVp3: () => { filename: string; bytes: Uint8Array; mime: string };

  /** Encode the compiled design as a TBF file. */
  exportTbf: () => { filename: string; bytes: Uint8Array; mime: string };

  /** Encode the compiled design as a Husqvarna HUS file. */
  exportHus: () => { filename: string; bytes: Uint8Array; mime: string };

  /**
   * Split the design into one file per hooping and encode each.
   *
   * Returns the split report (which hoop, how many sections, where the cuts
   * fell) alongside one encoded file per section, so the caller can show the
   * plan and download every part. A design that already fits the chosen hoop
   * comes back as a single file identical to the normal export.
   */
  exportSections: (format: ExportFormat) => {
    hoopName: string;
    message: string;
    warnings: string[];
    files: { filename: string; bytes: Uint8Array; mime: string }[];
  };

  /**
   * Compile each machine's objects separately and encode one file per machine.
   * A machine with no visible objects is omitted rather than written empty.
   */
  exportByMachine: (format: ExportFormat) => {
    machines: number[];
    message: string;
    files: { machine: number; filename: string; bytes: Uint8Array; mime: string; objects: number }[];
  };

  /** Change cap-frame settings without touching geometry. */
  setCapWrap: (patch: Partial<CapWrapSettings>) => void;

  /**
   * Put a picture under the artwork as a tracing guide.
   *
   * Replaces any guide already present. It is centred unless `x`/`y` are
   * given, and it never becomes an object or reaches an encoder.
   */
  placeReferenceImage: (placement: ReferenceImagePlacement) => void;

  /** Move, resize or fade the existing guide. Does not affect the stitches. */
  updateReferenceImage: (patch: Partial<Omit<ReferenceImage, 'dataUrl' | 'name'>>) => void;

  /** Remove the tracing guide while leaving the sewn objects untouched. */
  removeReferenceImage: () => void;

  /** Assign every selected object to the same 1-based production machine. */
  assignMachineToSelected: (machine: number) => void;

  /** Give every selected object its own machine in selection order. */
  spreadMachinesAcrossSelected: () => void;

  /** Vector/raster/print artwork built from the same compiled sequence. */
  exportArtwork: (request: ArtworkRequest) => Promise<{
    filename: string;
    bytes: Uint8Array;
    mime: string;
  }>;

  /**
   * Render the compiled design as an animated stitch movie (GIF).
   *
   * Asynchronous because the work runs on a worker thread: the page keeps
   * painting while a large design renders.
   */
  exportMovie: (options?: StitchMovieOptions) => Promise<{
    filename: string;
    bytes: Uint8Array;
    mime: string;
  }>;

  /**
   * Trace a raster image into embroidery objects.
   *
   * The traced art replaces the current objects and palette (the undo stack
   * brings the previous design straight back) and is centred in the field.
   * Returns a summary rather than throwing, so the dialog can report exactly
   * what happened.
   */
  digitizeImage: (image: RasterImage, options?: DigitizeOptions) => DigitizeSummary;

  /**
   * Turn a photograph into a cell mosaic grouped by thread colour.
   *
   * Like `digitizeImage`, replacing is the default and the palette travels
   * with the objects; `mode: 'add'` appends the photo palette after the
   * existing threads and offsets every colour index to match.
   */
  photoStitch: (image: RasterImage, options?: PhotoStitchRequest) => PhotoStitchSummary;
}

/**
 * Traced regions at or below this sewn width become satin columns.
 *
 * 2.4 mm is the width where a tatami fill stops reading as a clean edge (two
 * or three rows at most) and a satin column becomes what a digitizer would
 * choose for lettering and thin line art.
 */
const DIGITIZE_SATIN_MAX_MM = 2.4;

/** Tracing options plus the stitch settings applied to the result. */
export interface DigitizeOptions extends AutoDigitizeOptions {
  /** Fill spacing for the traced objects, in mm. Default 0.4. */
  spacing?: number;
  /** Distance between penetrations along a fill row, in mm. Default 3. */
  stitchLength?: number;
  /** Replace the current design (default) or add the traced objects to it. */
  mode?: 'replace' | 'add';
  /**
   * Keep the source picture behind the result at the traced size, so the
   * imported image and the generated stitches line up exactly.
   */
  reference?: ReferenceImageAttachment;
}

export interface DigitizeSummary {
  objects: number;
  colors: number;
  droppedSmall: number;
  droppedThin: number;
  droppedBackground: boolean;
  widthMm: number;
  heightMm: number;
}

/** Photo planning options plus placement mode, mirrored from the dialog. */
export interface PhotoStitchRequest extends PhotoStitchOptions {
  mode?: 'replace' | 'add';
  /** Keep the source photo behind the mosaic at the same size and place. */
  reference?: ReferenceImageAttachment;
}

export interface PhotoStitchSummary {
  objects: number;
  colors: number;
  cells: number;
  skipped: number;
  widthMm: number;
  heightMm: number;
  cellMm: number;
}

/**
 * Shared export gate: an invalid design must never reach the encoder, and the
 * first error message is the most useful thing to show the user.
 *
 * `ignore` lets a caller tolerate a specific issue code. Multi-hoop export
 * uses it for OUT_OF_HOOP: a design being split is out of its current hoop by
 * definition, and refusing to split it for exactly the reason it needs
 * splitting would make the feature unreachable.
 */
function requireExportable(validation: ValidationResult, ignore: string[] = []): void {
  if (!validation.ok) {
    const first = validation.issues.find((i) => i.severity === 'error' && !ignore.includes(i.code));
    if (!first) return;
    throw new Error(first.message);
  }
}

/** Encode one independently valid machine file. Used by part and machine splits. */
function encodeStitches(
  format: ExportFormat,
  stitches: StitchSequence['stitches'],
  colorCount: number,
  name: string,
  threads: ThreadColor[],
): { filename: string; bytes: Uint8Array; mime: string } {
  switch (format) {
    case 'pes':
      return {
        filename: `${name}${PES_EXTENSION}`,
        bytes: writePes(stitches, { name, colorCount, threads }),
        mime: PES_MIME,
      };
    case 'exp':
      return {
        filename: `${name}${EXP_EXTENSION}`,
        bytes: writeExp(stitches),
        mime: EXP_MIME,
      };
    case 'jef':
      return {
        filename: `${name}${JEF_EXTENSION}`,
        bytes: writeJef(stitches, { threads }),
        mime: JEF_MIME,
      };
    case 'vp3':
      return {
        filename: `${name}${VP3_EXTENSION}`,
        bytes: writeVp3(stitches, threads),
        mime: VP3_MIME,
      };
    case 'tbf':
      return {
        filename: `${name}${TBF_EXTENSION}`,
        bytes: writeTbf(stitches, threads, name),
        mime: TBF_MIME,
      };
    case 'hus':
      return {
        filename: `${name}${HUS_EXTENSION}`,
        bytes: writeHus(stitches, threads, name),
        mime: HUS_MIME,
      };
    default:
      return {
        filename: `${name}${DST_EXTENSION}`,
        bytes: writeDst(stitches, { name, colorCount }),
        mime: DST_MIME,
      };
  }
}

/** Deep clone used for history snapshots: history must not alias live state. */
function cloneDesign(design: DesignState): DesignState {
  return {
    ...design,
    objects: design.objects.map((o) => ({
      ...o,
      path: { rings: o.path.rings.map((r) => r.map((p) => ({ ...p }))) },
      params: {
        ...o.params,
        underlay: { ...o.params.underlay },
        tieIn: { ...o.params.tieIn },
        tieOff: { ...o.params.tieOff },
      },
      transform: { ...o.transform },
      entryExit: {
        entry: o.entryExit.entry ? { ...o.entryExit.entry } : null,
        exit: o.entryExit.exit ? { ...o.entryExit.exit } : null,
      },
      warnings: [...o.warnings],
    })),
    threadPalette: design.threadPalette.map((c) => ({ ...c })),
    capWrap: { ...design.capWrap },
    referenceImage: design.referenceImage ? { ...design.referenceImage } : null,
  };
}

/** Build a guide record aligned with a generated design's bounding box. */
function referenceAt(
  attachment: ReferenceImageAttachment,
  x: number,
  y: number,
  width: number,
  height: number,
  defaultOpacity: number,
): ReferenceImage {
  return {
    dataUrl: attachment.dataUrl,
    name: attachment.name,
    x,
    y,
    width,
    height,
    opacity: clampNumber(attachment.opacity ?? defaultOpacity, 0, 1),
    visible: attachment.visible ?? true,
  };
}

function initialDesign(): DesignState {
  const blank = createEmptyDesign();
  return { projectId: null, version: 0, ...blank };
}

/**
 * How many undo steps to keep.
 *
 * Read at call time rather than captured when the module loads: the limit is
 * a preference that arrives from the server long after the store exists, and
 * a value closed over at import time would ignore every change made in
 * Preferences for the rest of the session.
 */
function historyLimit(): number {
  return referenceStore.getState().settings?.undoDepth ?? HISTORY_LIMIT;
}

export const useDesignStore = create<DesignStore>()((set, get) => {
  /**
   * Apply a mutation to the document, pushing the previous state onto the
   * undo stack and invalidating the derived compile cache.
   */
  function mutate(
    updater: (design: DesignState) => DesignState,
    options: { history?: boolean } = {},
  ): void {
    const state = get();
    const previous = state.design;
    const next = updater(previous);

    if (next === previous) return;

    const past =
      options.history === false
        ? state.past
        : [...state.past, { design: cloneDesign(previous), selection: [...state.selection] }].slice(
            -historyLimit(),
          );

    set({
      design: next,
      rev: state.rev + 1,
      // History-less updates (load, autosave bookkeeping) must not wipe the
      // redo stack - only a real edit makes future states unreachable.
      past,
      future: options.history === false ? state.future : [],
      dirty: true,
      compiled: null,
    });
  }

  function withHistory(entry: HistoryEntry): Pick<DesignStore, 'design' | 'selection'> {
    return { design: cloneDesign(entry.design), selection: [...entry.selection] };
  }

  return {
    design: initialDesign(),
    selection: [],
    tool: 'select',
    continuingId: null,
    pendingEntryExit: null,

    // Opt-in: the default cut is the exactly-adjacent one, so a design
    // exported without touching these splits exactly as it always did.
    sectionOverlap: 0,
    sectionMarks: false,
    optimizeColors: false,

    rev: 0,
    compiled: null,

    dirty: false,
    saving: false,
    lastError: null,

    past: [],
    future: [],

    // --- lifecycle ---------------------------------------------------------

    newDesign: (name) => {
      // Honour the preferred default hoop when one is set and still loaded.
      // Field size travels with the hoop: they are one choice, and letting
      // them disagree is what used to make a design look like it fitted while
      // validation rejected it.
      const state = referenceStore.getState();
      const hoop = state.hoops.find((h) => h.id === state.settings?.defaultHoopId);

      const blank = createEmptyDesign({
        ...(name ? { name } : {}),
        ...(hoop ? { hoopId: hoop.id, width: hoop.width, height: hoop.height } : {}),
      });
      set({
        design: { projectId: null, version: 0, ...blank },
        selection: [],
        tool: 'select',
        continuingId: null,
        pendingEntryExit: null,
        rev: get().rev + 1,
        compiled: null,
        dirty: false,
        lastError: null,
        past: [],
        future: [],
      });
    },

    loadDesign: (input) => {
      set({
        design: {
          projectId: input.projectId,
          name: input.name,
          version: input.version,
          units: input.units,
          width: input.width,
          height: input.height,
          hoopId: input.hoopId,
          objects: input.objects,
          threadPalette: input.threadPalette,
          capWrap: { ...DEFAULT_CAP_WRAP, ...(input.capWrap ?? {}) },
          referenceImage: input.referenceImage ? { ...input.referenceImage } : null,
        },
        selection: [],
        pendingEntryExit: null,
        continuingId: null,
        rev: get().rev + 1,
        compiled: null,
        dirty: false,
        lastError: null,
        past: [],
        future: [],
      });
    },

    // --- editing -----------------------------------------------------------

    addObject: (obj) => {
      mutate((d) => ({ ...d, objects: [...d.objects, obj] }));
      set({ selection: [obj.id] });
    },

    updateObject: (id, patch) => {
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      }));
    },

    updateParams: (id, patch) => {
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          o.id === id ? { ...o, params: { ...o.params, ...patch } } : o,
        ),
      }));
    },

    removeSelected: () => {
      const ids = new Set(get().selection);
      if (ids.size === 0) return;
      mutate((d) => ({ ...d, objects: d.objects.filter((o) => !ids.has(o.id)) }));
      set({ selection: [] });
    },

    duplicateSelected: () => {
      const state = get();
      const selected = state.design.objects.filter((o) => state.selection.includes(o.id));
      if (selected.length === 0) return;

      const maxOrder = state.design.objects.reduce((m, o) => Math.max(m, o.order), 0);
      // A duplicate must not stay welded to the original group, or moving the
      // copy would drag the original along. Copies of a group become their own
      // fresh group instead.
      const copyGroup = selected.some((o) => o.groupId) ? nextObjectId() : null;
      const copies = selected.map((o, i) => ({
        ...cloneObject(o),
        id: `${o.id}-copy-${Date.now().toString(36)}-${i}`,
        name: `${o.name} copy`,
        order: maxOrder + 1 + i,
        groupId: copyGroup,
      }));

      mutate((d) => ({ ...d, objects: [...d.objects, ...copies] }));
      set({ selection: copies.map((c) => c.id) });
    },

    moveSelected: (dx, dy, options) => {
      if (dx === 0 && dy === 0) return;
      const ids = new Set(get().selection);
      if (ids.size === 0) return;
      // A drag fires this per pointermove. With history on (the default for
      // a deliberate single nudge) every pixel would land on the undo stack,
      // so the canvas passes `history: false` during a drag and takes one
      // snapshot with `beginGesture` when the drag starts.
      mutate(
        (d) => ({
          ...d,
          objects: d.objects.map((o) => (ids.has(o.id) ? translateObject(o, dx, dy) : o)),
        }),
        { history: options?.history },
      );
    },

    // --- node editing ------------------------------------------------------

    beginGesture: () => {
      const state = get();
      set({
        past: [
          ...state.past,
          { design: cloneDesign(state.design), selection: [...state.selection] },
        ].slice(-historyLimit()),
        // A new edit makes every redo state unreachable.
        future: [],
      });
    },

    moveNode: (objectId, ring, index, x, y) => {
      mutate(
        (d) => ({
          ...d,
          objects: d.objects.map((o) => {
            if (o.id !== objectId) return o;
            const rings = o.path.rings;
            if (!rings[ring] || !rings[ring]![index]) return o;
            const next = rings.map((r, ri) =>
              ri === ring ? r.map((pt, pi) => (pi === index ? { x, y } : pt)) : r,
            );
            return { ...o, path: { ...o.path, rings: next } };
          }),
        }),
        // History-less by contract: the canvas takes one snapshot per drag.
        { history: false },
      );
    },

    insertNode: (objectId, ring, afterIndex, at) => {
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) => {
          if (o.id !== objectId) return o;
          const rings = o.path.rings;
          const target = rings[ring];
          if (!target) return o;
          // Insert after `afterIndex`; for a closed ring, after the last
          // point means before index 0, so the new node lands on the closing
          // segment rather than extending the ring past its own start.
          const insertAt = afterIndex + 1;
          const next = rings.map((r, ri) =>
            ri === ring ? [...r.slice(0, insertAt), { ...at }, ...r.slice(insertAt)] : r,
          );
          return { ...o, path: { ...o.path, rings: next } };
        }),
      }));
    },

    deleteNodes: (objectId, ring, indices) => {
      if (indices.length === 0) return;
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) => {
          if (o.id !== objectId) return o;
          const rings = o.path.rings;
          const target = rings[ring];
          if (!target) return o;
          const drop = new Set(indices);
          // A ring needs three points to enclose area; deleting past that
          // would produce a degenerate shape the engine rejects, so refuse
          // the whole deletion rather than leave a broken object behind.
          if (target.length - drop.size < 3) return o;
          const next = rings.map((r, ri) => (ri === ring ? r.filter((_, i) => !drop.has(i)) : r));
          return { ...o, path: { ...o.path, rings: next } };
        }),
      }));
    },

    replacePath: (objectId, rings) => {
      const first = rings[0];
      if (!first || first.length < 2) return;
      // Copy the points so the caller's draft array cannot keep mutating the
      // document after the commit.
      const copied = rings.map((ring) => ring.map((p) => ({ x: p.x, y: p.y })));
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          o.id === objectId ? { ...o, path: { ...o.path, rings: copied } } : o,
        ),
      }));
    },

    blendSelected: (options) => {
      const state = get();
      const chosen = state.design.objects.filter((o) => state.selection.includes(o.id));

      // Blending needs something to blend against. Saying so is more useful
      // than doing nothing, and doing nothing is more useful than thinning a
      // single fill that has no partner to mix with.
      if (chosen.length < 2) {
        return 'Select at least two overlapping fills to blend.';
      }

      // Run and satin cannot share coverage: a run is a single line and a
      // satin's spacing is the zig-zag across the column rather than rows
      // covering an area, so thinning one would not lighten anything.
      if (!canBlend(chosen.map((o) => o.params))) {
        return 'Blending needs area fills (tatami, motif, contour or spiral). Run and satin columns cannot share coverage, so they were left unchanged.';
      }

      const plan = planBlend(
        chosen.map((o) => ({ id: o.id, params: o.params })),
        { densityMultiplier: options?.densityMultiplier },
      );

      const byId = new Map(plan.adjustments.map((a) => [a.id, a]));

      // One undo step: thinning every fill and re-aiming their angles is a
      // single intent, not several unrelated edits the user must retrace one
      // at a time.
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) => {
          const adj = byId.get(o.id);
          if (!adj) return o;
          return {
            ...o,
            params: { ...o.params, angle: adj.angle, spacing: adj.spacing },
          };
        }),
      }));

      const percent = Math.round(plan.densityFraction * 100);
      return `Blended ${chosen.length} fills: each now covers about ${percent}% of the area at evenly spread angles, so the threads mix where they overlap.`;
    },

    // --- redwork -----------------------------------------------------------

    redworkSelected: (options) => {
      const state = get();
      if (state.selection.length === 0) {
        return 'Select one or more objects to sew as redwork.';
      }

      const chosen = state.design.objects.filter((o) => state.selection.includes(o.id));
      // Lettering has no path to outline, and a photo's rings are cells rather
      // than one drawing. Both are left exactly as they are and reported.
      const convertible = chosen.filter(
        (o) => o.type !== 'lettering' && o.path.rings.length > 0 && !o.params.photo?.enabled,
      );
      if (convertible.length === 0) {
        return 'The selection has no outline to sew as redwork; lettering and photo objects are left unchanged.';
      }

      const widthMm = Math.min(
        REDWORK_LIMITS.maxWidthMm,
        Math.max(
          REDWORK_LIMITS.minWidthMm,
          Number.isFinite(options.widthMm) ? options.widthMm : 1.2,
        ),
      );
      const stitchMm = Math.min(
        REDWORK_LIMITS.maxStitchMm,
        Math.max(
          REDWORK_LIMITS.minStitchMm,
          Number.isFinite(options.stitchMm) ? options.stitchMm : 2.5,
        ),
      );
      const color = /^#[0-9a-f]{6}$/i.test(options.color) ? options.color : '#C8102E';

      // One thread for the whole conversion, as redwork is one colour. Reuse
      // an exact palette match instead of piling up duplicates.
      const palette = [...state.design.threadPalette];
      let colorIndex = palette.findIndex((c) => c.hex.toLowerCase() === color.toLowerCase());
      if (colorIndex === -1) {
        palette.push({
          id: `redwork-${color.slice(1).toLowerCase()}`,
          code: 'RW',
          name: 'Redwork',
          hex: color,
        });
        colorIndex = palette.length - 1;
      }

      const ids = new Set(convertible.map((o) => o.id));
      const redwork = { enabled: true as const, style: options.style, widthMm, stitchMm };

      // Geometry, ids, order and every other parameter survive: this is a
      // reversible sewing mode, not a replacement object.
      mutate((d) => ({
        ...d,
        threadPalette: palette,
        objects: d.objects.map((o) =>
          ids.has(o.id) ? { ...o, colorIndex, params: { ...o.params, redwork } } : o,
        ),
      }));

      const skipped = chosen.length - convertible.length;
      return `Sewing ${convertible.length} object${convertible.length === 1 ? '' : 's'} as redwork${skipped > 0 ? ` (${skipped} left unchanged)` : ''}.`;
    },

    removeRedworkSelected: () => {
      const state = get();
      if (state.selection.length === 0) {
        return 'Select redwork objects to remove.';
      }

      const ids = new Set(state.selection);
      const hasRedwork = state.design.objects.some(
        (o) => ids.has(o.id) && o.params.redwork?.enabled === true,
      );
      if (!hasRedwork) {
        return 'The selection is not sewing as redwork.';
      }

      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          ids.has(o.id) && o.params.redwork?.enabled
            ? { ...o, params: { ...o.params, redwork: null } }
            : o,
        ),
      }));
      return 'Redwork removed; the objects sew with their normal settings again.';
    },

    // --- shaping -----------------------------------------------------------

    shapeSelected: (op) => {
      const state = get();
      const chosen = state.design.objects
        .filter((o) => state.selection.includes(o.id))
        .sort((a, b) => a.order - b.order);

      const verb = op === 'weld' ? 'weld' : op === 'combine' ? 'combine' : op;
      if (chosen.length < 2) return `Select at least two shapes to ${verb}.`;

      const paths = chosen.map((o) => o.path);
      let merged: CompoundPath;
      switch (op) {
        case 'weld':
          merged = combinePaths(paths, 'union');
          break;
        case 'combine':
          merged = combinePaths(paths, 'xor');
          break;
        case 'intersect':
          merged = combinePaths(paths, 'intersection');
          break;
        case 'subtract':
          merged = subtractPaths(paths[0]!, combinePaths(paths.slice(1), 'union'));
          break;
      }

      if (merged.rings.length === 0) {
        if (op === 'intersect')
          return 'The selected shapes do not overlap, so there is nothing in common.';
        if (op === 'subtract')
          return 'The first shape is completely covered, so subtracting leaves nothing.';
        return 'The shapes cancel out completely, so nothing is left to sew.';
      }

      const base = chosen[0]!;
      const ids = new Set(chosen.map((o) => o.id));
      const labels: Record<ShapeOp, string> = {
        weld: 'welded',
        combine: 'combined',
        subtract: 'cut',
        intersect: 'intersection',
      };
      const result: EmbroideryObject = {
        ...cloneObject(base),
        id: nextObjectId(),
        name: `${base.name} ${labels[op]}`,
        path: merged,
        // The merge is a new shape; it must not stay welded to a group that
        // may have contained only some of the inputs.
        groupId: null,
        warnings: [],
      };

      mutate((d) => ({
        ...d,
        objects: [...d.objects.filter((o) => !ids.has(o.id)), result],
      }));
      set({ selection: [result.id] });

      if (op === 'weld') return `Welded ${chosen.length} shapes into one outline.`;
      if (op === 'combine') return `Combined ${chosen.length} shapes: overlaps became holes.`;
      if (op === 'subtract') return `Cut ${chosen.length - 1} shapes out of ${base.name}.`;
      return `Kept only the area shared by ${chosen.length} shapes.`;
    },

    offsetSelected: (distance, options) => {
      const state = get();
      const chosen = state.design.objects.filter((o) => state.selection.includes(o.id));
      if (chosen.length === 0) return 'Select a shape to offset.';
      if (!Number.isFinite(distance) || Math.abs(distance) < 1e-6) {
        return 'Enter an offset distance in millimetres — positive grows the shape, negative shrinks it.';
      }

      // Offset Advanced: several concentric outlines in one action. Each copy
      // is offset from the *source*, not from the previous copy, so rounding
      // in one ring cannot accumulate into a visibly wrong third.
      const copies = Math.max(1, Math.min(50, Math.round(options?.copies ?? 1)));
      const created: EmbroideryObject[] = [];
      for (const o of chosen) {
        for (let step = 1; step <= copies; step++) {
          const moved = offsetPath(o.path, distance * step, options);
          if (moved.rings.length === 0) break;
          created.push({
            ...cloneObject(o),
            id: nextObjectId(),
            name:
              copies > 1
                ? `${o.name} offset ${step} (${distance > 0 ? '+' : ''}${distance * step} mm)`
                : `${o.name} offset ${distance > 0 ? '+' : ''}${distance} mm`,
            path: moved,
            groupId: null,
            warnings: [],
          });
        }
      }

      if (created.length === 0) {
        return 'Nothing is left at that distance — the offset is wider than the shape.';
      }

      const maxOrder = state.design.objects.reduce((m, o) => Math.max(m, o.order), 0);
      const placed = created.map((o, i) => ({ ...o, order: maxOrder + 1 + i }));
      mutate((d) => ({ ...d, objects: [...d.objects, ...placed] }));
      set({ selection: placed.map((o) => o.id) });

      const sign = distance > 0 ? '+' : '';
      return `Created ${placed.length} offset ${placed.length === 1 ? 'outline' : 'outlines'} at ${sign}${distance} mm.`;
    },

    borderSelected: (distance) => {
      const state = get();
      const chosen = state.design.objects.filter((o) => state.selection.includes(o.id));
      if (chosen.length === 0) return 'Select a shape to outline.';
      if (!Number.isFinite(distance) || distance === 0) {
        return 'Enter a border distance in millimetres.';
      }

      const created: EmbroideryObject[] = [];
      for (const o of chosen) {
        const outline = borderPath(o.path, distance);
        // One run object per ring. A run follows a single polyline, so a
        // frame's outer edge and its hole have to be two objects; merging them
        // into one path would make the needle travel across the work between
        // them.
        outline.rings.forEach((ring, index) => {
          if (ring.length < 3) return;
          created.push({
            ...cloneObject(o),
            id: nextObjectId(),
            name: `${o.name} border${outline.rings.length > 1 ? ` ${index + 1}` : ''}`,
            // A border is a line to sew around the shape, not an area to fill,
            // so it becomes a run even when the source was a fill.
            type: 'run',
            path: { rings: [ring] },
            params: defaultParams('run'),
            entryExit: { entry: null, exit: null },
            groupId: null,
            warnings: [],
          });
        });
      }

      if (created.length === 0) {
        return 'Nothing is left at that distance — the border is wider than the shape.';
      }

      const maxOrder = state.design.objects.reduce((m, o) => Math.max(m, o.order), 0);
      const placed = created.map((o, i) => ({ ...o, order: maxOrder + 1 + i }));
      mutate((d) => ({ ...d, objects: [...d.objects, ...placed] }));
      set({ selection: placed.map((o) => o.id) });

      return `Created ${placed.length} border ${placed.length === 1 ? 'outline' : 'outlines'} at ${distance} mm.`;
    },

    roundSelectedCorners: (radius) => {
      const state = get();
      const chosen = state.design.objects.filter(
        (o) => state.selection.includes(o.id) && o.path.rings.some((r) => r.length >= 3),
      );
      if (chosen.length === 0) return 'Select a shape with corners to round.';
      if (!Number.isFinite(radius) || radius <= 0) {
        return 'Enter a corner radius greater than zero.';
      }

      const ids = new Set(chosen.map((o) => o.id));
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          ids.has(o.id) ? { ...o, path: roundCorners(o.path, radius) } : o,
        ),
      }));

      return `Rounded the corners of ${chosen.length} ${chosen.length === 1 ? 'shape' : 'shapes'} at ${radius} mm.`;
    },

    centerAll: () => {
      const state = get();
      if (state.design.objects.length === 0) return;

      const bounds = boundsOfObjects(state.design.objects);
      const dx = state.design.width / 2 - (bounds.minX + bounds.maxX) / 2;
      const dy = state.design.height / 2 - (bounds.minY + bounds.maxY) / 2;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;

      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) => translateObject(o, dx, dy)),
      }));
    },

    bringForward: (id) => {
      const state = get();
      const maxOrder = state.design.objects.reduce((m, o) => Math.max(m, o.order), 0);
      state.setOrder(id, maxOrder + 1);
    },

    sendBackward: (id) => {
      const state = get();
      const minOrder = state.design.objects.reduce((m, o) => Math.min(m, o.order), 0);
      state.setOrder(id, minOrder - 1);
    },

    setOrder: (id, order) => {
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) => (o.id === id ? { ...o, order } : o)),
      }));
    },

    // --- transform (baked into path geometry) -------------------------------
    //
    // The engine never applies `transform` at stitch time, so a flip/scale/
    // rotation only becomes real when it is written into the coordinates -
    // exactly how auto-hooping already bakes its rotation. That keeps the
    // outline you edit, the preview you see and the file the machine sews
    // three views of one truth instead of three that can drift apart.

    flipSelected: (axis) => {
      mutate((d) => {
        const ids = new Set(get().selection);
        if (ids.size === 0) return d;
        return {
          ...d,
          objects: d.objects.map((o) => {
            if (!ids.has(o.id)) return o;
            // Text geometry is generated from its spec, so a flip toggles a
            // mirror on the spec instead of rewriting coordinates that do not
            // exist on the object.
            if (o.type === 'lettering' && o.lettering) {
              const mirror = o.lettering.mirror ?? { x: false, y: false };
              const next = axis === 'x' ? { ...mirror, x: !mirror.x } : { ...mirror, y: !mirror.y };
              return { ...o, lettering: { ...o.lettering, mirror: next } };
            }
            const c = objectCenter(o);
            const rings =
              axis === 'x'
                ? o.path.rings.map((ring) => ring.map((p) => ({ x: 2 * c.x - p.x, y: p.y })))
                : o.path.rings.map((ring) => ring.map((p) => ({ x: p.x, y: 2 * c.y - p.y })));
            return { ...o, path: { ...o.path, rings } };
          }),
        };
      });
    },

    scaleSelected: (sx, sy) => {
      mutate((d) => {
        const ids = new Set(get().selection);
        if (ids.size === 0 || !(sx > 0) || !(sy > 0)) return d;
        return {
          ...d,
          objects: d.objects.map((o) => {
            if (!ids.has(o.id)) return o;
            // Text scales through its spec: vertical scale is the cap height,
            // horizontal scale becomes the width factor, because the glyph
            // shapes themselves only scale with the height.
            if (o.type === 'lettering' && o.lettering) {
              return {
                ...o,
                lettering: {
                  ...o.lettering,
                  height: clampNumber(o.lettering.height * sy, 1, 300),
                  stretch: clampNumber((o.lettering.stretch ?? 1) * sx, 0.25, 4),
                },
              };
            }
            const c = objectCenter(o);
            const rings = o.path.rings.map((ring) =>
              ring.map((p) => ({ x: c.x + (p.x - c.x) * sx, y: c.y + (p.y - c.y) * sy })),
            );
            return { ...o, path: { ...o.path, rings } };
          }),
        };
      });
    },

    rotateSelected: (angleDegrees) => {
      mutate((d) => {
        const ids = new Set(get().selection);
        if (ids.size === 0 || angleDegrees === 0) return d;
        return {
          ...d,
          objects: d.objects.map((o) => {
            if (!ids.has(o.id)) return o;
            // Text rotates through its own rotation, which the engine applies
            // to the finished layout.
            if (o.type === 'lettering' && o.lettering) {
              return {
                ...o,
                lettering: {
                  ...o.lettering,
                  rotation: normalizeRotation(o.lettering.rotation + angleDegrees),
                },
              };
            }
            const c = objectCenter(o);
            return rotateObject(o, angleDegrees, c);
          }),
        };
      });
    },

    // --- grouping -----------------------------------------------------------
    //
    // groupId is not decoration: click-to-select in the canvas expands to the
    // whole group, so a stitched emblem moves and edits as one piece.

    groupSelected: () => {
      mutate((d) => {
        const ids = new Set(get().selection);
        if (ids.size < 2) return d;
        const groupId = nextObjectId();
        return { ...d, objects: d.objects.map((o) => (ids.has(o.id) ? { ...o, groupId } : o)) };
      });
    },

    ungroupSelected: () => {
      mutate((d) => {
        const ids = new Set(get().selection);
        if (ids.size === 0) return d;
        return {
          ...d,
          objects: d.objects.map((o) => (ids.has(o.id) ? { ...o, groupId: null } : o)),
        };
      });
    },

    // --- entry / exit placement -------------------------------------------

    armEntryExit: (which) => {
      // Nothing to place onto: the point would be written nowhere and the
      // armed state would look like it worked.
      if (get().selection.length === 0) return;
      set({ pendingEntryExit: which });
    },

    cancelEntryExit: () => set({ pendingEntryExit: null }),

    placeEntryExit: (point) => {
      const which = get().pendingEntryExit;
      if (which === null) return;

      const ids = new Set(get().selection);
      if (ids.size === 0) {
        set({ pendingEntryExit: null });
        return;
      }

      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          ids.has(o.id) ? { ...o, entryExit: { ...o.entryExit, [which]: point } } : o,
        ),
      }));
      set({ pendingEntryExit: null });
    },

    // --- multi-hoop export preferences -------------------------------------

    setSectionOverlap: (mm) => {
      // NaN arrives from an empty number box; anything else out of range is
      // a value the engine would have clamped anyway, so the store clamps it
      // instead and the panel shows the number that will actually be used.
      const value = Number.isFinite(mm) ? mm : 0;
      set({ sectionOverlap: Math.min(100, Math.max(0, value)) });
    },

    setSectionMarks: (on) => set({ sectionMarks: on }),

    // --- sequencing ---------------------------------------------------------

    setOptimizeColors: (on) => {
      // Anything that changes the sequence must drop the cache, otherwise the
      // canvas and the export would keep the old stitch order until an
      // unrelated edit invalidated it.
      set({ optimizeColors: on, compiled: null });
    },

    autoSequence: (options) => {
      const before = get().design;
      if (before.objects.length <= 1) return 0;

      const ordered = optimizeObjectOrder(before.objects, options);
      const moved = ordered.filter((o, i) => before.objects[i]?.id !== o.id).length;
      if (moved === 0) return 0;

      mutate((d) => ({ ...d, objects: ordered }));
      return moved;
    },

    // --- palette -----------------------------------------------------------

    addColor: (color) => {
      mutate((d) => ({ ...d, threadPalette: [...d.threadPalette, color] }));
    },

    updateColor: (id, patch) => {
      mutate((d) => ({
        ...d,
        threadPalette: d.threadPalette.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },

    removeColor: (id) => {
      const current = get().design.threadPalette;

      // The UI disables the button at one colour, but the store is the real
      // guard: an empty palette leaves every object with nowhere to point, and
      // "no colour" is not a state the engine or a machine file can express.
      if (current.length <= 1) return;

      const next = current.filter((c) => c.id !== id);
      // Deleting an id that is not in the palette should not invalidate history.
      if (next.length === current.length) return;

      mutate((d) => ({
        ...d,
        threadPalette: next,
        // Measured against the *new* length: an object that pointed at the
        // removed colour (or past the end) would otherwise render black and
        // export an out-of-range colour index.
        objects: d.objects.map((o) => (o.colorIndex >= next.length ? { ...o, colorIndex: 0 } : o)),
      }));
    },

    setPalette: (colors) => {
      mutate((d) => ({
        ...d,
        threadPalette: colors,
        objects: d.objects.map((o) =>
          o.colorIndex >= colors.length ? { ...o, colorIndex: Math.max(0, colors.length - 1) } : o,
        ),
      }));
    },

    // --- canvas ------------------------------------------------------------

    setSize: (width, height, hoopId) => {
      mutate((d) => ({ ...d, width, height, hoopId }));
    },

    setSelection: (ids) => {
      // Filter against live objects: a stale id would leave the parameter
      // panel editing a document that no longer exists.
      const known = new Set(get().design.objects.map((o) => o.id));
      const selection = ids.filter((id) => known.has(id));
      // An armed entry/exit placement writes to the selection. Emptying it
      // would leave the state armed with nowhere to land, so disarm here
      // rather than letting the next click silently do nothing.
      set({ selection, pendingEntryExit: selection.length === 0 ? null : get().pendingEntryExit });
    },

    toggleSelection: (id) => {
      const current = get().selection;
      const selection = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      set({ selection, pendingEntryExit: selection.length === 0 ? null : get().pendingEntryExit });
    },

    clearSelection: () => set({ selection: [], pendingEntryExit: null }),

    // Selection follows the tool, with one exception: Node Edit needs a
    // selected object to show its nodes, so switching into it keeps the
    // current selection instead of wiping it.
    setTool: (tool) =>
      set({
        tool,
        // Any tool change is also a decision to stop resuming the old object;
        // otherwise the next Enter would quietly overwrite it.
        continuingId: null,
        selection: tool === 'select' || tool === 'nodeEdit' ? get().selection : [],
        // Point placement belongs to the select tool; picking anything else
        // cancels it so a later click cannot drop a stale entry point.
        pendingEntryExit: tool === 'select' ? get().pendingEntryExit : null,
      }),

    beginContinueDigitizing: () => {
      const state = get();
      if (state.selection.length !== 1) return false;
      const object = state.design.objects.find((o) => o.id === state.selection[0]);
      if (!object || object.path.rings.length === 0) return false;
      const ring = object.path.rings[0];
      if (!ring || ring.length < 2) return false;
      // Lettering is generated from its text spec, not from its path, so there
      // is no outline to resume.
      if (object.type === 'lettering') return false;

      const tool: Tool =
        object.type === 'run' ? 'run' : object.type === 'bean' ? 'bean' : 'complexFill';
      // Deliberately not `setTool`: that clears the selection and the very
      // object we are about to resume.
      set({ tool, continuingId: object.id, pendingEntryExit: null });
      return true;
    },

    cancelContinueDigitizing: () => set({ continuingId: null, tool: 'select' }),

    // --- history -----------------------------------------------------------

    undo: () => {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (!previous) return;

      set({
        ...withHistory(previous),
        past: state.past.slice(0, -1),
        future: [
          { design: cloneDesign(state.design), selection: [...state.selection] },
          ...state.future,
        ].slice(0, historyLimit()),
        rev: state.rev + 1,
        compiled: null,
        dirty: true,
      });
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) return;

      set({
        ...withHistory(next),
        past: [
          ...state.past,
          { design: cloneDesign(state.design), selection: [...state.selection] },
        ].slice(-historyLimit()),
        future: state.future.slice(1),
        rev: state.rev + 1,
        compiled: null,
        dirty: true,
      });
    },

    trimHistory: (depth) => {
      const limit = Number.isFinite(depth) && depth >= 1 ? Math.floor(depth) : HISTORY_LIMIT;
      const state = get();
      // Writing the arrays directly rather than through `mutate`: dropping
      // history is not an edit to the design, so it must not bump `rev` or
      // mark the document dirty - which would make autosave fire off a
      // preference change alone.
      set({
        past: state.past.slice(-limit),
        future: state.future.slice(0, limit),
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    // --- derived -----------------------------------------------------------

    getCompiled: () => {
      const state = get();
      if (state.compiled) return state.compiled;

      const hoop = resolveHoop(state.design.hoopId);
      const result = compileDesign(state.design.objects, state.design.threadPalette, hoop, {
        optimizeColors: state.optimizeColors,
        capWrap: {
          ...state.design.capWrap,
          centerX: hoop ? hoop.width / 2 : state.design.width / 2,
        },
      });

      // Cache at the *current* revision: if the document changed while
      // compiling (it cannot today, compile is synchronous), the cache would
      // simply be recomputed next time rather than serving stale stitches.
      set({ compiled: result, rev: state.rev });
      return result;
    },

    isDirty: () => get().dirty,

    markSaved: (projectId, version) => {
      set({ design: { ...get().design, projectId, version }, dirty: false, lastError: null });
    },

    setError: (message) => set({ lastError: message }),

    autoHoop: (options) => {
      const { allowRotation = true, center = true } = options ?? {};
      const state = get();
      const library = referenceStore.getState().hoops;

      if (library.length === 0) {
        return 'No hoop presets are loaded, so there is nothing to choose from. Run "npm run seed" to add the standard frames.';
      }

      // Measure the stitches that will actually sew.
      //
      // Object outlines cannot be trusted here: a lettering object carries an
      // empty path by design, so `boundsOfObjects` reports no extent for it
      // and auto-hooping would size the frame around a word it never measured.
      // The compiled sequence is the truth of what reaches the fabric.
      const { sequence } = state.getCompiled();
      if (sequence.stitches.length === 0) {
        return 'This design has no stitches yet, so there is nothing to hoop.';
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const s of sequence.stitches) {
        if (s.x < minX) minX = s.x;
        if (s.x > maxX) maxX = s.x;
        if (s.y < minY) minY = s.y;
        if (s.y > maxY) maxY = s.y;
      }

      const need = { width: maxX - minX, height: maxY - minY };
      const fit = pickHoop(need, library, { allowRotation });

      if (!fit) {
        return `The design measures ${need.width.toFixed(1)} x ${need.height.toFixed(1)} mm, which is larger than every hoop in the library. Use a bigger frame, or split the design.`;
      }

      const hoop = fit.hoop;
      const stitchCentre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

      // Everything below lands in ONE history entry.
      //
      // Hoop choice, a quarter turn and recentring are a single intent - the
      // user asked for "hoop this", not three unrelated edits. Applying them
      // as separate mutations would stack three undo steps, so a single undo
      // would leave the design centred in the *old* hoop, which is worse than
      // not offering undo at all.
      let objects = get().design.objects;

      if (fit.rotated) {
        objects = objects.map((o) => (o.hidden ? o : rotateObject(o, 90, stitchCentre)));
      }

      if (center) {
        // Where the design sits now - after any turn. Lettering carries no
        // path, so outline bounds can come back empty even with stitches
        // present; the stitch bounds measured above are the fallback.
        const placed = boundsOfObjects(objects);
        const current =
          Number.isFinite(placed.minX) && Number.isFinite(placed.maxX)
            ? boundsMidpoint(placed)
            : stitchCentre;

        // Centre on the *usable* field - the area left after the safe margin.
        // Centring on the nominal hoop would push part of the work into the
        // margin the machine will not stitch into.
        const fieldW = hoop.width - hoop.safeMargin * 2;
        const fieldH = hoop.height - hoop.safeMargin * 2;
        const target = {
          x: hoop.safeMargin + fieldW / 2,
          y: hoop.safeMargin + fieldH / 2,
        };

        const dx = target.x - current.x;
        const dy = target.y - current.y;
        if (dx !== 0 || dy !== 0) {
          objects = objects.map((o) => (o.hidden ? o : translateObject(o, dx, dy)));
        }
      }

      mutate((d) => ({
        ...d,
        hoopId: hoop.id,
        width: hoop.width,
        height: hoop.height,
        objects,
      }));

      const size = `${hoop.width} x ${hoop.height} mm`;
      const turned = fit.rotated ? ', turned 90 degrees to fit' : '';
      return `Hoop set to ${size} (${hoop.name})${turned}.`;
    },

    exportDst: () => {
      const { sequence, validation } = get().getCompiled();
      requireExportable(validation);

      const name = sanitizeFilename(get().design.name);
      const bytes = writeDst(sequence.stitches, {
        name,
        colorCount: Math.max(1, sequence.colorCount),
      });

      // The MIME type travels with the bytes so the caller does not have to
      // restate it (and cannot get it out of step with the exporter).
      return { filename: `${name}${DST_EXTENSION}`, bytes, mime: DST_MIME };
    },

    exportPes: () => {
      const { sequence, validation } = get().getCompiled();
      requireExportable(validation);

      const name = sanitizeFilename(get().design.name);
      const bytes = writePes(sequence.stitches, {
        name,
        colorCount: Math.max(1, sequence.colorCount),
        // The palette is what the PEC header colour-matches against, so the
        // exported file suggests the same threads the design was drawn with.
        threads: get().design.threadPalette,
      });

      return { filename: `${name}${PES_EXTENSION}`, bytes, mime: PES_MIME };
    },

    exportExp: () => {
      const { sequence, validation } = get().getCompiled();
      requireExportable(validation);

      const name = sanitizeFilename(get().design.name);
      const bytes = writeExp(sequence.stitches);

      return { filename: `${name}${EXP_EXTENSION}`, bytes, mime: EXP_MIME };
    },

    exportJef: () => {
      const { sequence, validation } = get().getCompiled();
      requireExportable(validation);

      const name = sanitizeFilename(get().design.name);
      const bytes = writeJef(sequence.stitches, {
        // The Janome colour library is filled from the palette the design
        // was drawn with, so the file opens showing the same threads.
        threads: get().design.threadPalette,
      });

      return { filename: `${name}${JEF_EXTENSION}`, bytes, mime: JEF_MIME };
    },

    exportVp3: () => {
      const { sequence, validation } = get().getCompiled();
      requireExportable(validation);

      const name = sanitizeFilename(get().design.name);
      // VP3 carries each thread's colour, name and number, so the design's
      // own palette travels with it and the machine shows the same spools.
      const bytes = writeVp3(sequence.stitches, get().design.threadPalette);

      return { filename: `${name}${VP3_EXTENSION}`, bytes, mime: VP3_MIME };
    },

    exportTbf: () => {
      const { sequence, validation } = get().getCompiled();
      requireExportable(validation);

      const name = sanitizeFilename(get().design.name);
      // TBF names the design in a 16-character label, so the full name is
      // handed over and the encoder takes what the field will hold.
      const bytes = writeTbf(sequence.stitches, get().design.threadPalette, get().design.name);

      return { filename: `${name}${TBF_EXTENSION}`, bytes, mime: TBF_MIME };
    },

    exportHus: () => {
      const { sequence, validation } = get().getCompiled();
      requireExportable(validation);

      const name = sanitizeFilename(get().design.name);
      // HUS names threads from the machine's own library rather than storing
      // their colours, so the design's palette is matched to the nearest
      // spool the machine can name.
      const bytes = writeHus(sequence.stitches, get().design.threadPalette, get().design.name);

      return { filename: `${name}${HUS_EXTENSION}`, bytes, mime: HUS_MIME };
    },

    exportSections: (format) => {
      const { sequence, validation } = get().getCompiled();
      // OUT_OF_HOOP is the whole reason to split, so it is tolerated here;
      // every other error still blocks the export.
      requireExportable(validation, ['OUT_OF_HOOP']);

      const library = referenceStore.getState().hoops;
      const { sectionOverlap, sectionMarks } = get();
      const split = splitIntoHoops(sequence, library, {
        overlap: sectionOverlap,
        registrationMarks: sectionMarks,
      });

      const base = sanitizeFilename(get().design.name);
      const threads = get().design.threadPalette;
      const files = split.sections.map((section) => {
        // Number every part, even a lone one: when the design does need
        // splitting the operator is juggling several files and "part2 of 3"
        // is the difference between sewing the right section and the wrong.
        const partName = `${base}-part${section.index}of${split.sections.length}`;
        const { stitches, colorCount } = section;
        return encodeStitches(format, stitches, colorCount, partName, threads);
      });

      return {
        hoopName: split.hoop.name,
        message: split.message,
        warnings: split.warnings,
        files,
      };
    },

    exportByMachine: (format) => {
      const state = get();
      const hoop = resolveHoop(state.design.hoopId);
      const visible = state.design.objects.filter((o) => !o.hidden);
      const groups = splitObjectsByMachine(visible);
      if (groups.size === 0) throw new Error('There are no visible objects to export.');

      const base = sanitizeFilename(state.design.name);
      const threads = state.design.threadPalette;
      const capWrap = {
        ...state.design.capWrap,
        centerX: hoop ? hoop.width / 2 : state.design.width / 2,
      };
      const machines: number[] = [];
      const files = [] as ReturnType<NonNullable<DesignStore['exportByMachine']>>['files'];

      for (const [machine, objects] of groups) {
        const { sequence, validation } = compileDesign(objects, threads, hoop, {
          optimizeColors: state.optimizeColors,
          capWrap,
        });
        try {
          requireExportable(validation);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          throw new Error(`Machine ${machine} cannot be exported: ${reason}`, { cause: err });
        }
        const name = `${base}-machine${machine}`;
        const file = encodeStitches(format, sequence.stitches, sequence.colorCount, name, threads);
        machines.push(machine);
        files.push({ machine, ...file, objects: objects.length });
      }

      return {
        machines,
        message:
          files.length === 1
            ? `All visible objects are assigned to machine ${machines[0]}, so one file was written.`
            : `${files.length} machine files written (${machines.join(', ')}).`,
        files,
      };
    },

    setCapWrap: (patch) => {
      mutate((d) => ({ ...d, capWrap: { ...d.capWrap, ...patch } }));
    },

    placeReferenceImage: (placement) => {
      const width = Math.max(1, placement.width);
      const height = Math.max(1, placement.height);
      mutate((d) => ({
        ...d,
        referenceImage: {
          dataUrl: placement.dataUrl,
          name: placement.name,
          x: placement.x ?? Math.max(0, (d.width - width) / 2),
          y: placement.y ?? Math.max(0, (d.height - height) / 2),
          width,
          height,
          opacity: clampNumber(placement.opacity ?? 0.85, 0, 1),
          visible: placement.visible ?? true,
        },
      }));
    },

    updateReferenceImage: (patch) => {
      if (!get().design.referenceImage) return;
      // Guides are reference material, not sewn geometry. Dragging an opacity
      // slider should not fill the undo stack with one step per pixel; placing
      // and removing the guide remain undoable.
      mutate(
        (d) => {
          if (!d.referenceImage) return d;
          const next = { ...d.referenceImage, ...patch };
          return {
            ...d,
            referenceImage: {
              ...next,
              width: Math.max(1, next.width),
              height: Math.max(1, next.height),
              opacity: clampNumber(next.opacity, 0, 1),
            },
          };
        },
        { history: false },
      );
    },

    removeReferenceImage: () => {
      mutate((d) => (d.referenceImage === null ? d : { ...d, referenceImage: null }));
    },

    assignMachineToSelected: (machine) => {
      const selected = new Set(get().selection);
      if (selected.size === 0) return;
      const value = Number.isFinite(machine)
        ? Math.min(64, Math.max(1, Math.round(machine)))
        : 1;
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) => (selected.has(o.id) ? { ...o, machine: value } : o)),
      }));
    },

    spreadMachinesAcrossSelected: () => {
      const selected = new Set(get().selection);
      if (selected.size < 2) return;
      const chosen = get().design.objects.filter((o) => selected.has(o.id));
      const assigned = spreadAcrossMachines(chosen);
      const byId = new Map(assigned.map((o) => [o.id, o.machine ?? 1]));
      mutate((d) => ({
        ...d,
        objects: d.objects.map((o) => (byId.has(o.id) ? { ...o, machine: byId.get(o.id) } : o)),
      }));
    },

    exportArtwork: async (request) => {
      const state = get();
      const { sequence, validation } = state.getCompiled();
      requireExportable(validation);
      const hoop = resolveHoop(state.design.hoopId);
      const name = sanitizeFilename(state.design.name);
      const palette = state.design.threadPalette;
      const stitches = sequence.stitches;

      switch (request.format) {
        case 'svg': {
          const svg = designToSvg({
            stitches,
            palette,
            title: state.design.name,
            hoop,
            includeHoop: request.includeHoop ?? true,
            background: request.background ?? null,
          });
          return {
            filename: `${name}.svg`,
            bytes: new TextEncoder().encode(svg),
            mime: 'image/svg+xml',
          };
        }
        case 'png': {
          const bytes = await artworkPng({
            stitches,
            palette,
            hoop,
            title: state.design.name,
            widthMm: request.widthMm ?? 200,
            dpi: request.dpi ?? 200,
            background: request.background ?? '#ffffff',
            includeHoop: request.includeHoop ?? false,
          });
          return { filename: `${name}.png`, bytes, mime: 'image/png' };
        }
        case 'print': {
          const { bytes } = buildPrintSheet({
            stitches,
            palette,
            title: state.design.name,
            hoop,
            paper: request.paper ?? 'a4',
            landscape: request.landscape ?? false,
            scale: request.scale === 'fit' ? 'fit' : '1:1',
            includeLegend: request.includeLegend ?? true,
            includeHoop: request.includeHoop ?? true,
          });
          return { filename: `${name}-print.pdf`, bytes, mime: 'application/pdf' };
        }
        default: {
          const bytes = designToPdf({
            stitches,
            palette,
            title: state.design.name,
            hoop,
            paper: request.paper ?? 'a4',
            landscape: request.landscape ?? false,
            scale: request.scale === '1:1' ? 1 : 'fit',
            includeHoop: request.includeHoop ?? true,
          });
          return { filename: `${name}-art.pdf`, bytes, mime: 'application/pdf' };
        }
      }
    },

    exportMovie: async (options = {}) => {
      const { sequence, validation } = get().getCompiled();
      requireExportable(validation);

      const name = sanitizeFilename(get().design.name);
      // Rendering happens on a worker thread, so the editor keeps painting
      // while a large design is drawn frame by frame.
      const movie = await encodeGif(sequence.stitches, {
        // The real thread colours travel with the render, so the movie matches
        // what the design will actually sew.
        threads: get().design.threadPalette,
        ...options,
      });

      return { filename: `${name}-stitch${GIF_EXTENSION}`, bytes: movie.bytes, mime: GIF_MIME };
    },

    digitizeImage: (image, options = {}) => {
      const result = autoDigitize(image, options);
      const summary: DigitizeSummary = {
        objects: result.regions.length,
        colors: result.palette.length,
        droppedSmall: result.droppedSmall,
        droppedThin: result.droppedThin,
        droppedBackground: result.droppedBackground,
        widthMm: result.widthMm,
        heightMm: result.heightMm,
      };
      if (result.regions.length === 0) return summary;

      const spacing = Math.max(0.1, options.spacing ?? DEFAULT_SPACING);
      const stitchLength = Math.max(0.5, options.stitchLength ?? DEFAULT_STITCH_LENGTH);

      mutate((d) => {
        // Centre the traced art in the field so it lands inside the hoop
        // instead of hanging off the origin. The guide uses the same box, so
        // the picture and the generated stitches line up exactly.
        const offsetX = Math.max(0, (d.width - result.widthMm) / 2);
        const offsetY = Math.max(0, (d.height - result.heightMm) / 2);

        const objects = result.regions.map((region, index) => {
          const rings = region.rings.map((ring) =>
            ring.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })),
          );
          // Traced regions are new fills too, so they honour the "default
          // stitch type" preference the same way a shape drawn by hand does.
          const preferred = referenceStore.getState().settings?.defaultStitchType;
          // A traced ribbon thinner than a satin column reads wrong as a fill:
          // lettering, outlines and thin details are what make a traced logo
          // look like its picture, and satin across their width is how a
          // digitizer sews them. The outline itself is the column boundary.
          if (region.thicknessMm <= DIGITIZE_SATIN_MAX_MM) {
            const base = createObject('column', rings, region.colorIndex, index);
            return {
              ...base,
              params: { ...base.params, spacing, stitchLength },
            };
          }
          const base = createObject('fill', rings, region.colorIndex, index, preferred);
          return {
            ...base,
            params: { ...base.params, angle: region.angleDeg, spacing, stitchLength },
          };
        });

        const referenceImage = options.reference
          ? referenceAt(
              options.reference,
              offsetX,
              offsetY,
              result.widthMm,
              result.heightMm,
              0.28,
            )
          : options.mode === 'add'
            ? d.referenceImage
            : null;

        if (options.mode === 'add') {
          return { ...d, objects: [...d.objects, ...objects], referenceImage };
        }
        // Replacing means the palette has to travel with the objects, or every
        // colourIndex would point at somebody else's thread.
        return {
          ...d,
          objects,
          threadPalette: result.palette.map((c) => ({ ...c })),
          referenceImage,
        };
      });

      set({ selection: [] });
      return summary;
    },
    photoStitch: (image, options = {}) => {
      const plan = planPhotoStitch(image, options);
      const summary: PhotoStitchSummary = {
        objects: plan.groups.length,
        colors: plan.palette.length,
        cells: plan.cells,
        skipped: plan.skipped,
        widthMm: plan.widthMm,
        heightMm: plan.heightMm,
        cellMm: plan.cellMm,
      };
      if (plan.groups.length === 0) return summary;

      const spacing = Math.min(2, Math.max(0.2, plan.spacing));
      const add = options.mode === 'add';

      mutate((d) => {
        const offsetX = Math.max(0, (d.width - plan.widthMm) / 2);
        const offsetY = Math.max(0, (d.height - plan.heightMm) / 2);
        const baseIndex = add ? d.threadPalette.length : 0;
        const baseOrder = add ? d.objects.length : 0;

        const objects = plan.groups.map((group, index) => {
          const rings = group.rings.map((ring) =>
            ring.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })),
          );
          const base = createObject(
            'fill',
            rings,
            group.colorIndex + baseIndex,
            baseOrder + index,
            'tatami',
          );
          return {
            ...base,
            name: `Photo ${group.colorIndex + 1}`,
            params: {
              ...base.params,
              angle: plan.angle,
              spacing,
              photo: { enabled: true, style: plan.style, spacing },
            },
          };
        });

        const palette = plan.palette.map((colour, index) => ({
          ...colour,
          id: `photo-${baseIndex + index + 1}`,
          code: `PHOTO${baseIndex + index + 1}`,
        }));

        const referenceImage = options.reference
          ? referenceAt(options.reference, offsetX, offsetY, plan.widthMm, plan.heightMm, 0.28)
          : add
            ? d.referenceImage
            : null;

        return {
          ...d,
          objects: add ? [...d.objects, ...objects] : objects,
          threadPalette: add ? [...d.threadPalette, ...palette] : palette,
          referenceImage,
        };
      });

      set({ selection: [] });
      return summary;
    },
  };
});

/** Keep a number inside a range; non-finite input falls back to the bottom. */
function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Wrap an angle into (-180, 180], the range the lettering UI edits. */
function normalizeRotation(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

function cloneObject(o: EmbroideryObject): EmbroideryObject {
  return {
    ...o,
    path: { rings: o.path.rings.map((r) => r.map((p) => ({ ...p }))) },
    params: {
      ...o.params,
      underlay: { ...o.params.underlay },
      tieIn: { ...o.params.tieIn },
      tieOff: { ...o.params.tieOff },
      ...(o.params.applique ? { applique: { ...o.params.applique } } : {}),
      ...(o.params.photo ? { photo: { ...o.params.photo } } : {}),
      ...(o.params.foam ? { foam: { ...o.params.foam } } : {}),
      ...(o.params.carve ? { carve: { ...o.params.carve } } : {}),
      ...(o.params.motif ? { motif: { ...o.params.motif } } : {}),
      ...(o.params.separatePullCompensation
        ? { separatePullCompensation: { ...o.params.separatePullCompensation } }
        : {}),
      ...(o.params.redwork ? { redwork: { ...o.params.redwork } } : {}),
    },
    transform: { ...o.transform },
    entryExit: {
      entry: o.entryExit.entry ? { ...o.entryExit.entry } : null,
      exit: o.entryExit.exit ? { ...o.entryExit.exit } : null,
    },
    // The nested path points and layout objects are copied too: history
    // snapshots and duplicates must not share a path array with the object
    // they came from, or a later edit would rewrite an undo step.
    ...(o.lettering
      ? {
          lettering: {
            ...o.lettering,
            ...(o.lettering.onPath
              ? {
                  onPath: {
                    ...o.lettering.onPath,
                    points: o.lettering.onPath.points.map((p) => ({ ...p })),
                  },
                }
              : {}),
            ...(o.lettering.monogram ? { monogram: { ...o.lettering.monogram } } : {}),
            ...(o.lettering.drop ? { drop: { ...o.lettering.drop } } : {}),
            ...(o.lettering.mirror ? { mirror: { ...o.lettering.mirror } } : {}),
          },
        }
      : { lettering: null }),
    warnings: [...o.warnings],
  };
}

/** Look up the active hoop, falling back to a bounds-derived hoop. */
export function resolveHoop(hoopId: string | null): Hoop | null {
  const known = referenceStore.getState().hoops;
  const found = hoopId ? known.find((h) => h.id === hoopId) : undefined;
  if (found) return found;
  if (!hoopId) return null;
  // Unknown hoop id (deleted preset): treat as no hoop rather than failing
  // validation on a frame the user cannot select.
  return null;
}

/** DST header fields are ASCII and 16 characters; keep the name usable. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned.length > 0 ? cleaned : 'design').slice(0, 60);
}

/** Bounds of every visible object, for zoom-to-fit. */
export function designBounds(store: { design: DesignState }) {
  return boundsOfObjects(store.design.objects);
}
