/**
 * Multi-hoop splitting.
 *
 * A design that is wider or taller than every hoop in the library cannot be
 * sewn in one hooping - a bedsheet border, a banner, a name across the back of
 * a jacket. The operator sews part of it, re-hoops the garment, and sews the
 * next part, aligning each section on a registration point. This module turns
 * one compiled stitch sequence into those sections, and every section it
 * returns is a complete, machine-file-ready sequence of its own.
 *
 * How the split is chosen
 * -----------------------
 *  - The walk is sequential: stitches are accumulated in sewing order until
 *    the next one would leave the hoop's usable field, then the section is
 *    closed. Sewing order is preserved across sections, so the operator sews
 *    section 1, then section 2, and never jumps backwards over finished work.
 *  - A cut prefers to land on a travel point (jump, trim or colour change)
 *    because that is where the machine is already between objects - cutting
 *    there loses no stitches and leaves each section starting cleanly. Only
 *    when no travel point exists inside the section (one very large object)
 *    is the cut forced mid-object, and that is reported as a warning so the
 *    user knows to align on the section's start point.
 *  - One hoop is chosen for the whole design and every section is checked
 *    against it. Mixing hoops per section would mean re-hooping to a
 *    different frame halfway through, which no operator wants.
 *
 * Positioning
 * -----------
 * Each section becomes its own machine file with its own origin, so each is
 * translated to sit centred inside the hoop's safe field. The exception is a
 * design that already fits a single hoop in its current position: that is
 * returned untouched, because moving a design that was already hooped would
 * be a surprise, not a help.
 *
 * Everything here is a pure function of its inputs.
 */

import type {
  Bounds,
  Hoop,
  Stitch,
  StitchSequence,
  StitchStats,
  ValidationResult,
} from './types.js';
import { usableField, pickHoop } from './hooping.js';
import { boundsOfStitches } from './formats/dst.js';
import { computeStats } from './stats.js';
import { validateSequence } from './validation/index.js';

/** Thrown when no hoop is available to split against. */
export class MultiHoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultiHoopError';
  }
}

/** Extra clearance kept between a section's content and the hoop's safe field. */
export const SPLIT_PADDING = 1;

/**
 * Default size, in mm, of the registration cross sewn at a section boundary.
 *
 * Small enough to disappear under the next pass of a join, large enough to
 * sight a needle against when lining the second hooping up on the first.
 */
export const DEFAULT_REGISTRATION_MARK_SIZE = 3;

/** How a section was closed. */
export type SectionCut =
  /** Last section - the design ran out here. */
  | 'end'
  /** Cut on a travel point (jump / trim / colour change). */
  | 'travel'
  /** Cut mid-run because the object itself is larger than the hoop. */
  | 'forced';

/**
 * An alignment cross to sew into a section.
 *
 * `at` says which end of the section it goes on: a boundary produces one mark
 * on the section that ENDS there and an identical mark on the section that
 * BEGINS there, both at the same design coordinate. The operator then lines
 * the two sewn crosses up and the halves are in register - the marks are the
 * only thing that has to agree between the two files.
 */
export interface RegistrationMark {
  at: 'start' | 'end';
  /** Design-space centre, before either section is translated into its hoop. */
  x: number;
  y: number;
  colorIndex: number;
  objectId?: string;
}

/** One hooping's worth of stitches, ready to be written as a machine file. */
export interface HoopSection {
  /** 1-based section number, in sewing order. */
  index: number;
  /** The hoop this section is sewn in (the same for every section). */
  hoop: Hoop;
  /** Translation applied so the section sits centred in the safe field. */
  offset: { x: number; y: number };
  /**
   * Range in the source sequence this section was cut from: [start, end).
   *
   * With an overlap set, consecutive ranges deliberately share their band -
   * section N's tail is also section N+1's head. That is what the option
   * means, not a slicing bug: the shared stitches appear in both machine files.
   */
  source: { start: number; end: number };
  /** Where the section's run ended. */
  cut: SectionCut;
  /** Renumbered, translated stitches - pass straight to a format writer. */
  stitches: Stitch[];
  /** Bounds of the translated stitches. */
  bounds: Bounds;
  /** Production statistics for this section alone. */
  stats: StitchStats;
  /** Distinct sewing colours in this section. */
  colorCount: number;
  /** Machine-facing checks for this section against its hoop. */
  validation: ValidationResult;
}

