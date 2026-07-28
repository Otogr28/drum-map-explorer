"use strict";
/* ===========================================================================
   Shared machinery: the data files, the theme, the part router and every
   Plotly helper the three parts draw with. Loaded first; poster.js, method.js
   and data.js all lean on what is defined here.
   =========================================================================== */

const DATA = {};
const $ = (id) => document.getElementById(id);
const PARTS = ["poster", "method", "data"];

/* Sequential single-hue ramps, the same ones the bench figures use. On a dark
   surface the ramp is reversed so "near zero" recedes toward the surface
   instead of glowing. Never a rainbow. */
const RAMPS = {
  blue:  ["#cde2fb","#9ec5f4","#6da7ec","#3987e5","#256abf","#184f95","#0d366b"],
  orange:["#fde3d7","#f9c4aa","#f3a077","#eb6834","#c94e1d","#9c3a12","#6f2809"],
  aqua:  ["#d2f2e4","#a5e4c9","#6fd0a8","#1baf7a","#0f8a5e","#0a6a48","#064f35"],
};
const isDark = () => getComputedStyle(document.documentElement)
  .getPropertyValue("color-scheme").trim().includes("dark");
const cssv = (n) => getComputedStyle(document.documentElement)
  .getPropertyValue(n).trim();
function scale(hue){
  const r = isDark() ? RAMPS[hue].slice().reverse() : RAMPS[hue];
  return r.map((c,i)=>[i/(r.length-1), c]);
}
const MONO = 'ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace';
const SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const SERIF = 'Georgia,"Iowan Old Style","Times New Roman",Times,serif';

function baseLayout(extra, box){
  const L = {
    paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)",
    font:{family:MONO, size:11, color:cssv("--ink2")},
    margin:{l:44,r:8,t:34,b:38},
    hoverlabel:{font:{family:MONO,size:12}, bgcolor:cssv("--panel"),
                bordercolor:cssv("--line"), namelength:-1},
    showlegend:false,
  };
  return Object.assign(L, extra||{}, box||{});
}
const CFG = {responsive:true, displaylogo:false,
  modeBarButtonsToRemove:["select2d","lasso2d","autoScale2d","toggleSpikelines"]};
/* Narrative figures keep hover and lose the toolbar: on the Poster and Method
   parts the reader is being told something, and a row of camera and zoom icons
   over the title is noise. The Data part keeps its toolbar. */
const CFG_BARE = Object.assign({}, CFG, {displayModeBar:false});

/* Plotly takes its height from the container at draw time. Inside a sticky
   stage the siblings above and below the plot (a pipeline strip, a slider, a
   caption that grows from one line to two) change height as the reader moves
   through the steps, and a plot drawn before that settles overflows its box
   and lands on top of them.
   Autosize does not save it: Plotly measures once, at draw time. So the size
   is stated OUTRIGHT in the layout, read from the container's own box, and a
   ResizeObserver restates it whenever that box changes. Nothing is left for
   Plotly to guess. */
function boxOf(el){
  return {width: el.clientWidth || undefined,
          height: el.clientHeight || undefined};
}
const _observed = new WeakSet();
function settle(divId){
  const el = typeof divId === "string" ? $(divId) : divId;
  if (!el) return;
  const fit = () => {
    const b = boxOf(el);
    if (!b.width || !b.height) return;
    try { Plotly.relayout(el, b); } catch (e) {}
  };
  requestAnimationFrame(fit);
  if (_observed.has(el) || typeof ResizeObserver === "undefined") return;
  _observed.add(el);
  let queued = false;
  new ResizeObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fit(); });
  }).observe(el);
}

const fmt = (v) => Math.abs(v) >= 100 ? v.toFixed(0)
                 : Math.abs(v) >= 10  ? v.toFixed(1) : v.toFixed(3);
const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x,y)=>x-y), m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5*(s[m-1]+s[m]);
};
const pct = (a, p) => {
  if (!a.length) return null;
  const s = a.slice().sort((x,y)=>x-y);
  const i = Math.min(s.length-1, Math.max(0, (s.length-1) * p/100));
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi]-s[lo])*(i-lo);
};

