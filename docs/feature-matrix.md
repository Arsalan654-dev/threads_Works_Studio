# Feature matrix

An honest, feature-by-feature status list for ThreadWorks Studio.

The **Reference** column names the equivalent capability in commercial
digitizing suites (Wilcom EmbroideryStudio among them) purely to describe the
intent of the feature. The **Status** column describes _this_ application
only, and is the one to trust.

Status legend:

| Mark | Meaning                                          |
| ---- | ------------------------------------------------ |
| âœ…   | Implemented, wired into the UI, covered by tests |
| ðŸŸ¡   | Partial â€” present but with a stated restriction  |
| âŒ   | Not implemented                                  |

---

## 1. Digitizing tools

| Feature                                               | Reference                  | Status | Notes                                                                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual point-by-point digitizing                      | Input / Complex Fill tools | âœ…     | click points, Enter/double-click to close, Esc to cancel                                                                                                                                                         |
| Satin column (two rails)                              | Input A / Input B          | ðŸŸ¡     | Two-rail satin works (Input A). **Input B and Input C are not implemented**; there is one column tool                                                                                                            |
| Complex Fill (closed outline)                         | Complex Fill               | âœ…     | even-odd holes supported                                                                                                                                                                                         |
| Single run outline                                    | Run                        | âœ…     |                                                                                                                                                                                                                  |
| Bean / triple run                                     | Bean stitch                | âœ…     |                                                                                                                                                                                                                  |
| Rectangle / circle shape tools                        | Shape tools                | âœ…     | drag to draw                                                                                                                                                                                                     |
| Polyline open path                                    | â€”                          | âœ…     | treated as a column stroke                                                                                                                                                                                       |
| Selection, multi-select, move                         | âœ…                         | âœ…     | Shift+click to add                                                                                                                                                                                               |
| Duplicate                                             | âœ…                         | âœ…     | `Ctrl+D`                                                                                                                                                                                                         |
| Delete                                                | âœ…                         | âœ…     | Del / Backspace                                                                                                                                                                                                  |
| Undo / redo                                           | âœ…                         | âœ…     | depth is a preference, 5â€“500 steps (default 60); lowering it trims the live stack                                                                                                                                |
| Z-order (sewing order)                                | Object order               | âœ…     | Bring forward / Send back                                                                                                                                                                                        |
| Lock object                                           | lock                       | âœ…     | checkbox in the panel; locked objects are skipped by hit testing, so they cannot be selected or dragged                                                                                                          |
| Hide object                                           | show/hide                  | âœ…     | hidden objects generate no stitches                                                                                                                                                                              |
| Groups                                                | group                      | âœ…     | `Ctrl+G` / `Ctrl+Shift+G` plus panel buttons; clicking a member selects the group, the group moves and rotates as one, duplicating a group keeps it together                                                     |
| Rotation / mirror / scale transform                   | transform                  | âœ…     | flip horizontal/vertical, rotate Â±90Â°, scale Â±10% about the middle; every change is baked into the path coordinates and is one undo step                                                                         |
| Shape combine (weld / combine / subtract / intersect) | Shaping tools              | âœ…     | boolean outlines: weld merges overlapping shapes, combine keeps exactly-once coverage so an overlap becomes a hole, subtract cuts the rest out of the first, intersect keeps only the shared area; one undo step |
| Offset / Offset Advanced                              | Offset                     | âœ…     | one or several concentric offset copies in one action, positive grows and negative shrinks, with miter / bevel / round corners; self-intersections are removed so the result is always a clean sewable outline   |
| Border outline                                        | Border                     | âœ…     | a run outline around the shape at a chosen distance; a frame gets its outer edge and its hole as two separate runs                                                                                               |
| Rounded corners                                       | Rounded Corners            | âœ…     | arcs tangent to both edges; the radius is reduced automatically where the shape is too small, so neighbouring corners cannot overrun each other                                                                  |
| Center all                                            | Center All                 | âœ…     | moves every object so the combined design sits in the middle of the hoop                                                                                                                                         |
| Node editing (move individual points)                 | node editor                | âœ…     | the `N` tool drags a vertex; one gesture is one undo step                                                                                                                                                        |
| Free-hand / trace-from-image digitizing               | Trace tools                | âœ…     | "Trace image" in the top bar: clear source preview, full-size reference underlay, colours, detail, density, optional auto-generated photo mosaic or colour-region trace                                                                                    |
| Photo stitch (Colour Photo Stitch / Photo Flash)      | Photo tools                | âœ…     | photo to cell mosaic, one object per thread, satin / run / cross cells, 2-24 colours, 20,000-cell ceiling; the source can stay behind as a faded guide                                                                                                        |
| Reference image under the canvas                      | Trace tools                | âœ…     | stored with the project as a compressed image, drawn under the stitches at any size/position, opacity and visibility adjustable, never sewn or exported                                                                                                                       |
| Auto-Digitizing from a bitmap | Auto-Digitize | Yes | median-cut colours, exact outline tracing with holes, noise filtering, per-shape fill angle, solid-surround removal |
| Built-in clipart browser | clipart library | Yes | 17 original parametric shapes in categories, searchable, inserted as editable complex fills at a chosen physical size |
| AppliquÃ©                                              | AppliquÃ©                   | âœ…     | placement run, stops, tack, satin finish; full or partial edge; fabric tint in preview                                                                                                                           |
| Crosshatch / programmed split fill                    | Crosshatch                 | âœ…     | selectable fill patterns: 12 mm blocks with 1.5 mm gaps (programmed split), the same idea with breaks that follow the row width (flexi split), and a true two-pass cross hatch at 90Â°                            |
| Advanced fill textures                                | Embroidery effects         | âœ…     | accordion, florentine, liquid, maze, string, laydown, stipple, shading, hand stitch, plus jagged edge and 3D warp riding the tatami generator; every texture is seeded from the shape, so preview and file agree |
| Continue Digitizing                                   | Continue Digitizing        | âœ…     | reopens the selected object's outer ring as the live draft, appends points and commits in place; id, thread, holes and parameters survive                                                                        |
| Redwork automation                                    | Redwork                    | âœ…     | selected outlines sew as one-colour line work in single / triple / backstitch / stem styles; geometry is kept, so removal restores the fill                                                                      |