export interface SplitResult {
  /** The single hoop every section is sewn in. */
  hoop: Hoop;
  sections: HoopSection[];
  /** Human-readable notes: forced cuts, sections that still do not fit, ... */
  warnings: string[];
  /** One-line summary of what happened, suitable for a status message. */
  message: string;
}

export interface SplitOptions {
  /**
   * Split against this hoop instead of choosing one.
   *
   * The caller usually passes the hoop the operator actually intends to
   * frame the garment with; without it the smallest hoop that holds the
   * whole design is used, or - when nothing is large enough - the roomiest
   * hoop in the library, which minimises the number of re-hoopings.
   */
  hoop?: Hoop;
  /**
   * Additional clearance in mm kept inside the hoop's safe field, giving the
   * operator slack when aligning sections. Defaults to SPLIT_PADDING.
   */
  padding?: number;
  /**
   * How many mm the consecutive sections sew twice.
   *
   * A multi-hoop join is a hard edge: hoop 1 sews up to the cut and hoop 2
   * takes over from there, and any wobble in re-hooping shows as a gap or a
   * step in the fill. Sharing a band means hoop 2 starts `overlap` mm BEFORE
   * hoop 1 stopped and re-sews that band; the operator no longer has to land
   * the second hooping on a line, only roughly over a region. Zero (the
   * default) keeps the original exactly-shared cut.
   *
   * The band is measured along whichever axis the split runs along - overlap
   * across the join is what heals it; overlap along the direction of travel
   * would just waste thread. It is truncated where the section runs out, so a
   * band can never be wider than the section it belongs to.
   */
  overlap?: number;
  /**
   * Sew a small registration cross at each section boundary, into BOTH of the
   * sections that share it, at the same design coordinate.
   *
   * The two crosses are the only thing that has to agree between the two
   * machine files: line the needle over the cross that is already sewn and
   * the halves are in register. Off by default - marks are stitches the
   * operator has to remove, so they are opt-in rather than imposed.
   */
  registrationMarks?: boolean;
  /** Cross size in mm. Defaults to DEFAULT_REGISTRATION_MARK_SIZE. */
  registrationMarkSize?: number;
}

/**
 * Split a compiled design into one section per hooping.
 *
 * A design that fits the chosen hoop in its current position comes back as a
 * single section carrying the original stitches unchanged - the multi-hoop
 * path is a no-op for it, so callers can use this unconditionally.
 */
