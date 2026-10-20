# ThreadWorks Studio — User Manual

---

## 1. Starting and stopping

| Action                     | How                                                            |
| -------------------------- | -------------------------------------------------------------- |
| Start                      | Double-click **`start.bat`**                                   |
| Editor                     | <http://127.0.0.1:4000> (opens automatically)                  |
| Stop                       | Double-click **`shutdown.bat`**, or Ctrl+C in the start window |
| Development (code changes) | **`dev.bat`** → <http://127.0.0.1:5173>                        |

`start.bat` checks Node, npm and MongoDB and stops with a plain-English message
if any is missing. It installs and builds on the first run only.

MongoDB must be running — every design is stored there. The app deliberately
does **not** fall back to files or browser storage, because that would make
"saved" designs vanish on the next start.

---

## 2. The window

```
┌──────────────────────────────────────────────────────────────────┐
│ New | Open | Trace image | Import | Save | History │ EXP ▾ Export │
│                Export sections | Stitch video                     │  Top bar
│ Undo | Redo │ design name ● │ Preferences │ server ●              │
├────┬──────────────────────────────────────────┬──────┤
│    │                                          │ Hoop │
│ T  │            design canvas                 │ Obj  │
│ o  │                                          │ ...  │  Right panel
│ o  │      ┌─────────────────────┐             │      │
│ l  │      │ ▶  ─────●──── 1234/ │             │ Palette
│ s  │      └─────────────────────┘             │      │
├────┴──────────────────────────────────────────┴──────┤
│ 45,678 stitches · 44,000 sewn · 12 jumps · Ready     │  Status bar
└──────────────────────────────────────────────────────┘
```

- **Top bar** — file actions (New, Open, Save, **History**), **Trace image**,
  **Import**, every export (single file, sections, stitch video), undo/redo,
  the design name, **Preferences**, and the server connection.
- **Left toolbar** — the digitizing tools.
- **Canvas** — grid, rulers, hoop outline and the generated stitches.
- **Right panel** — hoop selection and auto-hooping, the multi-hoop join
  options, lettering, object properties and transforms, thread palette.
- **Status bar** — real stitch counts, jump/trim/colour-change counts, and
  validation messages. The counts are read from the compiled sequence, i.e.
  they are exactly what will be in the exported file.

---

## 3. Digitizing a design

### 3.1 Choosing a tool

| Tool             | What it makes           | How to finish                                |
| ---------------- | ----------------------- | -------------------------------------------- |
| **Select** (`V`) | select and move objects | —                                            |
| **Pan** (`H`)    | move the view           | —                                            |
| **Input A**      | satin column (rails)    | click points, then **Enter** or double-click |
| **Complex Fill** | filled shape            | click points, then **Enter** or double-click |
| **Run**          | single-run outline      | click points, **Enter**                      |
| **Bean**         | triple/bean run         | click points, **Enter**                      |
| **Rectangle**    | drag a rectangle        | release the mouse                            |
| **Circle**       | drag a circle           | release the mouse                            |

- **Esc** cancels the outline in progress and returns to Select.
- A closed shape needs at least **3 points**; an open line needs **2**.
- While placing points, a dashed preview follows the cursor.

### 3.2 Moving, selecting, arranging

- Click an object to select it. **Shift+click** adds to the selection.
- Drag to move. With _Snap to grid_ on, movement snaps to the grid size.
- **Delete / Backspace** removes the selection.
- **Duplicate** copies it (or `Ctrl+D`).
- _Bring forward_ / _Send back_ change the sewing order — and therefore which
  object sits on top.
- **Undo / Redo** (`Ctrl+Z`, `Ctrl+Y` or `Ctrl+Shift+Z`) — depth is a
  preference, 5–500 steps (default 60). See §11.
- **Group / Ungroup** (`Ctrl+G`, `Ctrl+Shift+G`) — a group is selected by
  clicking any member and moves, rotates and duplicates as one.
- **Transform** in the right panel — flip H / flip V, rotate ±90°, scale ±10%.
  Each change is baked into the outline, so the canvas always shows what the
  machine will sew, and each is one undo step.

### 3.3 Setting the stitches

Select an object; its properties appear in the right panel.

| Setting                        | Meaning                                                                                                                                                                                                                                                   | Practical range                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Stitch type**                | tatami, satin, run, bean, contour, spiral, motif                                                                                                                                                                                                          | —                                  |
| **Density (spacing)**          | distance between needle penetrations, mm. **Lower = denser.**                                                                                                                                                                                             | 0.3–0.6 for fills                  |
| **Angle**                      | stitch direction in degrees                                                                                                                                                                                                                               | any                                |
| **Pull compensation**          | offsets row ends to counteract fabric pull, mm                                                                                                                                                                                                            | 0–0.5 typical                      |
| **Fill pattern** (tatami only) | _how_ a fill lays its stitches: plain weave, motif stamps, contour, spiral, programmed split, flexi split, accordion, florentine, liquid, maze, string, laydown, stipple, cross hatch, shading, hand stitch, jagged edge, or 3D warp — explained in §3.18 | plain weave for ordinary fills     |
| **Minimum stitch length**      | anything shorter is collapsed, because a machine cannot sew below a needle width without looping                                                                                                                                                          | 0.15–0.5; 0 turns it off           |
| **Maximum stitch length**      | longer single moves are split                                                                                                                                                                                                                             | up to 12.1, the Tajima DST ceiling |
| **Underlay**                   | stabilizing layer beneath the top stitch                                                                                                                                                                                                                  | see below                          |
| **Tie-in / Tie-off**           | lock stitches at start and end of the object                                                                                                                                                                                                              | on by default                      |

