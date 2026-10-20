# Sample exports

Real files written by ThreadWorks Studio, so they can be opened in digitizing
software, sent to a client, or tried on a machine before drawing anything
yourself.

| File               | What it is                                       |
| ------------------ | ------------------------------------------------ |
| `sample.dst`       | Tajima DST, 33 KB                                |
| `sample.pes`       | Brother PES v1 with an embedded PEC block, 65 KB |
| `sample.exp`       | Melco EXP, 21 KB                                 |
| `sample.jef`       | Janome JEF, 21 KB                                |
| `sample.vp3`       | Husqvarna VP3, 21 KB                             |
| `sample.tbf`       | TBF, 33 KB                                       |
| `sample.hus`       | Husqvarna HUS, 31 KB                             |
| `sample-movie.gif` | the design sewing, as an animated GIF, 580 KB    |

The design is a two-colour composition: a filled rectangle plus a filled
circle, with a colour change and travel between them so the files exercise
trims, jumps and colour changes rather than one continuous run. 10,829 stitches,
about 70 x 70 mm.

## Regenerating

```bat
npx tsx scripts/export-samples.ts
npx tsx scripts/export-movie-sample.ts
```

Both write from the current engine, so the samples can never drift away from
what the app produces.

## What to expect on a machine

- The first move is a jump from the design origin to the first stitch; the
  needle travels without sewing.
- The design is placed with its top-left corner at the machine origin. Centre it
  with the machine's own controls if you want it centred in the hoop.
- DST, EXP, JEF, VP3, TBF and HUS measure y upward, PES measures y downward.
  The encoders handle this, so every file sews the same way up.

## The movie

`sample-movie.gif` is rendered from the compiled stitch sequence: threads appear
in order in their real colours, a marker tracks the needle, and a counter runs
along the bottom. 250 frames at 12 fps.

## Verifying them yourself

`pyembroidery` reads all seven machine formats (HUS ships as read-only there,
which is why HUS was verified through its reader rather than a byte diff):

```bat
python -c "import pyembroidery; print(len(pyembroidery.read('samples/sample.pes').stitches))"
```

`Pillow` reads the movie:

```bat
python -c "from PIL import Image; im = Image.open('samples/sample-movie.gif'); print(im.size, im.n_frames)"
```

All eight were also compared against those libraries directly — see
[../docs/format-support.md](../docs/format-support.md) §0 for the machine files
and [../docs/known-limitations.md](../docs/known-limitations.md) §3 for the movie.
