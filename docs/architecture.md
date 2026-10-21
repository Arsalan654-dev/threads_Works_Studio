# Architecture

ThreadWorks Studio is a local-first MERN application split into three
workspaces that share one rule: **stitch generation lives in exactly one
place**.

```
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚  @threadworks/engine         â”‚
                    â”‚  pure TypeScript, no Node    â”‚
                    â”‚  APIs, no DOM APIs           â”‚
                    â”‚                              â”‚
                    â”‚  geometry â†’ stitches â†’ DST   â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â”‚  same code, two hosts
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â”‚                                  â”‚
   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”          â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
   â”‚  client (React/Vite) â”‚          â”‚  server (Express)      â”‚
   â”‚  preview, editing,   â”‚  HTTP    â”‚  validation, storage,  â”‚
   â”‚  playback, DST       â”‚â—„â”€â”€â”€â”€â”€â”€â”€â”€â–ºâ”‚  backup/restore, seed  â”‚
   â”‚  export in-browser   â”‚  /api    â”‚  serves client/dist    â”‚
   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜          â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
              â”‚                                  â”‚
              â”‚  save / open                     â”‚
              â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                 â”‚
                      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                      â”‚  MongoDB            â”‚
                      â”‚  127.0.0.1:27017    â”‚
                      â”‚  embroidery_studio  â”‚
                      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 1. `@threadworks/engine`

The engine is the product's core and is deliberately platform-neutral:

- **No `Buffer`**, no `process`, no `window`. It works on `Uint8Array` and
  plain objects, so the identical build runs in Node and in a browser.
- **Pure functions.** `compileDesign(objects, palette, hoop)` is a pure
  function of its inputs. The same design always produces byte-identical
  stitches, which is what makes save/reopen, undo/redo and testing reliable.
- **Editable geometry is never discarded.** Stitches are always _derived_, so
  editing a parameter and re-running is lossless.

### Pipeline

```
EmbroideryObject  (source geometry + StitchParameters)
      â”‚
      â–¼
generateUnderlay()            underlay layer: none | centerRun | edgeRun | zigzag | tatami
      â–¼
generateTopStitch()           satin | tatami | run | bean | motif | contour | spiral
      â–¼
generateObjectStitches()      specialty route (sequin/beading/chenille/schiffli) or underlay + top
      â–¼
buildSequence()               tie-in/tie-off locks, connectors, jumps, trims,
                              colour changes, optional colour-run optimisation
      |
applyCapCompensation()        inverse arcsin driver compensation when cap wrap is on
      â–¼
validateSequence()            machine-facing checks (see below)
      â–¼
StitchSequence                { stitches, colorCount, bounds, stats }
      â”‚
      â”œâ”€â”€â–º canvas renderer    what you see
      â””â”€â”€â–º writeDst()         what the machine gets
```

### Modules

| Module        | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry/`   | bounds, area, containment, scanline spans, resampling, path simplify/split, ring normalisation, boolean outlines (`boolean.ts`), offset/border/corner rounding (`offset.ts`)                                                                                                                                                                                                                                                           |
| `stitches/`   | the seven base generators plus the advanced texture fills (accordion, florentine, liquid, maze, string, laydown, stipple, cross, shading, hand, and jagged/warp/flexi split riding tatami) and the motif layouts (grid fill, outline run, single stamp and column, with an optional size/rotation gradient); every generator returns `RawStitch[]`, and texture randomness comes from a shape-seeded PRNG so compiles are reproducible |
| `applique.ts` | placement / tack / finish passes with real machine stops, full or partial outline                                                                                                                                                                                                                                                                                                                                                      |
| `photo.ts`    | photograph to cell mosaic: colour quantisation, per-cell satin/run/cross blocks, one object per thread                                                                                                                                                                                                                                                                                                                                 |
| `redwork.ts`  | outline line work: single, triple, backstitch and stem styles, with every corner kept as a penetration and the machine step limit respected                                                                                                                                                                                                                                                                                            |
| `lettering/`  | glyph layout: straight text, text on a path, monograms with optional frames, dropped letters, resequencing, width factor and mirrors, plus `letteringBounds` / `letteringStrokes` for selection and preview                                                                                                                                                                                                                            |
| `underlay/`   | underlay strategies, plus `tieIn` / `tieOff` lock generation and entry/exit choice                                                                                                                                                                                                                                                                                                                                                     |
| `sequencing/` | object ordering (nearest-travel auto-sequence, nearest colour block), connector/jump/trim decisions, colour changes                                                                                                                                                                                                                                                                                                                    |
| `validation/` | `LIMITS` + `validateObject` + `validateSequence`                                                                                                                                                                                                                                                                                                                                                                                       |
| `lettering/fonts.ts` | the six original skeleton font families, glyph resolution and family tracking; absent `font` keeps Studio Sans |
| `clipart.ts` | 17 original parametric shapes, categories, search and physical placement |
| `specialty.ts` | sequin, bead, chenille and schiffli simulation generators that emit ordinary penetrations |
| `machines.ts` | group by 1-64 machine number, spread a selection, list assigned machines |
| `capwrap.ts` | crown preview projection, inverse driver compensation and the width/radius check |
| `artwork/` | millimetre SVG, direct PDF writer, tiled 1:1 print sheets and shared stitch-run geometry |
| `formats/`    | one encoder + decoder per machine format: DST, PES/PEC, EXP, JEF, VP3, TBF, HUS, plus format detection                                                                                                                                                                                                                                                                                                                                 |

