# Feature matrix

An honest, feature-by-feature status list for ThreadWorks Studio.

The **Reference** column names the equivalent capability in commercial
digitizing suites (Wilcom EmbroideryStudio among them) purely to describe the
intent of the feature. The **Status** column describes _this_ application
only, and is the one to trust.

Status legend:

| Mark | Meaning                                          |
| ---- | ------------------------------------------------ |
| ✅   | Implemented, wired into the UI, covered by tests |
| 🟡   | Partial — present but with a stated restriction  |
| ❌   | Not implemented                                  |

---

## 1. Digitizing tools

| Feature                                               | Reference                  | Status | Notes                                                                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual point-by-point digitizing                      | Input / Complex Fill tools | ✅     | click points, Enter/double-click to close, Esc to cancel                                                                                                                                                         |
| Satin column (two rails)                              | Input A / Input B          | 🟡     | Two-rail satin works (Input A). **Input B and Input C are not implemented**; there is one column tool                                                                                                            |
| Complex Fill (closed outline)                         | Complex Fill               | ✅     | even-odd holes supported                                                                                                                                                                                         |
| Single run outline                                    | Run                        | ✅     |                                                                                                                                                                                                                  |
| Bean / triple run                                     | Bean stitch                | ✅     |                                                                                                                                                                                                                  |
| Rectangle / circle shape tools                        | Shape tools                | ✅     | drag to draw                                                                                                                                                                                                     |
| Polyline open path                                    | —                          | ✅     | treated as a column stroke                                                                                                                                                                                       |
| Selection, multi-select, move                         | ✅                         | ✅     | Shift+click to add                                                                                                                                                                                               |
| Duplicate                                             | ✅                         | ✅     | `Ctrl+D`                                                                                                                                                                                                         |
| Delete                                                | ✅                         | ✅     | Del / Backspace                                                                                                                                                                                                  |
| Undo / redo                                           | ✅                         | ✅     | depth is a preference, 5–500 steps (default 60); lowering it trims the live stack                                                                                                                                |
| Z-order (sewing order)                                | Object order               | ✅     | Bring forward / Send back                                                                                                                                                                                        |
| Lock object                                           | lock                       | ✅     | checkbox in the panel; locked objects are skipped by hit testing, so they cannot be selected or dragged                                                                                                          |
| Hide object                                           | show/hide                  | ✅     | hidden objects generate no stitches                                                                                                                                                                              |
| Groups                                                | group                      | ✅     | `Ctrl+G` / `Ctrl+Shift+G` plus panel buttons; clicking a member selects the group, the group moves and rotates as one, duplicating a group keeps it together                                                     |
| Rotation / mirror / scale transform                   | transform                  | ✅     | flip horizontal/vertical, rotate ±90°, scale ±10% about the middle; every change is baked into the path coordinates and is one undo step                                                                         |
| Shape combine (weld / combine / subtract / intersect) | Shaping tools              | ✅     | boolean outlines: weld merges overlapping shapes, combine keeps exactly-once coverage so an overlap becomes a hole, subtract cuts the rest out of the first, intersect keeps only the shared area; one undo step |
| Offset / Offset Advanced                              | Offset                     | ✅     | one or several concentric offset copies in one action, positive grows and negative shrinks, with miter / bevel / round corners; self-intersections are removed so the result is always a clean sewable outline   |
| Border outline                                        | Border                     | ✅     | a run outline around the shape at a chosen distance; a frame gets its outer edge and its hole as two separate runs                                                                                               |
| Rounded corners                                       | Rounded Corners            | ✅     | arcs tangent to both edges; the radius is reduced automatically where the shape is too small, so neighbouring corners cannot overrun each other                                                                  |
| Center all                                            | Center All                 | ✅     | moves every object so the combined design sits in the middle of the hoop                                                                                                                                         |
| Node editing (move individual points)                 | node editor                | ✅     | the `N` tool drags a vertex; one gesture is one undo step                                                                                                                                                        |
| Free-hand / trace-from-image digitizing               | Trace tools                | ✅     | "Trace image" in the top bar: colours, preview, detail, density                                                                                                                                                  |
| Photo stitch (Colour Photo Stitch / Photo Flash)      | Photo tools                | ✅     | photo to cell mosaic, one object per thread, satin / run / cross cells, 2-24 colours, 20,000-cell ceiling                                                                                                        |
| Auto-Digitizing from a bitmap                         | Auto-Digitize              | ✅     | median-cut colours, exact outline tracing with holes, noise filtering, per-shape fill angle, solid-surround removal                                                                                              |
| Appliqué                                              | Appliqué                   | ✅     | placement run, stops, tack, satin finish; full or partial edge; fabric tint in preview                                                                                                                           |
| Crosshatch / programmed split fill                    | Crosshatch                 | ✅     | selectable fill patterns: 12 mm blocks with 1.5 mm gaps (programmed split), the same idea with breaks that follow the row width (flexi split), and a true two-pass cross hatch at 90°                            |
| Advanced fill textures                                | Embroidery effects         | ✅     | accordion, florentine, liquid, maze, string, laydown, stipple, shading, hand stitch, plus jagged edge and 3D warp riding the tatami generator; every texture is seeded from the shape, so preview and file agree |
| Continue Digitizing                                   | Continue Digitizing        | ✅     | reopens the selected object's outer ring as the live draft, appends points and commits in place; id, thread, holes and parameters survive                                                                        |
| Redwork automation                                    | Redwork                    | ✅     | selected outlines sew as one-colour line work in single / triple / backstitch / stem styles; geometry is kept, so removal restores the fill                                                                      |