export function splitIntoHoops(
  sequence: StitchSequence,
  hoops: Hoop[],
  options: SplitOptions = {},
): SplitResult {
  const stitches = sequence.stitches;
  const warnings: string[] = [];

  if (stitches.length === 0) {
    throw new MultiHoopError('This design has no stitches, so there is nothing to split.');
  }

  const hoop = chooseHoop(stitches, hoops, options.hoop);
  const padding = options.padding ?? SPLIT_PADDING;
  const field = usableField(hoop);
  const rawMaxW = field.width - padding * 2;
  const rawMaxH = field.height - padding * 2;

  // A hoop whose margin eats the whole field can never hold anything, and
  // silently producing sections that cannot be sewn would be worse than
  // saying so.
  if (rawMaxW <= 0 || rawMaxH <= 0) {
    throw new MultiHoopError(
      `Hoop "${hoop.name}" has no usable stitching area once its ${hoop.safeMargin} mm safe margin is applied.`,
    );
  }

  // A registration cross is centred on the boundary stitch, which sits on the
  // section's own edge, so its arms poke `markRadius` past the content. Room
  // for both arms is reserved by shrinking the growth budget - otherwise the
  // cross would be the one thing in the file that does not fit the hoop.
  //
  // The room is only taken when the design genuinely has to be split. A
  // design that fits a single hooping gets no crosses at all (there is
  // nothing to align it to), so charging it for them could split a design
  // that would otherwise have stayed in one piece.
  const markRadius =
    Math.max(0, options.registrationMarkSize ?? DEFAULT_REGISTRATION_MARK_SIZE) / 2;
  const allBounds = boundsOfStitches(stitches);
  const needsSplit =
    allBounds.maxX - allBounds.minX > rawMaxW || allBounds.maxY - allBounds.minY > rawMaxH;
  const useMarks = options.registrationMarks === true && markRadius > 0 && needsSplit;
  const markRoom = useMarks ? markRadius * 2 : 0;

  const maxW = rawMaxW - markRoom;
  const maxH = rawMaxH - markRoom;

  if (maxW <= 0 || maxH <= 0) {
    throw new MultiHoopError(
      `Hoop "${hoop.name}" has no usable stitching area once its ${hoop.safeMargin} mm safe margin is applied.`,
    );
  }

  // An overlap wider than the hoop itself could never be honoured, and a
  // negative one would describe a hole instead of a shared band.
  const overlap = Math.min(Math.max(0, options.overlap ?? 0), maxW / 2, maxH / 2);

  const sections: HoopSection[] = [];
  const total = stitches.length;
  let start = 0;
  let forcedCuts = 0;
  /**
   * The cross the NEXT section opens with.
   *
   * One boundary produces one coordinate and two marks: the section that ends
   * there sews it last, the section that begins there sews it first. Sharing
   * the coordinate is the whole point - the marks only line up if both files
   * put them in the same place in the design.
   */
  let pendingMark: RegistrationMark | null = null;

  while (start < total) {
    // --- grow the section until the next stitch would leave the field -----
    let end = start;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    // Preferred cut: the last travel point seen inside this section. The
    // travel stitch itself goes with the NEXT section, where it becomes that
    // section's leading jump.
    let lastTravel = -1;
    // Which axis ran out of room, recorded only because it is the axis an
    // overlap has to be measured along.
    let overflowAxis: 'x' | 'y' = 'x';

    while (end < total) {
      const s = stitches[end]!;
      const tMinX = Math.min(minX, s.x);
      const tMinY = Math.min(minY, s.y);
      const tMaxX = Math.max(maxX, s.x);
      const tMaxY = Math.max(maxY, s.y);
      const overX = tMaxX - tMinX > maxW;
      const overY = tMaxY - tMinY > maxH;
      const fits = end === start || (!overX && !overY);

      if (!fits) {
        // When both axes ran out, whichever ran out further is the axis the
        // design is being split along.
        overflowAxis =
          overX && overY
            ? tMaxX - tMinX - maxW >= tMaxY - tMinY - maxH
              ? 'x'
              : 'y'
            : overX
              ? 'x'
              : 'y';
        break;
      }

      minX = tMinX;
      minY = tMinY;
      maxX = tMaxX;
      maxY = tMaxY;
      if (s.command === 'jump' || s.command === 'trim' || s.command === 'colorChange') {
        lastTravel = end;
      }
      end++;
    }

    // --- close the section -------------------------------------------------
    let cut = end;
    let cutKind: SectionCut = 'end';
    let boundary: Stitch | null = null;
    if (end < total) {
      if (lastTravel > start) {
        // Cut on the travel point: the travel stitch leads the next section,
        // so no stitches are lost and both sides stay clean.
        cut = lastTravel;
        cutKind = 'travel';
      } else {
        // One object larger than the hoop: cut where the field runs out and
        // warn, because the operator now has to align this section by its
        // start point rather than on a natural break.
        cutKind = 'forced';
        forcedCuts++;
        const cutSt = stitches[end - 1]!;
        warnings.push(
          `Section ${sections.length + 1} is cut mid-object (object "${cutSt.objectId ?? 'unknown'}", ` +
            `after stitch ${end} of ${total}): a single object is larger than hoop "${hoop.name}". ` +
            `Align section ${sections.length + 2} on its start point.`,
        );
      }
      boundary = stitches[cut - 1]!;
    }

    const marks: RegistrationMark[] = [];
    if (pendingMark) marks.push({ ...pendingMark, at: 'start' });
    if (boundary) {
      const mark: RegistrationMark = {
        at: 'end',
        x: boundary.x,
        y: boundary.y,
        colorIndex: boundary.colorIndex,
        ...(boundary.objectId ? { objectId: boundary.objectId } : {}),
      };
      if (useMarks) marks.push(mark);
      pendingMark = { ...mark, at: 'start' };
    } else {
      pendingMark = null;
    }
    sections.push(
      materialize(
        stitches,
        start,
        cut,
        sections.length + 1,
        hoop,
        cutKind,
        {
          minX,
          minY,
          maxX,
          maxY,
        },
        useMarks ? marks : [],
        markRadius,
      ),
    );

    // The next section opens on the overlap band when one was asked for, so
    // it re-sews the tail of this one instead of taking over on a hairline.
    start = overlap > 0 && boundary ? sharedBand(stitches, start, cut, overlap, overflowAxis) : cut;
  }

  // --- per-section verification -------------------------------------------
  // The bounds maths above should guarantee a fit; this catches the case it
  // cannot express (a hoop so small that even one stitch point with its
  // leading jump is out of place) and reports it rather than exporting a
  // file the machine would refuse.
  for (const section of sections) {
    if (!section.validation.ok) {
      const first = section.validation.issues.find((i) => i.severity === 'error');
      warnings.push(
        `Section ${section.index} does not fit hoop "${hoop.name}": ${first?.message ?? 'unknown issue'}`,
      );
    }
  }

  // --- summary -------------------------------------------------------------
  const cuts = sections.length - 1;
  const shared: string[] = [];
  if (overlap > 0 && sections.length > 1) shared.push(`${overlap} mm of every join sewn twice`);
  if (useMarks && sections.length > 1)
    shared.push(`registration crosses sewn into both halves of every join`);

  const message =
    sections.length === 1
      ? `The design fits hoop "${hoop.name}" (${hoop.width} x ${hoop.height} mm) as a single hooping.`
      : `Split into ${sections.length} hooping(s) for "${hoop.name}" (${hoop.width} x ${hoop.height} mm): ` +
        `${cuts} cut(s)${forcedCuts > 0 ? `, ${forcedCuts} of them mid-object` : ''}` +
        `${shared.length > 0 ? `, with ${shared.join(' and ')}` : ''}. ` +
        'Sew the sections in order, re-hooping between each.';

  return { hoop, sections, warnings, message };
}