Changing the stitch type **resets** density, pull compensation, fill pattern and
underlay to that type's defaults, because a sensible satin spacing is not a
sensible fill spacing.

Two more sections sit below those controls, each shown only when it applies:

- **3D Foam** and **Carving stamp** — see §3.6 and §3.7.
- **Transform** — flip, rotate, scale, group/ungroup (§3.2).
- **Entry / Exit** — **Arm entry**, then click the shape to place where the
  needle should come down first; **Arm exit** does the same for where it should
  leave. Placement is cleared with **Clear**, which returns the object to
  automatic resolution (the exit is derived from wherever the entry was put, so
  the two always agree).

#### Underlay strategies

| Strategy       | Use for                                                 |
| -------------- | ------------------------------------------------------- |
| **None**       | small shapes, or already-stabilized fabric              |
| **Center run** | general purpose, light fabrics                          |
| **Edge run**   | large fills — anchors the border                        |
| **Zigzag**     | medium fills needing edge plus interior support         |
| **Tatami**     | densest support; also the base layer for foam/puff work |

### 3.4 Colours

The palette section lists the design's threads.

- Click a swatch to make it active; new objects use the active colour.
- Assign a colour to a selected object from its _Colour_ dropdown.
- Add, edit (name/code/hex) and remove colours.
- Applying a preset palette replaces the current one — **"Basic 18"** is
  seeded on first run.
- The palette can never become empty; removing the final colour is blocked.
  Objects pointing at a removed colour are clamped back to a valid index.

### 3.5 Hoops

Pick a hoop in the right panel. Eight are built in:

```
100×100   126×110   180×130   200×200
300×200   400×200   Round 150   Cap frame 80×180
```

The hoop outline is drawn on the canvas. If the design runs outside the hoop
(or outside its safe margin) the status bar reports it as an **error**, and DST
export refuses — because a machine will silently truncate or mis-sew a design
that does not fit.

**Auto-hooping is not implemented.** Designs are checked against one hoop at a
time; the app will not automatically split or place a design across several
hoops. See [known-limitations.md](known-limitations.md).

### 3.6 3D foam (puff)

Foam is how you get raised lettering on a cap: a sheet of EVA foam sits on the
fabric, a dense satin column sews over it and traps it, and the excess is torn
away by hand afterwards.

Select a **satin** column or a **lettering** object and open **3D Foam** in the
right panel. It appears for satin only — a fill or a run has no foam technique
behind it, and pretending otherwise would just waste thread.

| Control                  | What it does                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| **Sew over foam (puff)** | turns the effect on                                                                            |
| **Foam thickness (mm)**  | how wide the column pulls past its drawn edge. Start at 2 mm, which is the common sheet.       |
| **Tack the foam first**  | sews one light run down the column's middle so the sheet cannot slide before the satin arrives |

Turning it on changes the stitches in three real ways, and all three are
visible in the preview and in the exported file:

- **The normal underlay is dropped.** A dense underlay would skate the foam
  sheet before the satin reached it. The optional tack replaces it — one run
  down the spine, nothing more.
- **The density is capped.** Foam shows through anything looser than about
  0.30 mm, so the row spacing is forced there no matter what the object asked
  for. A column at 0.4 mm looks solid on fabric; the same column over foam
  shows the sheet between every pair of rows.
- **The column pulls wider.** The thread has to climb the foam's edge and
  still meet fabric on the far side, so each side grows by a share of the
  thickness. Without this the letters look pinched and foam peeks out along
  the edges.

Two things the effect does **not** do, so you do not expect them on the
machine: it does not compensate for the foam compressing under the needle
(the first sew-out on your actual sheet is what tells you whether to raise or
lower the thickness), and it does not stabilise the fabric. Foam is an
addition to a proper stabiliser, never a replacement — on a stretchy cap or a
knit you still need one underneath.

### 3.7 Carving stamp

A carving stamp presses a repeating pattern **into** a fill — the opposite of a
motif fill, which _is_ only motifs with fabric showing between them. Here the
shape stays a solid tatami fill, and a stamp (any motif shape) is removed from
it over and over, so what you see is the fill with a debossed texture punched
through. The gaps are the design.

Select a **tatami** fill and open **Carving Stamp** in the right panel. It
appears for tatami only — a run or a satin column has no fill to carve.

| Control                              | What it does                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Carve a pattern into the fill**    | turns the effect on                                                                             |
| **Stamp**                            | which shape gets pressed in — the built-ins or anything in your motif library                   |
| **Stamp spacing (mm)**               | distance between stamps. Smaller packs them tighter.                                            |
| **Stamp size (mm)**                  | the stamp's actual size across. Leave it smaller than the spacing so fill shows between stamps. |
| **Stamp rotation (degrees)**         | turns each stamp, on top of the fill's own angle.                                               |
| **Sew an outline around each stamp** | adds a crisp run around every carved hole                                                       |

Four things happen to the stitches, and all four are visible in the preview and
the exported file:

- **The fill loses the stitches inside each stamp.** Carving only ever
  removes — you get the plain fill you asked for with a pattern taken out of
  it, never invented stitches.
- **The stamp grid follows the fill angle.** Stamps sit on the same staggered
  brick grid a motif fill uses, rotated to match the fill direction, so the
  texture lies with the stitches instead of against them.
- **Every hole is crossed by a jump, not a sewn line.** The needle lifts over
  the gap rather than sewing across it — sewing across would fill the texture
  straight back in and put a stitch longer than the machine can make.
- **The outline (optional) sews around each hole.** Without it the carve is
  just bare gaps; with it the edge of every stamp is a defined run, which is
  what makes a subtle texture readable.

