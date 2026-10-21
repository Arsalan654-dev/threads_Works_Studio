/**
 * Design validation.
 *
 * Produces machine-facing checks BEFORE a file is written. The point is to
 * catch problems a human can act on - not to declare a design "production
 * ready" because the coordinates happen to be numeric.
 */

import type {
  EmbroideryObject,
  Hoop,
  Stitch,
  ValidationIssue,
  ValidationResult,
} from '../types.js';
import { isSpecialtyStitch } from '../types.js';
import { boundsOfStitches } from '../formats/dst.js';

/** Hard limits that reflect real machine and thread constraints. */
export const LIMITS = {
  /** Tajima DST cannot encode a single move beyond this. */
  maxMachineStitchLength: 12.1,
  /** Stitches shorter than this waste time and can snap thread. */
  minUsefulStitchLength: 0.15,
  /** Above this the thread is likely to loop or snag. */
  maxTravelBeforeTrim: 60,
  /** Dense overlap: stitches closer together than this may bleed. */
  minSpacing: 0.15,
  /**
   * Above this a design is refused, and the number is measured rather than
   * guessed: every exporter here writes a two-million-stitch design in under
   * half a second and reads it back exactly (see the note in
   * known-limitations). The ceiling sits where the *file* starts to be the
   * problem instead of the software - most home machines refuse a design this
   * large, and the Brother PES length field itself runs out at about 2.4
   * million stitches - so going past it is a mistake rather than a bigger
   * design.
   */
  maxStitches: 2_000_000,
  /** Satin columns narrower than this rarely cover the fabric. */
  minColumnWidth: 0.8,
  /** Satin lettering below this cap height rarely covers its fabric. */
  minLetteringHeight: 3,
  /** A cap height beyond this is almost certainly a units mistake. */
  maxLetteringHeight: 300,
} as const;

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  objectId: string | null,
): ValidationIssue {
  return { severity, code, message, objectId };
}

/**
 * Validate the generated sequence of a whole design.
 */