/* ============================================================== aggregation
   Shared by the Poster maps and the Data maps, so both halves of the site
   average the same way and cannot drift apart. */
const cellKey = (r) => `${r.x}|${r.y}`;

function cellsOf(idxs, valueOf){
  const acc = new Map();
  for (const i of idxs){
    const r = DATA.strikes[i], v = valueOf(r, i);
    if (v === null || v === undefined || !isFinite(v)) continue;
    const k = cellKey(r);
    let e = acc.get(k);
    if (!e){ e = {x:r.x, y:r.y, sum:0, n:0, clip:false}; acc.set(k, e); }
    e.sum += v; e.n += 1; e.clip = e.clip || r.clipped;
  }
  for (const e of acc.values()) e.mean = e.sum / e.n;
  return acc;
}

/* The grid is fixed by the campaign (4 mm), not by the current filter, so the
   membrane does not resize as cells drop out of the selection. */
function grid(){
  if (DATA._grid) return DATA._grid;
  const xs = [...new Set(DATA.strikes.map(r=>r.x))].sort((a,b)=>a-b);
  const ys = [...new Set(DATA.strikes.map(r=>r.y))].sort((a,b)=>a-b);
  DATA._grid = {xs, ys,
    ix:new Map(xs.map((v,i)=>[v,i])), iy:new Map(ys.map((v,i)=>[v,i]))};
  return DATA._grid;
}

function zMatrix(acc){
  const g = grid();
  const z = g.ys.map(()=>g.xs.map(()=>null));
  const n = g.ys.map(()=>g.xs.map(()=>0));
  for (const e of acc.values()){
    const r = g.iy.get(e.y), c = g.ix.get(e.x);
    if (r === undefined || c === undefined) continue;
    z[r][c] = e.mean; n[r][c] = e.n;
  }
  return {z, n, xs:g.xs, ys:g.ys};
}

/* ================================================================= spectra
   spectra.json stores each strike normalised to its own peak and quantised;
   `scale` puts the raw |F| back when a band amplitude needs real units. */
const specOf = (i) => DATA.spectra.amp[i];
const fAt = (k) => DATA.spectra.f0 + k * DATA.spectra.df;
function freqAxis(){
  if (DATA._f) return DATA._f;
  DATA._f = Array.from({length:DATA.spectra.n}, (_,k)=>+fAt(k).toFixed(2));
  return DATA._f;
}
function medianSpectrum(idxs){
  const key = idxs.length + ":" + idxs[0] + ":" + idxs[idxs.length-1];
  if (DATA._medKey === key) return DATA._med;
  const n = DATA.spectra.n, rows = idxs.filter(i=>specOf(i));
  if (!rows.length) return null;
  const out = new Float64Array(n), buf = new Float64Array(rows.length);
  for (let k=0;k<n;k++){
    for (let j=0;j<rows.length;j++) buf[j] = specOf(rows[j])[k];
    const s = Array.prototype.slice.call(buf).sort((a,b)=>a-b);
    const m = s.length >> 1;
    out[k] = s.length % 2 ? s[m] : 0.5*(s[m-1]+s[m]);
  }
  const sc = DATA.spectra.amp_scale;
  DATA._medKey = key;
  DATA._med = Array.from(out, v => v/sc);
  return DATA._med;
}
/* Per-cell band amplitude: mean raw |F| over fc +- half, averaged per cell,
   then normalised to the map's own maximum. This is the SIMPLE version of the
   poster's mode map, and the site says so wherever it draws one. */