**Sizing tip:** size and spacing together decide the look. Keep the size
smaller than the spacing (the defaults do) and you get a visible grid with
fill showing between stamps. Push the size up to match the spacing and
neighbouring stamps touch — the fill between them disappears entirely and it
stops reading as texture.

### 3.8 Motif library

A motif is the little shape a **Motif** fill repeats, or that a carving stamp
presses into a fill. Nine ship with the app — diamond, circle, star, cross,
hexagon, square, heart, flower and a plain round — and you can add your own.

Open it from either place a motif is chosen: **Motif** in the fill-pattern
list, the Motif stitch type, or **Carving Stamp**. The picker shows every shape
drawn as an outline, because that is how you actually choose one. **Edit motif
library...** underneath opens the list.

**Adding a shape.** Give it a name, then say where the outline comes from:

| Source                               | What it reads                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **the shape selected on the canvas** | the outer outline of whatever is selected — draw it, then save it as a motif                                                     |
| **a pasted SVG path**                | move, line, horizontal, vertical, cubic and quadratic commands, absolute or relative. Arcs are refused rather than approximated. |
| **pasted coordinates**               | at least three `x,y` pairs in millimetres, separated by commas, spaces or new lines                                              |

A shape may be 1–60 mm across, hold at most 400 points, and must not cross
itself — the outline would sew a knot rather than a shape. Every limit is
checked against the same test the engine applies when it sews, so nothing that
would fail on the machine gets saved.

**Shapes you add are yours** to rename or delete; the nine built-ins cannot be
deleted, because a design may name one and needs it to still be there.

**What happens when you pick a shape.** A built-in is stored as its name, so a
design picks up improvements to it. A shape from your library is stored as its
name **and** a copy of its outline: the name lets a later edit to the library
reach the design, and the copy keeps the design sewing correctly even if you
rename or delete that library entry afterwards. A design is never left
dependent on the library still holding what it used.

**Size means the same thing for every shape.** Motifs are sized to fill one
grid cell of the fill's spacing, whichever shape you picked, so switching from
a heart to a hexagon changes the look without changing the coverage.

**How the motif is laid.** **Motif layout** decides what the motif makes:

| Layout           | What it sews                                                       |
| ---------------- | ------------------------------------------------------------------ |
| **Fill**         | a grid of motifs across the shape (the default)                    |
| **Run**          | a line of motifs along the shape's outline, each turned to follow  |
| **Single stamp** | exactly one motif, scaled to fill the box you drew                 |
| **Column**       | motifs across a column, each spanning rail to rail, stepping along |

**Gradient.** Fill, run and column layouts can fade their size or lean across
the work: **Scale at the start** / **Scale at the end** and **Rotation at the
start** / **Rotation at the end**. The first motif wears the start numbers and
the last the end numbers; everything between is interpolated. Leave them at
1 / 1 and 0 / 0 for one uniform size, or press **Remove gradient**. A single
stamp has no length to fade along, so its gradient controls are hidden.

**User-defined split.** With the **Programmed split** fill pattern, three
fields decide the break: **Block length**, **Break** and **Stagger (%)**.
Stagger 0 rules every break on one line; 50% offsets alternate rows by half a
block, which is the built-in look. **Use the built-in 12 mm / 1.5 mm / 50%**
clears your definition and returns the fill to the default.

### 3.9 Shaping, offset and borders

The **Shape** section of the right panel rewrites the outline itself. Nothing
here is an effect: the preview, the validation and the exported file all see
the new geometry, so what you shape is what the machine sews.

**Combining shapes.** Select two or more objects, then:

| Command       | What it leaves                                                                               |
| ------------- | -------------------------------------------------------------------------------------------- |
| **Weld**      | everything either shape covers — overlaps merge into one outline                             |
| **Combine**   | only the area covered an odd number of times, so a spot covered by two shapes becomes a hole |
| **Subtract**  | the first selected shape with every other selected shape cut out of it                       |
| **Intersect** | only the area every selected shape covers                                                    |

The order matters for **Subtract**: the first object selected is the one that
is cut. All four are a single undo step. If the answer is empty — two shapes
that do not touch, or a first shape entirely covered — the panel says so and
changes nothing, rather than deleting your work to leave a blank object.

**Offset.** Enter a distance and press **Offset**. Positive grows the shape,
negative shrinks it, and the original stays where it is; the copy is added on
top. The **Corners** choice decides what happens at a sharp point: **Miter**
keeps the point sharp, **Bevel** cuts it flat, and **Round** follows an arc.
When a miter would run away at a very sharp spike, it is cut back
automatically rather than shooting a long thin point across the design.

**Copies** makes Offset Advanced: 3 copies at 2 mm produce outlines at 2, 4
and 6 mm. Each copy is measured from the original, so an error in one cannot
accumulate into the next.

Offsets clean up after themselves. Moving every edge of a shape sideways can
make the outline cross itself near a tight notch; those folded-over pieces are
removed instead of sewn, which is why a border around a narrow slot comes out
as two clean outlines rather than a bow tie.

**Border** is the same outline as a line to sew: it creates a **run** object
at the chosen distance, not a filled copy. A shape with a hole gets one run for
the outside and one for the hole, because a run follows a single line and
joining them would drag the needle across the work.

**Round corners.** Enter a radius and press **Round corners**. Each corner is
replaced by an arc that meets both edges tangentially. If the radius is too big
for the edges on either side, it is reduced until neighbouring corners just
meet — a 5 mm radius on a 4 mm square comes out as a smooth, valid shape rather
than an inside-out one.

**Center all** moves every object in the design so the combined bounds sit in
the middle of the hoop. It centres the design as a whole, keeping the objects'
positions relative to each other.

### 3.10 Appliqué

