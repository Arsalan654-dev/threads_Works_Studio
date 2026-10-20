# ThreadWorks Studio — Run Guide

How to install, run, and operate ThreadWorks Studio on a single Windows
machine. Everything here is local-only: no cloud, no remote database, no
internet needed after install.

---

## 1. What you need

| Requirement | Minimum                      | Why                                                       |
| ----------- | ---------------------------- | --------------------------------------------------------- |
| Node.js     | 20.x or newer                | Runs the API and builds the editor. Verified on v24.18.0. |
| npm         | Ships with Node              | Dependency install and scripts.                           |
| MongoDB     | Running on `127.0.0.1:27017` | Every design is stored here.                              |
| Browser     | Chrome, Edge, or Firefox     | The editor UI.                                            |
| Disk        | ~400 MB                      | `node_modules` plus the MongoDB data folder.              |

**MongoDB is required and there is no substitute.** The application will not
fall back to files or browser `localStorage`, because doing so would make
"saved" designs vanish on the next start. If MongoDB is not installed, install
it first, then return here.

Confirm MongoDB is listening before anything else:

```
netstat -ano | findstr ":27017"
```

You should see a `LISTENING` line. If not, start the service:

```
net start MongoDB
```

---

## 2. Install and build

From `D:\my-embroidery-software` (or wherever you copied the project):

```
npm install
npm run build
```

`npm run build` compiles three workspaces in dependency order:

1. `packages/embroidery-engine` — the stitch engine (must build first; the
   server and client both import its `dist/` output)
2. `server` — the Express API
3. `client` — the editor, built into static files the server then serves

If you skip the engine build, the other two fail with a confusing
"module not found". Always build all three together with `npm run build`.

---

## 3. Start the app

### Normal use

Double-click **`start.bat`**, or run it from a terminal:

```
start.bat
```

It will, in order:

1. Check Node, npm, and that port 4000 is free.
2. Start the MongoDB service if it is not already running.
3. Install dependencies and build — **only on the first run**.
4. Seed the built-in hoops, thread palette, and digitizing presets
   (idempotent, safe to re-run).
5. Start the server, which serves both the API and the editor.
6. Open your browser at **http://127.0.0.1:4000**.

Stop it with **`shutdown.bat`**, or press `Ctrl+C` in the server window.

### Development use (you are changing code)

Double-click **`dev.bat`**:

```
dev.bat
```

This runs three watchers in one window — engine, server (auto-restart), and
client (hot reload). The editor is served by Vite at
**http://127.0.0.1:5173** and proxies `/api` to the Express process on port 4000. Use this when editing; use `start.bat` for daily operation.

---

## 4. Verify the install

Once the server is up, run the smoke test in a second terminal:

```
npm run smoke
```

It makes 110 checks against the live server: health, the editor being served
with no external CDN references, seeded data, project create/update/delete
including the optimistic-concurrency 409 path, version history (snapshot of the
outgoing design, list without designs, manual checkpoint, restore) and recent
files, real DST / PES / EXP / JEF / VP3 / TBF / HUS encode → decode round trips against
pyembroidery, image tracing, a stitched GIF, machine-file import, 3D foam, a
carving stamp, and multi-hoop splitting including the shared overlap band and
the registration crosses. The last line must read `All smoke checks passed.`

---

## 5. Day-to-day commands

| Command             | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `start.bat`         | Build (first run only), seed, start, open browser. Production use.   |
| `dev.bat`           | Engine + server + client watchers with hot reload. Development.      |
| `shutdown.bat`      | Stop the running server.                                             |
| `backup.bat`        | Write a timestamped JSONL backup of every design to `data/backups/`. |
| `restore.bat`       | Restore from a chosen backup folder (overwrites current data).       |
| `npm run smoke`     | 90 live checks against a running server.                             |
| `npm run seed`      | Re-seed hoops, palettes, and presets. Idempotent.                    |
| `npm test`          | Run all unit tests (engine, server, client).                         |
| `npm run typecheck` | Strict TypeScript check across every workspace.                      |
| `npm run lint`      | ESLint across the whole workspace.                                   |
| `npm run format`    | Prettier write.                                                      |
| `npm run build`     | Rebuild engine, server, and client.                                  |

### Backup and restore

```
backup.bat
restore.bat
```

Backups are plain JSONL with a manifest — one JSON document per line, plus a
`manifest.json` describing the dump. They are readable and diffable without
this application, and they do **not** require `mongodump` to be installed.
`BACKUP_KEEP` in `.env` controls how many timestamped folders are kept
before older ones are pruned.

Restoring overwrites whatever is currently in the database. The restore
script reports what it wrote and what it skipped.

---

## 6. Configuration

Settings live in `.env` at the project root. A `.env.example` documents every
key; `start.bat` copies it to `.env` on first run if you do not have one.