/**
 * Where the next section should start so it shares a band with this one.
 *
 * Walks backwards from the cut until the span along the split axis would
 * exceed `overlap`, i.e. finds the widest suffix of this section that is no
 * deeper than `overlap`. The result is clamped forward by one stitch: a band
 * that reached the section's very first stitch would hand the next section
 * exactly the range it was given, and the split would stop making progress
 * and loop forever.
 */
function sharedBand(
  source: Stitch[],
  sectionStart: number,
  cut: number,
  overlap: number,
  axis: 'x' | 'y',
): number {
  const at = (i: number): number => (axis === 'x' ? source[i]!.x : source[i]!.y);

  let lo = at(cut - 1);
  let hi = lo;
  let band = cut - 1;
  let i = cut - 2;

  while (i >= sectionStart) {
    const v = at(i);
    const nLo = Math.min(lo, v);
    const nHi = Math.max(hi, v);
    if (nHi - nLo > overlap) break;
    lo = nLo;
    hi = nHi;
    band = i;
    i--;
  }

  return Math.max(sectionStart + 1, band);
}

/**
 * The stitches of one registration cross, already translated into hoop space.
 *
 * Two separate bars rather than one four-armed star: a single diagonal from
 * arm to arm would put a needle penetration in the centre and four long
 * stitches radiating out of it, which is exactly where a cross over a satin
 * fill tends to bury itself. Two bars leave the centre readable from either
 * side of the machine.
 */