---

## 2. Stitch types

| Type                        | Reference                             | Status | Notes                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Satin                       | Satin                                 | âœ…     | rail-to-rail, with pull compensation and stitch splitting                                                                                                                                                                                                                                                |
| Tatami                      | Tatami / Fill                         | âœ…     | serpentine rows, offset pattern, edge inset                                                                                                                                                                                                                                                              |
| Run                         | Single run                            | âœ…     |                                                                                                                                                                                                                                                                                                          |
| Bean / triple               | Triple run                            | âœ…     |                                                                                                                                                                                                                                                                                                          |
| Contour                     | Contour                               | âœ…     | offset rows following the outline                                                                                                                                                                                                                                                                        |
| Spiral                      | Spiral                                | âœ…     |                                                                                                                                                                                                                                                                                                          |
| Motif fill                  | Motif fill                            | âœ…     | eight motif fills (star, diamond, circle, square, cross, hexagon, heart, flower) plus a **shape library** you can add your own motifs to; a library shape is carried by the design, so it keeps sewing even if the library entry is later renamed or deleted                                             |
| Motif run / single / column | Motif run, Motif single, Motif column | âœ…     | the same motif engine in three other layouts: **run** places motifs along the outline and turns each with the tangent (closed outlines wrap), **single** scales exactly one stamp to the drawn box, **column** spans each motif rail to rail and steps along the column                                  |
| Programmable split          | Programmable split                    | âœ…     | selectable fill patterns: blocks break every 12 mm with a 1.5 mm gap and alternate rows staggered by half a block; **user-defined split** edits block length, break and stagger per object, and resetting restores those built-in numbers; flexible split makes the block length follow each row's width |
| Crosshatch                  | Crosshatch                            | âœ…     | fill pattern that sews one pass at the fill angle and one perpendicular; the second pass starts with a needle-up move                                                                                                                                                                                    |
| appliquÃ© / edging           | â€”                                     | âœ…     | satin finish pass on any fill/column; placement, tack and stops included                                                                                                                                                                                                                                 |
| Redwork line | Redwork | Yes | single run, triple run (three passes), backstitch (forward / back), or stem (slanted overlapping stitches); one thread, corners preserved |
| Sequins, beading, chenille, schiffli | specialty stitches | Partial | generated as standard needle penetrations with distinct repeat geometry; the machine files do not carry sequin, bead or chenille device codes, and validation says so |

