# Wilcom EmbroideryStudio 2026 — gap analysis

This document compares ThreadWorks Studio against **Wilcom EmbroideryStudio
2026**, so the remaining work can be listed, prioritised and checked off.

## How this comparison was produced (and what it deliberately is not)

Every Wilcom feature named below comes from **Wilcom's own public marketing and
product pages** — their interactive comparison chart
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

The four Wilcom product levels are **Lettering → Editing → Decorating →
Designing**; ThreadWorks targets the full **Designing** feature set (minus
CorelDRAW integration, licensing, cloud and login systems).

## Status legend

| Mark | Meaning                                          |
| ---- | ------------------------------------------------ |
| ✅   | Implemented, wired into the UI, covered by tests |
| 🟡   | Partial — present but with a stated restriction  |
| ❌   | Not implemented                                  |

---

## 1. Wilcom feature-by-feature comparison

Feature names are Wilcom's, from their comparison chart.

### 1.1 Core digitizing and files (base levels)

| Wilcom feature                        | Status | Notes                                                                          |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| Open and export embroidery files      | ✅     | DST / PES / PEC / EXP / JEF import + export                                    |
| Auto digitize designs                 | ✅     | photo → traced regions → stitches, colour quantisation                         |
| Create lettering and monograms        | ✅     | lettering + three-initial monograms (mirrored sides, optional frame)           |
| Recolor and assign thread charts      | 🟡     | recolour ✅; **licensed brand charts** (Madeira/Isacord) ❌                    |
| Edit and reshape designs              | ✅     | node editing, reshape, transforms                                              |
| Adjust stitch settings                | ✅     | density, angle, max/min stitch, pull comp, underlay, ties                      |
| Team Name name drop                   | ✅     | one character sews larger and drops below the line; batch numbering ❌         |
| Lettering resequenced                 | ✅     | reading order / reverse / outside-in / inside-out; nothing moves               |
| Lettering min & max size display      | ✅     | warnings (too small, too large, stroke wider than cap height, one-point path)  |
| Multi-hooping                         | ✅     | split, overlap band, registration crosses                                      |
| Hoop Master / Mighty Hoops support    | 🟡     | 8 built-in hoops + custom presets; specific branded hoop list ❌               |
| Branching and automatic sequencing    | ✅     | nearest-neighbour travel order (one undo step); optional colour-block sort     |
| Offset and borders                    | ✅     | offset with concentric copies and miter/bevel/round joins; run border outlines |
| Shaping tools                         | ✅     | weld / combine / subtract / intersect of shapes                                |
| Create applique (+ partial applique)  | ✅     | placement, two stops, tack-down, satin finish; partial = selected open edge    |
| Embroidery clipart browser            | ❌     | clip-art library                                                               |
| Rounded corners                       | ✅     | corner radius on fills/columns, clamped to fit the shape                       |
| Center all                            | ✅     | centers the whole design in the hoop                                           |
| Export docker with history            | 🟡     | export menu + recent files; no dedicated history docker                        |
| Work while exporting to a stitch file | ❌     | export runs off the UI thread only for video                                   |
| Visual online machine functions       | ❌     | machine-specific commands                                                      |
| 228 professionally digitized fonts    | 🟡     | **one** single-stroke font ships                                               |

### 1.2 Stitch types

| Wilcom (count)               | Status | ThreadWorks                                             |
| ---------------------------- | ------ | ------------------------------------------------------- |
| Outline stitch types — 15    | 🟡     | satin, run, bean, contour, spiral (5)                   |
| Fill stitch types — 22       | 🟡     | tatami, motif, contour, spiral, programmedSplit (5)     |
| Stitch effects — 19          | 🟡     | pull comp, 5 underlays, ties, contour/spiral/split      |
| Manual digitizing tools — 19 | 🟡     | complex fill, column, run, lettering, carve, entry/exit |

### 1.3 Editing and shaping

