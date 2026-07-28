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
  /* The four textbook shapes are the Wikimedia Commons "Drum vibration mode"
     animations by Oleg Alexandrov, public domain, with the white background
     floodfilled out so they sit on either theme. They are THEORY: an ideal
     clamped circular membrane, not a measurement of this head, and the copy
     above them says so. The credit line lives in index.html.

     They replaced a canvas that solved J_m(alpha_mn r/a) cos(m theta) live.
     The operator asked for the Commons animations: this is a web page, they
     are public domain, and they show the surface in three dimensions where the
     canvas only had a top view. */
  const MODES = [
    {file:"mode01", label:"(0,1)", text:"the whole head moves as one"},
    {file:"mode11", label:"(1,1)", text:"one still line across the middle"},
    {file:"mode21", label:"(2,1)", text:"two still lines, four moving quarters"},
    {file:"mode12", label:"(1,2)", text:"a still line and a still ring"},
  ];

  function setMode(i){
    i = Math.max(0, Math.min(i, MODES.length - 1));
    const img = $("modeGif"), cap = $("modeCaption");
    if (img && !img.getAttribute("src").endsWith(MODES[i].file + ".gif"))
      img.setAttribute("src", `assets/modes/${MODES[i].file}.gif`);
    if (cap) cap.innerHTML = `<b>${MODES[i].label}</b> &nbsp; ${MODES[i].text}`;
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
    Scrolly.reset();
  }
  function redraw(){
    drawDrift(Scrolly.active("ch-drift"));
    drawStrike(Math.max(0, Scrolly.active("ch-strike")));
    drawMap(Math.max(0, Scrolly.active("ch-map")));
    drawPeaks(Math.max(0, Scrolly.active("ch-peaks")));
  }

  return {build, enter, redraw};
})();