---

## 3. Stitch parameters

| Feature                            | Reference                          | Status | Notes                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density / spacing | Density | Yes | 0.05-20 mm, live preview; the wider upper bound serves the specialty repeat pitches |
| Stitch angle                       | Angle                              | âœ…     |                                                                                                                                                                                                                                                                                                |
| Maximum stitch length              | Max stitch length                  | âœ…     | validated against the 12.1 mm DST limit                                                                                                                                                                                                                                                        |
| Minimum stitch length              | Min stitch length                  | âœ…     | editable in the right panel (default 0.3 mm); generation merges stitches closer than it with a shape-preserving merge â€” jumps, trims and colour changes are barriers and a run's final point is always kept                                                                                    |
| Pull compensation                  | Pull compensation                  | âœ…     | applied by satin and tatami generators                                                                                                                                                                                                                                                         |
| Separate pull compensation         | Separate pull                      | âœ…     | independent left/right satin values, applied rail by rail; absent or cleared falls back to the single value                                                                                                                                                                                    |
| Fill pattern selection             | fill pattern                       | âœ…     | reads the `fillPattern` field when the stitch type is tatami: tatami, motif, contour, spiral, programmed split, flexi split, accordion, florentine, liquid, maze, string, laydown, stipple, cross, shading, hand, jagged, warp; `tatami` output is byte-identical to before the option existed |
| Motif layout                       | Motif fill / run / single / column | âœ…     | `motifMode` picks the layout for any motif object; absent means a gridded fill                                                                                                                                                                                                                 |
| Motif gradient                     | Gradient motifs                    | âœ…     | scale and rotation lerp from the first motif to the last across fill rows, run stations or column steps; absent means one uniform size; not offered for a single stamp                                                                                                                         |
| User-defined split                 | User-defined split                 | âœ…     | block length, break and stagger editable per object; fields start at 12 mm / 1.5 mm / 50% and reset to them                                                                                                                                                                                    |
| Underlay: none                     | âœ…                                 | âœ…     |                                                                                                                                                                                                                                                                                                |
| Underlay: center run               | âœ…                                 | âœ…     |                                                                                                                                                                                                                                                                                                |
| Underlay: edge run                 | âœ…                                 | âœ…     |                                                                                                                                                                                                                                                                                                |
| Underlay: zigzag                   | âœ…                                 | âœ…     |                                                                                                                                                                                                                                                                                                |
| Underlay: tatami                   | âœ…                                 | âœ…     | also the base layer intended for foam work                                                                                                                                                                                                                                                     |
| Underlay row spacing / edge offset | âœ…                                 | âœ…     | editable in the right panel                                                                                                                                                                                                                                                                    |
| Tie-in (lock at start)             | Tie-in / tie-off                   | âœ…     | per object, on by default                                                                                                                                                                                                                                                                      |
| Tie-off (lock at end)              | Tie-in / tie-off                   | âœ…     |                                                                                                                                                                                                                                                                                                |
| Lock length and count              | âœ…                                 | ðŸŸ¡     | engine honours `length`/`count`; the UI only exposes on/off                                                                                                                                                                                                                                    |
| Manual entry / exit point          | Entry/exit                         | âœ…     | arm the entry or the exit, click on the shape to place it, clear to fall back to automatic; a guessed exit is derived from the entry rather than picked independently                                                                                                                          |
| Colour-run optimisation            | colour sequencing                  | âœ…     | same thread sewn together, nearest colour block chosen next, toggle in the panel                                                                                                                                                                                                               |