### Why the engine is a separate package

Preview and export must never disagree. If the canvas used one implementation
and the exporter another, "looks fine on screen, wrong on the machine" becomes
possible â€” the failure mode that matters most in this domain. One engine, one
sequence, two consumers.

---

## 2. Coordinates and units

- **Millimetres are canonical** everywhere: geometry, stitches, validation, DST
  header. Inch/centimetre display is a formatting concern only.
- The **embroidery field is addressed from its top-left corner**: `(0,0)` to
  `(width, height)`. The renderer draws the hoop there, objects are created
  there, and validation checks against that frame (including the hoop's
  `safeMargin` inset). These three must agree; an earlier build validated a
  hoop centred on the origin and consequently refused designs that visibly
  fit.
- DST's origin is its own; the encoder writes bounds into the header rather
  than trying to preserve the editor's origin.

---

## 3. `server`

Express + TypeScript, strict Zod validation at every boundary.

### Configuration â€” `src/config/env.ts`

All configuration is parsed and validated **once at startup**. A bad value
fails fast with a readable message instead of surfacing as a mysterious
runtime error. Notably:

- `MONGODB_URI` is validated to be **loopback-only**. A remote host is a
  configuration error, which is how the "no cloud" requirement is enforced
  rather than merely intended.
- `SERVER_HOST` defaults to `127.0.0.1`; `server.ts` re-checks the bind address
  before listening.
- `BACKUP_KEEP` bounds how many backups are retained.

### Request pipeline â€” `src/app.ts`

```
helmet â†’ compression â†’ JSON body limit â†’ origin restriction
   â†’ /api routes
   â†’ /exports static
   â†’ built client (production) + SPA fallback
   â†’ notFound â†’ errorHandler
```

- **Origin restriction:** only `http://127.0.0.1:<port>` and
  `http://localhost:<port>` are accepted. This makes browser CSRF against the
  local API from an arbitrary page impractical, and costs nothing on a
  localhost-only service.
- **Production mode serves the built editor from the same origin**, so a normal
  run is one process on one port. In development, Vite owns the client and
  proxies `/api`.
- The SPA fallback explicitly skips `/api` and `/exports`, so a mistyped API
  route still returns a JSON 404 rather than the HTML shell.

### Validation â€” `src/schemas/` + `src/middleware/validate.ts`

Zod schemas are the single definition of every request shape. The middleware
parses and **replaces** the request body/query with the typed, defaulted
result, so handlers only ever see validated data. Failures return 400 with a
`fields[]` array naming each bad path.

### Storage â€” `src/db/mongo.ts`

| Collection            | Contents                                                             |
| --------------------- | -------------------------------------------------------------------- |
| `projects`            | name, design document, monotonically increasing `version`, `summary` |
| `designVersions`      | version history per project                                          |
| `threadPalettes`      | palette presets                                                      |
| `hoopPresets`         | hoop presets                                                         |
| `digitizingPresets`   | stitch-parameter presets                                             |
| `motifPresets`        | motif library â€” shapes a fill repeats or a carve presses in          |
| `applicationSettings` | editor settings (grid, autosave interval, â€¦)                         |
| `recentFiles`         | recently opened projects                                             |

Indexes are created by `ensureIndexes()`, idempotently, at startup.

### Optimistic concurrency â€” `src/routes/projects.ts`

Every project carries an integer `version`. A `PUT` may include
`expectedVersion`; if it does not match the stored version the server returns
**409 Conflict** and changes nothing. This is what stops an idle second tab
from silently overwriting newer work â€” the alternative, last-write-wins, would
lose designs without warning.

### Scripts

| Script       | Purpose                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `seed.ts`    | idempotently installs 8 hoops, the "Basic 18" palette, 15 digitizing presets |
| `backup.ts`  | JSONL per collection + `manifest.json`, prunes to `BACKUP_KEEP`              |
| `restore.ts` | replace (default) or merge; rehydrates BSON `_id`/dates                      |

Backup and restore use the **MongoDB driver directly**, so `mongodump` is not a
prerequisite. The library functions are silent by default; only the CLI entry
points log.

---

## 4. `client`