function bandCells(idxs, fc, half){
  const k0 = Math.max(0, Math.ceil((fc-half-DATA.spectra.f0)/DATA.spectra.df));
  const k1 = Math.min(DATA.spectra.n-1,
                      Math.floor((fc+half-DATA.spectra.f0)/DATA.spectra.df));
  const sc = DATA.spectra.amp_scale;
  return cellsOf(idxs, (r,i)=>{
    const a = specOf(i);
    if (!a || k1 < k0) return null;
    let s = 0;
    for (let k=k0;k<=k1;k++) s += a[k];
    return (s/(k1-k0+1)) / sc * DATA.spectra.scale[i];
  });
}
function normalised(acc){
  let mx = 0;
  for (const e of acc.values()) mx = Math.max(mx, e.mean);
  if (mx > 0) for (const e of acc.values()) e.mean = e.mean / mx;
  return acc;
}
/* p90 / p10 of a band map: the number the campaign's picker uses to decide
   whether a peak cares where the head was struck. */
function contrastOf(acc){
  const v = [...acc.values()].map(e=>e.mean).filter(isFinite);
  if (v.length < 4) return null;
  return pct(v, 90) / Math.max(pct(v, 10), 1e-9);
}

/* ================================================================= drawing */
function drumShapes(){
  const a = DATA.campaign.membrane.a_mm;
  /* --muted is the one ink that reads on both surfaces, so the rim and the
     antinode ring do not vanish when the page flips to dark. */
  const ring = (r, dash, op) => ({type:"circle", xref:"x", yref:"y",
    x0:-r, y0:-r, x1:r, y1:r, opacity:op,
    line:{color:cssv("--muted"), width:dash?1.2:1.8, dash:dash||"solid"},
    layer:"below"});
  return [ring(a, null, 1), ring(0.48*a, "dash", 0.7)];
}

function heatmap(divId, acc, opts){
  const el = typeof divId === "string" ? $(divId) : divId;
  const {z, n, xs, ys} = zMatrix(acc);
  const a = DATA.campaign.membrane.a_mm, lim = a + 2.5;
  const custom = z.map((row,r)=>row.map((_,c)=>n[r][c]));
  const traces = [{
    type:"heatmap", x:xs, y:ys, z, customdata:custom,
    colorscale:scale(opts.hue), xgap:2, ygap:2,   /* 2px surface gap */
    hoverongaps:false, zmin:opts.zmin, zmax:opts.zmax,
    /* compact: the narrative maps are all normalised to their own maximum and
       say so in the caption, so the colour bar is 60 px of width spent on a
       scale nobody reads. Dropping it is worth about 25% more drum. */
    showscale: !opts.compact,
    colorbar:{title:{text:opts.unit, side:"right", font:{size:11}},
      thickness:11, len:0.82, outlinewidth:0, tickfont:{size:10},
      tickcolor:cssv("--baseline"), ticklen:3},
    hovertemplate:`x %{x} mm &nbsp; y %{y} mm<br>`+
      `<b>%{z:.4~s} ${opts.unit}</b><br>%{customdata} strike(s)<extra></extra>`,
  }];
  if (opts.clipped){
    const cx = [], cy = [];
    for (const e of acc.values()) if (e.clip){ cx.push(e.x); cy.push(e.y); }
    if (cx.length) traces.push({type:"scatter", x:cx, y:cy, mode:"markers",
      marker:{size:4, color:cssv("--ink2"), symbol:"circle"},
      hovertemplate:"clipped: amplitude is a lower bound<extra></extra>"});
  }
  Plotly.react(divId, traces, baseLayout({
    title:{text:opts.title, font:{family:SANS, size:14, color:cssv("--ink")},
           x:0, xanchor:"left", y:0.97},
    xaxis:{range:[-lim,lim], zeroline:false, showgrid:false, constrain:"domain",
      tickfont:{size:10}, linecolor:cssv("--baseline"), ticks:"outside",
      ticklen:3, tickcolor:cssv("--baseline"), title:{text:"x (mm)", standoff:6,
      font:{size:10.5}}},
    /* constrain:"domain" shrinks the PLOT AREA to the fixed +-lim range
       instead of widening the range to fill the box, so every panel shows the
       same millimetres however wide its tick labels are. */
    yaxis:{range:[-lim,lim], zeroline:false, showgrid:false, scaleanchor:"x",
      constrain:"domain",
      tickfont:{size:10}, linecolor:cssv("--baseline"), ticks:"outside",
      ticklen:3, tickcolor:cssv("--baseline"), title:{text:"y (mm)", standoff:4,
      font:{size:10.5}}},
    shapes:drumShapes(),
    margin: opts.compact ? {l:38,r:6,t:30,b:40} : {l:46,r:8,t:38,b:46},
  }, boxOf(el)), CFG_BARE);
  settle(el);
}