---

## 4. Thread and colour

| Feature                                     | Reference       | Status | Notes                                                                                                         |
| ------------------------------------------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Thread palette (add/edit/remove)            | Palette         | âœ…     |                                                                                                               |
| Apply palette preset                        | Palette sets    | âœ…     | "Basic 18" seeded                                                                                             |
| Assign colour to object                     | âœ…              | âœ…     |                                                                                                               |
| Colour index clamping on delete             | âœ…              | âœ…     | objects pointing at a removed colour are corrected                                                            |
| Empty palette guard                         | âœ…              | âœ…     | the last colour cannot be deleted                                                                             |
| Thread brands / charts (Madeira, Isacord â€¦) | thread charts   | âŒ     | no licensed charts; colours are `code + name + hex`                                                           |
| Colour blending / gradient fills            | Colour blending | ðŸŸ¡     | two or more fills blend in one undo step, with a density control; there is no continuous gradient fill _type_ |
| Automatic colour sort                       | â€”               | âœ…     | nearest colour block next, within a short travel order; off by default, session preference                    |

---

## 5. Hooping

| Feature                                                           | Reference      | Status | Notes                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select hoop                                                       | hoop selection | âœ…     | 8 built-ins incl. round and cap frame                                                                                                                                                                                                                                                                         |
| Custom hoop presets                                               | hoop presets   | âœ…     | create/edit/delete via the presets API                                                                                                                                                                                                                                                                        |
| Design vs hoop validation                                         | hoop check     | âœ…     | field and safe margin checked; export refused on error                                                                                                                                                                                                                                                        |
| Hoop overlay on canvas                                            | âœ…             | âœ…     | field, safe area, round/oval rendering                                                                                                                                                                                                                                                                        |
| Multiple hoops in one design                                      | â€”              | âŒ     | one hoop per design document                                                                                                                                                                                                                                                                                  |
| **Auto-hooping** (pick the hoop a design fits)                    | Auto-hooping   | âœ…     | picks the smallest hoop that fits, can turn the design a quarter turn; the rotation is a real undoable edit                                                                                                                                                                                                   |
| **Multi-hoop splitting** (sew one design across several hoopings) | Multi-hooping  | âœ…     | splits the compiled stitches into one section per re-hooping; cuts prefer travel points, one hoop chosen for the whole design, each section exported as its own DST/PES/EXP/JEF file. **Shared overlap band and registration crosses** at every join â€” see [known-limitations.md](known-limitations.md) Â§3    |
| Multi-hooping alignment / overlap / registration marks            | Multi-hooping  | âœ…     | **Overlap** spreads the cut across a band (clamped so the walk still moves forward) so consecutive sections sew the same strip twice; **registration crosses** sew a cross at each boundary, on the ending section and the beginning one, at the same design coordinate. Still no freehand nudge of a section |
| Cap frame special handling (270 degree wrap, driver) | cap digitizing | Yes | an 80x180 hoop preset enables the cap view; the flat design is projected onto a curved crown for preview and inverse-sine compensated for export, with radius and compensation controls. This is a geometric model, not a specific driver profile |
| Multi-head / machine assignment | production machines | Yes | every object carries a 1-64 machine number; assign a whole selection or spread one per machine, then Export machines writes one independently validated file per number. No network queue or machine-status integration |

---

## 6. Preview and verification

