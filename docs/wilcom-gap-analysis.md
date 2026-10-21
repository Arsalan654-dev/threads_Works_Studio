# Wilcom EmbroideryStudio 2026 â€” gap analysis

This document compares ThreadWorks Studio against **Wilcom EmbroideryStudio
2026**, so the remaining work can be listed, prioritised and checked off.

## How this comparison was produced (and what it deliberately is not)

Every Wilcom feature named below comes from **Wilcom's own public marketing and
product pages** â€” their interactive comparison chart
(`wilcom.com/embroiderystudio/comparison`), their "What's new in EmbroideryStudio
2026" section, and their product-level pages. These are published feature
**names and descriptions**, not code.

What this analysis is **not**: it is not a disassembly of the installed Wilcom
application, and no Wilcom source, constant table, resource or UI asset was
extracted or copied. ThreadWorks implements each capability as **original code**,
the same way every machine format (DST / PES / EXP / JEF / VP3 / TBF) was
matched byte-for-byte against the
MIT-licensed **pyembroidery** reference rather than against any Wilcom binary.
Functionality is mirrored; protected expression is not.

The four Wilcom product levels are **Lettering â†’ Editing â†’ Decorating â†’
Designing**; ThreadWorks targets the full **Designing** feature set (minus
CorelDRAW integration, licensing, cloud and login systems).

## Status legend

| Mark | Meaning                                          |
| ---- | ------------------------------------------------ |
| âœ…   | Implemented, wired into the UI, covered by tests |
| ðŸŸ¡   | Partial â€” present but with a stated restriction  |
| âŒ   | Not implemented                                  |

---

## 1. Wilcom feature-by-feature comparison

Feature names are Wilcom's, from their comparison chart.

### 1.1 Core digitizing and files (base levels)

| Wilcom feature                        | Status | Notes                                                                          |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| Open and export embroidery files      | âœ…     | DST / PES / PEC / EXP / JEF import + export                                    |
| Auto digitize designs                 | âœ…     | photo â†’ traced regions â†’ stitches, colour quantisation                         |
| Create lettering and monograms        | âœ…     | lettering + three-initial monograms (mirrored sides, optional frame)           |
| Recolor and assign thread charts      | ðŸŸ¡     | recolour âœ…; **licensed brand charts** (Madeira/Isacord) âŒ                    |
| Edit and reshape designs              | âœ…     | node editing, reshape, transforms                                              |
| Adjust stitch settings                | âœ…     | density, angle, max/min stitch, pull comp, underlay, ties                      |
| Team Name name drop                   | âœ…     | one character sews larger and drops below the line; batch numbering âŒ         |
| Lettering resequenced                 | âœ…     | reading order / reverse / outside-in / inside-out; nothing moves               |
| Lettering min & max size display      | âœ…     | warnings (too small, too large, stroke wider than cap height, one-point path)  |
| Multi-hooping                         | âœ…     | split, overlap band, registration crosses                                      |
| Hoop Master / Mighty Hoops support    | ðŸŸ¡     | 8 built-in hoops + custom presets; specific branded hoop list âŒ               |
| Branching and automatic sequencing    | âœ…     | nearest-neighbour travel order (one undo step); optional colour-block sort     |
| Offset and borders                    | âœ…     | offset with concentric copies and miter/bevel/round joins; run border outlines |
| Shaping tools                         | âœ…     | weld / combine / subtract / intersect of shapes                                |
| Create applique (+ partial applique)  | âœ…     | placement, two stops, tack-down, satin finish; partial = selected open edge    |
| Embroidery clipart browser            | Yes    | 17 original parametric shapes in categories, searchable, inserted as editable complex fills |
| Rounded corners                       | âœ…     | corner radius on fills/columns, clamped to fit the shape                       |
| Center all                            | âœ…     | centers the whole design in the hoop                                           |
| Export docker with history            | ðŸŸ¡     | export menu + recent files; no dedicated history docker                        |
| Work while exporting to a stitch file | âŒ     | export runs off the UI thread only for video                                   |
| Visual online machine functions       | âŒ     | machine-specific commands                                                      |
| 228 professionally digitized fonts    | Partial | six original single-stroke cuts (Studio Sans, Rounded, Block, Script, Serif, Mono); not 228 licensed typefaces |

### 1.2 Stitch types

