# Vibrations of a circular membrane

The web companion to the poster *Exploring the Vibrations of a Circular
Membrane with a Low-Cost Optical Sensor* (Otoniel Matute Cruz, Oleksiy
Svitelskiy PI, Department of Physics, Gordon College).

One static page in four parts. Scan the QR on the poster and you land here.

**Live site:** https://otogr28.github.io/drum-map-explorer/

## The four parts

### Poster

The printed poster, read by scrolling. Each chapter pins a figure while the
text moves past it, and the figure answers: the mode shapes animate, the map
fills in one mounting at a time, the band maps step through 289, 467, 508 and
31 Hz.

Every figure is drawn live from the exported data. No screenshot of the printed
poster is served here, so the two cannot quietly disagree.

The one exception is the membrane animation, which is the analytic
J_m(alpha_mn r/a) cos(m theta) and not a measurement. The caption says so.

### Method

How a peak earns the right to be called a mode. Six rules, each drawn on the
campaign's own data:

1. **Two branches.** Despike, then a zero-phase 5 Hz high pass, is the
   measurement branch. The spectral gate on top of it is display only and no
   number is ever taken from it. The page re-runs both on real traces in your
   browser.
2. **The floor and the bar.** A peak has to stand 10 dB above the running
   median of the spectrum around it. The threshold is a slider: turn it up and
   watch which peaks survive.
3. **One ridge is one mode.** 8 Hz of separation and a 3 dB valley between two
   peaks, or they are the same ridge read twice.
4. **A mode cares where you hit it.** Spatial contrast of the band map, with
   the bar at 1.8 and raised to 2.5 for a peak pinned across mountings. The
   band centre is a slider.
5. **The placebo strike.** Strike the mode's own node, where it cannot be
   excited, and require 6 dB between the real strikes and that null.
6. **Where two methods disagree, say so.** FFT against ESPRIT, backward
   integration against the log envelope, clipping, and whether the four
   mountings agree well enough to be glued into one map.

Every threshold quoted is exported from the campaign, so the page cannot
describe rules the measurement was not using.

### Data

The original explorer. Filters (mounting, sensor station, operator verdict,
clipping, r/a range) apply to all three views at once, and the filter state
lives in the URL, so any slice of this dataset is a link you can send.

- **Map**: the poster's three per-cell heatmaps (amplitude, decay T60,
  dominant mode), plus SNR and decay fit quality.
- **Modes**: the median ring-down spectrum with the peaks the campaign's own
  picker keeps, and a per-cell map of where any frequency band lives.
- **Strikes**: every hit as a sortable row. Click one and you get that
  strike's full measurement view: the waveform with the raw trace, the mains
  trend, the cleaned display branch, the envelope and the onset, settled and
  clipping markers; the Schroeder decay with its fit and the log envelope
  cross-check; the Welch ring-down spectrum with the picked modes; the
  spectrogram; and where on the head it was struck, with the sensor.

  Those panels are **not redrawn from scratch in the browser**. Every series in
  them was computed by drumlab at export time, by the same calls the bench
  figure draws from, and shipped as one small file per strike. The page decodes
  and plots. A second implementation would drift from the bench figure and
  nobody would notice which one was wrong.

`points.csv` is a verbatim copy of the campaign's own aggregate file, and the
download button hands it to you unchanged.

### References

The printed poster's source list. It moved here on 2026-07-28 so the poster
could give that space to Method, and the QR box on the sheet now reads
"Explore the Data Yourself & references". Static markup, no data behind it:
the vibrometry papers, the membrane papers, Schroeder, and the two datasheets,
each with a line on what it gave this campaign.

## How to read this honestly

- Strikes the operator **rejected** at the bench, and any jams, are kept in the
  dataset and marked. The site shows the verdicts; it does not hide data. The
  default filter happens to select the same strikes the poster figure uses.
- A **clipped** strike railed the amplifier, so its peak and pp are censored
  **lower bounds**, not measurements.
- The line near **31 Hz is electrical pickup**, never a drum mode. Its map is
  not flat, and the Method part says so rather than pretending otherwise. What
  keeps it out of the mode list is the 100 Hz floor and the operator's call at
  the bench, not its spatial contrast.
- **467 and 508 Hz are under study.** The Bessel ladder anchored on the
  measured 290 Hz fundamental predicts the (1,1) mode at 462 Hz, and a split
  pair is what an unevenly tensioned head looks like, but neither peak is a
  confirmed mode identification. The placebo check marked the candidate
  SUSPECT twice.
- The **placebo runs shown in the Method part were a test of the check**, not a
  final measurement. Same head and same day as the map campaign. The campaign
  that would settle 467 and 508 Hz has not been run.
- **101 cells, not 124.** The four mountings deliberately share the x = 0 and
  y = 0 strips (they are the cross-mounting anchors), so the 124
  (mounting, cell) pairs the campaign visited land on 101 distinct places on
  the membrane.
- The mode maps here are the **simple** per-cell band amplitude (mean |F| over
  a 12 Hz half band). The poster figure uses a masked rank-1 factorisation,
  which additionally glues the three sensor stations onto one scale. The two
  agree in shape, not in absolute scale.
- The **conclusion is a draft.** The printed poster's conclusion and future
  work boxes are deliberately empty and belong to the operator. What the site
  shows is marked as his own note, not as a finished claim.

## What is in this repo

```
index.html                     the shell: nav, four parts, all the copy
css/site.css                   theme, scrollytelling layout, print styles
js/core.js                     data load, theme, router, dsp, Plotly helpers
js/scrolly.js                  which step is current, and telling the figure
js/poster.js                   the Poster part
js/method.js                   the Method part
js/data.js                     the Data part
js/strikeview.js               the five panels behind a strike
assets/                        four images JavaScript cannot draw
data/campaign.json             anchor, axis, stations, mountings, mode list
data/strikes.json              one record per strike
data/spectra.json              each strike's ring-down tail spectrum, 21-898 Hz
data/method.json               four raw example traces, every threshold, and
                               the placebo verdicts
data/strikes/<i>.json          one per strike, about 31 kB: every series the
                               bench figure plots. Fetched on click, so a
                               reader who never opens a strike never loads one
data/points.csv                the campaign's aggregate file, verbatim
vendor/plotly-cartesian.min.js local fallback if the Plotly CDN is unreachable
```

Everything is static. There is no backend, no tracking, and no build tooling.
The scripts are plain `<script>` tags in dependency order, which is also what
keeps the `document.write` fallback for Plotly working when a conference
network blocks the CDN.

```bash
python3 -m http.server 8000   # then visit http://127.0.0.1:8000
```

The data files are generated from the raw campaign by
`poster/export_explorer_data.py` in the (private) lab vault. Only exported data
lives here.

## Accessibility and motion

The scroll is never captured: swiping keeps moving the page. Under
`prefers-reduced-motion` the step cards stop fading and lifting and every one
is legible at once, while the pinned figure still follows the reader, because
that is information rather than decoration. Light and dark are both hand
tuned, and the theme button overrides the system setting.

## Credits

Plotly.js is bundled under the MIT licence (Copyright 2012-2024 Plotly, Inc.).