| Feature                                | Reference           | Status | Notes                                                                                                              |
| -------------------------------------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Live stitch preview                    | 3D / stitch preview | âœ…     | Canvas 2D, batched runs                                                                                            |
| Underlay shown in preview              | âœ…                  | âœ…     | rendered as white/lock-weight lines                                                                                |
| Jump / travel shown                    | âœ…                  | âœ…     | dashed, dimmed                                                                                                     |
| Grid and rulers                        | âœ…                  | âœ…     | independent minor step and major spacing, major lines drawn heavier                                                |
| Snap to grid                           | âœ…                  | âœ…     | minor-grid rounding                                                                                                |
| Snap to object geometry                | Snap to Object      | âœ…     | node > edge > centre priority, 8 px threshold, then grid; hidden objects and the dragged object itself are skipped |
| Zoom / pan                             | âœ…                  | âœ…     | cursor-anchored wheel zoom, middle-drag / `H` pan                                                                  |
| **Stitch player** (sew-out simulation) | stitch simulator    | âœ…     | play/pause/rewind, scrub, 0.25Ã—â€“8Ã—, needle-head marker, `Space`                                                    |
| Real stitch statistics                 | âœ…                  | âœ…     | counts read from the compiled sequence, never estimated                                                            |
| Validation messages                    | design check        | âœ…     | 14 checks; errors block export                                                                                     |
| 3D / lit rendering with light | 3D view | Yes | optional lit preview adds a shadow and highlight pass to satin runs; it is a screen-only effect, not a fabric or lighting simulation |
| Thread-coloured true-to-life render    | â€”                   | ðŸŸ¡     | uses palette hex; no sheen, thickness or fabric simulation                                                         |

---

## 7. Lettering

| Feature                   | Reference    | Status | Notes                                                                                                                                               |
| ------------------------- | ------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lettering / text tool     | Lettering    | âœ…     | text, cap height, stroke width, width scale, spacing, slant, rotation and mirrors; the spec is saved with the design                                |
| Built-in embroidery fonts | font library | Yes | six original single-stroke cuts derived from the built-in skeleton: Studio Sans, Rounded, Block, Script, Serif and Mono. No third-party font data; an unsupported character is substituted with ? and counted |
| Monogramming              | Monogramming | âœ…     | up to three initials, the middle one larger with the sides centred and optionally mirrored, plus an optional circle/oval/diamond satin frame        |
| Text on a path            | â€”            | âœ…     | follows any selected shape's outline, letters rotate with the tangent or stay upright, offset and start/centre alignment                            |
| Resequencing              | Resequence   | âœ…     | reading order, reverse, outside-in or inside-out; the needle order changes, nothing moves                                                           |
| Team-name dropped letter  | â€”            | âœ…     | any character can sew larger and drop below the line, top-aligned, with a chosen scale                                                              |
| Lettering size limits     | â€”            | âœ…     | sizes outside the sewable range produce warnings (too small, too large, stroke wider than the cap height, one-point path) rather than silent damage |

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
| 3D Foam / puff                        | 3D Puff        | âœ…     | satin over a foam sheet: underlay dropped for a light tack, spacing capped at 0.30 mm so no foam shows, column pulls wider by 0.35 Ã— thickness per side to wrap the edge; works on columns and lettering |
| Carving stamp                         | Carving Stamp  | âœ…     | a repeating stamp (diamond, circle, star, cross, hexagon) punched out of a tatami fill; grid follows the fill angle, holes are crossed by jumps, optional run outline around each stamp                  |
| Color blending                        | Color Blending | âœ…     | two or more fills blend in one undo step, density control, same stitching path for every layer                                                                                                           |
| Contour / carving runs                | â€”              | âœ…     | contour is a fill pattern option, and carving is an object property (a stamp punched out of a tatami fill, holes crossed by jumps, optional run outline)                                                 |
| AppliquÃ© placement, tack-down, finish | AppliquÃ©       | âœ…     | three real passes with machine stops between them; partial mode covers a chosen stretch of the edge                                                                                                      |
| Motif library                         | motif sets     | âœ…     | eight built-ins, a library of your own motifs/stamps, capture from the canvas or paste SVG/coordinates; designs carry the shape they use                                                                 |
| Branch / leaf generator               | â€”              | âŒ     |                                                                                                                                                                                                          |

---

## 9. Files and interchange