| Wilcom (count)               | Status | ThreadWorks                                             |
| ---------------------------- | ------ | ------------------------------------------------------- |
| Outline stitch types â€” 15    | ðŸŸ¡     | satin, run, bean, contour, spiral (5)                   |
| Fill stitch types â€” 22       | ðŸŸ¡     | tatami, motif, contour, spiral, programmedSplit (5)     |
| Stitch effects â€” 19          | ðŸŸ¡     | pull comp, 5 underlays, ties, contour/spiral/split      |
| Manual digitizing tools â€” 19 | ðŸŸ¡     | complex fill, column, run, lettering, carve, entry/exit |

### 1.3 Editing and shaping

| Wilcom feature                        | Status | Notes                                                           |
| ------------------------------------- | ------ | --------------------------------------------------------------- |
| Shaping tools (weld/combine/subtract) | âœ…     | also intersect; single undo step, refusals explained            |
| Offset / Offset Advanced              | âœ…     | positive/negative distance, 1â€“50 concentric copies, join style  |
| Jagged Edge effect                    | âœ…     | `fillPattern: 'jagged'`: row ends torn by a shape-seeded jitter |
| Hand Stitch Effect                    | âœ…     | `fillPattern: 'hand'`: irregular steps and jittered rows        |
| Rounded Corners                       | âœ…     | tangent arcs with automatic radius clamp                        |
| Mirror Merge (auto-arrangement)       | âŒ     |                                                                 |
| Center All                            | âœ…     | centers the combined design in the hoop                         |
| Team Names Advanced                   | âŒ     |                                                                 |
| Styles (object style presets)         | âŒ     |                                                                 |

### 1.4 Curved, textured and patterned fills

| Wilcom feature                | Status | Notes                                                                                                                                              |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contour Stitch Effects        | âœ…     | `fillPattern: 'contour'`                                                                                                                           |
| Spiral Fill                   | âœ…     | `fillPattern: 'spiral'`                                                                                                                            |
| Custom Split Stitch Effects   | âœ…     | `programmedSplit` (fixed blocks) and `flexiSplit` (blocks follow the row width)                                                                    |
| User Defined Split Stitch     | âœ…     | block length, break and stagger set per object; fields start at 12 mm / 1.5 mm / 50% and reset to them                                             |
| Motif Fills, Runs, Singles    | âœ…     | `motifMode`: `fill` (grid), `run` (along the outline, turned to the tangent) and `single` (one stamp scaled to the drawn box)                      |
| Carving Stamp                 | âœ…     | diamond/circle/star/cross/hexagon punched from tatami                                                                                              |
| Create Motif / motif library  | âœ…     | Phase E done â€” nine built-ins, add your own from the canvas, an SVG path or coordinates; rename and delete; used by motif fills and carving stamps |
| Gradient Motifs               | âœ…     | `motifGradient`: size and extra rotation lerp from the first motif to the last; fill, run and column                                               |
| Motif Column                  | âœ…     | `motifMode: 'column'`: each motif spans the two rails and steps along the column                                                                   |
| 3D Warp                       | âœ…     | `fillPattern: 'warp'`: rows bow outward as if over a dome                                                                                          |
| Flexi Split                   | âœ…     | `fillPattern: 'flexiSplit'`                                                                                                                        |
| Accordion Spacing (+ custom)  | âœ…     | `fillPattern: 'accordion'`: pleat pitch follows density, pleats follow angle                                                                       |
| Florentine Effects            | âœ…     | `fillPattern: 'florentine'`: leaf bands tilted alternately                                                                                         |
| Liquid Effects                | âœ…     | `fillPattern: 'liquid'`: rows flow as sine waves                                                                                                   |
| Stipple Stitch / Cross Stitch | âœ…     | `fillPattern: 'stipple'` (seeded dot texture) and `'cross'` (two passes at 90Â°)                                                                    |
| String Stitch                 | âœ…     | `fillPattern: 'string'`: long meandering laid stitches                                                                                             |
| Maze Fill                     | âœ…     | `fillPattern: 'maze'`: one line wandering with square turns                                                                                        |
| Laydown Stitch                | âœ…     | `fillPattern: 'laydown'`: long parallel laid threads, split at the step limit                                                                      |
| Alphabet Creator              | âŒ     |                                                                                                                                                    |
| Shading and Open Fills        | âœ…     | `fillPattern: 'shading'`: row pitch fades from open to dense                                                                                       |
| Make Lines for Stitch Effects | âŒ     |                                                                                                                                                    |

### 1.5 Colour, blending and photos

