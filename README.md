# Drum map explorer

An interactive view of one full-drum vibration campaign: **424 strikes** over
**101 cells** of a 50 mm 3D-printed TPU membrane, struck from below by a
solenoid on a two-axis stage and watched by an **ST188 reflective optical
sensor** (an infrared LED + phototransistor pair sold for line-following
robots, costing about a dollar).

It is the companion to the poster *Exploring the Vibrations of a Circular
Membrane with a Low-Cost Optical Sensor* (Otoniel Matute Cruz, Oleksiy
Svitelskiy PI, Department of Physics, Gordon College). Scan the QR on the
poster and you land here.

**Live site:** https://otogr28.github.io/drum-map-explorer/

## What you can do

- **Map** — the poster's three per-cell heatmaps (amplitude, decay T60,
  dominant mode), redrawn live from the data, plus SNR and decay fit quality.
- **Modes** — the median ring-down spectrum with the four peaks the campaign's
  own picker keeps, and a per-cell map of where any frequency band lives on
  the head.
- **Strikes** — every hit as a sortable row; click one to see its own spectrum
  against the median.

Filters (mounting, sensor station, operator verdict, clipping, r/a range)
apply to all three views at once, and the filter state lives in the URL, so
any slice of this dataset is a link you can send to somebody.

`points.csv` is a verbatim copy of the campaign's own aggregate file, and the
download button hands it to you unchanged.

## How to read this honestly

- Strikes the operator **rejected** at the bench, and any jams, are kept in the
  dataset and marked. The site shows the verdicts; it does not hide data. The
  default filter happens to select the same strikes the poster figure uses.
- A **clipped** strike railed the amplifier, so its peak and pp are censored
  **lower bounds**, not measurements.
- The line near **31 Hz is electrical pickup**, never a drum mode. It is
  labelled as such everywhere, and its map is visibly flat, because it does
  not care where the head is struck.
- **467 and 508 Hz are under study.** The Bessel ladder anchored on the
  measured 290 Hz fundamental predicts the (1,1) mode at 462 Hz, and a split
  pair is what an unevenly tensioned head looks like, but neither peak is a
  confirmed mode identification.
- **101 cells, not 124.** The four mountings deliberately share the x = 0 and
  y = 0 strips (they are the cross-mounting anchors), so the 124
  (mounting, cell) pairs the campaign visited land on 101 distinct places on
  the membrane.
- The mode maps here are the **simple** per-cell band amplitude (mean |F| over
  a ±12 Hz band). The poster figure uses a masked rank-1 factorisation, which
  additionally glues the three sensor stations onto one scale. The two agree
  in shape, not in absolute scale.

## What is in this repo

```
index.html                     the whole application; no build step
data/campaign.json             anchor, axis, stations, mountings, mode list
data/strikes.json              one record per strike
data/spectra.json              each strike's ring-down tail spectrum, 21-898 Hz
data/points.csv                the campaign's aggregate file, verbatim
vendor/plotly-cartesian.min.js local fallback if the Plotly CDN is unreachable
```

Everything is static. There is no backend, no tracking, and no build tooling:
open `index.html` over any HTTP server and it runs.

```bash
python3 -m http.server 8000   # then visit http://127.0.0.1:8000
```

The data files are generated from the raw campaign by
`poster/export_explorer_data.py` in the (private) lab vault. Only exported
data lives here.

## Credits

Plotly.js is bundled under the MIT licence (Copyright 2012-2024 Plotly, Inc.).