| Feature                                  | Status | Notes                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native project store (MongoDB)           | âœ…     | versioned, validated, local                                                                                                                                                                                                                                                       |
| Open / search projects                   | âœ…     |                                                                                                                                                                                                                                                                                   |
| Optimistic concurrency (409 on conflict) | âœ…     | prevents a stale tab overwriting newer work                                                                                                                                                                                                                                       |
| Autosave                                 | âœ…     | configurable interval, only when dirty and named                                                                                                                                                                                                                                  |
| **Version history**                      | âœ…     | saving a project whose design actually differs snapshots the outgoing state first; manual checkpoints; restore (which checkpoints what it replaced first, so it is itself undoable); 30 per project, fetched one at a time so the list stays small                                |
| **Recent files**                         | âœ…     | upserted on open, 20 kept, forget one or clear all; a project deleted underneath is dropped with a message instead of failing to open                                                                                                                                             |
| **Tajima DST export**                    | âœ…     | real encoder, validation-gated, `writeDst()`; byte-identical to pyembroidery                                                                                                                                                                                                      |
| **Brother PES export**                   | âœ…     | real encoder (PES v1 + PEC), `writePes()`; rows normalised the way the reference normalises them, de-duplicated Brother palette, drawn hoop-icon thumbnails; byte-identical to pyembroidery                                                                                       |
| **Melco EXP export**                     | âœ…     | real encoder, `writeExp()`; byte-identical to pyembroidery                                                                                                                                                                                                                        |
| **Janome JEF export**                    | âœ…     | real encoder, `writeJef()`, Janome colour-library matching, hoop declared from the design size; byte-identical to pyembroidery                                                                                                                                                    |
| **Husqvarna VP3 export**                 | âœ…     | real encoder, `writeVp3()`, carries full thread colour / name / number / brand; byte-identical to pyembroidery                                                                                                                                                                    |
| **TBF export**                           | âœ…     | real encoder, `writeTbf()`, needle-order table and the whole palette carried, label capped at the field width; byte-identical to pyembroidery                                                                                                                                     |
| **Husqvarna HUS export**                 | âœ…     | real encoder, `writeHus()`, compressed streams, threads snapped to the machine's library; pyembroidery's own reader agrees on every case                                                                                                                                          |
| **Machine file import**                  | âœ…     | "Import" reads DST / PES / PEC / EXP / JEF / VP3 / TBF / HUS, previews with the movie's renderer, recovers Brother, Janome or Husqvarna colours where the format stores them, and saves as another format or a stitch video; `detectFormat()`, `importMachineFile()`              |
| SVG/PNG/PDF art export | Yes | vector SVG and PDF in millimetre units, canvas-rasterised PNG, and a tiled 1:1 printable placement sheet with crop marks, hoop outlines and a thread legend |
| **Stitch video**                         | âœ…     | animated GIF: our own GIF89a encoder (LZW) plus a software rasteriser, needle marker and live counter; verified against Pillow; rendered on a Web Worker thread so the editor stays live, with a main-thread fallback where workers cannot be created (`client/src/video/gif.ts`) |
| Backup / restore                         | âœ…     | `backup.bat`, `restore.bat`, replace or merge                                                                                                                                                                                                                                     |
| Cloud sync / accounts                    | âŒ     | deliberately local-only                                                                                                                                                                                                                                                           |
| Print / hoop placement sheets | Yes | A4 or Letter, portrait or landscape, fit or 1:1, optional hoop outline and legend; large designs tile across pages |

---

## 10. Editor experience

| Feature                          | Status | Notes                                                                                                                                                                                                                                    |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard shortcuts               | âœ…     | V, H, N, Enter, Esc, Del, Space, Ctrl+Z/Y/D, Ctrl+G / Ctrl+Shift+G                                                                                                                                                                       |
| Tool hints                       | âœ…     |                                                                                                                                                                                                                                          |
| Right-hand properties panel      | âœ…     |                                                                                                                                                                                                                                          |
| Auto-sequencing (branching)      | âœ…     | reorders the object list for shortest travel, one undo step; keeps colour blocks when optimise is on                                                                                                                                     |
| Status bar with validation       | âœ…     |                                                                                                                                                                                                                                          |
| Start / stop scripts for Windows | âœ…     | `start.bat`, `dev.bat`, `shutdown.bat`                                                                                                                                                                                                   |
| **Preferences UI**               | âœ…     | default hoop, autosave interval, undo depth, minor grid size, major grid spacing, player speed, show grid, show rulers, snap to grid, snap to objects, underlay in preview; saving the undo depth also trims the stack already in memory |
| Multi-language UI                | âŒ     | English only                                                                                                                                                                                                                             |
| Customisable key bindings        | âŒ     | the list above is fixed                                                                                                                                                                                                                  |