| Wilcom feature        | Status | Notes                                                                                     |
| --------------------- | ------ | ----------------------------------------------------------------------------------------- |
| Color Blending        | âœ…     | two or more fills blend in one undo step, density control                                 |
| Multi Blend (2026)    | ðŸŸ¡     | layered blend with presets exists; "blend layers/colours/textures in real time" partially |
| Color Photo Stitch    | âœ…     | photograph to cell mosaic, one object per thread, fine satin cells, 2-24 colours          |
| Photo Flash           | âœ…     | fast preset: 8 colours, 3 mm run cells                                                    |
| Color Photo Flash     | âœ…     | the Photo Flash preset keeps the picture's colours                                        |
| Reef PhotoStitch      | âŒ     | specialised marine content, not a separate algorithm                                      |
| Automatic colour sort | âœ…     | toggle regroups the nearest colour block next at compile time                             |

### 1.6 AppliquÃ©, motifs and advanced techniques

| Wilcom feature                 | Status | Notes                                                                                             |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------- |
| Create applique (full/partial) | âœ…     | placement run + stop + tack + stop + satin finish; partial selects an open stretch of the outline |
| Branch / leaf generator        | âŒ     |                                                                                                   |
| Sequins (single / advanced)    | Partial | sequin-grid simulation from standard needle penetrations; no sequin device codes in the machine files |
| Beading                        | Partial | bead-and-cross-tack simulation; no bead-feeder commands in the machine files |
| Chenille                       | Partial | dense chenille-like pile path; no chenille device code in the machine files |
| Schiffli                       | Partial | repeating lace motifs linked by a fine run; no schiffli-specific controls |
| 3D Foam / puff                 | âœ…     | satin over foam sheet                                                                             |
| Color Blending                 | âœ…     |                                                                                                   |

### 1.7 Hooping, preview, verification

| Wilcom feature                  | Status | Notes                                          |
| ------------------------------- | ------ | ---------------------------------------------- |
| Multi-hooping                   | âœ…     | shared overlap band + registration crosses     |
| Auto-hooping                    | âœ…     | smallest-fit + quarter turn                    |
| Cap frame (270 degree wrap)     | Yes    | curved crown preview plus inverse-sine driver compensation; geometric model, not a specific driver profile |
| Multi-head / machine assignment | Yes    | per-object 1-64 routing, spread across a selection, one independently validated file per machine; no network queue |
| 3D / lit true-to-life render    | Yes    | optional screen-only lit preview with shadow and highlight passes; not a fabric or lighting simulation |
| Design check / validation       | âœ…     | 14 checks                                      |

### 1.8 Lettering

| Wilcom feature      | Status | Notes                                                                      |
| ------------------- | ------ | -------------------------------------------------------------------------- |
| 228 fonts           | Partial | six original single-stroke cuts; not a licensed 228-font library |
| Monogramming        | âœ…     | three initials, honoured centre, mirrored sides, circle/oval/diamond frame |
| Text on a path      | âœ…     | follows a selected shape; upright option, offset, start/centre alignment   |
| Team Name name drop | âœ…     | any character, scaled and top-aligned below the line                       |
| Alphabet Creator    | âŒ     |                                                                            |

### 1.9 What's new in 2026

| Wilcom 2026 feature               | Status | Notes                                                              |
| --------------------------------- | ------ | ------------------------------------------------------------------ |
| Continue Digitizing               | âœ…     | reopens the selected outline, appends points, commits in place     |
| Redwork automation                | âœ…     | Single / Triple / Backstitch / Stem stitch, one thread, reversible |
| Snap to Object                    | âœ…     | node > edge > centre priority, then grid; hidden objects skipped   |
| Major and Minor Grid (micro-grid) | âœ…     | independent minor step and major spacing, clamps major â‰¥ minor     |
| Separate Pull Compensation        | âœ…     | independent left/right satin compensation in millimetres           |
| Monogramming                      | âœ…     | honoured centre initial, mirrored sides, optional frame            |
| Text on a path                    | âœ…     | letters follow a selected shape, rotate with it or stay upright    |
| Lettering resequence              | âœ…     | reading / reverse / outside-in / inside-out needle order           |
| Team Name name drop               | âœ…     | one letter sews larger and drops below the line                    |
| Streamlined / one-step export     | âŒ     |                                                                    |
| Multi Blend                       | ðŸŸ¡     | see Â§1.5                                                           |
| Custom Accordion Spacing          | âœ…     | the accordion fill's pitch follows the object's density and angle  |
| Wilcom Answers (AI assistant)     | â€”      | deliberately out of scope (cloud / AI service)                     |