---

## 2. Stitch types

| Type                        | Reference                             | Status | Notes                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Satin                       | Satin                                 | ✅     | rail-to-rail, with pull compensation and stitch splitting                                                                                                                                                                                                                                                |
| Tatami                      | Tatami / Fill                         | ✅     | serpentine rows, offset pattern, edge inset                                                                                                                                                                                                                                                              |
| Run                         | Single run                            | ✅     |                                                                                                                                                                                                                                                                                                          |
| Bean / triple               | Triple run                            | ✅     |                                                                                                                                                                                                                                                                                                          |
| Contour                     | Contour                               | ✅     | offset rows following the outline                                                                                                                                                                                                                                                                        |
| Spiral                      | Spiral                                | ✅     |                                                                                                                                                                                                                                                                                                          |
| Motif fill                  | Motif fill                            | ✅     | nine motif fills (star, diamond, circle, square, cross, hexagon, heart, flower) plus a **shape library** you can add your own motifs to; a library shape is carried by the design, so it keeps sewing even if the library entry is later renamed or deleted                                              |
| Motif run / single / column | Motif run, Motif single, Motif column | ✅     | the same motif engine in three other layouts: **run** places motifs along the outline and turns each with the tangent (closed outlines wrap), **single** scales exactly one stamp to the drawn box, **column** spans each motif rail to rail and steps along the column                                  |
| Programmable split          | Programmable split                    | ✅     | selectable fill patterns: blocks break every 12 mm with a 1.5 mm gap and alternate rows staggered by half a block; **user-defined split** edits block length, break and stagger per object, and resetting restores those built-in numbers; flexible split makes the block length follow each row's width |
| Crosshatch                  | Crosshatch                            | ✅     | fill pattern that sews one pass at the fill angle and one perpendicular; the second pass starts with a needle-up move                                                                                                                                                                                    |
| appliqué / edging           | —                                     | ✅     | satin finish pass on any fill/column; placement, tack and stops included                                                                                                                                                                                                                                 |
| Redwork line                | Redwork                               | ✅     | single run, triple run (three passes), backstitch (forward / back), or stem (slanted overlapping stitches); one thread, corners preserved                                                                                                                                                                |

---

## 3. Stitch parameters

