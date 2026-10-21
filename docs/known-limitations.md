# Known limitations

An honest, itemized list of what ThreadWorks Studio does not do yet, and why.
Nothing here is a stub that pretends to work â€” if a feature is on this list,
there is no button for it.

Last reviewed: the build with the Phase N/O additions - six original font cuts, the clipart browser, SVG/PDF/PNG artwork and 1:1 print sheets, cap-frame preview and driver compensation, production-machine assignment, sequin/bead/chenille/schiffli simulations, and the lit/3D preview - on top of the seven-format encoder set (1,202 automated tests, 119 smoke checks).

---

## 1. Missing features

| Feature                                                          | Status          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-digitizing from an image**                                | done            | Two paths: **Photo mosaic** keeps a photograph's colours as a grid of satin cells, while **Auto trace** reduces colours by median cut, traces outlines with holes, filters noise and angles fills along each shape. The clear source image is kept behind the result as a tracing guide. `autoDigitize()`, `planPhotoStitch()` + the Image to embroidery dialog. The reference image is downscaled before storage (about 1400 px on the long edge, compressed), so it is a tracing aid rather than a print-resolution copy. |
| **3D Foam**                                                      | done            | A satin column sewn over a foam sheet: the normal underlay is dropped for a light tack so it does not skate the sheet, the spacing is capped at 0.30 mm so no foam shows between rows, and the column pulls wider by a share of the foam's thickness so the thread still meets fabric past the raised edge. Applies to satin columns and lettering.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Carving Stamp**                                                | done            | A texture pressed into a tatami fill: a repeating stamp is removed from the fill, so the shape keeps reading as a solid fill with a debossed pattern punched through it. The stamp grid follows the fill angle, travels are jumps over each hole (never sewing across it), and every stamp can carry a run outline so the edge reads crisply. The eight built-in stamps are always available and any shape from the motif library can be used instead.                                                                                                                                                                                                                                                                                                                      |
| **Stitch video export**                                          | done            | "Stitch video" writes an animated GIF: stitches in thread colours, needle marker, live counter. Encoder verified against Pillow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Multi-hoop splitting**                                         | done            | A design that outgrows every hoop is split into one section per re-hooping: the walk is sequential in sewing order, cuts prefer travel points (jump/trim/colour change) so no stitches are lost, one hoop is chosen for the whole design, and each section is translated to sit centred in that hoop's safe field and exported as its own DST/PES/EXP/JEF file. A cut that has to land mid-object (one object larger than the frame) is reported as a warning. See Â§3 for the join options (shared overlap, registration crosses).                                                                                                                                                                                                                                          |
| **Importing DST/PES/PEC/EXP/JEF**                                | done            | The "Import" button reads a machine file, previews it with the movie's renderer, converts it to another format, or films it. A machine file is a flattened stitch list, so it comes back as stitches, not as editable shapes â€” see Â§3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **VP3, TBF and HUS**                                             | done            | Husqvarna VP3, TBF and Husqvarna HUS are written and read. VP3 and TBF are byte-identical to pyembroidery over twelve cases apiece; pyembroidery ships HUS as read-only, so HUS is verified the other way round â€” its own HusReader reads our files back to exactly the stitches and palette we wrote. Each carries a different amount of thread information: VP3 colour, name, number and brand; TBF colour only; HUS a number into the machine's own thread library. See [format-support.md](format-support.md) Â§5, Â§6 and Â§7.                                                                                                                                                                                                                                            |
| **Continue Digitizing**                                          | done            | The **Continue** button (one selectable fill/column/run/bean) reopens the object's outer ring as the live draft; new points append where it stopped and commit back into the same object â€” id, thread, order, holes and parameters all survive. Escape cancels without touching it. Five store tests plus a rail test pin the behaviour.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Redwork automation**                                           | done            | Selected outlines sew as one-colour line work: single, triple (three passes), backstitch (forward two, back one) and stem (slanted overlapping stitches of a chosen width). Geometry is kept, so removal restores the fill; corners stay exact because each segment is subdivided rather than sampled across. Fourteen engine tests, eight store tests, four panel tests and a schema round trip.                                                                                                                                                                                                                                                                                                                                                                           |
| **Snap to object, major/minor grid, separate pull compensation** | done            | Object snap catches vertices first, then edges, then bounding-box centres, within 8 screen pixels, and hands off to the grid; hidden objects and the dragged object are excluded, and a ring marks the caught point. The grid gained an independent major spacing (never below the minor step). Satin columns accept per-side pull compensation in millimetres. Thirteen snap tests plus grid, preference and schema tests.                                                                                                                                                                                                                                                                                                                                                 |
| **Advanced lettering**                                           | done            | Monograms (three initials, honoured centre, mirrored sides, circle/oval/diamond satin frame), text on a path (any selected shape, letters rotate with the tangent or stay upright, offset, start/centre), resequencing (reading / reverse / outside-in / inside-out), dropped letters for team names, width factor and mirrors that move through the spec, and size limits as warnings, never silent damage. The spec is saved with the design, and text is selected by the box around its laid-out letters. Thirty engine tests, store transform tests, panel tests and a schema round trip.                                                                                                                                                                               |
| **Advanced fill textures**                                       | done            | Eighteen fill patterns share one routing table: accordion pleats, florentine leaf bands, flowing liquid rows, a square-turning maze, loosely laid string, long-thread laydown split only at the step limit, stipple dots, a true two-pass cross hatch, shading that fades open to dense, irregular hand stitch, jagged torn edges, rows bowed as if over a dome (3D warp) and flexi splits whose breaks follow each row's width. Randomness is a shape-seeded PRNG â€” never a clock â€” so preview, export and tests always agree; textured rows that lean off their scanline keep a hole crossed by jumps, and every stitch stays inside the shape box. Twenty-one engine tests plus a client test that drives all thirteen new patterns through panel, store and engine.     |
| **Motif runs, singles, columns and gradients**                   | done            | One motif engine serves four layouts: a gridded **fill**, a **run** that places motifs along the outline and turns each with the tangent (closed outlines wrap around), a **single** stamp scaled to fit the drawn box, and a **column** whose motifs span rail to rail and step along it. Fill, run and column take an optional **gradient** that lerps size and extra rotation from the first motif to the last; the programmed split takes a per-object block length, break and stagger. Absent fields reproduce the old uniform fill and the built-in 12 mm / 1.5 mm / 50% split exactly. Ten engine tests cover layout counts, tangent turning, single-stamp containment, gradient growth and split overrides; three panel tests drive the controls through the store. |
| **Original font library and clipart** | done | Six font cuts are derived from the existing single-stroke skeleton, not licensed or copied from a commercial product. Seventeen original parametric clipart shapes are searchable and insert as editable fills. Font substitution for a missing glyph is still `?` and is counted. |
| **Artwork and print sheets** | done | SVG and PDF use millimetre vector paths; PNG is rasterised in the browser. The placement sheet tiles at 1:1 and adds crop marks, an optional hoop outline and a thread legend. A printer set to "fit to page" will break the 1:1 guarantee, and PDF titles are limited to ASCII. |
| **Cap-frame wrap and compensation** | done | The preview projects the flat design by sine onto a crown; export applies the inverse arcsin so the cap sews at the drawn width. This is a geometric crown model, not a profile for every driver or cap shape; a crown too narrow for the design is refused with `CAP_WRAP_INVALID`. |
| **Production machine assignment** | done | Objects carry a 1-64 machine number, can be assigned or spread in one undo step, and export one independently validated file per machine. There is no network queue, machine-status feedback, or automatic load balancing, and one object cannot be split across machines. |
| **Sequins, beading, chenille and schiffli** | partial | The visual effect is generated from real needle penetrations, but DST/PES/EXP/JEF/VP3/TBF/HUS cannot carry sequin, bead-feeder or chenille device codes. These are explicitly simulations; the validation notice says so. |
| **Lit / 3D preview** | done | An optional screen-only shadow and highlight pass over satin runs helps judge coverage. It is not a fabric, light or thickness simulation and never changes an exported stitch. |
| **Barudan DSB/DBS, VP4 and other formats**                       | not implemented | See [format-support.md](format-support.md) Â§8 for why each is refused rather than approximated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Wilcom `.EMB` and Brother project files**                      | never           | Proprietary project formats of other products.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