| Wilcom feature                        | Status | Notes                                                           |
| ------------------------------------- | ------ | --------------------------------------------------------------- |
| Shaping tools (weld/combine/subtract) | ✅     | also intersect; single undo step, refusals explained            |
| Offset / Offset Advanced              | ✅     | positive/negative distance, 1–50 concentric copies, join style  |
| Jagged Edge effect                    | ✅     | `fillPattern: 'jagged'`: row ends torn by a shape-seeded jitter |
| Hand Stitch Effect                    | ✅     | `fillPattern: 'hand'`: irregular steps and jittered rows        |
| Rounded Corners                       | ✅     | tangent arcs with automatic radius clamp                        |
| Mirror Merge (auto-arrangement)       | ❌     |                                                                 |
| Center All                            | ✅     | centers the combined design in the hoop                         |
| Team Names Advanced                   | ❌     |                                                                 |
| Styles (object style presets)         | ❌     |                                                                 |

### 1.4 Curved, textured and patterned fills

| Wilcom feature                | Status | Notes                                                                                                                                              |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contour Stitch Effects        | ✅     | `fillPattern: 'contour'`                                                                                                                           |
| Spiral Fill                   | ✅     | `fillPattern: 'spiral'`                                                                                                                            |
| Custom Split Stitch Effects   | ✅     | `programmedSplit` (fixed blocks) and `flexiSplit` (blocks follow the row width)                                                                    |
| User Defined Split Stitch     | ✅     | block length, break and stagger set per object; fields start at 12 mm / 1.5 mm / 50% and reset to them                                             |
| Motif Fills, Runs, Singles    | ✅     | `motifMode`: `fill` (grid), `run` (along the outline, turned to the tangent) and `single` (one stamp scaled to the drawn box)                      |
| Carving Stamp                 | ✅     | diamond/circle/star/cross/hexagon punched from tatami                                                                                              |
| Create Motif / motif library  | ✅     | Phase E done — nine built-ins, add your own from the canvas, an SVG path or coordinates; rename and delete; used by motif fills and carving stamps |
| Gradient Motifs               | ✅     | `motifGradient`: size and extra rotation lerp from the first motif to the last; fill, run and column                                               |
| Motif Column                  | ✅     | `motifMode: 'column'`: each motif spans the two rails and steps along the column                                                                   |
| 3D Warp                       | ✅     | `fillPattern: 'warp'`: rows bow outward as if over a dome                                                                                          |
| Flexi Split                   | ✅     | `fillPattern: 'flexiSplit'`                                                                                                                        |
| Accordion Spacing (+ custom)  | ✅     | `fillPattern: 'accordion'`: pleat pitch follows density, pleats follow angle                                                                       |
| Florentine Effects            | ✅     | `fillPattern: 'florentine'`: leaf bands tilted alternately                                                                                         |
| Liquid Effects                | ✅     | `fillPattern: 'liquid'`: rows flow as sine waves                                                                                                   |
| Stipple Stitch / Cross Stitch | ✅     | `fillPattern: 'stipple'` (seeded dot texture) and `'cross'` (two passes at 90°)                                                                    |
| String Stitch                 | ✅     | `fillPattern: 'string'`: long meandering laid stitches                                                                                             |
| Maze Fill                     | ✅     | `fillPattern: 'maze'`: one line wandering with square turns                                                                                        |
| Laydown Stitch                | ✅     | `fillPattern: 'laydown'`: long parallel laid threads, split at the step limit                                                                      |
| Alphabet Creator              | ❌     |                                                                                                                                                    |
| Shading and Open Fills        | ✅     | `fillPattern: 'shading'`: row pitch fades from open to dense                                                                                       |
| Make Lines for Stitch Effects | ❌     |                                                                                                                                                    |

### 1.5 Colour, blending and photos