| Feature                            | Reference                          | Status | Notes                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density / spacing                  | Density                            | ✅     | 0.05–10 mm, live preview                                                                                                                                                                                                                                                                       |
| Stitch angle                       | Angle                              | ✅     |                                                                                                                                                                                                                                                                                                |
| Maximum stitch length              | Max stitch length                  | ✅     | validated against the 12.1 mm DST limit                                                                                                                                                                                                                                                        |
| Minimum stitch length              | Min stitch length                  | ✅     | editable in the right panel (default 0.3 mm); generation merges stitches closer than it with a shape-preserving merge — jumps, trims and colour changes are barriers and a run's final point is always kept                                                                                    |
| Pull compensation                  | Pull compensation                  | ✅     | applied by satin and tatami generators                                                                                                                                                                                                                                                         |
| Separate pull compensation         | Separate pull                      | ✅     | independent left/right satin values, applied rail by rail; absent or cleared falls back to the single value                                                                                                                                                                                    |
| Fill pattern selection             | fill pattern                       | ✅     | reads the `fillPattern` field when the stitch type is tatami: tatami, motif, contour, spiral, programmed split, flexi split, accordion, florentine, liquid, maze, string, laydown, stipple, cross, shading, hand, jagged, warp; `tatami` output is byte-identical to before the option existed |
| Motif layout                       | Motif fill / run / single / column | ✅     | `motifMode` picks the layout for any motif object; absent means a gridded fill                                                                                                                                                                                                                 |
| Motif gradient                     | Gradient motifs                    | ✅     | scale and rotation lerp from the first motif to the last across fill rows, run stations or column steps; absent means one uniform size; not offered for a single stamp                                                                                                                         |
| User-defined split                 | User-defined split                 | ✅     | block length, break and stagger editable per object; fields start at 12 mm / 1.5 mm / 50% and reset to them                                                                                                                                                                                    |
| Underlay: none                     | ✅                                 | ✅     |                                                                                                                                                                                                                                                                                                |
| Underlay: center run               | ✅                                 | ✅     |                                                                                                                                                                                                                                                                                                |
| Underlay: edge run                 | ✅                                 | ✅     |                                                                                                                                                                                                                                                                                                |
| Underlay: zigzag                   | ✅                                 | ✅     |                                                                                                                                                                                                                                                                                                |
| Underlay: tatami                   | ✅                                 | ✅     | also the base layer intended for foam work                                                                                                                                                                                                                                                     |
| Underlay row spacing / edge offset | ✅                                 | ✅     | editable in the right panel                                                                                                                                                                                                                                                                    |
| Tie-in (lock at start)             | Tie-in / tie-off                   | ✅     | per object, on by default                                                                                                                                                                                                                                                                      |
| Tie-off (lock at end)              | Tie-in / tie-off                   | ✅     |                                                                                                                                                                                                                                                                                                |
| Lock length and count              | ✅                                 | 🟡     | engine honours `length`/`count`; the UI only exposes on/off                                                                                                                                                                                                                                    |
| Manual entry / exit point          | Entry/exit                         | ✅     | arm the entry or the exit, click on the shape to place it, clear to fall back to automatic; a guessed exit is derived from the entry rather than picked independently                                                                                                                          |
| Colour-run optimisation            | colour sequencing                  | ✅     | same thread sewn together, nearest colour block chosen next, toggle in the panel                                                                                                                                                                                                               |

---

## 4. Thread and colour

| Feature                                     | Reference       | Status | Notes                                                                                                         |
| ------------------------------------------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Thread palette (add/edit/remove)            | Palette         | ✅     |                                                                                                               |
| Apply palette preset                        | Palette sets    | ✅     | "Basic 18" seeded                                                                                             |
| Assign colour to object                     | ✅              | ✅     |                                                                                                               |
| Colour index clamping on delete             | ✅              | ✅     | objects pointing at a removed colour are corrected                                                            |
| Empty palette guard                         | ✅              | ✅     | the last colour cannot be deleted                                                                             |
| Thread brands / charts (Madeira, Isacord …) | thread charts   | ❌     | no licensed charts; colours are `code + name + hex`                                                           |
| Colour blending / gradient fills            | Colour blending | 🟡     | two or more fills blend in one undo step, with a density control; there is no continuous gradient fill _type_ |
| Automatic colour sort                       | —               | ✅     | nearest colour block next, within a short travel order; off by default, session preference                    |