export function validateSequence(
  stitches: Stitch[],
  objects: EmbroideryObject[],
  hoop: Hoop | null,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (stitches.length === 0) {
    issues.push(
      issue('error', 'EMPTY_DESIGN', 'Design has no stitches. Add at least one object.', null),
    );
    return { ok: false, issues };
  }

  if (stitches.length > LIMITS.maxStitches) {
    issues.push(
      issue(
        'error',
        'TOO_MANY_STITCHES',
        `Design has ${stitches.length} stitches, which exceeds the supported limit of ${LIMITS.maxStitches}.`,
        null,
      ),
    );
  }

  // --- stitch length ------------------------------------------------------
  let maxLen = 0;
  let maxIndex = -1;
  let shortCount = 0;

  for (let i = 1; i < stitches.length; i++) {
    const a = stitches[i - 1]!;
    const b = stitches[i]!;
    if (b.command !== 'stitch') continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > maxLen) {
      maxLen = d;
      maxIndex = i;
    }
    if (d > 0 && d < LIMITS.minUsefulStitchLength) shortCount++;
  }

  if (maxLen > LIMITS.maxMachineStitchLength) {
    issues.push(
      issue(
        'error',
        'STITCH_TOO_LONG',
        `Longest stitch is ${maxLen.toFixed(2)} mm at sequence #${maxIndex}, which exceeds the ${LIMITS.maxMachineStitchLength} mm machine limit. Reduce spacing or enable auto-split.`,
        stitches[maxIndex]?.objectId ?? null,
      ),
    );
  }

  if (shortCount > 0) {
    issues.push(
      issue(
        'warning',
        'SHORT_STITCHES',
        `${shortCount} stitch(es) are shorter than ${LIMITS.minUsefulStitchLength} mm and may waste time or snap thread.`,
        null,
      ),
    );
  }

  // --- travel -------------------------------------------------------------
  let longTravel = 0;
  for (let i = 1; i < stitches.length; i++) {
    const a = stitches[i - 1]!;
    const b = stitches[i]!;
    if (b.command !== 'jump') continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > LIMITS.maxTravelBeforeTrim) longTravel++;
  }
  if (longTravel > 0) {
    issues.push(
      issue(
        'warning',
        'LONG_TRAVEL',
        `${longTravel} jump(s) exceed ${LIMITS.maxTravelBeforeTrim} mm. Long untrimmed travel can drag loose thread across the design.`,
        null,
      ),
    );
  }

  // --- colour changes -----------------------------------------------------
  const changes = stitches.filter((s) => s.command === 'colorChange').length;
  if (changes > 15) {
    issues.push(
      issue(
        'warning',
        'MANY_COLOR_CHANGES',
        `${changes} color changes will slow production. Consider reordering the color sequence.`,
        null,
      ),
    );
  }

  // --- locks --------------------------------------------------------------
  const objectsNeedingLocks = objects.filter(
    (o) => o.params.tieIn.enabled || o.params.tieOff.enabled,
  );
  if (objectsNeedingLocks.length === 0 && objects.length > 1) {
    issues.push(
      issue(
        'warning',
        'NO_LOCKS',
        'No object has tie-in/tie-off enabled. Thread may pull out when the machine starts or trims.',
        null,
      ),
    );
  }

  // --- per-object geometry warnings ---------------------------------------
  for (const obj of objects) {
    if (obj.hidden) continue;

    // Lettering carries no path: its geometry is derived from the text spec
    // at compile time, so an empty `path` is normal, not a defect.
    if (obj.type === 'lettering') {
      if (obj.warnings.length > 0) {
        for (const w of obj.warnings) issues.push(issue('warning', 'OBJECT_WARNING', w, obj.id));
      }
      continue;
    }

    const outer = obj.path.rings[0];
    if (!outer || outer.length < 3) {
      issues.push(
        issue(
          'error',
          'INVALID_PATH',
          `Object "${obj.name}" has an open or degenerate path.`,
          obj.id,
        ),
      );
      continue;
    }

    if (obj.params.stitchType === 'satin') {
      const width = estimateColumnWidth(obj);
      if (width < LIMITS.minColumnWidth) {
        issues.push(
          issue(
            'warning',
            'NARROW_COLUMN',
            `Satin column "${obj.name}" is ${width.toFixed(2)} mm wide (minimum recommended ${LIMITS.minColumnWidth} mm); stitches may not cover.`,
            obj.id,
          ),
        );
      }
    }

    if (obj.warnings.length > 0) {
      for (const w of obj.warnings) issues.push(issue('warning', 'OBJECT_WARNING', w, obj.id));
    }

    if (isSpecialtyStitch(obj.params.stitchType)) {
      issues.push(
        issue(
          'info',
          'SPECIALTY_SIMULATION',
          `"${obj.name}" is a ${obj.params.stitchType} simulation sewn with standard penetrations. ` +
            'DST/PES/EXP/JEF/VP3/TBF/HUS do not carry sequin, bead or chenille machine codes.',
          obj.id,
        ),
      );
    }
  }

  // --- hoop ---------------------------------------------------------------
  if (hoop) {
    const bounds = boundsOfStitches(stitches);
    const margin = hoop.safeMargin;

    // The embroidery field is addressed from its top-left corner: (0,0) to
    // (width, height). That is the frame the editor draws the hoop in and the
    // frame objects are created in, so validation must use it too. Checking a
    // centred field instead would reject nearly every design that visibly fits
    // and block export for no reason.
    const within =
      bounds.minX >= margin &&
      bounds.maxX <= hoop.width - margin &&
      bounds.minY >= margin &&
      bounds.maxY <= hoop.height - margin;

    if (!within) {
      issues.push(
        issue(
          'error',
          'OUT_OF_HOOP',
          `Design runs from ${bounds.minX.toFixed(1)}, ${bounds.minY.toFixed(1)} to ` +
            `${bounds.maxX.toFixed(1)}, ${bounds.maxY.toFixed(1)} mm, which is outside the ` +
            `safe area of hoop "${hoop.name}" ` +
            `(${hoop.width} x ${hoop.height} mm, ${margin} mm margin). ` +
            `Pick a larger hoop or move the design inside the field.`,
          null,
        ),
      );
    }
  }

  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, issues };
}

/**
 * Rough width of a satin column: the average distance between the two
 * boundary rings measured from sampled points on the outer ring.
 */