## 2. Format-level differences from the reference implementation

**DST, EXP, JEF and PES/PEC have no differences.** Each of the four was
compared whole-file against pyembroidery 1.5.1 â€” header, palette, body and, for
PES, the thumbnails as well â€” over the same set of cases: a move whose parts
land exactly on half a unit, a travel longer than one record allows, a block
opening after a cut or a colour stop, a colour stop that has to travel, and a
real design compiled through the pipeline. Everything from the header's
space-padded fields to the last record came out identical. Three behaviours in
particular are the reference's own, and are followed here: a cut and a colour
stop are written where the needle already stands and carry it nowhere, and the
first stitch of a block is travelled to with jumps and landed with a stitch of
zero length rather than sewn towards. A trim that arrives immediately after a
colour change is dropped, because the colour change has already stopped the
machine.

PES took a pass of its own to reach that, because its writer never works from
the rows it is handed: the rows are first normalised the way pyembroidery
normalises them (block-opening jumps, cuts and colour changes that stay at the
needle, travel longer than 204.7 mm chained into hops), and the palette is
built as the reference builds it â€” each distinct thread claiming its nearest
still-free slot â€” rather than as a plain nearest-colour list.

**PES v1 only.** The file is `#PES0001` with an embedded PEC block, which is what
machines read. The v6 header (project metadata, thread table, hoop name) is not
written.