function crossStitches(
  mark: RegistrationMark,
  offset: { x: number; y: number },
  radius: number,
  resume: { x: number; y: number } | null,
): Stitch[] {
  const cx = mark.x + offset.x;
  const cy = mark.y + offset.y;
  const base = {
    colorIndex: mark.colorIndex,
    objectId: mark.objectId ?? null,
    sequence: -1,
  };

  const out: Stitch[] = [
    { x: cx - radius, y: cy, command: 'jump', ...base },
    { x: cx + radius, y: cy, command: 'stitch', ...base },
    { x: cx, y: cy - radius, command: 'jump', ...base },
    { x: cx, y: cy + radius, command: 'stitch', ...base },
  ];
  if (resume) out.push({ x: resume.x, y: resume.y, command: 'jump', ...base });
  return out;
}

/**
 * Choose the one hoop every section will use.
 *
 *  1. A hoop passed by the caller always wins - it is the frame the operator
 *     has decided to use.
 *  2. Otherwise the smallest hoop that holds the whole design, so a design
 *     that fits never forces a bigger frame than it needs.
 *  3. Otherwise the roomiest hoop in the library: when a design must be split
 *     anyway, larger sections mean fewer re-hoopings and fewer alignment
 *     points to get wrong.
 */
function chooseHoop(stitches: Stitch[], hoops: Hoop[], forced: Hoop | undefined): Hoop {
  if (forced) return forced;

  const usable = hoops.filter((h) => {
    const f = usableField(h);
    return f.width > 0 && f.height > 0;
  });
  if (usable.length === 0) {
    throw new MultiHoopError(
      'No hoop presets are available to split against. Run "npm run seed" to load the standard frames, or pass a hoop explicitly.',
    );
  }

  const bounds = boundsOfStitches(stitches);
  const need = { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };

  // No rotation: the splitter never turns stitches, so offering a hoop that
  // would need the design turned would be a lie.
  const fit = pickHoop(need, usable, { allowRotation: false });
  if (fit) return fit.hoop;

  let best = usable[0]!;
  let bestArea = usableField(best).width * usableField(best).height;
  for (const h of usable.slice(1)) {
    const f = usableField(h);
    const area = f.width * f.height;
    if (area > bestArea) {
      best = h;
      bestArea = area;
    }
  }
  return best;
}

/** True when the bounds already sit inside the hoop's safe area, unmoved. */
function fitsInPlace(b: Bounds, hoop: Hoop): boolean {
  const m = hoop.safeMargin;
  return b.minX >= m && b.minY >= m && b.maxX <= hoop.width - m && b.maxY <= hoop.height - m;
}

/**
 * Turn one range of the source sequence into a standalone section: translate
 * into the hoop field, give it a leading jump and a trailing trim, and
 * renumber so the section is a valid machine sequence on its own.
 *
 * `marks` are registration crosses to sew in alongside the content. A `start`
 * mark goes straight after the leading jump and leaves the machine pointed at
 * the content it interrupted; an `end` mark runs after the content and before
 * the trailing trim. They are only ever added when the section is actually
 * being re-hooped - the passthrough case has nothing to align to.
 */