| Wilcom feature        | Status | Notes                                                                                     |
| --------------------- | ------ | ----------------------------------------------------------------------------------------- |
| Color Blending        | ✅     | two or more fills blend in one undo step, density control                                 |
| Multi Blend (2026)    | 🟡     | layered blend with presets exists; "blend layers/colours/textures in real time" partially |
| Color Photo Stitch    | ✅     | photograph to cell mosaic, one object per thread, fine satin cells, 2-24 colours          |
| Photo Flash           | ✅     | fast preset: 8 colours, 3 mm run cells                                                    |
| Color Photo Flash     | ✅     | the Photo Flash preset keeps the picture's colours                                        |
| Reef PhotoStitch      | ❌     | specialised marine content, not a separate algorithm                                      |
| Automatic colour sort | ✅     | toggle regroups the nearest colour block next at compile time                             |

### 1.6 Appliqué, motifs and advanced techniques

| Wilcom feature                 | Status | Notes                                                                                             |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------- |
| Create applique (full/partial) | ✅     | placement run + stop + tack + stop + satin finish; partial selects an open stretch of the outline |
| Branch / leaf generator        | ❌     |                                                                                                   |
| Sequins (single / advanced)    | ❌     | machine capability                                                                                |
| Beading                        | ❌     |                                                                                                   |
| Chenille                       | ❌     |                                                                                                   |
| Schiffli                       | ❌     |                                                                                                   |
| 3D Foam / puff                 | ✅     | satin over foam sheet                                                                             |
| Color Blending                 | ✅     |                                                                                                   |

### 1.7 Hooping, preview, verification

| Wilcom feature                  | Status | Notes                                          |
| ------------------------------- | ------ | ---------------------------------------------- |
| Multi-hooping                   | ✅     | shared overlap band + registration crosses     |
| Auto-hooping                    | ✅     | smallest-fit + quarter turn                    |
| Cap frame (270° wrap)           | 🟡     | preset exists, **no wrap/driver compensation** |
| Multi-head / machine assignment | ❌     |                                                |
| 3D / lit true-to-life render    | ❌     | flat rendering only                            |
| Design check / validation       | ✅     | 14 checks                                      |

### 1.8 Lettering

| Wilcom feature      | Status | Notes                                                                      |
| ------------------- | ------ | -------------------------------------------------------------------------- |
| 228 fonts           | 🟡     | **one** single-stroke font                                                 |
| Monogramming        | ✅     | three initials, honoured centre, mirrored sides, circle/oval/diamond frame |
| Text on a path      | ✅     | follows a selected shape; upright option, offset, start/centre alignment   |
| Team Name name drop | ✅     | any character, scaled and top-aligned below the line                       |
| Alphabet Creator    | ❌     |                                                                            |

### 1.9 What's new in 2026

| Wilcom 2026 feature               | Status | Notes                                                              |
| --------------------------------- | ------ | ------------------------------------------------------------------ |
| Continue Digitizing               | ✅     | reopens the selected outline, appends points, commits in place     |
| Redwork automation                | ✅     | Single / Triple / Backstitch / Stem stitch, one thread, reversible |
| Snap to Object                    | ✅     | node > edge > centre priority, then grid; hidden objects skipped   |
| Major and Minor Grid (micro-grid) | ✅     | independent minor step and major spacing, clamps major ≥ minor     |
| Separate Pull Compensation        | ✅     | independent left/right satin compensation in millimetres           |
| Monogramming                      | ✅     | honoured centre initial, mirrored sides, optional frame            |
| Text on a path                    | ✅     | letters follow a selected shape, rotate with it or stay upright    |
| Lettering resequence              | ✅     | reading / reverse / outside-in / inside-out needle order           |
| Team Name name drop               | ✅     | one letter sews larger and drops below the line                    |
| Streamlined / one-step export     | ❌     |                                                                    |
| Multi Blend                       | 🟡     | see §1.5                                                           |
| Custom Accordion Spacing          | ✅     | the accordion fill's pitch follows the object's density and angle  |
| Wilcom Answers (AI assistant)     | —      | deliberately out of scope (cloud / AI service)                     |

### 1.10 Deliberately out of scope