/* A line plot with the site's axes already set. Every non map figure on the
   Poster and Method parts goes through here. */
function linePlot(divId, traces, o){
  o = o || {};
  const el = typeof divId === "string" ? $(divId) : divId;
  const legend = o.legend !== false && traces.length > 1;
  Plotly.react(divId, traces, baseLayout({
    showlegend: legend,
    legend:{orientation:"h", y:1.14, x:0, font:{size:11},
            bgcolor:"rgba(0,0,0,0)"},
    /* 58 at the bottom, not 44: the axis title needs a line of its own under
       the tick labels or it prints straight through them. */
    margin: o.margin || {l:56, r:12, t:legend?50:28, b:58},
    xaxis:Object.assign({title:{text:o.xtitle||"", font:{size:11}, standoff:6},
      gridcolor:cssv("--grid"), zeroline:false, linecolor:cssv("--baseline"),
      ticks:"outside", ticklen:3, tickcolor:cssv("--baseline")}, o.xaxis||{}),
    yaxis:Object.assign({title:{text:o.ytitle||"", font:{size:11}, standoff:8},
      gridcolor:cssv("--grid"), zeroline:false, linecolor:cssv("--baseline"),
      ticks:"outside", ticklen:3, tickcolor:cssv("--baseline")}, o.yaxis||{}),
    annotations:o.annotations||[], shapes:o.shapes||[],
    hovermode:o.hovermode||"x unified", barmode:o.barmode,
  }, boxOf(el)), o.toolbar ? CFG : CFG_BARE);
  settle(el);
}

/* ====================================================================== dsp
   The Method part re-runs the measurement chain in the browser on the raw
   traces in method.json, so a reader watches the filters act instead of
   reading a claim that they do. These are the same operations drumlab runs,
   at the same settings, written out small enough to read.

   They are NOT a second implementation of the campaign's numbers: every value
   the site quotes comes from the export. This is a demonstration on four
   traces, and the page says so. */

/* Hampel: a sample more than nsig robust sigmas from its neighbourhood median
   is a spike, and it is replaced by that median. drumlab uses window 9 and
   5 sigma, and the metrics record how many samples it caught. */
function hampel(x, win, nsig){
  const n = x.length, half = win >> 1, out = Float64Array.from(x);
  const hit = [];
  const buf = new Float64Array(win);
  for (let i=half;i<n-half;i++){
    for (let k=0;k<win;k++) buf[k] = x[i-half+k];
    const s = Array.prototype.slice.call(buf).sort((a,b)=>a-b);
    const med = s[half];
    for (let k=0;k<win;k++) buf[k] = Math.abs(x[i-half+k] - med);
    const d = Array.prototype.slice.call(buf).sort((a,b)=>a-b);
    const sig = 1.4826 * d[half];
    if (sig > 0 && Math.abs(x[i]-med) > nsig*sig){ out[i] = med; hit.push(i); }
  }
  return {y:out, hit};
}

/* Second order Butterworth high pass, applied forward and then backward. Two
   passes cancel the phase the filter would otherwise add, which is why the
   onset of a strike does not move: exactly what filtfilt does in drumlab. */