---

## 5. Hooping

| Feature                                                           | Reference      | Status | Notes                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select hoop                                                       | hoop selection | ✅     | 8 built-ins incl. round and cap frame                                                                                                                                                                                                                                                                         |
| Custom hoop presets                                               | hoop presets   | ✅     | create/edit/delete via the presets API                                                                                                                                                                                                                                                                        |
| Design vs hoop validation                                         | hoop check     | ✅     | field and safe margin checked; export refused on error                                                                                                                                                                                                                                                        |
| Hoop overlay on canvas                                            | ✅             | ✅     | field, safe area, round/oval rendering                                                                                                                                                                                                                                                                        |
| Multiple hoops in one design                                      | —              | ❌     | one hoop per design document                                                                                                                                                                                                                                                                                  |
| **Auto-hooping** (pick the hoop a design fits)                    | Auto-hooping   | ✅     | picks the smallest hoop that fits, can turn the design a quarter turn; the rotation is a real undoable edit                                                                                                                                                                                                   |
| **Multi-hoop splitting** (sew one design across several hoopings) | Multi-hooping  | ✅     | splits the compiled stitches into one section per re-hooping; cuts prefer travel points, one hoop chosen for the whole design, each section exported as its own DST/PES/EXP/JEF file. **Shared overlap band and registration crosses** at every join — see [known-limitations.md](known-limitations.md) §3    |
| Multi-hooping alignment / overlap / registration marks            | Multi-hooping  | ✅     | **Overlap** spreads the cut across a band (clamped so the walk still moves forward) so consecutive sections sew the same strip twice; **registration crosses** sew a cross at each boundary, on the ending section and the beginning one, at the same design coordinate. Still no freehand nudge of a section |
| Cap frame special handling (270° wrap, driver)                    | cap digitizing | 🟡     | an 80×180 hoop preset exists; **no wrap or driver compensation**                                                                                                                                                                                                                                              |
| Multi-head / machine assignment                                   | —              | ❌     |                                                                                                                                                                                                                                                                                                               |

---

## 6. Preview and verification

| Feature                                | Reference           | Status | Notes                                                                                                              |
| -------------------------------------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Live stitch preview                    | 3D / stitch preview | ✅     | Canvas 2D, batched runs                                                                                            |
| Underlay shown in preview              | ✅                  | ✅     | rendered as white/lock-weight lines                                                                                |
| Jump / travel shown                    | ✅                  | ✅     | dashed, dimmed                                                                                                     |
| Grid and rulers                        | ✅                  | ✅     | independent minor step and major spacing, major lines drawn heavier                                                |
| Snap to grid                           | ✅                  | ✅     | minor-grid rounding                                                                                                |
| Snap to object geometry                | Snap to Object      | ✅     | node > edge > centre priority, 8 px threshold, then grid; hidden objects and the dragged object itself are skipped |
| Zoom / pan                             | ✅                  | ✅     | cursor-anchored zoom, wheel pan, middle-drag                                                                       |
| **Stitch player** (sew-out simulation) | stitch simulator    | ✅     | play/pause/rewind, scrub, 0.25×–8×, needle-head marker, `Space`                                                    |
| Real stitch statistics                 | ✅                  | ✅     | counts read from the compiled sequence, never estimated                                                            |
| Validation messages                    | design check        | ✅     | 14 checks; errors block export                                                                                     |
| 3D / angled rendering with light       | 3D view             | ❌     | flat rendering only                                                                                                |
| Thread-coloured true-to-life render    | —                   | 🟡     | uses palette hex; no sheen, thickness or fabric simulation                                                         |

---

## 7. Lettering