---

## 3. Generator behaviour worth knowing

**Auto-digitizing produces fills.** Every traced region becomes a tatami fill
whose stitch direction follows that shape's long axis. Thin strokes (lettering,
outlines) come out as narrow fills rather than satin columns or runs, which
sews acceptably but is not what a hand-digitized logo would use. Regions below
`minThicknessMm` (0.6 mm by default) and below `minRegionMm2` are dropped and
counted in the summary rather than sewn badly.

**Auto-digitizing reduces colour, it does not separate objects.** Median cut
turns a photograph's thousands of colours into 2â€“16 flat blocks. Gradients and
soft shading become visible bands. There is no background removal beyond a
solid surround (see below), no cropping, and no rotation or perspective
correction â€” do those to the image first.

**Background detection only handles a solid surround.** A colour is treated as
the page only when it dominates the image border, covers at least 15% of the
image, and wraps around another colour. A textured or photographic backdrop
will not be recognised, and can be turned off entirely with "Ignore background".

**Photo stitch is a true mosaic, not a photograph printed in thread.** Every
cell is a separate small block, so the picture reads as a grid of stitches
rather than as a smooth image; small cells reduce that texture at the cost of
stitches (1.4 mm satin cells are roughly 4,000 cells and 25,000 stitches for a
100 x 100 mm picture). A 20,000-cell cap keeps a design sewable on a home
machine. Cells are grouped into one object per thread, so a 16-colour photo is
16 objects; editing one colour at a time is normal and intentional.

**Tracing cost grows with pixels.** Images are downscaled to 900 px on the long
edge before tracing; a 900 x 900 image with 8 colours takes on the order of a
second. Colour count and detail level are the two knobs that matter.

**The stitch video is a GIF, not a video file.** GIF plays anywhere - WhatsApp,
email, any browser - with no codec and nothing to install, which is why it was
chosen. The trade-offs are real: no audio, 256 colours (exact here, because the
renderer is flat-coloured), and a long design makes a large file. A 10,900
stitch design at 420 px / 12 fps comes out around 580 KB.