function butterHP(fc, fs){
  const w = Math.tan(Math.PI * fc / fs), k = Math.SQRT2 * w, w2 = w*w;
  const a0 = 1 + k + w2;
  return {b:[1/a0, -2/a0, 1/a0],
          a:[1, (2*(w2-1))/a0, (1 - k + w2)/a0]};
}
function biquad(x, f){
  const [b0,b1,b2] = f.b, [,a1,a2] = f.a, n = x.length;
  const y = new Float64Array(n);
  let x1=0,x2=0,y1=0,y2=0;
  for (let i=0;i<n;i++){
    const v = b0*x[i] + b1*x1 + b2*x2 - a1*y1 - a2*y2;
    x2=x1; x1=x[i]; y2=y1; y1=v; y[i]=v;
  }
  return y;
}
function filtfilt(x, f){
  const fwd = biquad(x, f);
  const rev = Float64Array.from(fwd).reverse();
  const back = biquad(rev, f);
  return Float64Array.from(back).reverse();
}
function highpass(x, fc, fs){ return filtfilt(x, butterHP(fc, fs)); }

/* Radix 2 FFT, magnitude only. Enough for a Hann windowed 2048 point block. */
function magSpectrum(x, fs){
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  const m = x.length;
  for (let i=0;i<m;i++){
    const w = 0.5 - 0.5*Math.cos(2*Math.PI*i/(m-1));   /* Hann */
    re[i] = x[i] * w;
  }
  for (let i=1,j=0;i<n;i++){
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j){ let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; }
  }
  for (let len=2; len<=n; len<<=1){
    const ang = -2*Math.PI/len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i=0;i<n;i+=len){
      let cr = 1, ci = 0;
      for (let k=0;k<len/2;k++){
        const ur = re[i+k], ui = im[i+k];
        const vr = re[i+k+len/2]*cr - im[i+k+len/2]*ci;
        const vi = re[i+k+len/2]*ci + im[i+k+len/2]*cr;
        re[i+k] = ur+vr; im[i+k] = ui+vi;
        re[i+k+len/2] = ur-vr; im[i+k+len/2] = ui-vi;
        const nr = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = nr;
      }
    }
  }
  const half = n >> 1, mag = new Float64Array(half), f = new Float64Array(half);
  for (let k=0;k<half;k++){
    mag[k] = Math.hypot(re[k], im[k]) / m;
    f[k] = k * fs / n;
  }
  return {f, mag};
}

/* Order statistic CFAR floor: the running median of the spectrum over a window
   `wbin` bins wide. A candidate has to stand `floor_db` above this to count,
   which is what stops a broad hump from being read as a peak. */
function cfarFloor(mag, wbin){
  const n = mag.length, out = new Float64Array(n), half = wbin >> 1;
  for (let i=0;i<n;i++){
    const a = Math.max(0, i-half), b = Math.min(n, i+half+1);
    const s = Array.prototype.slice.call(mag.slice(a,b)).sort((x,y)=>x-y);
    out[i] = s[s.length >> 1];
  }
  return out;
}

/* find_modes' picking rules, on whatever spectrum it is handed: rank by
   height, demand `floorDb` over the CFAR floor, demand `minSep` Hz of
   separation, and demand a `valleyDb` dip between a candidate and every peak
   already accepted, so the skirt bins of one ridge stay one mode. */
function pickPeaks(f, mag, o){
  const {fmin, fmax, floorDb, valleyDb, minSep, nModes, wbin} = o;
  const floor = cfarFloor(mag, wbin);
  const cand = [];
  for (let i=1;i<mag.length-1;i++){
    if (f[i] < fmin || f[i] > fmax) continue;
    if (!(mag[i] > mag[i-1] && mag[i] >= mag[i+1])) continue;
    const prom = 20*Math.log10(mag[i] / Math.max(floor[i], 1e-12));
    cand.push({i, hz:f[i], mag:mag[i], prom});
  }
  cand.sort((a,b)=>b.mag - a.mag);
  const kept = [], rejected = [];
  for (const c of cand){
    if (kept.length >= nModes) break;
    if (c.prom < floorDb){ rejected.push({...c, why:"floor"}); continue; }
    let bad = null;
    for (const k of kept){
      if (Math.abs(c.hz - k.hz) < minSep){ bad = "sep"; break; }
      const a = Math.min(c.i, k.i), b = Math.max(c.i, k.i);
      let dip = Infinity;
      for (let j=a;j<=b;j++) dip = Math.min(dip, mag[j]);
      if (20*Math.log10(Math.min(c.mag,k.mag) / Math.max(dip,1e-12)) < valleyDb){
        bad = "valley"; break;
      }
    }
    if (bad){ rejected.push({...c, why:bad}); continue; }
    kept.push(c);
  }
  return {kept, rejected, floor};
}