function estimateColumnWidth(obj: EmbroideryObject): number {
  const outer = obj.path.rings[0];
  const inner = obj.path.rings[1];
  if (!outer) return Infinity;

  // Single-ring column: use the shape's own thickness (min bbox dimension).
  if (!inner) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of outer) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return Math.min(maxX - minX, maxY - minY);
  }

  let total = 0;
  const count = Math.min(outer.length, inner.length) || 1;
  for (let i = 0; i < count; i++) {
    const a = outer[i % outer.length]!;
    const b = inner[i % inner.length]!;
    total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total / count;
}

/** Validate a single object's parameters before generation. */
export function validateObject(obj: EmbroideryObject): ValidationResult {
  const issues: ValidationIssue[] = [];
  const p = obj.params;

  if (p.spacing <= 0) {
    issues.push(
      issue(
        'error',
        'INVALID_SPACING',
        `Object "${obj.name}" has non-positive stitch spacing.`,
        obj.id,
      ),
    );
  } else if (p.spacing < LIMITS.minSpacing) {
    issues.push(
      issue(
        'warning',
        'SPACING_TOO_DENSE',
        `Object "${obj.name}" spacing ${p.spacing} mm is extremely dense; the needle may break or the fabric may pucker.`,
        obj.id,
      ),
    );
  }

  if (p.maxStitchLength > LIMITS.maxMachineStitchLength) {
    issues.push(
      issue(
        'error',
        'MAX_LENGTH_TOO_HIGH',
        `Object "${obj.name}" max stitch length ${p.maxStitchLength} mm exceeds the ${LIMITS.maxMachineStitchLength} mm machine limit.`,
        obj.id,
      ),
    );
  }

  if (p.angle < 0 || p.angle >= 360) {
    issues.push(
      issue(
        'warning',
        'ANGLE_OUT_OF_RANGE',
        `Object "${obj.name}" fill angle ${p.angle} is outside 0-360 degrees.`,
        obj.id,
      ),
    );
  }

  // Lettering has no path by design - its geometry comes from the text spec,
  // so requiring three points here would reject every text object. Instead
  // check the thing that can actually be wrong with lettering: no text.
  if (obj.type === 'lettering') {
    if (!obj.lettering || obj.lettering.text.trim() === '') {
      issues.push(
        issue(
          'warning',
          'EMPTY_LETTERING',
          `Lettering object "${obj.name}" has no text; nothing will be sewn.`,
          obj.id,
        ),
      );
      return { ok: true, issues };
    }

    // Size limits: real digitizing advice rather than a hard refusal. Tiny
    // satin letters lose their counters and a stroke wider than the cap
    // height turns a letter into a blob, so both are worth saying out loud.
    const spec = obj.lettering;
    if (spec.height < LIMITS.minLetteringHeight) {
      issues.push(
        issue(
          'warning',
          'LETTERING_TOO_SMALL',
          `Lettering object "${obj.name}" is ${spec.height} mm high; below ${LIMITS.minLetteringHeight} mm satin letters may not cover the fabric cleanly.`,
          obj.id,
        ),
      );
    }
    if (spec.height > LIMITS.maxLetteringHeight) {
      issues.push(
        issue(
          'warning',
          'LETTERING_TOO_LARGE',
          `Lettering object "${obj.name}" is ${spec.height} mm high; check the units before sewing.`,
          obj.id,
        ),
      );
    }
    if (spec.width > spec.height) {
      issues.push(
        issue(
          'warning',
          'LETTERING_STROKE_TOO_WIDE',
          `Lettering object "${obj.name}" has a ${spec.width} mm stroke on ${spec.height} mm letters; a stroke wider than the cap height swallows the letterforms.`,
          obj.id,
        ),
      );
    }
    if (spec.onPath && spec.onPath.points.length > 0 && spec.onPath.points.length < 2) {
      issues.push(
        issue(
          'warning',
          'LETTERING_PATH_TOO_SHORT',
          `Lettering object "${obj.name}" follows a path with a single point; a path needs two points to have a direction.`,
          obj.id,
        ),
      );
    }
    return { ok: !issues.some((i) => i.severity === 'error'), issues };
  }

  const outer = obj.path.rings[0];
  if (!outer || outer.length < 3) {
    issues.push(
      issue('error', 'INVALID_GEOMETRY', `Object "${obj.name}" needs at least 3 points.`, obj.id),
    );
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

/** True when the design is safe to export (no blocking errors). */
export function canExport(result: ValidationResult): boolean {
  return result.ok;
}
