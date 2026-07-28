"use strict";
/* ===========================================================================
   The Poster part: the printed poster, read by scrolling.

   The copy lives in index.html so it stays editable as text. This file only
   draws, and everything it draws comes from the campaign files, so the web
   poster cannot quietly disagree with the printed one.

   The one exception is the membrane animation. There is no measurement of a
   textbook mode shape here; it is the analytic J_m(alpha_mn r/a) cos(m theta),
   the same thing the four renders on the printed poster show, and the caption
   says so.
   =========================================================================== */

const Poster = (() => {

  /* --------------------------------------------------------- mode shapes */
  /* A real 3D surface, rendered here rather than shipped as an image.
     z(r, theta, t) = J_m(alpha_mn r/a) cos(m theta) sin(wt), the ideal clamped
     circular membrane. THEORY, not a measurement of this head.

     It replaced the Wikimedia Commons GIFs, which replaced an earlier flat
     canvas. The GIFs were public domain and correct, but they are 246 px wide
     with a baked-in white background and a baked-in caption: keying the
     background out left a pale fringe on every edge, the caption inverted
     against the dark theme, and blowing them up to fill the stage made the
     whole thing mushy. A surface drawn at the device's own resolution is crisp
     at any size, follows the theme, costs no bytes, and can be dragged. */

  const ALPHA = {"0,1":2.404826, "1,1":3.831706,
                 "2,1":5.135622, "1,2":7.015587};
  const MODES = [
    {m:0, n:1, label:"(0,1)", text:"the whole head moves as one"},
    {m:1, n:1, label:"(1,1)", text:"one still line across the middle"},
    {m:2, n:1, label:"(2,1)", text:"two still lines, four moving quarters"},
    {m:1, n:2, label:"(1,2)", text:"a still line and a still ring"},
  ];

  /* J_m by its power series. The argument never passes alpha_12 = 7.02, so it
     converges long before the factorials could overflow. */
  function besselJ(m, x){
    let term = Math.pow(x / 2, m);
    for (let k = 1; k <= m; k++) term /= k;
    let sum = term;
    for (let k = 1; k < 40; k++){
      term *= -(x * x / 4) / (k * (k + m));
      sum += term;
      if (Math.abs(term) < 1e-14) break;
    }
    return sum;
  }

  const NR = 16, NTH = 40;             /* rings and spokes: 640 quads a frame */
  const ZS = 0.52;                     /* height of the relief, in disc radii */
  /* Two canvases share one surface and one clock: the hero's small one and
     the chapter's big one. Only the chapter's is draggable.

     `elev` is the angle the camera sits ABOVE the plane of the rim, and it is
     the whole difference between a drawing that reads as a surface and one
     that reads as a flat disc. At 18 deg the rim foreshortens to about 31% of
     its width, so the relief owns most of the vertical extent of the picture.
     Operator's own framing, picked by dragging the first version until it
     looked right.

     The drag is CLAMPED well short of overhead. Past about 40 deg the disc
     opens back out toward a circle, the relief flattens against it, and the
     surface stops reading as three dimensional, which is exactly the
     complaint that produced this angle. */
  const ELEV_MIN = 0.12, ELEV_MAX = 0.70;
  const surf = {mode:0, grid:null, raf:0, t:0, yaw:-0.5, elev:0.31,
                drag:null, canvas:null, canvases:[], dpr:1};

  /* The shape is fixed per mode, so it is built ONCE and a frame only scales
     it by sin(wt). That is what keeps this cheap enough to leave running. */
  function buildGrid(mi){
    const {m, n} = MODES[mi], a = ALPHA[`${m},${n}`];
    const pts = [];
    let zmax = 1e-9;
    for (let i = 0; i <= NR; i++){
      const rr = i / NR;                                  /* r/a, 0 to 1 */
      const row = [];
      for (let j = 0; j <= NTH; j++){
        const th = j / NTH * Math.PI * 2;
        const z = besselJ(m, a * rr) * Math.cos(m * th);
        zmax = Math.max(zmax, Math.abs(z));
        row.push({x: rr * Math.cos(th), y: rr * Math.sin(th), z});
      }
      pts.push(row);
    }
    /* `c` is the colour, and it is the MODE SHAPE, fixed. Colouring by the
       instantaneous height instead washes the whole surface out twice a cycle,
       every time the membrane passes through flat, and the nodal lines vanish
       with it. Fixed colour keeps the pattern readable at every phase while
       the geometry still swings. */
    for (const row of pts) for (const p of row) p.c = p.z / zmax;
    surf.grid = pts;
  }

  /* One proper orthonormal camera: yaw about the drum's own axis, then an
     elevation tilt. Orthonormal matters because the SAME transform lights the
     surface, and a squashed one would tilt the highlights. */
  function view(x, y, z){
    const cy = Math.cos(surf.yaw), sy = Math.sin(surf.yaw);
    const ce = Math.cos(surf.elev), se = Math.sin(surf.elev);
    const x1 = x * cy - y * sy;
    const y1 = x * sy + y * cy;
    return {right: x1,
            up:    z * ce - y1 * se,
            depth: y1 * ce + z * se};
  }

  function project(p, amp, w, h){
    const v = view(p.x, p.y, p.z * amp * ZS);
    const s = Math.min(w, h) * 0.46;
    return {sx: w / 2 + v.right * s, sy: h / 2 - v.up * s, depth: v.depth};
  }

  /* Lambert, with the light fixed to the CAMERA rather than to the drum, so
     turning the surface does not drag the highlight around with it. This is
     the cue that settles whether a lobe is coming at you or going away: with
     flat fill the two are the same picture. */
  const LIGHT = (() => {
    const v = [-0.42, 0.68, 0.60];
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0]/n, v[1]/n, v[2]/n];
  })();

  function lambert(A, B, C, D, amp){
    /* the quad's normal from its diagonals, in view space */
    const p = (q) => view(q.x, q.y, q.z * amp * ZS);
    const a = p(A), b = p(B), c = p(C), d = p(D);
    const u = [c.right - a.right, c.up - a.up, -(c.depth - a.depth)];
    const v = [d.right - b.right, d.up - b.up, -(d.depth - b.depth)];
    let nx = u[1]*v[2] - u[2]*v[1];
    let ny = u[2]*v[0] - u[0]*v[2];
    let nz = u[0]*v[1] - u[1]*v[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (nz < 0){ nx = -nx; ny = -ny; nz = -nz; }   /* face the camera */
    const dot = nx*LIGHT[0] + ny*LIGHT[1] + nz*LIGHT[2];
    return 0.58 + 0.42 * Math.max(0, dot);
  }

  /* Diverging, from the site's own two series hues through the panel colour at
     zero. A membrane displacement has a sign, so a single hue ramp would throw
     half of it away. */
  function shade(v, lit){
    const up = [58, 135, 229], dn = [235, 104, 52];
    const base = isDark() ? [88, 88, 84] : [250, 250, 246];
    const t = Math.min(1, Math.abs(v) * 1.15);
    const c = v >= 0 ? up : dn;
    const k = lit === undefined ? 1 : lit;
    const mix = (i) => Math.max(0, Math.min(255,
      Math.round((base[i] + (c[i] - base[i]) * t) * k)));
    return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
  }

  function paint(){
    for (const cv of surf.canvases) paintOne(cv);
  }

  function paintOne(cv){
    if (!cv || !cv.offsetParent || !surf.grid) return;
    const w = cv.width / surf.dpr, h = cv.height / surf.dpr;
    const ctx = cv.getContext("2d");
    ctx.setTransform(surf.dpr, 0, 0, surf.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const amp = Math.sin(surf.t);
    const g = surf.grid, quads = [];
    for (let i = 0; i < NR; i++){
      for (let j = 0; j < NTH; j++){
        const a = project(g[i][j], amp, w, h);
        const b = project(g[i][j+1], amp, w, h);
        const c = project(g[i+1][j+1], amp, w, h);
        const d = project(g[i+1][j], amp, w, h);
        const cc = (g[i][j].c + g[i][j+1].c + g[i+1][j+1].c + g[i+1][j].c) / 4;
        quads.push({p:[a,b,c,d], v: cc,
                    lit: lambert(g[i][j], g[i][j+1], g[i+1][j+1], g[i+1][j], amp),
                    depth: (a.depth + b.depth + c.depth + d.depth) / 4});
      }
    }
    /* The rim, drawn flat at z = 0 before the surface. J_m(alpha_mn) is zero
       at r = a for every mode, so the rim never moves: it is the one line in
       the picture the reader can trust as the resting plane, and it settles
       which way the lobes are going. */
    ctx.beginPath();
    for (let j = 0; j <= NTH; j++){
      const q = project({x: g[NR][j].x, y: g[NR][j].y, z: 0}, 0, w, h);
      if (j === 0) ctx.moveTo(q.sx, q.sy); else ctx.lineTo(q.sx, q.sy);
    }
    ctx.strokeStyle = isDark() ? "rgba(255,255,255,.22)" : "rgba(0,0,0,.20)";
    ctx.lineWidth = 1.1;
    ctx.stroke();

    /* painter's algorithm: far first, so near quads cover what is behind */
    quads.sort((p, q) => p.depth - q.depth);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = isDark() ? "rgba(0,0,0,.55)" : "rgba(0,0,0,.30)";
    for (const q of quads){
      ctx.beginPath();
      ctx.moveTo(q.p[0].sx, q.p[0].sy);
      for (let k = 1; k < 4; k++) ctx.lineTo(q.p[k].sx, q.p[k].sy);
      ctx.closePath();
      ctx.fillStyle = shade(q.v, q.lit);
      ctx.fill();
      ctx.stroke();
    }
  }

  const reduced = () => window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function tick(){
    surf.t += 0.055;
    paint();
    surf.raf = requestAnimationFrame(tick);
  }

  function sizeCanvas(){
    surf.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const cv of surf.canvases){
      const box = cv.parentElement.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      cv.width = Math.max(1, Math.round(box.width * surf.dpr));
      cv.height = Math.max(1, Math.round(box.height * surf.dpr));
      cv.style.width = box.width + "px";
      cv.style.height = box.height + "px";
    }
    paint();
  }

  function setMode(i){
    i = Math.max(0, Math.min(i, MODES.length - 1));
    if (i !== surf.mode || !surf.grid){
      surf.mode = i;
      buildGrid(i);
    }
    const cap = $("modeCaption");
    if (cap) cap.innerHTML = `<b>${MODES[i].label}</b> &nbsp; ${MODES[i].text}`;
    paint();
  }

  function initSurface(){
    surf.canvas = $("modeCanvas");
    surf.canvases = [$("heroCanvas"), surf.canvas].filter(Boolean);
    if (!surf.canvases.length) return;
    buildGrid(0);
    sizeCanvas();
    if (typeof ResizeObserver !== "undefined")
      for (const cv of surf.canvases)
        new ResizeObserver(sizeCanvas).observe(cv.parentElement);
    if (!surf.canvas) return;

    /* Drag to turn it. This is a web page, so the reader may as well look at
       the nodal lines from wherever they want. */
    const cv = surf.canvas;
    const down = (e) => {
      const p = e.touches ? e.touches[0] : e;
      surf.drag = {x:p.clientX, y:p.clientY, yaw:surf.yaw, elev:surf.elev};
    };
    const move = (e) => {
      if (!surf.drag) return;
      const p = e.touches ? e.touches[0] : e;
      surf.yaw = surf.drag.yaw + (p.clientX - surf.drag.x) * 0.01;
      surf.elev = Math.max(ELEV_MIN, Math.min(ELEV_MAX,
        surf.drag.elev + (p.clientY - surf.drag.y) * 0.005));
      if (e.cancelable) e.preventDefault();
      paint();
    };
    const up = () => { surf.drag = null; };
    cv.addEventListener("mousedown", down);
    cv.addEventListener("touchstart", down, {passive:true});
    window.addEventListener("mousemove", move);
    cv.addEventListener("touchmove", move, {passive:false});
    window.addEventListener("mouseup", up);
    cv.addEventListener("touchend", up);
  }

  function startSurface(){
    if (surf.raf || reduced()) { paint(); return; }
    surf.raf = requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ the drift */
  /* Per strike, the picked peak closest to the campaign anchor. modes_hz is
     ranked by magnitude, and out near the rim the fundamental is not always
     the loudest thing in the list, so "the first one" would be wrong. */
  function fundamentals(){
    const a = DATA.campaign.anchor_hz, out = [];
    for (const i of DATA.kept){
      const l = DATA.strikes[i].modes_hz || [];
      let best = null;
      for (const v of l)
        if (v !== null && Math.abs(v-a) <= 15 &&
            (best === null || Math.abs(v-a) < Math.abs(best-a))) best = v;
      if (best !== null) out.push(best);
    }
    return out;
  }

  function drawDrift(step){
    const v = fundamentals();
    const med = median(v), sd = Math.sqrt(
      v.reduce((s,x)=>s+(x-med)*(x-med),0) / Math.max(1,v.length));
    $("driftStat").innerHTML =
      `<span class="big">${med.toFixed(1)}<small>Hz</small></span>`+
      `${v.length} kept strikes agree to &plusmn;${sd.toFixed(1)} Hz`;

    /* The three rungs are the operator's own observations of the same head on
       three days. Only the middle one produced this campaign. */
    const ladder = [
      {hz:323, when:"freshly stretched"},
      {hz:290, when:"the next day, this campaign"},
      {hz:270, when:"the third day"},
    ];
    const shapes = [], ann = [];
    if (step >= 1) for (const L of ladder){
      shapes.push({type:"line", x0:L.hz, x1:L.hz, yref:"paper", y0:0, y1:1,
        line:{color: L.hz===290 ? cssv("--navy") : cssv("--baseline"),
              width: L.hz===290 ? 2 : 1.2, dash:"dot"}});
      ann.push({x:L.hz, y:1, yref:"paper", yanchor:"bottom",
        text:`${L.hz} Hz<br><span style="font-size:10px">${L.when}</span>`,
        showarrow:false, font:{family:MONO, size:11,
          color: L.hz===290 ? cssv("--navy") : cssv("--muted")}});
    }
    const lo = step >= 1 ? 258 : 280, hi = step >= 1 ? 335 : 300;
    linePlot("driftPlot", [{
      type:"histogram", x:v, xbins:{start:lo, end:hi, size:1},
      marker:{color:cssv("--series1"), line:{width:0}},
      hovertemplate:"%{x:.0f} Hz<br><b>%{y}</b> strikes<extra></extra>",
    }], {xtitle:"fundamental measured on one strike (Hz)",
         ytitle:"strikes", legend:false, hovermode:"closest",
         xaxis:{range:[lo,hi]}, shapes, annotations:ann});
  }

  /* ---------------------------------------------------------- one strike */
  function trace(i){ return DATA.method.traces[i]; }

  function traceMv(t){
    const k = DATA.method.mv_per_count;
    return Array.from(t.counts, c => (c - t.baseline) * k);
  }
  function traceMs(t){
    return t.counts.map((_,i)=>(i - t.pre) * 1000 / t.fs_hz);
  }

  function drawStrike(step){
    const t = trace(0);
    const wave = $("strikeWave"), spec = $("strikeSpec");
    wave.classList.toggle("hidden", step >= 2);
    spec.classList.toggle("hidden", step < 2);

    if (step < 2){
      const y = traceMv(t), x = traceMs(t);
      const traces = [{type:"scatter", x, y, mode:"lines",
        line:{color:cssv("--series1"), width:1},
        hovertemplate:"%{x:.1f} ms<br><b>%{y:.0f}</b> mV<extra></extra>",
        name:"the sensor"}];
      /* The measured decay, drawn as the envelope it describes: the site never
         re-fits anything, it shows the fit drumlab already recorded. */
      if (step >= 1 && t.metrics.T60_ms){
        const tau = t.metrics.T60_ms / 6.9078;
        let pi = 0;
        y.forEach((v,i)=>{ if (Math.abs(v) > Math.abs(y[pi])) pi = i; });
        const A = Math.abs(y[pi]), t0 = x[pi];
        const ex = x.filter(v=>v>=t0);
        const env = ex.map(v=>A*Math.exp(-(v-t0)/tau));
        traces.push({type:"scatter", x:ex, y:env, mode:"lines",
          line:{color:cssv("--strike"), width:1.6, dash:"dot"},
          name:`T60 ${t.metrics.T60_ms.toFixed(0)} ms`, hoverinfo:"skip"});
        traces.push({type:"scatter", x:ex, y:env.map(v=>-v), mode:"lines",
          line:{color:cssv("--strike"), width:1.6, dash:"dot"},
          showlegend:false, hoverinfo:"skip"});
      }
      /* Step 0 sits CLOSE so the individual cycles are wide enough to count;
         step 1 pulls back to show the whole ring-down under its envelope. At
         the full 245 ms window a 290 Hz cycle is about ten pixels wide and the
         vibration reads as a smear. */
      linePlot("strikeWave", traces, {
        xtitle:"time from the hit (ms)", ytitle:"sensor output (mV)",
        xaxis:{range: step >= 1 ? [-10, 200] : [-6, 70]}, hovermode:"x"});
    } else {
      const f = freqAxis(), sp = specOf(t.strike_index);
      const sc = DATA.spectra.amp_scale;
      const y = Array.from(sp, v=>v/sc);
      const ann = [];
      if (step >= 3) for (const m of DATA.campaign.modes){
        const k = Math.round((m.hz - DATA.spectra.f0)/DATA.spectra.df);
        if (k < 0 || k >= y.length) continue;
        const elec = m.kind === "electrical";
        ann.push({x:m.hz, y:Math.log10(Math.max(y[k],1e-4)),
          text:`<b>${m.hz.toFixed(0)}</b>` + (elec ? "<br>electrical" : ""),
          showarrow:true, arrowhead:0, arrowwidth:1,
          arrowcolor:cssv("--baseline"), ax:0, ay:-28,
          font:{family:MONO, size:elec?10:12,
                color:elec?cssv("--muted"):cssv("--ink")},
          bgcolor:cssv("--panel"), borderpad:2});
      }
      linePlot("strikeSpec", [{type:"scatter", x:f, y, mode:"lines",
        line:{color:cssv("--series1"), width:1.7},
        hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b><extra></extra>"}], {
        xtitle:"frequency (Hz)", ytitle:"ring-down amplitude (rel.)",
        yaxis:{type:"log", showticklabels:false}, annotations:ann,
        legend:false});
    }
    $("strikeCap").textContent = step < 2
      ? `${t.label}, mounting ${t.mount.replace("mount","")} at `+
        `(${t.x}, ${t.y}) mm. Raw counts turned back into millivolts.`
      : `The same strike after the hit, as a spectrum. This is the campaign's `+
        `own tail spectrum for it, not a redrawing.`;
  }

  /* ------------------------------------------------------------- the map */
  function drawMap(step){
    const mounts = DATA.campaign.mounts.map(m=>"mount"+m.mount);
    const upto = step <= 2 ? Math.min(mounts.length, step+1) : mounts.length;
    const keep = new Set(mounts.slice(0, upto));
    const idxs = DATA.kept.filter(i=>keep.has(DATA.strikes[i].mount));
    const metric = step >= 4 ? "t60" : "pp";
    const acc = cellsOf(idxs, metric === "pp"
      ? (r=>r.pp_mv) : (r=>r.T60_ms));
    heatmap("posterMap", acc, {
      title: metric === "pp" ? "Amplitude" : "Decay T60",
      unit: metric === "pp" ? "mV" : "ms",
      hue: metric === "pp" ? "blue" : "orange",
      clipped: metric === "pp"});
    const nclip = [...acc.values()].filter(e=>e.clip).length;
    $("mapCap").innerHTML = step <= 2
      ? `${upto} of 4 mountings &middot; ${acc.size} cells &middot; `+
        `${idxs.length} strikes`
      : (metric === "pp"
        ? `All four mountings: ${acc.size} cells, ${idxs.length} kept strikes, `+
          `${nclip} cells carrying a clipped hit (dots).`
        : `The same cells, coloured by how long each rang.`);
  }

  /* ----------------------------------------------------------- the peaks */
  function drawPeaks(step){
    const modes = DATA.campaign.modes;
    /* Step order is the story order: the fundamental, then the pair nobody has
       explained, then the line that is not the drum at all. */
    const order = [1, 2, 3, 0];
    const mi = order[Math.min(step, order.length-1)];
    const m = modes[mi];
    const half = DATA.campaign.band_half_bw_hz;
    const acc = normalised(bandCells(DATA.kept, m.hz, half));
    const contrast = contrastOf(acc);
    heatmap("peakBand", acc, {title:`${m.hz.toFixed(0)} Hz across the head`,
      unit:"rel.", compact:true, zmin:0, zmax:1,
      hue: m.kind === "electrical" ? "aqua" : "blue"});

    const f = freqAxis(), med = medianSpectrum(DATA.kept);
    linePlot("peakSpec", [{type:"scatter", x:f, y:med, mode:"lines",
      line:{color:cssv("--series1"), width:1.7}, hoverinfo:"skip"}], {
      xtitle:"frequency (Hz)", legend:false, ytitle:"",
      yaxis:{type:"log", showticklabels:false},
      margin:{l:22, r:10, t:22, b:40},
      shapes:[{type:"rect", x0:m.hz-half, x1:m.hz+half, yref:"paper",
        y0:0, y1:1, fillcolor:cssv("--navy"), opacity:.14, line:{width:0}}],
      annotations:[{x:m.hz, y:1, yref:"paper", yanchor:"bottom",
        text:`<b>${m.hz.toFixed(0)} Hz</b>`, showarrow:false,
        font:{family:MONO, size:12, color:cssv("--ink")}}]});

    $("peakCap").innerHTML = `<b>${m.hz.toFixed(0)} Hz</b>, ${m.label}. `+
      `Loud and quiet regions across the head, each map scaled to its own `+
      `maximum. Spatial contrast <b>${contrast ? contrast.toFixed(1) : "?"}</b>.`;
  }

  /* ------------------------------------------------------------- build up */
  function fillStats(){
    const c = DATA.campaign, k = c.counts;
    $("posterStats").innerHTML = [
      [k.strikes, "strikes fired"], [k.used, "kept"], [k.cells, "cells"],
      [k.mounts, "mountings"], [c.anchor_hz.toFixed(0)+" Hz", "fundamental"],
      [k.clipped, "clipped"],
    ].map(([v,l])=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`)
     .join("");
  }

  function build(){
    fillStats();
    initSurface();
    setMode(0);

    Scrolly.register("ch-modes", (i)=>setMode(Math.min(i, MODES.length-1)));
    Scrolly.register("ch-sense", (i)=>{
      $("senseExploded").classList.toggle("hidden", i >= 2);
      $("senseBench").classList.toggle("hidden", i < 2);
      $("senseCap").textContent = i < 2
        ? "The rig on the optical table. The printed drum sits in its clamp "
          + "with the two axis stage underneath it."
        : "The ST188 looking straight down at the printed membrane, inside "
          + "the clamp ring and its four tensioning screws.";
    });
    Scrolly.register("ch-drift", drawDrift);
    Scrolly.register("ch-strike", drawStrike);
    Scrolly.register("ch-map", drawMap);
    Scrolly.register("ch-peaks", drawPeaks);
  }

  function enter(){
    startSurface();
    Scrolly.reset();
  }
  function redraw(){
    sizeCanvas();
    drawDrift(Scrolly.active("ch-drift"));
    drawStrike(Math.max(0, Scrolly.active("ch-strike")));
    drawMap(Math.max(0, Scrolly.active("ch-map")));
    drawPeaks(Math.max(0, Scrolly.active("ch-peaks")));
  }

  return {build, enter, redraw};
})();