/* ================================================================== router
   The hash carries the part AND the Data part's filter state, so a link into
   a slice of the data still works. A hash written before this rebuild has no
   `part` key but does have the old data keys, so it lands on Data. */
function currentPart(){
  const p = new URLSearchParams(location.hash.slice(1));
  const want = p.get("part");
  if (PARTS.includes(want)) return want;
  return p.has("v") || p.has("m") || p.has("x") ? "data" : "poster";
}

function showPart(part, push){
  if (!PARTS.includes(part)) part = "poster";
  SITE.part = part;
  for (const p of PARTS){
    $("part-"+p).classList.toggle("hidden", p !== part);
    $("nav-"+p).setAttribute("aria-selected", String(p === part));
  }
  $("filters").classList.toggle("hidden", part !== "data");
  if (push){
    const q = new URLSearchParams(location.hash.slice(1));
    q.set("part", part);
    if (part !== "data"){
      ["v","m","s","u","c","ra","k","p","bw","bc","x"].forEach(k=>q.delete(k));
    }
    history.replaceState(null, "", "#"+q.toString());
    window.scrollTo({top:0, behavior:"auto"});
  }
  if (part === "poster") Poster.enter();
  if (part === "method") Method.enter();
  if (part === "data")   Data.enter();
  updateProgress();
}

const SITE = {part:"poster"};

/* The thin bar under the nav. It measures the part the reader is in, so the
   Poster and Method parts show how much of the story is left. */
function updateProgress(){
  const host = $("part-"+SITE.part);
  const bar = $("progressbar");
  if (!host || !bar) return;
  const total = host.scrollHeight - window.innerHeight;
  const done = total > 40 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0;
  bar.style.width = (done * 100).toFixed(1) + "%";
}

/* ================================================================== theme */
function wireTheme(){
  $("themebtn").onclick = () => {
    document.documentElement.setAttribute("data-theme",
      isDark() ? "light" : "dark");
    redrawAll();
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",
    () => { if (!document.documentElement.hasAttribute("data-theme"))
              redrawAll(); });
}
function redrawAll(){
  if (SITE.part === "poster") Poster.redraw();
  if (SITE.part === "method") Method.redraw();
  if (SITE.part === "data") { Data.render(); StrikeView.redraw(); }
}

/* =================================================================== boot */
Promise.all(["campaign","strikes","spectra","method"].map(n =>
    fetch(`data/${n}.json`).then(r=>{
      if (!r.ok) throw new Error(`data/${n}.json: ${r.status}`);
      return r.json();
    })))
  .then(([campaign, strikes, spectra, method]) => {
    DATA.campaign = campaign; DATA.strikes = strikes;
    DATA.spectra = spectra; DATA.method = method;
    /* The default selection everywhere: the strikes the operator kept. The
       poster figures are drawn from exactly this set. */
    DATA.kept = DATA.strikes.map((r,i)=>[r,i])
      .filter(([r])=>r.used && !r.jam).map(([,i])=>i);
    Data.build();
    Poster.build();
    Method.build();
    wireTheme();
    document.querySelectorAll(".part").forEach(b=>{
      b.onclick = () => showPart(b.dataset.part, true);
    });
    window.addEventListener("scroll", updateProgress, {passive:true});
    window.addEventListener("resize", () => {
      clearTimeout(SITE._rt);
      SITE._rt = setTimeout(redrawAll, 180);
    });
    $("boot").classList.add("hidden");
    $("app").classList.remove("hidden");
    showPart(currentPart(), false);
  })
  .catch(err => {
    $("boot").innerHTML = `could not load the data: ${err.message}`;
    console.error(err);
  });
