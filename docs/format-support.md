# Format support

ThreadWorks Studio supports **seven** machine file formats — **Tajima DST**,
**Brother PES** (v1, with an embedded PEC stitch block), **Melco EXP**,
**Janome JEF**, **Husqvarna VP3**, **TBF** and **Husqvarna HUS** — and
implements each properly, encoder _and_ decoder.

Nothing else is offered. This document explains what is implemented, how
faithfully, and why the formats that are missing are missing rather than
half-done.

---

## 0. How faithfulness is established

Every encoder here was checked twice over:

1. **Round trip.** The test suite encodes a design and reads it back with the
   independent decoder, asserting positions, commands and ordering. The
   end-to-end smoke test does the same through the app's real export path.
2. **Cross-check against pyembroidery.** [pyembroidery](https://github.com/EmbroidePy/pyembroidery)
   is the reference reader/writer behind Ink/Stitch. Output was read back with
   it, and — for the same stitch list — its own output was compared byte for
   byte with ours:

| Format  | Result of the byte-level comparison                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DST     | **Identical**, header and body — over hand-built edge cases (rounding, cuts, colour stops, block openings) and a compiled design                          |
| EXP     | **Identical**, record for record, over the same set                                                                                                       |
| PES/PEC | **Identical**, whole file — container, PEC header and palette, stitch stream and thumbnails, over thirteen cases including a 239,785-byte compiled design |
| JEF     | **Identical**, header, palette and body — on a 23,575-stitch compiled design and a hand-built edge case                                                   |
| VP3     | **Identical**, whole file, over twelve cases including a 4,754-byte design — the first run of the encoder matched on every byte                           |
| TBF     | **Identical**, whole file, over the same twelve cases, with the reference's own reader agreeing on stitches, palette and label                            |

The comparison is a byte-for-byte diff of two files written from the _same_
stitch list — ours and pyembroidery's — so a difference in the header counts
just as loudly as one in the stitch stream. Cases worth naming, because they
are where the two encoders can quietly part company: a move whose parts land
exactly on half a unit, a travel longer than one record allows, a block opening
after a cut or a colour stop, a colour stop that has to travel, a cut row that
points somewhere other than the needle, a colour change before the first stitch,
threads close enough to claim the same palette slot, the same colour sewn twice,
and a real design compiled through the pipeline.

**HUS is checked the other way round.** pyembroidery ships HUS as _read-only_ —
it has no writer to compare against — so the check is that its own HusReader
reads our files back to exactly the stitches and palette we wrote. All twelve
cases agree, including the compressed streams.

`scripts/export-samples.ts` writes `samples/sample.{dst,pes,exp,jef}` from a real
two-colour design so the files can be opened in digitizing software or tried on
a machine.

---

## 1. Tajima DST — supported

### Export

| Property            | Value                                                             |
| ------------------- | ----------------------------------------------------------------- |
| Extension           | `.dst`                                                            |
| MIME                | `application/octet-stream`                                        |
| Header              | 512 bytes ASCII, 125 data bytes, space-padded                     |
| Stitch records      | 3 bytes each, relative deltas                                     |
| Resolution          | 0.1 mm per unit                                                   |
| Maximum single step | 12.1 mm (121 units)                                               |
| Command bytes       | `0x03` normal, `0x83` jump, `0xC3` stop/colour change, `0xF3` end |
| Termination         | `00 00 F3` — the end record is the last one in the file           |

The encoder is `packages/embroidery-engine/src/formats/dst.ts` → `writeDst()`.

**Header fields written:** design name (`LA:`, sanitised to 16 characters of
`[A-Za-z0-9_ -]`), stitch count (`ST`), colour count (`CO`, stored as count − 1),
extents (`+X -X +Y -Y`) and the finish position (`AX`/`AY`, in machine space —
y is negated, so it matches what Tajima software writes). Every one of those
numbers is **space padded** to its own width, the way the format defines them
and the way every other writer spells them; zero padding reads as a different
field to some machines.

**`ST` counts rows, not stitches and not records.** It is the number of rows the
encoded stream holds, terminator included: one per stitch or hop, one per colour
stop, one per cut. Only a cut writes more than one record, so a file with cuts in
it holds more records than the header claims — and never fewer rows than it has
records.

**The extents describe the needle's path**, measured on the same 0.1 mm grid the
records use, rather than the points the design names. A long travel reaches its
destination through intermediate hops, and one of those can sit further out than
any point the design asked for.

**Y is negated once, at the encoder boundary.** DST measures y upward (machine
space) while the engine's design space is y-down, so `writeDst` writes `-y` and
`readDst` negates it back. Without this a design sews upside down.

**Long moves are split.** A delta beyond 12.1 mm cannot be encoded in one
record, so it is divided into equal hops; intermediate records carry the jump
command and only the final one carries the real command. This is why a decoded
file can contain _more_ records than the source sequence — never fewer. Each hop
is rounded from where the needle last landed, halves to the even unit, which is
the rule the reference implementation follows (`packages/embroidery-engine/src/formats/moves.ts`).

**A cut is written in place.** DST has no cut command, so the format's own answer
is used: a needle pop of three jumps that end exactly where they started, which a
Tajima machine reads as "lift and cut here". The cut carries the needle nowhere —
travel to the next point belongs to the row after it — and a second cut taken
while the thread is already up is dropped rather than doubled. A colour stop is
written the same way: at the needle, with no travel before it.

### Import

`readDst()` decodes DST back into a `Stitch[]`, parsing the ASCII header (name,
stitch count, colour count, extents) and every ternary record.

### Honest limits of the DST format itself

DST is a lossy interchange format. The following are **format** limits, not
implementation gaps:

| Not carried in DST               | Consequence                                                                                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread colour per stitch         | Only a _count_ of colours is stored. Colour names and hex values are not in the file; the machine stops `CO` times and the operator threads by hand.                                                                                                                             |
| Trim command                     | DST has no trim. ThreadWorks writes the format's own answer — a **needle pop**, three jumps that end where they started, which a Tajima machine reads as "lift and cut here". Whether the machine trims is still a machine setting. On decode, those records come back as jumps. |
| Stitch type / density / underlay | Only the resulting coordinates exist. Satin vs tatami is not recoverable from a DST.                                                                                                                                                                                             |
| Editable source geometry         | A DST is a flattened point list. Re-importing gives you stitches, not the shapes they came from.                                                                                                                                                                                 |
| Object names, order metadata     | Lost.                                                                                                                                                                                                                                                                            |

---

## 2. Brother PES — supported

### Export

| Property            | Value                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Extension           | `.pes`                                                             |
| MIME                | `application/octet-stream`                                         |
| Version             | `#PES0001` (v1)                                                    |
| Container           | `#PES0001` + u32 offset + CEmbOne/CSewSeg design block + PEC block |
| PEC header          | 512 bytes: label, icon geometry, Brother palette indices           |
| PEC stitches        | 1-byte short form (−63…62), 2-byte long form (signed 12-bit)       |
| Maximum single move | 2047 units = 204.7 mm; longer travel is chained                    |
| Colour change       | `FE B0 02` / `FE B0 01` (alternating)                              |
| Jump / trim         | flag bits `0x90` jump, `0xA0` trim + jump                          |
| Termination         | `FF`                                                               |

The encoder is `packages/embroidery-engine/src/formats/pes.ts` → `writePes()`.

**Y is _not_ negated.** Brother's convention runs the same way as the engine's
y-down design space, so PES/PEC passes coordinates through untouched apart from
the millimetre → 0.1 mm conversion. This asymmetry with DST and EXP is real and
comes straight from pyembroidery, whose PEC writer writes `dy` untouched.

**There is no `#PEC0001` inside a PES.** Some references show one, but the
reference implementation seeks to the offset and parses the header directly;
writing the extra 8 bytes shifts every field and the reader decodes garbage.
The `#PEC0001` marker only exists in a standalone `.pec` file.

**The rows are normalised before anything is written.** pyembroidery never
writes the rows it is handed: it runs them through its own encoder with this
writer's settings, and the container, the stitch stream and the thumbnails all
read that result. `writePes()` does the same in `normalizePes()`:

- the first stitch after a cut — or at the start of the design — opens its
  block with a jump to the target and then sews it, so thread is never dragged;
- a cut row never moves the needle. It records a cut where the needle already
  stands, and the travel to the next block becomes that block's opening jump,
  which is also where the cut flag travels (PEC has no standalone trim record);
- a colour change is a remark at the needle, and a second cut while already cut
  is dropped;
- travel longer than 204.7 mm is chained into hops before the arrival record;
- an end record closes the stream whether or not the input carried one.

Every part of the file — the CSewSeg sections, the bounds, the thumbnails and
the PEC stitch stream — is derived from those normalised rows, so the parts
cannot disagree with one another.

**Colours are matched to the Brother chart twice, in two different ways.** The
container's segment log codes each block by its nearest entry in the full
64-colour chart. The PEC header holds a _de-duplicated_ palette: each distinct
thread claims its nearest still-free slot, and every block then looks itself up
in that sparse chart. Two threads that would both land on Black end up with a
slot each, so a machine never shows one suggestion for two different blocks.

**Thumbnails are drawn, not blank.** Every thumbnail starts from the fixed
6 × 38 hoop icon the reference carries in its PecGraphics table, with the design
scaled into it: one preview for the whole design, then one frame per colour
block. That is the picture a Brother machine shows while the design is loaded.

### Import

`readPes()` follows the PES offset, parses the 512-byte header (label, colour
count) and the PEC stitch stream back into a `Stitch[]`.

### Honest limits of the PES format as implemented

| Not carried                         | Consequence                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Per-object stitch type / density    | The PES block carries segment geometry, not the generator settings; re-importing gives stitches.                        |
| Project metadata (author, category) | Not written in v1; the machine does not use it.                                                                         |
| Designer-editable shapes            | A PES is a flattened stitch list with block structure.                                                                  |
| Names beyond ASCII                  | The label is stripped to printable ASCII before writing, which keeps the 512-byte header where every reader expects it. |

### Parity with the reference

PES/PEC is byte-identical to pyembroidery 1.5.1 on every case tried — the same
claim DST, EXP and JEF already make. Thirteen cases were compared whole-file:
seven hand-built streams, four palettes chosen to break the colour lookup, and
a design compiled through the real pipeline (239,785 bytes of container, stitch
stream and thumbnails). They are listed at the top of this document.

---

## 3. Melco EXP — supported

### Export

| Property            | Value                                                   |
| ------------------- | ------------------------------------------------------- |
| Extension           | `.exp`                                                  |
| MIME                | `application/octet-stream`                              |
| Header              | **none** — a bare stitch stream, read until EOF         |
| Stitch record       | 2 bytes `[dx, dy]`, signed 8-bit, 0.1 mm units          |
| Jump                | `80 04 [dx dy]` (4 bytes)                               |
| Colour change       | `80 01 00 00` (4 bytes)                                 |
| Trim                | `80 80 07 00` (4 bytes; the payload is ignored on read) |
| Maximum single move | 127 units = 12.7 mm; longer travel is chained           |

The encoder is `packages/embroidery-engine/src/formats/exp.ts` → `writeExp()`.

**Y is negated**, exactly as for DST: EXP measures y upward, the engine's design
space is y-down. Both formats were confirmed against pyembroidery, whose writer
negates and whose reader negates back.

**A normal stitch must never start with `0x80`.** That byte marks an escape, so
a `dx` of −128 would be mistaken for a command. The encoder keeps every step
within ±127 by chaining, which makes the collision impossible.

**A trim cannot move the needle.** The trim record's payload is ignored by every
reader, so the cut is written where the needle already stands and the distance to
wherever it was measured from belongs to the row after it. A second cut taken
while the thread is already up is dropped rather than doubled.

**The first stitch of a block is travelled to, not sewn towards.** After a cut or
a colour stop the needle is out of the fabric, so the file shows it jumping to
that block's first point and then taking one stitch in place — the record that
tells the machine to start sewing. This is the behaviour the reference has, and it
is why the bytes following a colour change now match it exactly.

### Import

`readExp()` decodes the stream back into a `Stitch[]`, including the escape
records.

### No differences from pyembroidery

The bytes after a colour change are where this format used to differ, and they no
longer do. A colour stop is written where the needle stands (`80 01 00 00`, no
movement), and the distance to the next colour's first point is travelled _after_
it, as block-opening jumps landing on a stitch of zero length — which is exactly
what pyembroidery's encoder produces.

**PES/PEC still has that one difference** (§2); DST, EXP and JEF do not.

---

## 4. Janome JEF — supported

### Export

| Property            | Value                                                         |
| ------------------- | ------------------------------------------------------------- |
| Extension           | `.jef`                                                        |
| MIME                | `application/octet-stream`                                    |
| Header              | `0x74` (116) bytes, little-endian `int32` throughout          |
| Date stamp          | 14 ASCII digits `YYYYMMDDHHMMSS` followed by two zero bytes   |
| Colour blocks       | 32-bit slot each, indexing Janome's built-in thread table     |
| Stitch record       | 2 bytes `[dx, -dy]`, signed 8-bit, 0.1 mm units               |
| Jump                | `80 02 [dx dy]` (4 bytes)                                     |
| Colour change       | `80 01 00 00` (4 bytes)                                       |
| Trim                | three `80 02 00 00` records (12 bytes)                        |
| Termination         | `80 10`                                                       |
| Maximum single move | 127 units = 12.7 mm; longer travel is chained                 |
| Hoop declared from  | the design's size (50², 126×110, 140×200, 200×200, else 110²) |

The encoder is `packages/embroidery-engine/src/formats/jef.ts` → `writeJef()`.

**Y is negated**, exactly as for DST and EXP — JEF measures y upward while the
engine's design space is y-down. This was confirmed against pyembroidery, whose
JEF writer writes `-dy` and whose reader negates it back.

**Colour is a number, not an RGB.** A JEF never stores thread colour: each block
holds a slot into the machine's own 78-thread table (slot 0 means "unassigned").
`writeJef` therefore colour-matches every block to its nearest Janome thread with
the integer _red mean_ formula, so the file names a thread the operator can
actually buy — and two design threads that land on the same slot get separated by
handing the second one the next-closest thread instead of silently merging them.

**The size in the header is the size of the path, not of the artwork.** The
declared extents are measured over every record the file writes — including the
intermediate hops of a chained move — while a trim (which travels nowhere) and a
colour change (which happens where the needle already stands) add nothing. That
is why a design whose furthest coordinate is only ever reached by a trim still
reports the area it actually sews.

**A trim is only written while thread is in the fabric.** A cut arriving right
after a colour change — which already stops the machine — is dropped, matching
the reference encoder: a second cut in a row would simply be ignored by the
machine.

**Provenance of the thread table.** The 79-slot table (slot 0 = `null`, 78 real
threads) is reused as **data**, not code, from
[pyembroidery](https://github.com/EmbroidePy/pyembroidery)'s `EmbThreadJef`
module — MIT License, Copyright (c) 2018. It is attributed in place at the top
of `jefColors.ts`. Everything else in the JEF path (the record layout, the hop
division, the colour matching, the header) is original.

### Import

`readJef()` parses the header (colour count, point count, hoop, extents, colour
slots) and the record stream back into a `Stitch[]`. The colour slots come back
as Janome thread names and numbers (`Red (225)`), so an imported file shows the
thread each block was sewn with rather than a placeholder. A run of three
zero-distance jump records is read as a trim, and an unknown control byte is
treated as a jump so the needle position stays honest instead of drifting.

### Honest limits of the JEF format as implemented

| Not carried                          | Consequence                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| JEF+ extras (`.jef` with extra data) | Only the classic single-block JEF body is written; readers ignore anything after the end record anyway. |
| Per-object stitch type / density     | A JEF is a flattened point list with colour stops.                                                      |
| Custom hoop geometry                 | The hoop is declared by size from a fixed table; a machine with an unusual frame selects it manually.   |
| Programmable colours beyond 78       | A design thread with no close Janome match reports the nearest one — it does not invent a new slot.     |

---

## 5. Husqvarna VP3 — supported

VP3 is the format Husqvarna Viking and Pfaff machines read. It is a tagged
container rather than a bare stitch stream: a magic string, a producer name, two
length-prefixed blocks, and one colour block per thread change.

### Export

`writeVp3(stitches, threads)` — the rows go through the shared normaliser with
the reference's own settings (longest jump 3,200 mm, longest stitch 255 mm, no
rounding, a colour change opens each block), then:

- extents, centre and half-extents in hundredths of a millimetre, y-up;
- one colour block per thread change, each opening with the block's start
  position and the thread's colour, name, catalogue number and brand;
- the stitch run itself, one byte per axis, with an escape pair for any delta
  wider than a signed byte.

**VP3 carries real thread metadata** — colour, name, number and brand all
travel with the file, so the machine shows the same spools the design was drawn
with. TBF and HUS are poorer in this respect; see below.

### Import

`readVp3(bytes)` walks the same blocks back. VP3 stores no jump rows — the
writer drops them — so an imported design comes back as stitches, cuts and
colour changes, which is enough to preview, convert and film.

### Honest limits of the VP3 format as implemented

| What                                            | Consequence                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A single delta wider than 127 mm uses an escape | The format can express it in one record, so a long travel is one row rather than a chain — this is by design. |
| Jumps do not survive a round trip               | VP3 has no jump row. A design imported back will sew the travel as thread rather than floating over it.       |
| Producer string                                 | Written as the studio's own name rather than a Husqvarna one; machines do not check it.                       |

### Parity with the reference

Byte-identical to pyembroidery over twelve cases, including a 4,754-byte design
and cases built to part company: a colour change before any stitching, threads
close enough to claim the same slot, stops interleaved with cuts, and a name
longer than a label field holds.

---

## 6. TBF — supported

TBF is what Babylock, Bernina and some Barudan machines read. Its header is a
fixed-width ASCII block, and the reference reads it **by offset**, not by
searching for tags — which is why the label field is capped at sixteen
characters.

### Export

`writeTbf(stitches, threads, name)` normalises with the reference's own
settings (longest hop and stitch 127 mm, whole-millimetre coordinates, an
explicit cut before each colour change, and a needle set opening each block),
then writes:

- `LA:` label, `ST:` stitch count, `CO:` needle count and the four extent
  fields, all at the offsets a loader seeks to;
- `AX:`/`AY:` for where the needle finishes;
- a 256-byte needle order table filled from each block's announced needle, so
  the machine loads its spools in the right slots;
- the whole palette — used threads or not — because an operator needs the
  threads the design was set up with even when one goes unused;
- three-byte records: delta, delta, command, with y carried upward.

The label is **capped at sixteen characters**. This is the one deliberate
deviation from pyembroidery: its writer lets a long name through and pushes
every later field past the position its own reader looks for, so the file it
produces cannot be read back by it. Capping the label is what makes the
round-trip work, and the design's full name is still kept in the project.

### Import

`readTbf(bytes)` reads at the same fixed offsets. A needle record opens a new
colour block; one stored with no needle number reads back as a machine stop.

### Honest limits of the TBF format as implemented

| What                               | Consequence                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Whole-millimetre coordinates       | Fine detail below a millimetre cannot be expressed; this is the format's own resolution, not an encoder limit. |
| Label capped at sixteen characters | A longer design name is truncated in the file; the project keeps the full name.                                |
| Palette carries colour only        | Thread names and numbers do not survive; VP3 is the format for those.                                          |

### Parity with the reference

Byte-identical to pyembroidery over the same twelve cases, with the reference's
own reader agreeing on stitches, palette and label.

---

## 7. Husqvarna HUS — supported

HUS is the older Husqvarna format. It has three quirks that set it apart: its
stitch data is **compressed**, its palette stores **numbers into the machine's
thread library** rather than colours, and pyembroidery ships it **read-only**.

### Export

`writeHus(stitches, threads, name)` writes a 42-byte header plus two bytes per
thread, then three separately compressed streams of one byte each per stitch —
commands, x deltas and y deltas:

- each axis is a signed byte, so no single hop may exceed 127 mm and a longer
  travel is walked as a chain of jumps, exactly as Tajima and Melco require;
- y is carried upward in the deltas and read back down;
- a colour change is a record of its own, so a machine stops without cutting
  unless the design asked for a cut;
- each thread is snapped to the **nearest thread the machine can name**, so an
  exported file never points at a spool the operator does not own.

The compression is a literal-only block chain. A block opens with its symbol
count and then two tables; when both carry a single default symbol every symbol
is the next raw byte, so a block of stored bytes is both valid and readable. The
reference decoder reads this form directly, and blocks are chained so a design
larger than one block worth of stitches still round-trips.

### Import

`readHus(bytes)` decompresses the three streams and walks them back, naming each
thread after the machine library entry it points at.

### Honest limits of the HUS format as implemented

| What                                   | Consequence                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Whole-millimetre coordinates           | The format's own resolution, not an encoder limit.                                                                     |
| Name held in eight bytes               | A long design name is truncated; the project keeps the full name.                                                      |
| Threads snapped to the machine library | A colour outside the library's twenty-nine entries is matched to its nearest neighbour rather than reproduced exactly. |
| Stored rather than compressed          | A file is larger than one written by Husqvarna's own software, which compresses for real. Both are valid.              |

### Parity with the reference

There is no reference writer to compare against, so the check runs the other
way: pyembroidery's own HusReader reads our files back to exactly the stitches
and palette we wrote, over all twelve cases.

---

## 8. Formats deliberately **not** offered

The rule: **a format is only offered when it is really implemented.** A button
that produces a plausible-looking file the machine will reject is worse than no
button, because it fails late and expensively.

| Format                                          | Status          | Why                                                                                                                                     |
| ----------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Pfaff / Husqvarna .VP4**                      | not implemented | A later revision of VP3 with a different block layout; not needed for the target workflow yet.                                          |
| **Barudan .DSB/.DBS**                           | not implemented | Different record layouts; not needed for the target workflow yet.                                                                       |
| **SVG / PDF / PNG art export**                  | not implemented | Would be for viewing, not sewing. Lower value than getting the stitch path right.                                                       |
| **Wilcom `.EMB`, Brother `.PES` project files** | **never**       | Proprietary project formats of other products. ThreadWorks' own design document (JSON, stored in MongoDB) is the native project format. |

### Reading vs writing

`readDst`, `readPes`, `readPec`, `readExp`, `readJef`, `readVp3`, `readTbf` and
`readHus` all exist and are tested, and the **Import** button in the top bar
uses them: it reads a machine file, previews it with the movie's renderer, and
saves it back out as another format or as a stitch video. `detectFormat()`
identifies the format from the signature (DST `LA:`, PES `#PES`, PEC `#PEC`,
VP3 `%vsm%`, TBF's version banner plus its fixed label record, HUS's three
stepping offsets and block tag, and JEF's own header shape — an in-range record
offset on a 4-byte boundary, a colour count the thread table can hold and a
14-digit date stamp) and falls back to the file extension for EXP, which is a
bare stitch stream with no header.

Thread colours are recovered where the format stores them: PES and PEC name
chart entries, JEF names Janome numbers, **VP3 carries colour, name, number and
brand outright**, **TBF carries colour only**, and **HUS carries a number into
the machine's own thread library** — so an imported HUS design names each thread
exactly as the operator's machine will. DST and EXP store no colours at all, so
placeholder threads are invented and flagged in the dialog.

What the import does _not_ do is reconstruct editable shapes. No machine format
stores the outlines, fills and columns that produced the point list, so an
imported design is a stitch sequence — enough to preview, convert and film, not
enough to re-edit. To change the artwork, trace the original picture with
**Trace image** instead.

---

## 9. Native project format

Projects are **not** files on disk. They are documents in the local MongoDB
database `embroidery_studio`, written through the validated API:

```
{
  id, name, version, createdAt, updatedAt,
  design: {
    units: "mm",
    width, height,
    hoopId,
    objects: [ { id, name, type, path{rings}, transform, colorIndex,
                 params{stitchType, angle, spacing, maxStitchLength,
                        minStitchLength, pullCompensation, fillPattern,
                        underlay, tieIn, tieOff},
                 entryExit, order, locked, hidden, groupId, warnings } ],
    threadPalette: [ { id, code, name, hex, brand? } ]
  },
  summary: { objectCount, stitchCount?, colorCount, width, height, hoopId }
}
```

Everything needed to regenerate the stitches is in `objects[]`; stitches
themselves are never stored, because they are a pure function of that data.

Backups of these documents are plain JSON lines with a manifest — see
`backup.bat` / `restore.bat`.

---

## 10. Summary

|                           | Read           | Write          | Verified by                                                    |
| ------------------------- | -------------- | -------------- | -------------------------------------------------------------- |
| **Tajima DST**            | ✅ UI + engine | ✅ UI + engine | round trips, byte-identical to pyembroidery, live smoke test   |
| **Brother PES v1**        | ✅ UI + engine | ✅ UI + engine | round trips, pyembroidery reads it, field-for-field comparison |
| **Melco EXP**             | ✅ UI + engine | ✅ UI + engine | round trips, byte-identical to pyembroidery, live smoke test   |
| **Janome JEF**            | ✅ UI + engine | ✅ UI + engine | round trips, byte-identical to pyembroidery, live smoke test   |
| **Husqvarna VP3**         | ✅ UI + engine | ✅ UI + engine | round trips, byte-identical to pyembroidery (12/12 cases)      |
| **TBF**                   | ✅ UI + engine | ✅ UI + engine | round trips, byte-identical to pyembroidery (12/12 cases)      |
| **Husqvarna HUS**         | ✅ UI + engine | ✅ UI + engine | round trips, pyembroidery's HusReader agrees (12/12 cases)     |
| **JSON project (native)** | ✅             | ✅             | 34 server tests + optimistic-concurrency checks                |
| **JSONL backup**          | ✅             | ✅             | backup → delete → restore round trip                           |
| VP4 / DSB / …             | ❌             | ❌             | — (not implemented, not offered)                               |

If you need a format that is not on this list, the honest answer today is:
**export DST, PES, EXP, JEF, VP3, TBF or HUS, or use a tool that supports your
format.** Free alternatives such as **Inkscape + Ink/Stitch** cover VP4, DSB
and many more.