Appliqué sews a piece of fabric onto the garment instead of filling the shape
with thread. Select a fill or column object, open **Appliqué** in the right
panel and tick **Appliqué object**. The object then sews four passes around its
outline:

1. **Placement run** — a thin outline telling the operator where the fabric
   goes.
2. **Stop** — the machine pauses so the fabric can actually be put down.
3. **Tack** — a wide zigzag (or run/satin) holds the patch while it is trimmed.
4. **Stop** — the machine pauses again for the trimming.
5. **Finish** — a dense satin band covers the raw edge.

The stops are real machine stops and survive export; they are not simulated
pauses in the player. Every pass is ordinary stitch geometry, so the stitch
count, validation, preview and the exported file all agree.

| Setting                          | What it does                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Placement run**                | Turn the placement outline on or off.                                                             |
| **Tack**                         | `none`, `run`, `zigzag` or `satin`, plus its width in mm.                                         |
| **Tack width**                   | How far the basting stitch reaches either side of the edge.                                       |
| **Finish**                       | `none`, `run`, `zigzag` or `satin`, plus its width in mm.                                         |
| **Finish width**                 | How much of the raw edge the final band covers.                                                   |
| **Finish offset**                | Moves the finish outward (positive) or inward (negative) in mm, so it can sit more on the patch.  |
| **Finish spacing**               | Distance between finish penetrations; smaller is denser.                                          |
| **Sew the fill under the patch** | Also lays the object's normal fill before the appliqué passes. Leave off for a true fabric patch. |

**Partial appliqué.** Set **Mode** to _Partial (one open edge)_ and choose
**Start** and **Length** as percentages of the outline. Only that stretch is
placed, tacked and finished; the rest of the object behaves normally. This is
how a fabric roof is added to a stitched house — the roof edge is appliquéd,
the walls stay direct embroidery. The percentages are measured from the start
of the outline and wrap around the end automatically, so the same numbers keep
working after you move nodes.

A patch is previewed with a translucent tint of its thread colour so it reads
as fabric on the canvas. The tint is preview only: it is not a stitch and never
reaches an exported file.

### 3.11 Photo stitch

**Photo stitch** in the top bar sews a photograph as a mosaic of small thread
blocks. Pick an image, choose a preset, then press **Stitch photo**:

| Preset                  | What it sews                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| **Colour Photo Stitch** | 16 colours, 1.4 mm satin cells — the dense, photoreal look.         |
| **Photo Flash**         | 8 colours, 3 mm run cells — far fewer stitches, much faster to sew. |

Both presets are only starting points; every control stays editable:

| Control           | What it does                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------- |
| **Width**         | Finished width in mm; the height follows the picture's aspect ratio.                          |
| **Colours**       | How many thread colours the picture is reduced to, 2 to 24.                                   |
| **Cell size**     | The size of one thread block in mm. Smaller cells carry more detail and more stitches.        |
| **Style**         | `Satin` fills each cell with a dense band, `Run` lays one stroke, `Cross` lays two diagonals. |
| **Satin density** | Distance between satin rows inside a cell; only used by the satin style.                      |

The preview shows the real cell grid, so what you see is the colour layout that
will be sewn, not a rescaled photograph.

How it is built: the image is averaged down to the cell grid, reduced to the
chosen number of thread colours (median cut, so the same picture always gives
the same palette), and each cell becomes a square in the design. Cells are
grouped into **one object per thread colour** — that is what makes a
multi-colour photo exportable, since every machine format carries the thread
colour per block, not per stitch. Each cell is then sewn as its own little
satin, run or cross block. Transparent areas are skipped rather than sewn
black. The design is centred in the field and the whole photo is a single undo
step.

A photo is real, editable geometry: you can move it, reshape cells with the
node editor, change colours, sequence it, and export it like any other design.
The cell grid is capped at 20,000 cells; if the picture is too detailed for the
chosen cell size the dialog says so and asks for larger cells or a smaller
width.

### 3.12 Sequencing

The **Sequencing** section of the right panel decides the order the machine
sews in. It holds two different controls:

**Optimise thread changes** is a compile-time setting. When it is on, objects
that use the same thread are sewn together, and the next colour block is the
one nearest the needle. The object list is not changed, so the design stays
exactly as you drew it; only the stitch order changes. It is a session
preference, not part of the saved design.

**Auto-sequence** is a real edit. It rewrites the order of the objects so each
step lands at the nearest remaining object, starting from the machine origin.
That shortens travel and usually removes jumps and trims. One click is one undo
step, and the panel reports how many objects moved - or says that the order was
already the shortest. With **Optimise thread changes** ticked, auto-sequence
keeps the current thread's objects together instead of hopping between colours.

Both use each object's bounding-box centre as its travel point. That is exact
enough for choosing an order and much faster than simulating every needle
position; the actual entry and exit are still chosen inside each object when the
design compiles, so the final stitch path can differ slightly from the estimate.
Turning **Optimise thread changes** off restores the listed order immediately;
it does not use an undo step.

### 3.13 Continue digitizing

**Continue** (left tool rail) resumes the object you already have instead of
starting a new one. Select exactly one fill, column, run or bean and click
Continue: the object's outer ring becomes the live outline, with all its existing
points intact.

- Click to add points at the end of the outline. **Enter** or a double-click
  finishes; the shape closes from the last point back to the first.
- The commit changes the same object - its id, thread, order, holes and every
  stitch parameter stay as they were - and is one undo step.
- **Esc** leaves resume mode without changing the object, and keeps it selected.
  Picking another tool also leaves resume mode.
- A run or bean resumes as an open line; fills and columns close as outlines.
- Lettering has no editable outline (its stitches come from the text) and photo
  cells are not one drawing, so neither can be continued. The button is disabled
  unless one resumable object is selected.