**Rendering a movie runs off the main thread.** The encoder is handed to a Web
Worker (`client/src/video/gif.ts`), so while a large design draws its frames the
canvas keeps painting, the "Rendering..." note keeps blinking, and the rest of
the page responds: roughly 1.5 seconds of work for a 10,000-stitch design at
420 px, none of it spent on the thread the editor runs on. Where a worker cannot
be created â€” a test environment, a `file://` page, a browser without module
workers â€” the same engine function runs on the main thread instead, which is
correct but does block the tab for the duration. `scripts/export-movie-sample.ts`
offers the full set of options (frame size, fps, stitches per frame, jump
visibility) for scripted use.

**Short stitches are warned about, not prevented.** Very thin shapes can
generate penetrations closer than 0.15 mm, which validation reports as a
`SHORT_STITCHES` warning. Export is not blocked. Widen the spacing or the shape
to avoid it.

**A design is refused, not silently fixed, when it breaks a machine limit.**
Validation errors (`OUT_OF_HOOP`, `STITCH_TOO_LONG`, `INVALID_GEOMETRY`, â€¦) stop
export with a message naming the problem. `STITCH_TOO_LONG` happens when a satin
span is wider than the 12.1 mm machine limit and auto-split is off; the satin
generator's `splitStrategy: 'divide'` option fixes it and is on by default in the
pipeline.

**Undo depth is a preference, 5 to 500 steps, default 60.** Beyond the depth in
force, the oldest step is dropped, which keeps a large design's history from
growing without bound. Lowering it in Preferences trims the stack already in
memory (after the save succeeds, so a rejected change destroys nothing) â€” the
steps nearest the present are the ones that survive.

**Two million stitches is the ceiling.** Above it, validation reports
`TOO_MANY_STITCHES` and refuses the design whole â€” nothing is written half way.
The number is measured, not guessed: every exporter writes a two-million-stitch
design in under half a second and reads it back exactly (DST 2.9 MB in 198 ms,
PES 6.7 MB in 437 ms, EXP 1.9 MB in 119 ms, JEF 1.9 MB in 182 ms on the machine
this was checked on). The ceiling sits where the _file_ starts to be the
problem instead of the software: most home machines refuse a design that large,
and the Brother PES block length field â€” three bytes, 16,777,215 â€” runs out at
about 2.4 million stitches, which `writePes()` refuses out loud rather than
writing as a wrapped, unreadable length.

**The stitch player is a preview, not a simulation.** It interpolates along the
stitch path at the chosen speed. It does not model needle dwell, thread twist or
machine acceleration.

**Imported machine files are stitches, not shapes.** Opening a DST/PES/PEC/EXP/JEF
gives back the needle penetrations in order - the editor's object model (rings,
fill types, satin rails) cannot be reconstructed from a point list, because no
format stores it. What the import gives you is the full stitch sequence, which
is enough to preview, re-export in another format, or render a stitch video for
the client. To edit the shapes, re-trace the artwork with "Trace image" instead.

**3D foam only changes satin.** The technique is a satin column sewn over a
foam sheet, so the foam controls are shown for satin objects and lettering
(which is satin under the hood) and ignored on a fill or a run. Turning foam on
does three real things to the emitted stitches: drops the normal underlay (a
dense bed would skate the foam sheet) and optionally replaces it with a single
light tack down the column's spine, caps the row spacing at 0.30 mm so no foam
shows between rows, and pulls the column wider by 0.35 Ã— the foam thickness per
side so the thread still meets fabric past the raised edge. A 2 mm sheet at
0.4 mm spacing therefore produces noticeably more, denser, wider stitches than
the same column flat â€” which is the point.