| Area                          | Reason                                                 |
| ----------------------------- | ------------------------------------------------------ |
| Login / activation / dongle   | excluded by requirement                                |
| Cloud (WilcomWorkspace)       | local-only by requirement                              |
| CorelDRAW integration         | third-party commercial suite                           |
| Licensed thread charts        | licensing — replaced with `code + name + hex` palettes |
| 228 licensed embroidery fonts | licensing — one original font ships                    |
| Wilcom Answers (cloud AI)     | local-only by requirement                              |

---

## 2. Machine formats

| Format                     | Status | Notes                                                                                           |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| DST / PES / EXP / JEF      | ✅     | byte-identical to pyembroidery                                                                  |
| HUS                        | ✅     | Phase D done — writer + reader, verified by round-trip through pyembroidery's HusReader (12/12) |
| VP3                        | ✅     | Phase D done — byte-identical to pyembroidery (12/12 cases)                                     |
| TBF                        | ✅     | Phase D done — byte-identical to pyembroidery (12/12 cases); 16-char name truncation documented |
| SVG / PNG / PDF art export | ❌     |                                                                                                 |

---

## 3. Prioritised work plan

Ordered by value to the studio's real workflow (clients supply photos, expect
DST/PES/EXP/JEF designs and stitch videos), and grouped into phases.

| Phase | Scope                                                                                                                                             | Why first                                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D** | HUS / VP3 / TBF export + import                                                                                                                   | ✅ done — VP3/TBF byte-identical, HUS verified by reference reader                                                                                                                              |
| **E** | Motif library editor (import your own motif/stamp shapes)                                                                                         | ✅ done — nine built-ins, capture from the canvas, paste an SVG path or coordinates                                                                                                             |
| **F** | Shaping tools (weld / combine / subtract / intersect) + Offset & borders + Rounded corners + Center all                                           | ✅ done — boolean outlines, offset copies, run borders, rounded corners, center all                                                                                                             |
| **G** | Appliqué (placement, tack-down, finish, partial)                                                                                                  | ✅ done — real stops, full and partial edges, fabric preview                                                                                                                                    |
| **H** | Colour Photo Stitch / Photo Flash — photo to photoreal fill                                                                                       | ✅ done — cell mosaic per thread colour, satin/run/cross cells, both presets                                                                                                                    |
| **I** | Enable automatic colour sort + branching/auto-sequencing                                                                                          | ✅ done — nearest colour block, auto-sequence action with undo                                                                                                                                  |
| **J** | Continue Digitizing + Redwork (Single/Triple/Backstitch/Stemstitch) + Snap to Object + micro-grid + separate pull comp                            | ✅ done — resume in place, four line styles, geometry snap, independent grid, per-side pull                                                                                                     |
| **K** | Lettering: monogramming, text on a path, size limits, resequence, team-name drop                                                                  | ✅ done — one layout engine covers straight / path / monogram, mirrors + width factor, warnings not errors                                                                                      |
| **L** | Advanced fills: Accordion, Florentine, Liquid, Maze, String, Laydown, Stipple/Cross, Shading/Open, Hand stitch, Jagged edge, 3D warp, Flexi split | ✅ done — thirteen fill textures on one routing table, each shape-seeded so preview and file match; jagged/warp/flexi ride the tatami generator                                                 |
| **M** | Motif runs/singles, gradient motifs, motif column, user-defined split                                                                             | ✅ done — one motif engine serves fill / run / single / column, an optional size-rotation gradient fades across the layout, and the split fill takes per-object block / break / stagger numbers |
| **N** | Fonts library (original strokes), clipart browser, art export SVG/PNG/PDF, print sheets                                                           | breadth                                                                                                                                                                                         |
| **O** | 3D / lit render, cap-frame wrap, multi-machine assignment, sequins/beading/chenille/schiffli                                                      | machine-specific parity                                                                                                                                                                         |

Each phase lands **real, tested** features — same standard as the four
byte-identical formats — before the next begins.