### 3.14 Redwork

Redwork sews an outline as one-colour line work instead of filling it. Select one
or more objects, open **Redwork** in the right panel, choose a style and click
**Convert to redwork**.

| Style       | How it sews                                                          |
| ----------- | -------------------------------------------------------------------- |
| Single line | one run along the outline                                            |
| Triple run  | three passes over the same line, for a bold cord                     |
| Backstitch  | every step goes forward two stitches and back one, into the old hole |
| Stem stitch | short slanted stitches across the line, overlapping like a rope      |

**Stitch length** sets the distance between penetrations (0.5–8 mm). **Stem
width** is the thickness of a stem-stitch line (0.2–6 mm) and is only used by
that style. **Thread colour** becomes the redwork thread: an exact palette match
is reused, otherwise a new entry is added.

The geometry is never discarded. Conversion only sets the object's redwork
setting, so **Remove redwork** (shown while a selected object is in redwork mode)
returns the original fill, one undo step later. Corners are kept as corners: the
line is subdivided inside each segment rather than sampled across them, so a
square stays square. Lettering and photo objects are skipped; the panel reports
how many objects were converted and how many were left alone.

### 3.15 Snapping and the grid

The canvas grid has two independent spacings, both in Preferences: the **minor
grid size** (the everyday step) and the **major grid spacing** (the heavier lines
every fifth line by default). The major spacing can never be smaller than the
minor step; lowering the minor step pushes the major one up with it.

Two snap switches control where a click or drag lands:

- **Snap to grid** rounds the point to the nearest minor grid line.
- **Snap to objects** first looks for geometry on any visible object within 8
  screen pixels. A vertex wins over an edge, an edge wins over the object's
  bounding-box centre; if nothing is that close, the point is passed to the grid
  snap (when that is also on). A small ring is drawn at the caught point.

Hidden objects are not snapped to. While dragging an object, the object itself is
excluded so it cannot snap to where it already is; the same applies to the node
being dragged. With both switches off, points are placed exactly where you click.
The threshold is measured on screen, so zooming in gives finer control.

### 3.16 Separate pull compensation

A satin column is normally widened by one **Pull compensation** value. Tick
**Separate pull compensation** in the object panel to give each side its own:
**Left side** and **Right side**, in millimetres. The two values are applied
rail by rail, so a column bordered by a fill on one side can be widened only
where the fabric pulls harder.

The checkbox starts both sides at the uniform value, so turning it on changes
nothing until you edit a number. Turning it off stores no per-side value and the
uniform value applies again. Foam scales each side by the same ratio it applies
to the uniform value. The satin generator widens a column rather than shrinking
it, so a negative side value is stored but treated as zero - exactly like a
negative single value. Lettering hides the control because its letters are
generated as a whole, not as one editable column.

### 3.17 Advanced lettering

The Text tool places a lettering object straight away with "TEXT" as a starter
string. Everything below lives in the **Lettering** panel while the text object
is selected.

**Width scale.** The **Width scale** field condenses or widens the letters
without touching their height: `1` keeps the font's proportions, `0.6` condenses,
`1.5` widens. It is also what the scale buttons change when you scale text.

**Order.** **Sewing order** resequences the needle path through the letters:

| Order         | Sews                        |
| ------------- | --------------------------- |
| Reading order | left to right (the default) |
| Reverse       | right to left               |
| Outside in    | first and last, then inward |
| Inside out    | middle outwards             |

Nothing moves on the canvas with any of these; only the sequence changes. That
is useful for keeping long travels short and for stitching a name in the order
the machine handles best.

**Text on a path.** Tick **Text on a path**, pick the text _and_ the shape whose
outline it should follow (click the text, then Shift-click the shape), and press
**Use selected shape**. The shape's outline is copied into the spec - the shape
itself is not consumed, you can delete or hide it. Letters sit centred on the
path and rotate with it; **Keep letters upright** holds them vertical instead.
**Offset from path (mm)** lifts them above the line, and **Along the path**
starts them at the first point or centres them on the whole path. **Clear path**
returns the text to a straight line.

**Monogram.** Tick **Monogram** to compose the first three letters the monogram
way: the middle initial is honoured and larger, the side initials sit at 72%,
vertically centred, and can be mirrored outwards. **Frame** adds a circle, oval
or diamond sewn last as a closed satin ring at **Frame width**. Two letters
become centre + right, one letter becomes a single large initial. A monogram
takes precedence over a path and over the dropped letter.

**Dropped letter (team names).** Tick **Dropped letter** and choose **Which
letter** (the first letter is 0) and a **Scale**. That letter sews larger, its
top staying on the line and the rest dropping below it - the classic team-name
look. Drag the scale to your taste; 1.6 is a good start.

**Mirrors and rotation.** The shape transform buttons work on text too: rotate
and scale go through the lettering spec, and the flip buttons toggle **Mirror
horizontally** / **Mirror vertically** (also available as checkboxes in the
panel). A mirrored lettering block mirrors about its own centre, so its box
stays where it was.

**Size limits.** No size is blocked, but the checks warn when text leaves the
sewable zone: too small (< 3 mm cap height), too large (> 300 mm), a stroke wider
than the cap height (the letters would close up), or a path with a single point
(it lays out straight instead). Fix the warning and it clears.

**Picking text up again.** Text has no editable outline by design, so clicking it
selects it by the box around the laid-out letters. Node Edit is not available on
text; move, rotate, scale, mirror and the panel fields are.

### 3.18 Fill styles

A **tatami** fill has eighteen ways to lay its stitches. Choose one with **Fill
pattern** in the object panel. Density and angle still drive every one of them,
so nothing is a fixed sample that ignores your settings.