**Foam thickness is a digitizing input, not a measurement.** The engine cannot
know what sheet is on the machine; the thickness you type drives the extra
width and nothing else. Real foam varies (2â€“4 mm is typical, and it compresses
under the needle), so the first sew-out on your actual sheet is what tells you
whether to raise or lower it. There is no automatic compensation for foam
compressing, and no separate "foam density" â€” the one spacing cap covers it.

**The foam tack is a single run, not an underlay.** It exists to stop the
sheet moving before the satin arrives, nothing more. It does not stabilise the
fabric the way a real underlay would, so on a stretchy cap or a knit you still
need a proper stabiliser underneath â€” foam is an addition to stabilising, not a
replacement for it.

**A carving stamp only carves a tatami fill, and it only removes.** The
technique starts from a real tatami fill and takes stitches out of it; there is
no fill to carve in a run, a satin column, or a contour fill, so the controls
appear for tatami only and are ignored elsewhere. Carving never invents
stitches â€” what you get is the plain fill you asked for with a repeating stamp
punched through it. Each hole is crossed by a jump rather than a sewn line
(sewing across it would fill the texture straight back in and blow past the
machine's step limit), and the optional outline sews a run around every stamp
so the edge of each gap reads crisply.

**The stamp grid follows the fill angle, and any motif can be a stamp.**
Stamps are laid on the same staggered brick grid a motif fill uses, rotated to
match the fill's angle so the texture sits with the stitches rather than
against them. The same eight built-ins the motif fill offers are available, and
any shape saved in the motif library can be used instead â€” see the motif
library section above. Each stamp's rotation is on top of the fill angle,
independent of it.

**Stamp size means the stamp's real size across, not a scale factor.** The
control and the engine agree that a size of 3 is a 3 mm stamp. That matters
because spacing and size together decide the look: stamps at 3 mm with 6 mm
spacing leave fill showing between them (a visible diamond grid); push size up
to match spacing and neighbouring stamps touch, which carves away the whole
fill and stops reading as texture at all. The defaults are set so the pattern
is visible without destroying the fill.

**DST and EXP carry no thread colours.** A DST file records how many colour
changes exist, not which threads they use; EXP carries nothing at all. The
import therefore invents a placeholder thread per colour block and flags it in
the dialog â€” set them to match your spools before sending the file out. PES and
PEC do store palette indices into Brother's fixed 64-colour chart, and JEF
stores slots into Janome's 78-thread library, so those come back with real
thread names and hex values.

**A `.pec` standalone file is not a `.pes`.** A PES is a container with a
signature, a PEC offset, and the PEC block itself; a standalone PEC is just that
block with a `#PEC0001` header. Both are detected and read. (A PES container
never carries the `#PEC0001` signature â€” its offset points straight at the
`LA:` label line â€” which is a trap that trips up hand-rolled readers.)

**EXP has no header, so it needs the file extension.** Unlike DST (`LA:`) and
PES (`#PES`), an EXP file is a bare stitch stream with nothing to identify it.
Detection falls back to the extension; if you pass bytes without a filename,
pass `format: 'exp'` explicitly.

**Importing does not validate against your machine's hoop.** The imported
sequence is checked for stitch length and long travel (reported in the dialog),
but hoop fitting and object-level checks need the object model that the file no
longer has. Hoop the design after converting it, not before.

**Multi-hoop splits the stitches, not the source objects.** The splitter works
on the compiled sequence, so it cannot re-digitize a section: it cuts wherever
the hoop's field runs out. When that cut falls inside a single large object (a
fill bigger than the frame), there is no travel point to hide it on, so the cut
is forced and reported as a warning â€” the operator then aligns that section on
its start point rather than on a natural break. Cutting on a travel point (jump,
trim or colour change) is always preferred when one is available, because that
loses no stitches and leaves each section starting cleanly.

**Sections are translated to sit centred in the hoop, so absolute positions
change.** Each section becomes its own machine file with its own origin, and
each is moved to the middle of the hoop's safe field. That means a section's
stitches are _not_ at the same coordinates they had in the whole design â€” which
is the point (the operator re-hoops and aligns by eye or on a registration mark),
but it does mean you cannot mix a section file with the original and expect them
to overlay. The one exception is a design that already fits a single hoop: that
comes back untouched, byte-identical to a normal single-file export.

