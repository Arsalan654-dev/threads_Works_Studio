/**
 * Melco EXP encoder and decoder.
 *
 * Verified against pyembroidery's ExpWriter / ExpReader (the battle-tested
 * reference used by Ink/Stitch) and the documented format notes.
 *
 * File layout
 * -----------
 *   No header, no terminator: a bare run of stitch records, read until EOF.
 *
 * Record
 * ------
 *   A normal stitch is 2 bytes: [dx, dy] signed 8-bit, 0.1 mm units.
 *   0x80 in the first byte marks an escape; the second byte is the control:
 *     0x80 0x04 [dx dy]     jump          (4 bytes)
 *     0x80 0x01 0x00 0x00   colour change (4 bytes)
 *     0x80 0x80 0x07 0x00   trim          (4 bytes; payload ignored on read)
 *   Maximum single move is 127 units (12.7 mm); longer travel is chained into
 *   several hops by the encoder, exactly as DST is.
 *
 * Coordinates
 * -----------
 *   Like Tajima DST, EXP measures y upward (machine space) while the engine's
 *   design space is y-down, so y is negated once at the encoder boundary and
 *   once on the way back in - mirroring pyembroidery, whose writers negate and
 *   whose readers negate, keeping read(write(s)) == s.
 */

import type { Stitch } from '../types.js';
import { planMove } from './moves.js';

export const EXP_MM_PER_UNIT = 0.1;
export const EXP_MAX_STEP = 127; // 12.7 mm in 0.1 mm units

const ESCAPE = 0x80;
const CONTROL_JUMP = 0x04;
const CONTROL_COLOR = 0x01;
const CONTROL_TRIM = 0x80;

export class ExpEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpEncodingError';
  }
}

function signed8(b: number): number {
  return b & 0x80 ? b - 0x100 : b;
}

/**
 * Split a move that exceeds the representable range into chained hops.
 *
 * EXP cannot encode a single move beyond 12.7 mm, so long jumps and travel
 * stitches must be broken up rather than truncated.
 */
export function splitExpMove(dx: number, dy: number): Array<{ x: number; y: number }> {
  return planMove(dx, dy, EXP_MAX_STEP).map((hop) => ({ x: hop.x, y: hop.y }));
}

/** Write a single 2-byte move record. Y is negated into machine space here. */
function pushMove(out: number[], dx: number, dy: number): void {
  out.push(dx & 0xff, -dy & 0xff);
}

/** Write planned travel as chained jump records. */
function pushJumps(out: number[], hops: Array<{ x: number; y: number }>): void {
  for (const hop of hops) {
    out.push(ESCAPE, CONTROL_JUMP);
    pushMove(out, hop.x, hop.y);
  }
}

/**
 * Encode a generated stitch sequence as a Melco EXP file.
 *
 * Millimeter coordinates are scaled to 0.1 mm units and moves beyond the
 * single move limit are chained. A cut and a colour stop are remarks about
 * where the needle already stands rather than destinations, so neither
 * carries the needle anywhere: both are written where it is and leave it
 * there, and the first stitch of a block is then travelled to with jumps and
 * landed with a stitch of its own rather than sewn towards.
 */