| Pattern          | What it sews                                                       |
| ---------------- | ------------------------------------------------------------------ |
| Plain weave      | serpentine tatami rows — the default, unchanged from before        |
| Programmed split | 12 mm blocks with 1.5 mm breaks, rows staggered half a block       |
| Flexi split      | the same blocks, but each row's break length follows its own width |
| Motif stamps     | a grid, run, single stamp or column of the chosen motif (§3.8)     |
| Contour          | offset rings that follow the edge                                  |
| Spiral           | one spiral line from the middle out                                |
| Accordion        | pleated zigzag bands; the pleat pitch follows the density          |
| Florentine       | leaf bands tilted alternately, one way then the other              |
| Liquid           | rows that flow as sine waves                                       |
| Maze             | one line wandering the shape with square turns                     |
| String           | loosely laid, longer meandering stitches                           |
| Laydown          | long parallel laid threads, split only at the machine step limit   |
| Stipple          | a jittered dot texture (no rows, so the angle does not apply)      |
| Cross hatch      | two passes: the fill angle, then the same grid crossed at 90°      |
| Shading          | row pitch fades from open at the top to dense at the bottom        |
| Hand stitch      | irregular penetrations and jittered rows, a hand-sewn look         |
| Jagged edge      | row ends torn in and out for a rough edge                          |
| 3D warp          | rows bow outward as if the fabric curved over a dome               |

The textures are **seeded from the shape itself**, never from a clock: the same
shape always compiles to exactly the same stitches, so the preview, the exported
file and a re-opened project never disagree. Holes are respected — rows stop at
a hole and the thread is carried across by a jump — and every stitch stays inside
the shape box.

---

## 4. Watching it sew — the stitch player

The bar at the bottom of the canvas:

```
 ⏮   ▶   ────────●────────────   1,234 / 45,678   Speed 1x
```

| Control       | Does                              |
| ------------- | --------------------------------- |
| **▶ / ❚❚**    | play / pause (or **Space**)       |
| **⏮**         | rewind and leave playback mode    |
| **scrub bar** | jump to any point in the sequence |
| **Speed**     | 0.25× … 8×                        |
| counter       | stitches revealed / total         |

The yellow ring marks the current needle position.

Playback reveals the **same compiled sequence the file will contain**, in the
same order, including jumps, trims and colour changes. That makes it a check of
real output rather than an animation of what the design might look like.

Pressing play blanks everything after the current position — that is intended:
you are watching the design build up from nothing, the way the machine does.

---

## 5. Saving

- **Save** (the Save button in the top bar) writes to MongoDB.
- A new design asks for a name on first save.
- **Autosave** runs every 30 s (configurable) but only for designs that already
  have a name and have unsaved changes.
- **Open** lists saved projects with search.

**Version conflicts:** every project carries a version number. If the same
project changed in another tab, your save is rejected with
_"This project was changed elsewhere. Reload before saving again."_ rather than
silently overwriting the newer copy. Reload and re-apply your changes.

**History** (the History button in the top bar, once the design has been saved)
is a list of checkpoints of _this_ project:

- Every save whose **design actually changed** leaves a checkpoint of the state
  _before_ that save — so after a bad edit you can go back to it. Renaming the
  design, or saving with nothing edited, creates nothing to wade through.
- **Take checkpoint** records the current design whenever you want, named
  **manual** so you can tell it from an automatic one.
- **Restore** writes a checkpoint back over the document. Before it does, it
  first checkpoints what it is replacing (named **restore**), so restoring is
  itself undoable with `Ctrl+Z`.
- Checkpoints are fetched one at a time, so the list opens fast even with a
  large design. The 30 most recent are kept per project; older ones fall off.

**Recent files** appear at the top of **Open**, most recently used first —
up to 20. Hover a row for **Forget** to drop one without deleting the project,
or clear the whole list. If a project was deleted outside the editor, opening it
says _"<name>" is no longer in the library_ and removes the row rather than
failing.

---

## 6. Exporting a machine file

Pick the format from the dropdown next to **Export** and click it. The file
downloads as `<design name>.<ext>`, sanitised for the filesystem.

| Format  | Choose it for                       |
| ------- | ----------------------------------- |
| **DST** | Tajima and most commercial machines |
| **PES** | Brother / Babylock home machines    |
| **EXP** | Melco / Bernina                     |
| **JEF** | Janome / Elna / New Home            |
| **VP3** | Husqvarna Viking / Pfaff            |
| **TBF** | Babylock / Bernina / Barudan        |
| **HUS** | Husqvarna Viking                    |

- Export runs the full compile → validation pipeline first.
- If validation reports an **error** (most commonly "design exceeds the hoop"),
  export is refused and the message is shown.
- The bytes are produced by ThreadWorks' own encoders from the exact sequence
  previewed on screen — no placeholder data, no estimated counts.

Each format has its own coordinate convention, and each encoder handles it
internally: DST, EXP, JEF, VP3, TBF and HUS negate y (machine space is y-up),
PES does not (Brother is y-down like the editor). Thread colours travel with
the file where the format carries them — VP3 in full, TBF and HUS by swatch —
and DST and EXP carry none at all. See [format-support.md](format-support.md)
for the details and for the formats that are deliberately not offered rather than
faked.

### Exporting a design too big for one hoop

When a design is wider or taller than every hoop you have — a banner, a
bedsheet border, a name across a jacket back — it cannot be sewn in one
hooping. **Export sections** (next to **Export**) splits it and writes one file
per hooping.

1. Click **Export sections**. The design is walked in sewing order and cut into
   sections that each fit one hoop. One frame is chosen for the whole design:
   the smallest that holds the whole thing, or, if nothing is large enough, the
   roomiest in your library so there are fewer re-hoopings.