**Alignment is provided as overlap and registration crosses, not as a nudge
tool.** Two options on the Multi-hoop panel address the join:

- **Shared overlap (mm)** spreads the cut across a band rather than on one line,
  so consecutive sections sew the same strip twice. The band is measured along
  whichever axis overflowed and taken from the _end_ of the earlier section, so
  the next section always begins strictly after that section's start (the walk
  still has to move forward, or the split would not terminate). It is clamped to
  half the hoop's width and height so the band cannot exceed what a section can
  hold, and a design that fits one hoop is never split or grown at all. The
  export message names how much got shared.
- **Registration crosses** sew a small cross (+) at each boundary: one cut
  yields one coordinate in the design, and each side carries it â€” the section
  that ends on it sews the cross last, the one that begins on it sews it first
  after a leading jump. Because each section is then translated to the middle of
  its own hoop, the two files sit at different coordinates _by design_; undo that
  translation and the two crosses land on the same point. Cross placement
  reserves room from the growth budget only when a split was needed in the
  first place.

Neither replaces the operator's judgement at the machine â€” there is no tool that
selects a section and nudges it by a fraction of a millimetre, and the splitter
still cannot re-digitize what it cut (see above).

**The hoop is chosen once for the whole design.** Every section uses the same
frame â€” the smallest that holds the whole design, or, when nothing is large
enough, the roomiest one in the library so there are fewer re-hoopings. You can
force a specific hoop, but the splitter will not mix frames per section, because
re-hooping to a different partway through is not something an operator wants
surprised by.

---

## 4. Data model gaps

**No stored field is inert any more.** Two used to be:

| Field                               | What became of it                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transform.scaleX / scaleY / flipX` | **Removed from the model.** Flip, rotate and scale are baked into the path coordinates by the editor, so these three numbers were written and read by nothing. Designs saved by an older build still load: the server strips the keys instead of rejecting the document.            |
| settings `defaultStitchType`        | **Now applied.** It decides what a freshly drawn complex fill starts as â€” read at the moment the shape is committed, so a change in Preferences applies to the very next shape drawn, and traced regions honour it too. Column, run and bean tools keep the type they already mean. |

Two fields that are stored and deliberately _not_ applied remain, and both say
so on screen:

| Field                                                  | Why it stays                                                                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| settings `units`                                       | Shown read-only in Preferences: this build digitizes in millimetres, and the field exists so an imported design has somewhere to declare its units. |
| settings `defaultStitchType` as a _global_ object type | It sets the fill type only. A tool that already means one stitch type keeps it, which the control's own note explains.                              |

Four fields that used to be on this list are no longer gaps â€” they are read
now, and covered by tests:

| Field             | Reads it                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fillPattern`     | Consulted when `stitchType` is `tatami`; routes to one of the eighteen fill patterns. Left at `tatami`, output is byte-identical to before the option existed.                                                                                                                                                      |
| `minStitchLength` | Shape-preserving merge in the sequencer: a stitch is dropped only when its endpoint lands closer to the last _emitted_ point, so runs never lose their shape. Jumps, trims and colour changes are hard barriers and the final point of a run is always kept. Top layer and lettering only â€” underlay is left alone. |
| `entryExit`       | `resolveEntryExit()` honours a hand-set entry and exit, and a guessed exit is derived _from_ the entry rather than picked independently. Placed on canvas with the entry/exit tool.                                                                                                                                 |
| `groupId`         | Group (Ctrl+G) and ungroup (Ctrl+Shift+G), group-aware click selection on the canvas, group moves and rotates as one, and duplicating a group keeps its members together under a fresh id.                                                                                                                          |