React 18 + TypeScript + Vite + Zustand.

### Stores

| Store            | Holds                                                            | Why separate                                                                                                          |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `designStore`    | the design document, selection, tool, undo/redo, derived compile | its mutations bump `rev` and invalidate history                                                                       |
| `referenceStore` | hoops, palettes, presets, settings, connection status            | loaded once at startup, shared by many components                                                                     |
| `playbackStore`  | stitch-player position/speed/playing                             | **transient UI state** â€” must never enter undo history, and must not invalidate the compiled-stitch cache every frame |

### Derived state instead of duplicated state

`getCompiled()` memoises `{ sequence, validation }` against the store's `rev`.
Every edit sets `compiled: null`, so the next read recompiles. Nothing else in
the store stores stitch counts â€” the status bar, the player and the exporter
all read the same object, so they cannot drift apart.

### Rendering

Canvas 2D rather than SVG. A dense fill can be tens of thousands of stitches;
the renderer batches them into runs of identical appearance and submits one
path per run, so a large design costs a handful of `stroke()` calls instead of
tens of thousands of DOM nodes.

The **view transform lives in a ref**, not React state: `pointermove` fires far
faster than React re-renders usefully, and repainting straight from the ref
keeps panning smooth. Repaints are coalesced to at most one per animation
frame.

`preview3d` adds a shadow and highlight pass over satin runs without changing
the stitch list. When `capWrap.enabled` is set, `render.ts` replaces the flat
hoop background with a curved crown panel and projects each stitch through
`capPreviewPoint()`; object outlines and node handles are hidden in that mode
because they would otherwise sit on the flat, unwrapped coordinates.

### The stitch player

Playback does not regenerate anything. It advances a _pointer_ into the
already-compiled sequence and asks the renderer to reveal only the first `N`
stitches (`RenderOptions.stitchLimit`), plus a needle-head marker. Scrubbing is
therefore O(1) in the engine and reuses the exact order the file will contain.

### Export

Export runs the full pipeline, refuses on validation errors, and encodes with
the engine's `writeDst()` â€” the same code path the tests round-trip through
`readDst()`.

**Export machines** groups visible objects by their 1-64 `machine` number and
runs `compileDesign()` once per group, so each file has its own validation and
its own stitch list. **Artwork** uses the same compiled sequence: the engine
writes SVG and PDF directly in millimetres, `buildPrintSheet()` tiles a 1:1
sheet, and the browser-only `files/artwork.ts` rasterises PNG through a canvas.

### Stitch video rendering

Rendering a movie is the editor's slowest job by a wide margin (about 1.5 s for
a 10,000-stitch design), so `client/src/video/gif.ts` hands the work to a Web
Worker (`gifWorker.ts`) and returns a promise. The worker is a thin shell around
the same pure `encodeStitchMovie()` the tests call directly â€” the engine has no
DOM in it, which is exactly what makes the move possible â€” and it transfers the
finished buffer back rather than copying it. Where a worker cannot be created
(jsdom, a `file://` page, a browser refusing module workers), the facade calls
the encoder on the calling thread: one code path, one result, only a different
thread. The pending map is keyed by request id, rejects on worker error, and is
drained by `closeGifWorker()` so no promise can be left hanging.

---

## 5. Money/honesty rules encoded in the design

Several choices are about _not_ being able to lie:

1. **Stitch counts are computed, never estimated.** The status bar reads
   `sequence.stats`, which is derived from the array that gets encoded.
2. **Export refuses rather than degrades.** A design outside the hoop is a hard
   error, not a warning that gets ignored.
3. **No silent fallbacks.** No hoop â†’ validation skips the hoop check
   explicitly; missing database â†’ Save reports failure; unknown hoop id â†’ no
   hoop, rather than validating against a frame the user cannot select.
4. **Only formats that are really implemented are offered.** See
   [format-support.md](format-support.md).

---

## 6. Testing strategy

| Layer      | Approach                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Engine     | unit + integration; DST encodeâ†’decode round trips; each generator; sequence and validation rules; fonts, clipart, artwork, cap wrap, machine grouping and specialty simulations                                         |
| Server     | `supertest` against the real Express app with a test database; schema, concurrency, CRUD                                                 |
| Client     | Vitest + Testing Library; store logic, geometry, hit testing, playback, renderer behaviour through a recording 2D context; clipart browser, artwork dialog, inspector controls and per-machine export                |
| End-to-end | `npm run smoke` â€” 119 checks over live HTTP against a running server, including real DST / PES / EXP / JEF / VP3 / TBF / HUS round trips |

The renderer test is worth calling out: jsdom has no canvas, so drawing is
observed through a stand-in that records what was submitted. That genuinely
verifies _how much_ was drawn (e.g. that `stitchLimit` shortens the sequence),
but it does not verify pixels â€” and no claim is made that it does.