2. Each section downloads as `<design name>-part<N>of<M>.<ext>` in the format
   selected in the dropdown — so `Logo-part1of3.dst`, `Logo-part2of3.dst`, and
   so on.
3. The status message tells you the hoop to mount and how many cuts were made,
   and warns if any cut had to fall mid-object.

How to sew it: mount section 1, sew it, then re-hoop the garment for section 2,
aligning it on the section's start point — or, with **Registration crosses** on,
on the cross the two files share — and sew. Keep the sections in order.

The two **Multi-hoop** options in the right panel control that join:

- **Overlap (mm)** spreads each cut across a band instead of landing on one
  line, so consecutive sections sew the same strip twice and the join has no
  visible line. 0 (the default) means sections meet exactly; 3–5 mm is a
  sensible starting point. The export message says how much got shared.
- **Registration crosses** sew a small cross at each boundary: the section that
  ends there sews it last, the one that begins there sews it first. Because each
  file is centred in its own hoop the two crosses are at different coordinates
  in the two files — that is deliberate; the operator lines the garment up on
  them, and the cross is the same point in the design on both sides.

A few things worth knowing:

- **Cuts prefer travel points.** Wherever possible the split lands on a jump,
  trim or colour change — a place the machine is already between objects — so
  no stitches are lost and each section starts cleanly.
- **Each section is centred in the hoop.** Because each file is hooped
  separately, each is moved to the middle of its frame. This means a section's
  coordinates differ from the whole design; align by eye or on a mark, not by
  overlaying the files.
- **A design that already fits** comes back as a single file, byte-identical to
  a normal **Export** — so you can use **Export sections** without checking the
  size first. Overlap and crosses are left alone in that case: they only apply
  when a split actually happens.
- **Overlap and registration marks are optional**, on the Multi-hoop panel.
  Neither changes the source objects; they change how the design is _cut into
  files_. See [known-limitations.md](known-limitations.md) §3 for how the band
  is measured and why it is clamped.

`scripts/export-samples.ts` (`npx tsx scripts/export-samples.ts`) writes one file
per format into `samples/` from a real two-colour design, if you want something
to try on a machine before drawing your own.

---

## 7. Opening a machine file a client sent

**Import** in the top bar reads a DST, PES, PEC, EXP, JEF, VP3, TBF or HUS
file — the kind a client emails when they say "make me this" — and turns it
into something you can work with.

1. Pick the file. The dialog reads it and shows what it found: the format, the
   design name stored in it, how many of the records are actual sewing, the
   number of colour blocks, and the finished size in millimetres.
2. A preview appears, rendered with the same engine the stitch video uses, so
   what you see is what the machine will sew.
3. If the format carries thread colours, they are shown as swatches with their
   real thread names — PES and PEC name Brother's chart entries, JEF names
   Janome's numbers, VP3 carries colour, name, number and brand outright, TBF
   carries colour only, and HUS names each thread from the machine's own
   library. If the format stores no colours at all (DST and EXP cannot), one
   placeholder thread is invented per colour block and the dialog says so.
4. Choose what to save it as — **DST**, **PES**, **EXP**, **JEF**, **VP3**,
   **TBF**, **HUS**, or a **stitch video** — and click **Save**.

The most common reason to open this dialog is conversion: a client sends a PES,
the shop's machine wants DST. Pick the file, choose DST, save, done. The second
most common is making a stitch video out of someone else's design to show them
what it will look like.

What you cannot do is edit the shapes. A machine file stores needle
penetrations in order — a flat point list — and nothing about the outlines,
fills and columns that produced them. This is a property of the format, not a
missing feature. To change the artwork, close this dialog and use **Trace
image** on the original picture instead; you will get editable objects.

The dialog also reports anything worth knowing about the file: very long
stitches, very short stitches, and long travels. Those are informational here —
the file already came off a working machine — and long moves are split
automatically when the new file is written.

`scripts/smoke.ts` exercises this path end to end: it writes a PES, reads it
back, converts it to a DST, and re-imports the result.

---

## 8. Tracing an image

**Trace image** in the top bar turns a photo or logo into fills.

1. Pick a file (PNG, JPEG, anything the browser can decode).
2. The preview shows exactly the colours the tracer will use. If the result
   looks too flat, raise **Colours**; if it looks noisy, lower **Detail**.
3. **Width** sets the finished size in millimetres; the height follows the
   image's proportions.
4. **Density** is the fill spacing in mm — smaller is denser and sews slower.
5. **Trace**.

What it does, in order: reduce the image to your colour count, treat a solid
surround as background if **Ignore background** is ticked, walk each remaining
colour's outline (holes included), drop anything too small or too thin, and
build one fill per region with its stitch direction along that shape's long
axis.

The traced art **replaces** the current design and is centred in the field.
One **Undo** brings the previous design straight back.

The toast afterwards reports what happened, including how many regions were
ignored for being tiny. If it says nothing to sew, lower the colour count or
pick the _Fine_ detail level.

Preparing an image well matters more than the settings:

- Crop it first — whatever is in the frame gets traced.
- Straighten it. The tracer has no rotation or perspective correction.
- Photos work best with soft, well-lit subjects; hard shadows trace as extra
  colour regions.
- A PNG with a transparent background beats a white one: nothing to detect.

---

## 9. Stitch video

**Stitch video**, next to the export controls, renders the design sewing into an
animated GIF you can send straight to a client — WhatsApp, email and every
browser play it with nothing installed.

What it shows:

- stitches appear in order, in the design's real thread colours
- a marker shows where the needle is
- a counter and a progress bar run along the bottom