| Key                | Default                                       | Meaning                                                |
| ------------------ | --------------------------------------------- | ------------------------------------------------------ |
| `MONGODB_URI`      | `mongodb://127.0.0.1:27017/embroidery_studio` | Local database only. Do not point at a remote cluster. |
| `SERVER_HOST`      | `127.0.0.1`                                   | Binds to localhost only.                               |
| `SERVER_PORT`      | `4000`                                        | API and editor.                                        |
| `VITE_CLIENT_PORT` | `5173`                                        | Dev server only.                                       |
| `DATA_DIR`         | `./data`                                      | Root for projects, exports, backups, uploads.          |
| `MAX_UPLOAD_MB`    | `25`                                          | Largest accepted upload.                               |
| `BACKUP_KEEP`      | `20`                                          | Backups kept before pruning; `0` keeps all.            |
| `NODE_ENV`         | `development`                                 | Set to `production` to quiet request logging.          |

Runtime preferences that do not require a restart — default hoop, autosave
interval, grid size, snap, underlay preview, stitch player speed — are in
**Preferences** in the editor and are stored in MongoDB, so they follow the
machine rather than the browser.

---

## 7. Where things are stored

| Path                        | Contents                                      |
| --------------------------- | --------------------------------------------- |
| `data/projects/`            | Saved project files.                          |
| `data/exports/`             | Exported DST files.                           |
| `data/backups/`             | Timestamped JSONL backups.                    |
| `data/uploads/`             | Uploaded source images.                       |
| MongoDB `embroidery_studio` | Projects, hoops, palettes, presets, settings. |

Everything is local. Nothing leaves the machine.

---

## 8. Troubleshooting

**`Port 4000 is already in use`**
Another instance is running. Open http://127.0.0.1:4000 to check, or run
`shutdown.bat`.

**`Could not start MongoDB`**
Start it by hand from Services (`services.msc`) — look for **MongoDB** — or
run `net start MongoDB`, then start the app again. The editor will not work
without it; it reports "database disconnected" rather than pretending to save.

**Editor loads but shows "Reference data could not be loaded"**
Seeding did not run. Run `npm run seed`, then reload. The editor still works
with a locally constructed hoop, but the preset lists will be empty.

**Build fails with "module not found" for `@threadworks/engine`**
The engine was not built. Run `npm run build` (not just the client build).

**Changes to engine code are not appearing**
The server and client consume the engine's compiled `dist/`, not its source.
Rebuild after editing the engine:

```
npm run build -w @threadworks/engine
```

Then restart the server (and the client dev server, if running).

**The editor is a blank page**
Hard-refresh (`Ctrl+Shift+R`). If it persists, check the browser console and
the server terminal for the underlying error.

---

## 9. What is implemented, and what is not

This build is honest about its scope. Implemented and tested:

- Manual digitizing: satin column (Input A — two rails), complex fill, run, bean
- Tatami, motif, contour, and spiral fills
- **Fill patterns on a tatami fill** — plain weave, programmed split (12 mm
  blocks with 1.5 mm gaps, alternate rows staggered), motif stamps, contour and
  spiral, chosen in the right panel. Left on plain weave the output is
  byte-identical to before the option existed. 12 engine tests.
- **Minimum stitch length** — a real, shape-preserving merge: a stitch is
  dropped only if its endpoint lands closer to the last _emitted_ point, jumps
  and trims are hard barriers, and a run's final point is always kept. 12 engine
  tests.
- **Entry / exit placement** — arm the entry or the exit, click the shape to
  place it; a guessed exit is derived from the entry rather than picked
  independently. 9 engine tests.
- **Grouping and transforms** — `Ctrl+G` / `Ctrl+Shift+G` plus panel buttons;
  clicking a member selects the group. Flip, rotate ±90° and scale ±10% are
  baked into the path coordinates (never a live flag), so what is on the canvas
  is what the machine sews.
- Underlay (center run, edge run, zigzag, tatami), tie-ins and tie-offs
- Pull compensation, automatic stitch splitting for the DST length limit
- Stitch player with speed control and needle-head marker
- Hoop selection and out-of-hoop validation
- Optimistic-concurrency save (stale saves are rejected, not silently applied)
- **Version history** — every save whose design actually changed snapshots the
  outgoing state first, manual checkpoints on demand, and restore (which
  checkpoints what it replaced first, so it is itself undoable). The list
  returns metadata only and fetches designs one at a time; 30 per project.
- **Recent files** — upserted on open, 20 kept, forget one or clear all; a stale
  pointer is dropped with a message rather than failing to open.
- **Preferences** — default hoop, autosave interval, undo depth (5–500, default
  60), grid size, player speed, grid/rulers/snap, underlay in preview. Lowering
  the undo depth also trims the stack already in memory, and only after the
  save succeeds.
- **Lettering** — engine-level: a single-stroke font (26 letters, 10 digits,
  17 punctuation marks) with layout, slant, rotation, spacing, and satin
  generation. 20 tests.
- **Node editing** — move the points of an existing outline, with gesture undo
- **Auto-hooping** — picks the smallest hoop the design fits and can turn it a
  quarter turn to find a better one; the rotation is a real, undoable edit
- **Colour blending** — merge two or more selected fills into one stitched
  layer (shared spacing, spread stitch angles) in a single undo step
