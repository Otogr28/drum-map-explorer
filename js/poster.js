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

  /* ------------------------------------------------------- Bessel machinery */
  /* J_m by its power series. The argument never exceeds alpha_31 = 6.4 here,
     so the series converges long before the factorials overflow. */
  function besselJ(m, x){
    let term = Math.pow(x/2, m);
    for (let k=1;k<=m;k++) term /= k;
    let sum = term;
    for (let k=1;k<40;k++){
      term *= -(x*x/4) / (k * (k+m));
      sum += term;
      if (Math.abs(term) < 1e-14) break;
    }
    return sum;
  }
  /* alpha_mn: the n-th zero of J_m. The ladder every predicted frequency on
     this project is built from. */
  const ALPHA = {"0,1":2.404826, "1,1":3.831706, "2,1":5.135622,
                 "0,2":5.520078, "3,1":6.380162, "1,2":7.015587};
  const MODES = [
    {m:0, n:1, label:"(0,1)", text:"the whole head moves as one"},
    {m:1, n:1, label:"(1,1)", text:"one still line across the middle"},
    {m:2, n:1, label:"(2,1)", text:"two still lines, four moving quarters"},
    {m:1, n:2, label:"(1,2)", text:"a still line and a still ring"},
  ];

  const anim = {raf:0, t:0, mode:0, shape:null, size:0, canvases:[]};

  /* The spatial part is computed ONCE per mode and cached. A frame is then a
     multiply and a colour lookup over the cached field, which keeps the
     animation cheap enough to leave running on a phone. */
  function shapeFor(mode, size){
    const {m, n} = MODES[mode];
    const a = ALPHA[`${m},${n}`];
    const f = new Float32Array(size*size);
    const c = (size-1)/2;
    for (let iy=0;iy<size;iy++){
      for (let ix=0;ix<size;ix++){
        const dx = (ix-c)/c, dy = (iy-c)/c;
        const r = Math.hypot(dx, dy);
        f[iy*size+ix] = r > 1 ? NaN
          : besselJ(m, a*r) * Math.cos(m * Math.atan2(dy, dx));
      }
    }
    return f;
  }

  /* Diverging blue to orange through the panel colour. A membrane displacement
     has a sign, so a single hue ramp would throw half the information away. */
  function ramp(v){
    const up = [58,135,229], dn = [235,104,52];
    const t = Math.min(1, Math.abs(v));
    const base = isDark() ? [26,26,25] : [255,255,255];
    const c = v >= 0 ? up : dn;
    return [Math.round(base[0] + (c[0]-base[0])*t),
            Math.round(base[1] + (c[1]-base[1])*t),
            Math.round(base[2] + (c[2]-base[2])*t)];
  }

  function paint(cv, field, size, amp){
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let i=0;i<size*size;i++){
      const v = field[i];
      if (Number.isNaN(v)){ d[i*4+3] = 0; continue; }
      const [r,g,b] = ramp(v * amp);
      d[i*4] = r; d[i*4+1] = g; d[i*4+2] = b; d[i*4+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function tick(){
    anim.t += 0.055;
    const amp = Math.sin(anim.t);
    for (const cv of anim.canvases){
      if (!cv.isConnected || !cv.offsetParent) continue;
      paint(cv, anim.shape, anim.size, amp);
    }
    anim.raf = requestAnimationFrame(tick);
  }

  function setMode(i){
    if (i === anim.mode && anim.shape) return;
    anim.mode = i;
    anim.shape = shapeFor(i, anim.size);
    const el = $("modeCaption");
    if (el) el.innerHTML = `<b>${MODES[i].label}</b> &nbsp; ${MODES[i].text}`;
  }

  function startAnim(){
    if (anim.raf) return;
    anim.raf = requestAnimationFrame(tick);
  }
  function stopAnim(){
    cancelAnimationFrame(anim.raf);
    anim.raf = 0;
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
      linePlot("strikeWave", traces, {
        xtitle:"time from the hit (ms)", ytitle:"sensor output (mV)",
        xaxis:{range:[-20, 225]}, hovermode:"x"});
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
    anim.size = 300;
    anim.canvases = [...document.querySelectorAll("canvas.membrane")];
    anim.canvases.forEach(cv=>{ cv.width = anim.size; cv.height = anim.size; });
    /* At 300 px the analytic shape is drawn once per mode, so the resolution
       costs one pass and not one per frame. */
    setMode(0);

    Scrolly.register("ch-modes", (i)=>setMode(Math.min(i, MODES.length-1)));
    Scrolly.register("ch-sense", (i)=>{
      $("senseExploded").classList.toggle("hidden", i >= 2);
      $("senseBench").classList.toggle("hidden", i < 2);
      $("senseCap").textContent = i < 2
        ? "The head, the clamp ring and the striker mount, all printed."
        : "The same parts assembled on the two axis stage.";
    });
    Scrolly.register("ch-drift", drawDrift);
    Scrolly.register("ch-strike", drawStrike);
    Scrolly.register("ch-map", drawMap);
    Scrolly.register("ch-peaks", drawPeaks);
  }

  function enter(){
    startAnim();
    Scrolly.reset();
  }
  function redraw(){
    if (anim.shape) anim.shape = shapeFor(anim.mode, anim.size);
    drawDrift(Scrolly.active("ch-drift"));
    drawStrike(Math.max(0, Scrolly.active("ch-strike")));
    drawMap(Math.max(0, Scrolly.active("ch-map")));
    drawPeaks(Math.max(0, Scrolly.active("ch-peaks")));
  }

  return {build, enter, redraw, stopAnim};
})();