**Version history and recent files are written.** Saving a project whose design
JSON actually differs snapshots the _outgoing_ state first, so a checkpoint can
be restored to before the edit; a manual checkpoint can be taken at any moment;
restore writes the snapshot back after first checkpointing what it replaced (so
the restore itself is undoable). The list endpoint returns metadata only and
the design is fetched per checkpoint. Recent files are pointers rather than
copies: a project deleted underneath is dropped with a message rather than
failing to open. Both lists are capped (30 checkpoints per project, 20 recent
files) and cleaned up with their project.

---

## 5. Deployment scope

**Local by default; hosting is explicit.** The server binds to `127.0.0.1` and
the API has no application-level login. Local use is one machine, one person,
backed by a local MongoDB. Hosted use needs `NODE_ENV=production`,
`MONGODB_URI`, and `CORS_ORIGINS`; the current Vercel deployment is
additionally behind Vercel Authentication. CORS is not authentication: anyone
who can reach the API with a permitted origin can read and write projects, so
keep the deployment protected or add a token layer before sharing it.

**Vercel Functions are limited to a 4.5 MB request/response.** This build sets
`MAX_PROJECT_MB=4` on Vercel so an oversized save fails with the API's own
structured 413 instead of an opaque platform error. Larger designs need the
Railway or local server, whose default limit is 50 MB.

**No telemetry, no CDN.** The local app works offline after install. The hosted
version talks only to MongoDB Atlas and the Vercel platform. There is no
cross-device sync, sharing, or collaborative editing.

---

## 6. What is solidly covered

For balance, the parts that are done and tested:

- Satin column, complex fill, run, bean, tatami, motif, contour, spiral fills
- Underlay (center run, edge run, zigzag, tatami), tie-in and tie-off
- Pull compensation and automatic stitch splitting
- 3D foam (puff): satin over a foam sheet â€” tack instead of underlay, capped
  density, and width that wraps the foam edge
- Carving stamp: a repeating stamp punched out of a tatami fill, with jumps
  over each hole and an optional run outline around every stamp
- Lettering with a single-stroke font, layout, slant, rotation and spacing
- Node editing with gesture undo
- Auto-hooping (smallest fitting hoop, optional quarter turn)
- Colour blending of two or more fills in one undo step
- Auto-digitizing: median-cut colour reduction, exact outline tracing with
  holes, noise filtering, per-shape fill angle, and solid-surround removal
- Stitch video: animated GIF with real thread colours, needle marker and counter
- DST / PES / EXP / JEF / VP3 / TBF / HUS export, each with a real encoder and
  decoder (HUS is verified through the reference reader, which is all it ships)
- Importing DST / PES / PEC / EXP / JEF / VP3 / TBF / HUS: preview, thread
  colours where the format carries them, conversion to another format, and
  stitch video
- Stitch player with speed control
- Optimistic-concurrency save; stale writes are rejected, not applied
- Version history: automatic snapshots on real design changes, manual
  checkpoints, restore (itself checkpointed first), capped and cleaned up
- Recent files: upserted on open, forgettable one at a time or all at once
- Multi-hoop joins: shared overlap band, registration crosses on both sides of
  every cut
- Fill patterns on tatami: eighteen textures â€” tatami, motif, contour, spiral,
  programmed split, flexi split (breaks follow the row width), accordion,
  florentine, liquid, maze, string, laydown, stipple, cross hatch, shading
  (open to dense), hand stitch, jagged edge and 3D warp. Every textured fill is
  seeded from the shape's own geometry, never from a clock, so the preview, the
  export and the next compile all agree
- Motif library: eight built-in shapes plus your own, captured from the canvas
  or pasted as an SVG path or coordinates; rename, delete, and pick one for a
  motif fill or a carving stamp. A design carries the shape it used, so it
  still sews after the library entry is gone.
- Motif layouts: a library shape can stamp a grid (fill), follow the outline
  (run), fill the drawn box once (single) or span a column rail to rail; fill,
  run and column can fade size and rotation from the first motif to the last