function materialize(
  source: Stitch[],
  start: number,
  end: number,
  index: number,
  hoop: Hoop,
  cut: SectionCut,
  rawBounds: Bounds,
  marks: RegistrationMark[],
  markRadius: number,
): HoopSection {
  const field = usableField(hoop);
  const contentW = rawBounds.maxX - rawBounds.minX;
  const contentH = rawBounds.maxY - rawBounds.minY;

  // A design that already sits inside the single hoop it was going to be
  // sewn in is returned exactly as it was compiled: no translation, no
  // injected jump or trim. The multi-hoop path is a no-op for it, so callers
  // can use this unconditionally and a fitting design exports byte-identical
  // to the normal single-file export.
  const passthrough = index === 1 && cut === 'end' && fitsInPlace(rawBounds, hoop);

  // Centre the content in the safe field - except in the passthrough case,
  // where moving it would silently change a design the user had placed.
  const centred = {
    x: hoop.safeMargin + (field.width - contentW) / 2,
    y: hoop.safeMargin + (field.height - contentH) / 2,
  };
  const offset = passthrough
    ? { x: 0, y: 0 }
    : { x: centred.x - rawBounds.minX, y: centred.y - rawBounds.minY };

  const translated: Stitch[] = [];
  for (let i = start; i < end; i++) {
    const s = source[i]!;
    translated.push({ ...s, x: s.x + offset.x, y: s.y + offset.y });
  }

  if (!passthrough) {
    // Leading jump: the machine starts each file at the hoop origin, and the
    // first content point is typically tens of mm away. Without a jump the
    // first move would be sewn as one long stitch.
    const first = translated[0]!;
    if (first.command !== 'jump' && first.command !== 'trim') {
      translated.unshift({
        x: first.x,
        y: first.y,
        command: 'jump',
        colorIndex: first.colorIndex,
        objectId: first.objectId,
        sequence: -1,
      });
    }

    // A `start` cross sits immediately after that jump: the machine arrives,
    // marks the fabric, then gets on with the section. Each cross leaves the
    // machine pointed back at the content point it stepped aside for, so no
    // stitch between the interrupted points is skipped.
    const startMarks = marks.filter((m) => m.at === 'start');
    if (startMarks.length > 0) {
      const at = Math.min(1, translated.length);
      const resume = translated[Math.min(at, translated.length - 1)]!;
      const injected: Stitch[] = [];
      for (const m of startMarks) injected.push(...crossStitches(m, offset, markRadius, resume));
      translated.splice(at, 0, ...injected);
    }

    // An `end` cross runs after the content; the trailing trim that follows
    // then cuts the thread at the cross rather than stranding it across it.
    for (const m of marks) {
      if (m.at === 'end') translated.push(...crossStitches(m, offset, markRadius, null));
    }

    // Trailing trim: the operator is about to stop and move the hoop, so the
    // machine should cut the thread rather than leave it spanning the gap.
    if (cut !== 'end') {
      const last = translated[translated.length - 1]!;
      if (last.command !== 'trim' && last.command !== 'jump') {
        translated.push({
          x: last.x,
          y: last.y,
          command: 'trim',
          colorIndex: last.colorIndex,
          objectId: last.objectId,
          sequence: -1,
        });
      }
    }
  }

  // Renumber: `sequence` is defined as the position in the final sequence,
  // and each section is its own final sequence.
  for (let i = 0; i < translated.length; i++) translated[i]!.sequence = i;

  const bounds = boundsOfStitches(translated);
  const colorCount = new Set(
    translated.filter((s) => s.command !== 'jump' && s.command !== 'trim').map((s) => s.colorIndex),
  ).size;

  return {
    index,
    hoop,
    offset,
    source: { start, end },
    cut,
    stitches: translated,
    bounds,
    stats: computeStats(translated),
    colorCount: Math.max(1, colorCount),
    // Object checks need the source objects, which the splitter never sees;
    // passing none keeps the machine-facing checks (hoop fit, stitch limits)
    // which are exactly what a section must pass.
    validation: validateSequence(translated, [], hoop),
  };
}