| Feature                   | Reference    | Status | Notes                                                                                                                                               |
| ------------------------- | ------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lettering / text tool     | Lettering    | ✅     | text, cap height, stroke width, width scale, spacing, slant, rotation and mirrors; the spec is saved with the design                                |
| Built-in embroidery fonts | font library | 🟡     | one single-stroke font ships; a character outside the glyph table is substituted with `?` and the substitution is counted                           |
| Monogramming              | Monogramming | ✅     | up to three initials, the middle one larger with the sides centred and optionally mirrored, plus an optional circle/oval/diamond satin frame        |
| Text on a path            | —            | ✅     | follows any selected shape's outline, letters rotate with the tangent or stay upright, offset and start/centre alignment                            |
| Resequencing              | Resequence   | ✅     | reading order, reverse, outside-in or inside-out; the needle order changes, nothing moves                                                           |
| Team-name dropped letter  | —            | ✅     | any character can sew larger and drop below the line, top-aligned, with a chosen scale                                                              |
| Lettering size limits     | —            | ✅     | sizes outside the sewable range produce warnings (too small, too large, stroke wider than the cap height, one-point path) rather than silent damage |

Lettering is a real object type with its own generator: the panel takes the
text and its layout, and the engine lays it out glyph by glyph into stitches.
The advanced layouts all share that one generator, so the monogram frame, the
path letters and the dropped letter behave exactly like hand-digitized satin.
Text has no editable path by design; selection, moving, rotating, scaling and
flipping go through the spec, which is stored with the design so a saved
monogram reopens as the same monogram.

---

## 8. Advanced techniques

| Feature                               | Reference      | Status | Notes                                                                                                                                                                                                    |
| ------------------------------------- | -------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3D Foam / puff                        | 3D Puff        | ✅     | satin over a foam sheet: underlay dropped for a light tack, spacing capped at 0.30 mm so no foam shows, column pulls wider by 0.35 × thickness per side to wrap the edge; works on columns and lettering |
| Carving stamp                         | Carving Stamp  | ✅     | a repeating stamp (diamond, circle, star, cross, hexagon) punched out of a tatami fill; grid follows the fill angle, holes are crossed by jumps, optional run outline around each stamp                  |
| Color blending                        | Color Blending | ✅     | two or more fills blend in one undo step, density control, same stitching path for every layer                                                                                                           |
| Contour / carving runs                | —              | ✅     | contour is a fill pattern option, and carving is an object property (a stamp punched out of a tatami fill, holes crossed by jumps, optional run outline)                                                 |
| Appliqué placement, tack-down, finish | Appliqué       | ✅     | three real passes with machine stops between them; partial mode covers a chosen stretch of the edge                                                                                                      |
| Motif library                         | motif sets     | ✅     | nine built-ins, a library of your own motifs/stamps, capture from the canvas or paste SVG/coordinates; designs carry the shape they use                                                                  |
| Branch / leaf generator               | —              | ❌     |                                                                                                                                                                                                          |

---

## 9. Files and interchange