- User-defined split: block length, break and stagger per object on the
  programmed split fill, with a reset back to 12 mm / 1.5 mm / 50%
- Hand-set entry and exit per object; minimum stitch length as a real merge
- Grouping (Ctrl+G / Ctrl+Shift+G) with group-aware selection and transforms
- Transform: move, flip, scale and rotate, baked into the path coordinates
- Shaping tools: weld, combine (xor), subtract and intersect, each one undo
  step; offset with one or several concentric copies and miter / bevel / round
  corners; a run border around any shape; corner rounding with an automatic
  radius clamp; center all in the hoop. All of it is real geometry â€” the
  preview, validation and export see the rewritten outline, not an effect
- Six original single-stroke font cuts, selectable per lettering object and saved
  with the design; Studio Sans remains the default for older files
- Clipart browser: 17 original shapes, categories, search and placement as
  editable complex fills
- Artwork: vector SVG and PDF, raster PNG, and a tiled 1:1 placement sheet with
  crop marks, hoop outlines and an optional thread legend
- Cap frame: curved crown preview, radius and compensation controls, inverse
  compensation applied before statistics and validation, and `CAP_WRAP_INVALID`
  when the design cannot fit the crown
- Production machines: per-object assignment, spread across a selection, and
  one independently validated file per machine
- Specialty stitches: sequins, beading, chenille and schiffli generated as
  standard penetrations with a visible simulation notice
- Lit/3D preview preference: a screen-only shadow and highlight pass
- Undo depth as a preference (5â€“500), trims the live stack on a successful save
- Hoop validation, backup and restore


---

## 7. Phase N/O specifics

**Fonts are original skeletons, not a type library.** The six cuts share the
existing single-stroke alphabet and change its geometry - corners, smoothing,
slant, tracking and serifs. They are not tracings of a commercial embroidery
font, so their letterforms are deliberately simpler. A character outside the
glyph table is still shown as `?` and the substitution is counted by the
engine.

**The clipart is parametric, not an imported SVG pack.** All 17 shapes are
computed in the engine. A placed shape is an ordinary fill: it can be node
edited, welded, offset or reshaped, and it carries no link back to the
catalogue.

**Artwork is a proof, not a contract.** SVG and PDF use the compiled stitches in
millimetre units, and the print sheet tiles at 1:1. The print is only 1:1 if the
printer dialog disables scaling. PDF titles are ASCII-only; non-Latin text is
substituted with `?`, while the thread geometry is unaffected. PNG is a
convenience raster and is not suitable for measuring.

**Cap compensation is geometric.** It assumes a circular crown of the radius
entered. Real caps taper, have a seam and different fabric stretch. The inverse
projection widens the design so it sews at the drawn width on that model, but it
does not know a particular machine's driver. Check the first cap at low speed,
and turn compensation off if the driver already applies its own.

**Specialty stitches are simulations.** The engine generates real, ordered needle
penetrations that look like sequins, beads, chenille or schiffli lace. The seven
supported file formats do not carry the auxiliary device commands those
attachments need, so no file should be described as a native sequin or chenille
file. Validation adds `SPECIALTY_SIMULATION`.

**Machine assignment is routing, not a queue.** Each machine file is compiled
and validated on its own, but there is no network connection to a machine, no
status feedback and no automatic balancing. An object assigned to one machine
is not split; move or duplicate geometry if work must be shared.

**The lit preview is only a preview.** It draws a shadow and highlight pass on
satin runs. It does not alter stitch order, density or encoding.

**Test coverage.** The Phase N/O work adds engine tests for all six fonts,
clipart placement, SVG/PDF/print output, cap round trips, machine grouping and
the four specialty generators; client tests for the inspector, clipart browser,
artwork dialog, store actions and per-machine export; and server round trips for
fonts, specialty values, machine and cap fields. The workspace total is 1,202
tests (723 engine, 76 server, 403 client).