---

## 11. Stored data model fields

Kept here so "supported" is not overstated. Most of these are read now; the
ones that are not are named as such:

| Field                                                                                                                                                       | Reality                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capWrap.enabled` / `.radiusMm` / `.compensate` | **read** - drives the curved cap preview and inverse-sine export compensation; legacy designs default to off / 90 mm / on |
| `machine` | **read** - 1-64 production routing used by the machine grouping and Export machines action; legacy objects default to 1 |
| `lettering.font` | **read** - selects one of the six original skeleton cuts; absent keeps the historical Studio Sans layout |
| `fillPattern` | **read** - routes tatami fills to tatami / motif / contour / spiral / programmed split |
| `minStitchLength`                                                                                                                                           | **read** â€” shape-preserving merge of stitches closer than it, jumps and trims as barriers                                                                                                                                                                                 |
| `entryExit.entry` / `.exit`                                                                                                                                 | **read** â€” honoured when set, placed with the entry/exit tool; a guessed exit derives from the entry                                                                                                                                                                      |
| `groupId`                                                                                                                                                   | **read** â€” group / ungroup, group-aware click selection, group transforms                                                                                                                                                                                                 |
| `transform.x` / `.y`                                                                                                                                        | **read** â€” the lettering generator anchors at the object's position                                                                                                                                                                                                       |
| `transform` as a whole                                                                                                                                      | placement only: flip, rotate and scale are **baked into the path coordinates** by the editor, so the outline, the preview and the machine file stay one truth; the rotation/scale/mirror flags an older build stored were never read and have been removed from the model |
| `locked`                                                                                                                                                    | stored **and enforced**: a locked object is skipped by hit testing, so it cannot be selected or dragged                                                                                                                                                                   |
| `designVersions` collection                                                                                                                                 | **written** â€” automatic snapshots of the outgoing design on real changes, manual checkpoints, restore; capped at 30 per project and cleaned on delete                                                                                                                     |
| `recentFiles` collection                                                                                                                                    | **written** â€” upserted when a project opens, capped at 20, cleaned on delete; stale pointers are dropped rather than failing to open                                                                                                                                      |
| settings `showGrid`, `showRulers`, `gridSize`, `snapToGrid`, `autosaveIntervalMs`, `defaultHoopId`, `previewUnderlay`, `preview3d`, `stitchSimulationSpeed`, `undoDepth` | all **consulted** by the editor |
| settings `units`                                                                                                                                            | shown read-only: the application works in millimetres only, which is what imported designs declare                                                                                                                                                                        |
| settings `defaultStitchType`                                                                                                                                | **applied** â€” decides what a freshly drawn complex fill starts as (read when the shape commits; traced regions honour it too). Column, run and bean tools keep the stitch type they already mean                                                                          |

---

## 12. Honest summary

**Working end to end today:** manual digitizing with seven stitch types,
underlay and tie-off control, node editing, transforms (flip, scale, rotate),
grouping, lettering with monograms, text on a path, resequencing and team-name
drops, auto-hooping, colour blending, thread palettes, hoop
selection with validation, live preview, a stitch player, undo/redo with a
configurable depth, save/open with conflict detection, version history with
checkpoints and restore, a recent-files list, backup/restore, genuine
DST / PES / EXP / JEF / VP3 / TBF / HUS export â€” the first four byte-identical
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
real appliquÃ© â€” placement run, machine stop, tack, stop for trimming, satin
finish â€” full or partial, and the editor has weld/combine/subtract/intersect,
offset copies, border outlines, rounded corners and center-all. A photograph
becomes embroidery either as traced vector regions or as a Colour Photo Stitch
mosaic of per-thread cell blocks, with the Photo Flash preset when speed
matters more than detail.

**Not built:** licensed thread charts, app-level accounts, networked machine queues, and customisable key bindings. Artwork export, the lit preview and specialty stitch simulations are now built; see the field notes below for their limits.

Development decisions â€” including what each format can and cannot carry, and
what "local-only" means in practice â€” are in
[format-support.md](format-support.md), [known-limitations.md](known-limitations.md)
and [architecture.md](architecture.md).



---

## 13. Phase N/O field notes

These features are built and wired through the engine, HTTP schema, store and
editor UI. The notes state the boundary of each one rather than implying more
than the file formats can carry.

### Original font library, clipart and artwork

- **Six font families** are generated from the existing single-stroke skeleton,
  not copied from a commercial font. Studio Sans is the historical layout, so a
  design saved without a `font` field still opens and sews exactly as before.
- **Seventeen clipart shapes** are parametric engine geometry. Inserting one
  creates an ordinary editable complex fill carrying no hidden clipart state.
- **SVG and PDF** carry vector thread paths in millimetres. **PNG** is
  canvas-rasterised in the browser. The **print sheet** tiles at 1:1 on A4 or
  Letter, adds crop marks and optional hoop outlines, and can append a thread
  legend page. Printable output still depends on the printer being set to 100%.
- PDF text is restricted to ASCII; an accented or non-Latin design title is
  substituted rather than embedded with a font. The geometry is unaffected.

### Cap-frame wrap

- The preview maps the flat design through `x = centre + radius * sin(angle)`
  onto a curved crown panel.
- Export applies the inverse `centre + radius * arcsin((x - centre) / radius)`,
  widening the coordinates so the cap sews at the drawn width. Compensation can
  be switched off for a driver that already performs it.
- Designs wider than the half-circumference are refused with
  `CAP_WRAP_INVALID`; the radius and design width are shown in the message.
- This is a geometric model of a cap crown. It does not identify a specific
  machine or driver profile, so the first cap sew-out should be checked at low
  speed.

### Production machines

- `machine` is a 1-64 integer on every object. Objects default to machine 1.
- **Use machine N for all selected** applies one number to the selection;
  **Spread one per machine** numbers the selected objects in selection order.
- **Export machines** compiles each machine's visible objects independently,
  validates that file against the hoop, and writes a decodable file named
  `<design>-machineN.<ext>`. One object cannot be split between machines.
- This is production routing, not a network queue: there is no status feedback
  from a machine and no automatic re-balancing of stitch counts.

### Specialty stitches

| Style | What is generated | What the machine file carries |
| ----- | ----------------- | ----------------------------- |
| Sequins | A staggered sequin grid; each sequin is a short anchor plus radiating tack penetrations | Ordinary stitches only - no sequin device commands |
| Beading | Bead centres with cross tacks along the fill rows | Ordinary stitches only - no bead feeder commands |
| Chenille | A dense, raised satin-like pile path with moss underlay | Ordinary satin penetrations; no chenille device code |
| Schiffli | Repeating lace motifs linked by a fine connecting run | Ordinary penetrations; no schiffli-specific controls |

All four are deliberately simulations. DST, PES, EXP, JEF, VP3, TBF and HUS do
not carry the device instructions a multi-head sequin, bead or chenille machine
needs, so calling the output a real specialty file would be false. The engine
adds a `SPECIALTY_SIMULATION` validation notice and the inspector says the same
thing in plain words. Density controls the repeat pitch for these styles; the
server accepts the four stitch-type values so they survive save and reload.

### Lit/3D preview

`preview3d` is a server-backed preference. When enabled, satin runs gain a
shadow offset, shadow pass and highlight pass in the canvas renderer. It is a
screen-only depth cue for judging coverage and direction; it does not change
stitches, create a mesh or simulate fabric. The preference is stored with the
other settings and is not written into a design file.