- **Machine formats: Tajima DST, Brother PES, Melco EXP and Janome JEF.** Each
  has a real encoder and decoder, verified by a decode round trip, and the
  output was compared whole-file against pyembroidery (the reference reader and
  writer behind Ink/Stitch): **all four are byte-identical** — header, palette,
  stitch stream and, for PES, the thumbnails as well. PES took the most work,
  because its writer never writes the rows it is handed: they are normalised the
  way the reference normalises them first (block-opening jumps, cuts and colour
  changes that stay at the needle, travel beyond 204.7 mm chained into hops), and
  its Brother palette is built as a de-duplicated lookup rather than a plain
  nearest-colour list, so two threads that would both claim Black keep a slot
  each. 25 engine tests cover JEF alone, including pins taken from the reference
  encoder's own output.
- **Auto-digitizing from an image.** Pick a photo or logo, choose how many
  thread colours and how large, and the tracer reduces the colours, walks each
  colour's outline (holes included), drops noise, and builds fills whose stitch
  direction follows each shape's long axis. 29 engine tests, plus an end-to-end
  smoke check that traces an image and exports the result.
- **Stitch video.** "Stitch video" renders the design sewing as an animated
  GIF: stitches appear in order in their real thread colours, with a needle
  marker and a live stitch counter. The GIF encoder is ours (LZW and all) and
  verified against Pillow, an independent decoder.
- **Importing a machine file.** The "Import" button opens a DST, PES, PEC, EXP
  or JEF that a client sent: it reads the stitches, previews them with the
  movie's own renderer, recovers thread colours when the format carries them
  (Brother chart for PES/PEC, Janome's library for JEF), and then lets you save
  it as another machine format or film it as a stitch video.
  A machine file is a flattened stitch list, so it comes back as stitches rather
  than as editable shapes — `docs/known-limitations.md` §3 explains why and
  what to do instead (re-trace the artwork with "Trace image").
- **3D foam (puff).** Turn it on for a satin column or a lettering object and
  the column is sewn the way a foam sheet actually needs: the normal underlay
  is dropped and replaced by a single light tack so the sheet cannot skate,
  the row spacing is capped so no foam shows between rows, and the column
  pulls wider by a share of the foam's thickness so the thread still meets
  fabric past the raised edge. Thickness and the tack are per-object controls.
  22 engine tests, plus a smoke check that compiles a foam column and confirms
  it is denser and wider than the same column flat.
- **Carving stamp.** Turn it on for a tatami fill and a repeating stamp
  (diamond, circle, star, cross, hexagon) is pressed into the fill by removing
  the stitches inside it — the shape stays a solid fill with a debossed
  texture punched through it, not a scatter of motifs. The stamp grid follows
  the fill angle, every hole is crossed by a jump instead of a sewn line (so
  the machine does not fill the texture back in), and each stamp can carry a
  run outline so the edge reads crisply. Spacing, size, rotation and the
  outline are per-object controls; the size is the stamp's real size in mm.
  18 engine tests, plus a smoke check that compiles a carved fill and confirms
  it removes stitches while still validating clean and exporting as DST.
- **Multi-hoop splitting.** A design too big for any single hoop is split into
  one section per re-hooping, and "Export sections" writes a separate
  DST/PES/EXP/JEF file per section. The split walks the stitches in sewing
  order, cuts on a
  travel point whenever one is available (so no stitches are lost), picks one
  hoop for the whole design, and centres each section in that hoop's safe field.
  A design that already fits comes back as a single, untouched file identical to
  a normal export. When one object alone is bigger than the frame the cut is
  forced mid-object and reported, so you know to align that section by its start
  point. 27 engine tests, plus smoke checks that confirm the sections tile the
  design exactly, each fits its hoop, and each encodes as a real DST.
- **Multi-hoop joins.** Two options on the Multi-hoop panel, both session-only
  (they describe how the design is _cut into files_, so they are not part of the
  saved document): **Overlap** spreads every cut across a band — measured along
  the axis that overflowed, taken from the end of the earlier section, clamped
  so the walk still moves forward and to at most half the hoop — so consecutive
  sections sew the same strip twice and the join has no visible line.
  **Registration crosses** sew a cross at each boundary: the ending section
  sews it last, the beginning one first, at the same design coordinate in both.
  Room for the marks is reserved from the growth budget only when a split was
  needed, so a design that fits one hoop is left byte-identical. 11 engine tests
  plus 6 smoke checks.
- Backup and restore without `mongodump`

**Not yet implemented** — there is no button or menu that pretends otherwise:

- A motif / stamp library editor (importing your own stamp shapes). The five
  built-in carve stamps and the built-in motif fill work; there is no editor to
  draw a new one yet.
- Freehand nudge of a section: overlap and registration crosses cover the join,
  but there is no tool that selects one section and shifts it by a fraction of
  a millimetre.
- JEF and other formats that have not been verified against a reference

See `docs/known-limitations.md` for the full, itemized list and why each gap
exists.