### 1.10 Deliberately out of scope

| Area                          | Reason                                                 |
| ----------------------------- | ------------------------------------------------------ |
| Login / activation / dongle   | excluded by requirement                                |
| Cloud (WilcomWorkspace)       | local-only by requirement                              |
| CorelDRAW integration         | third-party commercial suite                           |
| Licensed thread charts        | licensing â€” replaced with `code + name + hex` palettes |
| 228 licensed embroidery fonts | licensing - six original single-stroke cuts ship instead |
| Wilcom Answers (cloud AI)     | local-only by requirement                              |

---

## 2. Machine formats

| Format                     | Status | Notes                                                                                           |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| DST / PES / EXP / JEF      | âœ…     | byte-identical to pyembroidery                                                                  |
| HUS                        | âœ…     | Phase D done â€” writer + reader, verified by round-trip through pyembroidery's HusReader (12/12) |
| VP3                        | âœ…     | Phase D done â€” byte-identical to pyembroidery (12/12 cases)                                     |
| TBF                        | âœ…     | Phase D done â€” byte-identical to pyembroidery (12/12 cases); 16-char name truncation documented |
| SVG / PNG / PDF art export | Yes    | vector SVG and PDF, raster PNG, tiled 1:1 print sheet with crop marks, hoop outline and thread legend |

---

## 3. Prioritised work plan

Ordered by value to the studio's real workflow (clients supply photos, expect
DST/PES/EXP/JEF designs and stitch videos), and grouped into phases.

| Phase | Scope                                                                                                                                             | Why first                                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D** | HUS / VP3 / TBF export + import                                                                                                                   | âœ… done â€” VP3/TBF byte-identical, HUS verified by reference reader                                                                                                                              |
| **E** | Motif library editor (import your own motif/stamp shapes)                                                                                         | âœ… done â€” nine built-ins, capture from the canvas, paste an SVG path or coordinates                                                                                                             |
| **F** | Shaping tools (weld / combine / subtract / intersect) + Offset & borders + Rounded corners + Center all                                           | âœ… done â€” boolean outlines, offset copies, run borders, rounded corners, center all                                                                                                             |
| **G** | AppliquÃ© (placement, tack-down, finish, partial)                                                                                                  | âœ… done â€” real stops, full and partial edges, fabric preview                                                                                                                                    |
| **H** | Colour Photo Stitch / Photo Flash â€” photo to photoreal fill                                                                                       | âœ… done â€” cell mosaic per thread colour, satin/run/cross cells, both presets                                                                                                                    |
| **I** | Enable automatic colour sort + branching/auto-sequencing                                                                                          | âœ… done â€” nearest colour block, auto-sequence action with undo                                                                                                                                  |
| **J** | Continue Digitizing + Redwork (Single/Triple/Backstitch/Stemstitch) + Snap to Object + micro-grid + separate pull comp                            | âœ… done â€” resume in place, four line styles, geometry snap, independent grid, per-side pull                                                                                                     |
| **K** | Lettering: monogramming, text on a path, size limits, resequence, team-name drop                                                                  | âœ… done â€” one layout engine covers straight / path / monogram, mirrors + width factor, warnings not errors                                                                                      |
| **L** | Advanced fills: Accordion, Florentine, Liquid, Maze, String, Laydown, Stipple/Cross, Shading/Open, Hand stitch, Jagged edge, 3D warp, Flexi split | âœ… done â€” thirteen fill textures on one routing table, each shape-seeded so preview and file match; jagged/warp/flexi ride the tatami generator                                                 |
| **M** | Motif runs/singles, gradient motifs, motif column, user-defined split                                                                             | âœ… done â€” one motif engine serves fill / run / single / column, an optional size-rotation gradient fades across the layout, and the split fill takes per-object block / break / stagger numbers |
| **N** | Fonts library (original strokes), clipart browser, art export SVG/PNG/PDF, print sheets | Yes - done - six cuts, 17 shapes, SVG/PDF/PNG and 1:1 tiled print sheets |
| **O** | 3D / lit render, cap-frame wrap, multi-machine assignment, sequins/beading/chenille/schiffli | Yes - done - lit preview, crown projection with inverse driver compensation, per-machine files and four specialty simulations |

Each phase lands **real, tested** features â€” same standard as the four
byte-identical formats â€” before the next begins.