export function writeExp(stitches: Stitch[]): Uint8Array {
  if (!Array.isArray(stitches)) throw new TypeError('stitches must be an array');

  const out: number[] = [];
  let px = 0; // running position in 0.1 mm (design space, y-down)
  let py = 0;
  // False while the needle is out of the fabric - after a cut or a colour
  // stop - which is what tells the first stitch of a block to travel there
  // instead of sewing the distance.
  let sewing = false;

  for (const stitch of stitches) {
    // Scale into 0.1 mm units, and ask first whether this row may move the
    // needle at all. A cut and a colour stop measure nothing, so the running
    // position stays exactly where it was and travel to wherever they were
    // *meant* belongs to the row that follows them.
    const movesNeedle = stitch.command !== 'trim' && stitch.command !== 'colorChange';
    const ax = Math.round(stitch.x / EXP_MM_PER_UNIT);
    const ay = Math.round(stitch.y / EXP_MM_PER_UNIT);
    const dx = movesNeedle ? ax - px : 0;
    const dy = movesNeedle ? ay - py : 0;
    const hops = movesNeedle ? splitExpMove(dx, dy) : [];
    if (movesNeedle) {
      px = ax;
      py = ay;
    }

    switch (stitch.command) {
      case 'end':
        // EXP has no end record: the file simply stops (pyembroidery writes
        // nothing for END and its reader runs until EOF).
        break;

      case 'trim': {
        // The trim record is a fixed 4-byte sequence whose payload the reader
        // ignores, so it cannot move the needle - which is why no travel
        // precedes it: the needle is already where this cut belongs. A second
        // cut while the thread is already up would be one in the wrong place,
        // so it is dropped rather than doubled.
        if (sewing) out.push(ESCAPE, CONTROL_TRIM, 0x07, 0x00);
        sewing = false;
        break;
      }

      case 'colorChange': {
        // A colour change carries no movement (00 00), matching pyembroidery,
        // and takes the thread out with it. Whatever distance separates this
        // point from the next colour's first stitch is travelled afterwards,
        // as block-opening jumps, because the needle is no longer sewing.
        out.push(ESCAPE, CONTROL_COLOR, 0x00, 0x00);
        sewing = false;
        break;
      }

      case 'jump': {
        // A jump record is written even for a zero-distance move, so the
        // reader sees exactly the command stream the design describes. It
        // moves the needle without taking a stitch, so the fabric stays
        // unpierced and the next stitch still has to open its block.
        pushJumps(out, hops);
        break;
      }

      case 'stitch':
      case 'lock':
      default: {
        if (sewing) {
          for (let i = 0; i < hops.length; i++) {
            const hop = hops[i]!;
            const isLast = i === hops.length - 1;
            if (isLast) {
              pushMove(out, hop.x, hop.y);
            } else {
              // Intermediate hops of an over-long stitch are travelled as jumps
              // so the needle still ends on the exact target.
              out.push(ESCAPE, CONTROL_JUMP);
              pushMove(out, hop.x, hop.y);
            }
          }
        } else {
          // Opening a block: travel there with jumps and land with a stitch
          // of zero length rather than sewing the distance. A stitch with
          // nowhere left to go still lands, so the block still opens.
          if (dx !== 0 || dy !== 0) pushJumps(out, hops);
          pushMove(out, 0, 0);
        }
        sewing = true;
        break;
      }
    }
  }

  return Uint8Array.from(out);
}

export interface ExpReadResult {
  stitches: Stitch[];
}

/** Parse an EXP file back into stitches. Used by tests and the import path. */
export function readExp(bytes: Uint8Array): ExpReadResult {
  const stitches: Stitch[] = [];
  let x = 0;
  let y = 0;
  let seq = 0;
  let pos = 0;

  const push = (command: Stitch['command']): void => {
    stitches.push({
      x: x * EXP_MM_PER_UNIT,
      // Mirror of the writer's negation: the file holds y-up machine
      // coordinates, and the design space is y-down, so flip back on read.
      y: -y * EXP_MM_PER_UNIT,
      command,
      colorIndex: 0,
      objectId: null,
      sequence: seq++,
    });
  };

  while (pos + 2 <= bytes.length) {
    const b0 = bytes[pos]!;
    const b1 = bytes[pos + 1]!;

    if (b0 !== ESCAPE) {
      x += signed8(b0);
      y += signed8(b1);
      push('stitch');
      pos += 2;
      continue;
    }

    // Escape: b1 is the control byte, followed by a 2-byte payload.
    pos += 2;
    if (pos + 2 > bytes.length) break;
    const p0 = bytes[pos]!;
    const p1 = bytes[pos + 1]!;
    pos += 2;

    if (b1 === CONTROL_TRIM) {
      // Payload ignored: a trim happens at the current needle position.
      push('trim');
      continue;
    }

    const dx = signed8(p0);
    const dy = signed8(p1);

    if (b1 === CONTROL_JUMP) {
      x += dx;
      y += dy;
      push('jump');
    } else if (b1 === CONTROL_COLOR) {
      // pyembroidery moves only when the record carries a non-zero delta.
      if (dx !== 0 || dy !== 0) {
        x += dx;
        y += dy;
        push('colorChange');
        push('jump');
      } else {
        push('colorChange');
      }
    } else {
      // Unknown control: treat the payload as a jump so the position tracking
      // stays honest rather than silently drifting.
      x += dx;
      y += dy;
      push('jump');
    }
  }

  return { stitches };
}

/** File extension for this format. */
export const EXP_EXTENSION = '.exp';

/** MIME type used for local download. */
export const EXP_MIME = 'application/octet-stream';
