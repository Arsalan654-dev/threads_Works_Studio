# ThreadWorks Studio

A local-first embroidery digitizing workstation. Draw shapes, choose stitch
types and parameters, watch the design sew out, and export a genuine machine
file - Tajima `.dst`, Brother `.pes`, Melco `.exp`, Janome `.jef`, Husqvarna
`.vp3`, `.hus` or `.tbf` - for your machine.

MERN stack â€” **M**ongoDB (local or Atlas), **E**xpress, **R**eact + TypeScript,
**N**ode â€” built as an npm workspace with a shared embroidery engine package.

Local is the default: the server binds to `127.0.0.1`, needs no account, and
works without a CDN. The same build can be hosted on Vercel with MongoDB Atlas;
see [docs/deployment.md](docs/deployment.md).

---

## Quick start

Requirements: **Node.js 20+** and a **local MongoDB** service on
`127.0.0.1:27017`.

|                          |                                                                |
| ------------------------ | -------------------------------------------------------------- |
| **Normal use**           | Double-click `start.bat` â†’ opens <http://127.0.0.1:4000>       |
| **Stop it**              | Double-click `shutdown.bat`                                    |
| **Changing code**        | Double-click `dev.bat` (hot reload at <http://127.0.0.1:5173>) |
| **Back up your designs** | `backup.bat`                                                   |
| **Restore a backup**     | `restore.bat data\backups\<folder>`                            |

`start.bat` installs dependencies and builds on the first run only, so later
starts are fast.

### Command line

```bash
npm install          # once
npm run seed         # built-in hoops, palettes and presets (idempotent)
npm run build        # engine + server + client
npm start            # production server on http://127.0.0.1:4000

npm run dev          # all three watchers for development
npm test             # 1,202 tests across engine, server and client
npm run typecheck    # strict TS across every workspace
npm run smoke        # 119 end-to-end checks against a running server
npm run lint
```

---

## What it does

- **Manual digitizing** â€” Input A (satin column), Complex Fill, Run, Bean,
  Rectangle, Circle, plus click-to-place polyline tools.
- **Stitch types** - satin, tatami, run, bean, motif, contour, spiral; and on a
  tatami fill a **fill pattern**: plain weave, programmed split, motif stamps,
  contour or spiral. **Sequins, beading, chenille and schiffli** are available as
  disclosed simulations built from standard needle penetrations.
- **Stitch parameters** â€” density/spacing, angle, minimum and maximum stitch
  length, pull compensation, underlay type and settings, tie-in / tie-off, and a
  hand-placed **entry / exit**.
- **3D foam (puff)** and **carving stamp** â€” the two techniques a shop actually
  gets asked for, both per-object.
- **Lettering** with six original single-stroke font cuts - Studio Sans, Rounded,
  Block, Script, Serif and Mono - plus text, size, spacing, slant and rotation.
- **Original clipart browser** - 17 built-in shapes in categories with search;
  every shape inserts as editable geometry, not a flat image.
- **Artwork and print output** - real SVG, PDF and PNG proofs from the compiled
  stitches, plus a tiled 1:1 printable placement sheet with crop marks and a
  thread legend.
- **Transforms and grouping** â€” flip, rotate, scale, group / ungroup, node
  editing.
- **Auto-digitizing from a photo** â€” colour reduction, outline tracing with
  holes, per-shape fill angle; also plain **image tracing**.
- **Thread palette** â€” create, edit, recolour and reorder colours; pick from the
  seeded "Basic 18" palette; blend two or more fills.
- **Hoops** â€” 8 built-in hoops including a round frame and a cap frame, an
  auto-hoop that picks the smallest fit, **multi-hoop splitting** with a shared
  overlap band and registration crosses, and out-of-hoop validation.
- **Cap-frame digitizing** - a curved crown preview plus inverse-sine driver
  compensation, so a wide design sews at the drawn width around the cap.
- **Specialty effects** - sequins, beading, chenille pile and schiffli lace are
  generated as standard needle penetrations, with the format limitation stated
  in validation rather than hidden.
- **Production machines** - assign objects to machine numbers, spread a
  selection across machines, and export one independently valid file per
  machine.
- **Lit / 3D preview** - an optional shadow and highlight pass over the threads;
  it changes the screen only, never the exported file.
- **Stitch player** â€” play the design sew out stitch by stitch, scrub the
  sequence, change speed. It replays the _real_ compiled sequence.
- **Undo / redo** with a configurable depth, multi-select, duplicate,
  snap-to-grid.
- **Save and reopen** â€” projects live in MongoDB with optimistic concurrency,
  so a stale tab cannot silently overwrite newer work â€” plus **version
  history** (checkpoints, restore) and a **recent files** list.
- **Export** â€” Tajima `.dst`, Brother `.pes`, Melco `.exp`, Janome `.jef`,
  Husqvarna `.vp3`, `.tbf` and `.hus`, each encoded by a real encoder from the
  same sequence you previewed. **Import** reads those formats back for preview,
  conversion or filming.
- **Stitch video** â€” the design sewing out as an animated GIF, with real thread
  colours, a needle marker and a live counter.
- **Validation** â€” stitch length, hoop overrun, colour index, and more, shown in
  the status bar as you work.

---

## Documentation

| Document                                               | What is in it                                            |
| ------------------------------------------------------ | -------------------------------------------------------- |
| [docs/user-manual.md](docs/user-manual.md)             | Using the editor, tool by tool                           |
| [docs/architecture.md](docs/architecture.md)           | How the packages fit together                            |
| [docs/feature-matrix.md](docs/feature-matrix.md)       | Honest feature-by-feature status                         |
| [docs/format-support.md](docs/format-support.md)       | Exactly what file formats are supported, and what is not |
| [docs/known-limitations.md](docs/known-limitations.md) | The limits worth knowing before you rely on it           |

Please read **known-limitations** before sending anything to a machine. It is
short and it is honest.

---

## Repository layout

```
threadworks-studio/
â”œâ”€ packages/embroidery-engine/   pure stitch generation + DST codec (no Node APIs)
â”œâ”€ server/                       Express API, MongoDB, seed/backup/restore
â”œâ”€ client/                       React + Vite editor
â”œâ”€ scripts/                      smoke test
â”œâ”€ docs/
â”œâ”€ start.bat / dev.bat / shutdown.bat / backup.bat / restore.bat
â””â”€ .env                          created from .env.example on first run
```

The engine is deliberately platform-neutral: it never touches `Buffer` or the
DOM, so the identical stitch generation runs in the browser for preview and in
Node for the API and CLI.

---

## Testing

```bash
npm test
```

Current state: **1,202 tests passing** â€” 723 engine, 76 server, 403 client â€” plus a
119-check live smoke test (`npm run smoke`, needs the server running).

The tests cover what actually matters: DST / PES / EXP / JEF / VP3 / TBF
encode-decode round trips, with the first six additionally compared **byte for
byte** against pyembroidery's own writers (HUS is verified through
pyembroidery's reader, which is all it ships), every stitch generator and fill
pattern, the foam
and carve techniques, multi-hoop splitting with overlap and registration marks,
sequence building and validation, HTTP validation, optimistic-concurrency
conflicts, version history and recent files, and the editor's store, geometry,
lettering, transform and playback logic, the six derived font families, the
clipart catalogue, SVG/PDF/PNG artwork and 1:1 print tiling, cap preview and
driver compensation, multi-machine splitting, and the four specialty stitch
simulations.

---

## Licence and provenance

ThreadWorks Studio is an original application. It contains no proprietary
source code and nothing extracted from any commercial embroidery product. The
Tajima DST, Melco EXP and Janome JEF layouts are published de-facto formats.

One dataset is reused with permission and attribution: the Janome thread table
that JEF files index into, taken from
[pyembroidery](https://github.com/EmbroidePy/pyembroidery) (MIT License,
Copyright (c) 2018) and kept as **data** in
`packages/embroidery-engine/src/formats/jefColors.ts`, where its source is
credited in place. No code was copied from it â€” pyembroidery was used as a
_read-only reference_ for checking our encoders byte for byte, which is what
`docs/format-support.md` records.

Wilcom EmbroideryStudio is referenced only in the feature-comparison documents,
to describe what this application does and does not yet do.