| Feature                                  | Status | Notes                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native project store (MongoDB)           | ✅     | versioned, validated, local                                                                                                                                                                                                                                                       |
| Open / search projects                   | ✅     |                                                                                                                                                                                                                                                                                   |
| Optimistic concurrency (409 on conflict) | ✅     | prevents a stale tab overwriting newer work                                                                                                                                                                                                                                       |
| Autosave                                 | ✅     | configurable interval, only when dirty and named                                                                                                                                                                                                                                  |
| **Version history**                      | ✅     | saving a project whose design actually differs snapshots the outgoing state first; manual checkpoints; restore (which checkpoints what it replaced first, so it is itself undoable); 30 per project, fetched one at a time so the list stays small                                |
| **Recent files**                         | ✅     | upserted on open, 20 kept, forget one or clear all; a project deleted underneath is dropped with a message instead of failing to open                                                                                                                                             |
| **Tajima DST export**                    | ✅     | real encoder, validation-gated, `writeDst()`; byte-identical to pyembroidery                                                                                                                                                                                                      |
| **Brother PES export**                   | ✅     | real encoder (PES v1 + PEC), `writePes()`; rows normalised the way the reference normalises them, de-duplicated Brother palette, drawn hoop-icon thumbnails; byte-identical to pyembroidery                                                                                       |
| **Melco EXP export**                     | ✅     | real encoder, `writeExp()`; byte-identical to pyembroidery                                                                                                                                                                                                                        |
| **Janome JEF export**                    | ✅     | real encoder, `writeJef()`, Janome colour-library matching, hoop declared from the design size; byte-identical to pyembroidery                                                                                                                                                    |
| **Husqvarna VP3 export**                 | ✅     | real encoder, `writeVp3()`, carries full thread colour / name / number / brand; byte-identical to pyembroidery                                                                                                                                                                    |
| **TBF export**                           | ✅     | real encoder, `writeTbf()`, needle-order table and the whole palette carried, label capped at the field width; byte-identical to pyembroidery                                                                                                                                     |
| **Husqvarna HUS export**                 | ✅     | real encoder, `writeHus()`, compressed streams, threads snapped to the machine's library; pyembroidery's own reader agrees on every case                                                                                                                                          |
| **Machine file import**                  | ✅     | "Import" reads DST / PES / PEC / EXP / JEF / VP3 / TBF / HUS, previews with the movie's renderer, recovers Brother, Janome or Husqvarna colours where the format stores them, and saves as another format or a stitch video; `detectFormat()`, `importMachineFile()`              |
| SVG/PNG/PDF art export                   | ❌     |                                                                                                                                                                                                                                                                                   |
| **Stitch video**                         | ✅     | animated GIF: our own GIF89a encoder (LZW) plus a software rasteriser, needle marker and live counter; verified against Pillow; rendered on a Web Worker thread so the editor stays live, with a main-thread fallback where workers cannot be created (`client/src/video/gif.ts`) |
| Backup / restore                         | ✅     | `backup.bat`, `restore.bat`, replace or merge                                                                                                                                                                                                                                     |
| Cloud sync / accounts                    | ❌     | deliberately local-only                                                                                                                                                                                                                                                           |
| Print / hoop placement sheets            | ❌     |                                                                                                                                                                                                                                                                                   |

---

## 10. Editor experience

| Feature                          | Status | Notes                                                                                                                                                                                                                                    |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard shortcuts               | ✅     | V, H, N, Enter, Esc, Del, Space, Ctrl+Z/Y/D, Ctrl+G / Ctrl+Shift+G                                                                                                                                                                       |
| Tool hints                       | ✅     |                                                                                                                                                                                                                                          |
| Right-hand properties panel      | ✅     |                                                                                                                                                                                                                                          |
| Auto-sequencing (branching)      | ✅     | reorders the object list for shortest travel, one undo step; keeps colour blocks when optimise is on                                                                                                                                     |
| Status bar with validation       | ✅     |                                                                                                                                                                                                                                          |
| Start / stop scripts for Windows | ✅     | `start.bat`, `dev.bat`, `shutdown.bat`                                                                                                                                                                                                   |
| **Preferences UI**               | ✅     | default hoop, autosave interval, undo depth, minor grid size, major grid spacing, player speed, show grid, show rulers, snap to grid, snap to objects, underlay in preview; saving the undo depth also trims the stack already in memory |
| Multi-language UI                | ❌     | English only                                                                                                                                                                                                                             |
| Customisable key bindings        | ❌     | the list above is fixed                                                                                                                                                                                                                  |

---

## 11. Stored data model fields

Kept here so "supported" is not overstated. Most of these are read now; the
ones that are not are named as such:

| Field                                                                                                                                                       | Reality                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fillPattern`                                                                                                                                               | **read** — routes tatami fills to tatami / motif / contour / spiral / programmed split                                                                                                                                                                                    |
| `minStitchLength`                                                                                                                                           | **read** — shape-preserving merge of stitches closer than it, jumps and trims as barriers                                                                                                                                                                                 |
| `entryExit.entry` / `.exit`                                                                                                                                 | **read** — honoured when set, placed with the entry/exit tool; a guessed exit derives from the entry                                                                                                                                                                      |
| `groupId`                                                                                                                                                   | **read** — group / ungroup, group-aware click selection, group transforms                                                                                                                                                                                                 |
| `transform.x` / `.y`                                                                                                                                        | **read** — the lettering generator anchors at the object's position                                                                                                                                                                                                       |
| `transform` as a whole                                                                                                                                      | placement only: flip, rotate and scale are **baked into the path coordinates** by the editor, so the outline, the preview and the machine file stay one truth; the rotation/scale/mirror flags an older build stored were never read and have been removed from the model |
| `locked`                                                                                                                                                    | stored **and enforced**: a locked object is skipped by hit testing, so it cannot be selected or dragged                                                                                                                                                                   |
| `designVersions` collection                                                                                                                                 | **written** — automatic snapshots of the outgoing design on real changes, manual checkpoints, restore; capped at 30 per project and cleaned on delete                                                                                                                     |
| `recentFiles` collection                                                                                                                                    | **written** — upserted when a project opens, capped at 20, cleaned on delete; stale pointers are dropped rather than failing to open                                                                                                                                      |
| settings `showGrid`, `showRulers`, `gridSize`, `snapToGrid`, `autosaveIntervalMs`, `defaultHoopId`, `previewUnderlay`, `stitchSimulationSpeed`, `undoDepth` | all **consulted** by the editor                                                                                                                                                                                                                                           |
| settings `units`                                                                                                                                            | shown read-only: the application works in millimetres only, which is what imported designs declare                                                                                                                                                                        |
| settings `defaultStitchType`                                                                                                                                | **applied** — decides what a freshly drawn complex fill starts as (read when the shape commits; traced regions honour it too). Column, run and bean tools keep the stitch type they already mean                                                                          |

---

## 12. Honest summary

**Working end to end today:** manual digitizing with seven stitch types,
underlay and tie-off control, node editing, transforms (flip, scale, rotate),
grouping, lettering with monograms, text on a path, resequencing and team-name
drops, auto-hooping, colour blending, thread palettes, hoop
selection with validation, live preview, a stitch player, undo/redo with a
configurable depth, save/open with conflict detection, version history with
checkpoints and restore, a recent-files list, backup/restore, genuine
DST / PES / EXP / JEF / VP3 / TBF / HUS export — the first four byte-identical
to pyembroidery, HUS verified through its own reader, machine-file import
that reads a client's DST / PES / PEC / EXP / JEF / VP3 / TBF / HUS for
preview, conversion or filming, auto-digitizing from a photo, stitch video as an
animated GIF, 3D foam
(puff) that sews a satin column over a foam sheet the way it actually needs, a
carving stamp that punches a repeating pattern into a tatami fill, eighteen fill
patterns (tatami, motif, contour, spiral, programmed split, flexi split,
accordion, florentine, liquid, maze, string, laydown, stipple, cross, shading,
hand, jagged, warp), hand-set entry and exit,
a minimum stitch length that really merges, and multi-hoop splitting with a
shared overlap band and registration crosses at every join. A patch can be a
real appliqué — placement run, machine stop, tack, stop for trimming, satin
finish — full or partial, and the editor has weld/combine/subtract/intersect,
offset copies, border outlines, rounded corners and center-all. A photograph
becomes embroidery either as traced vector regions or as a Colour Photo Stitch
mosaic of per-thread cell blocks, with the Photo Flash preset when speed
matters more than detail.

**Not built:** art export to SVG / PNG / PDF, licensed
thread charts, 3D / lit rendering, and
customisable key bindings.

Development decisions — including what each format can and cannot carry, and
what "local-only" means in practice — are in
[format-support.md](format-support.md), [known-limitations.md](known-limitations.md)
and [architecture.md](architecture.md).