It takes a second or two on a large design, and the button reads _Rendering..._
while it works. The work happens on a background thread, so the canvas keeps
moving and the rest of the editor stays usable meanwhile. The file lands as
`<design name>-stitch.gif`.

The movie is re-rendered from the compiled stitch sequence every time, so it
always matches what would actually sew — it is not a screen recording.

For more control (frame size, frame rate, stitches per frame, whether jumps are
drawn), run the sample script, which also writes one into `samples/`:

```bat
npx tsx scripts/export-movie-sample.ts
```

---

## 10. Backups

```bat
backup.bat
restore.bat                     :: list available backups
restore.bat data\backups\2026-10-14T12-00-00-000Z
restore.bat data\backups\<folder> merge    :: keep existing records too
```

- Backups land in `data\backups\<timestamp>\` as one JSON-lines file per
  collection plus `manifest.json`.
- Uses the MongoDB driver directly — `mongodump` need not be installed.
- **Restore replaces everything by default.** A prompt shows the folder and the
  mode before anything is erased, and offers to stop a running instance first.
- `merge` mode keeps records not present in the backup; it can resurrect
  designs you deleted on purpose, which is why it is not the default.

---

## 11. Preferences

The **Preferences** button (top right) is where everything below is set. It
saves as you change it; if the server refuses, the panel says so and the change
is rolled back.

| Setting                  | What it does                                   | Range                             |
| ------------------------ | ---------------------------------------------- | --------------------------------- |
| Default hoop             | the hoop a **New** design starts with          | any hoop in your library, or none |
| **New fill stitch type** | what a newly drawn complex fill starts as      | tatami / contour / spiral / motif |
| Autosave interval        | how often a named, unsaved design is written   | seconds                           |
| **Undo steps**           | how much history a design keeps                | 5–500, default 60                 |
| Minor grid size          | the canvas grid spacing                        | mm                                |
| Major grid spacing       | spacing of the heavier grid lines              | mm, never below the minor step    |
| Player speed             | the speed the stitch player starts at          | 0.25×–8×                          |
| Show grid / Show rulers  | canvas furniture on or off                     |                                   |
| Snap to grid             | clicks and drags snap to the minor grid        |                                   |
| Snap to objects          | clicks and drags catch visible object geometry |                                   |
| Show underlay in preview | whether the underlay is drawn in the canvas    |                                   |

**Undo steps also affects the history you already have.** Lowering it trims the
stack the editor is holding — the steps nearest the present survive, the oldest
are dropped — but only _after_ the save succeeds, so a rejected change never
destroys history. Raising it simply allows more from then on; it cannot
recreate steps that were already dropped. The value is stored per installation,
not per design.

**New fill stitch type** sets the stitch type a freshly drawn complex fill
starts with — pick the one you reach for most and every shape you draw from
then on begins there, already half digitized. It is read the moment a shape is
committed, so it applies to the very next shape drawn, and traced images honour
it too. The column, run and bean tools each already mean one stitch type, so
they keep theirs.

Units are shown read-only as millimetres: the application works in millimetres
throughout.

---

## 12. Keyboard reference

| Key                       | Action                                                                       |
| ------------------------- | ---------------------------------------------------------------------------- |
| `V`                       | Select tool                                                                  |
| `H`                       | Pan tool                                                                     |
| `N`                       | Node editing tool (drag an individual point)                                 |
| `Enter` / double-click    | finish the outline in progress                                               |
| `Esc`                     | cancel outline, clear selection, cancel entry/exit placement, back to Select |
| `Delete` / `Backspace`    | delete selection                                                             |
| `Space`                   | play/pause the stitch player (when using the Select tool)                    |
| `Ctrl+Z`                  | undo                                                                         |
| `Ctrl+Y` / `Ctrl+Shift+Z` | redo                                                                         |
| `Ctrl+D`                  | duplicate selection                                                          |
| `Ctrl+G`                  | group the selection                                                          |
| `Ctrl+Shift+G`            | ungroup                                                                      |
| `Ctrl`/`⌘` + wheel        | zoom at cursor                                                               |
| wheel                     | pan vertically                                                               |
| middle-drag / `H` + drag  | pan                                                                          |
| shift+click               | add to selection                                                             |

---

## 13. When something goes wrong

| Symptom                                     | Cause and fix                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| "Reference data could not be loaded" banner | server not running, or MongoDB down. Start with `start.bat`.                          |
| Server status shows disconnected            | same as above; the editor still works locally, but Save and Open do not.              |
| Compile error in the status bar             | a parameter is out of range; the message names it. Editing any field updates it live. |
| "Design exceeds the hoop"                   | pick a larger hoop, or move/shrink the design.                                        |
| Port 4000 already in use                    | another instance is running — open <http://127.0.0.1:4000> or run `shutdown.bat`.     |
| Seeded hoops/palettes empty                 | run `npm run seed`.                                                                   |
| Save says "changed elsewhere"               | reload the project, redo your edit, save again.                                       |

---

## 14. What this application does not do

Read [known-limitations.md](known-limitations.md) before relying on it for
production work, and [feature-matrix.md](feature-matrix.md) for a
feature-by-feature status list. In short: manual digitizing, lettering with
monograms and text on a path, eighteen fill textures, node editing, transforms,
grouping, auto-hooping, colour blending, appliqué, multi-hoop splitting with
overlap and registration crosses, 3D foam, carving stamps, the motif library,
auto-digitizing, machine-file import, stitch video, version history and
DST / PES / EXP / JEF / VP3 / TBF / HUS export all work. **What is still
missing** is art export to SVG / PNG / PDF, licensed thread charts, 3D / lit
rendering, and customisable key bindings.
