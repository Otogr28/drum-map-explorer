"use strict";
/* ===========================================================================
   The Method part: how a peak earns the right to be called a mode.

   Six rules, each drawn on the campaign's own data. Two of them are live: the
   reader moves the threshold and watches peaks appear and disappear, which is
   the only honest way to show that a fixed bar was chosen and not tuned until
   the answer looked right.

   The traces are re-filtered in the browser (core.js dsp block). Every number
   the page QUOTES still comes from the export, so nothing here can drift away
   from what drumlab measured.
   =========================================================================== */

const Method = (() => {
  const K = () => DATA.method.constants;
  const S = {floorDb:null, bandHz:null, touched:false};

  const mvOf = (t) => Array.from(t.counts,
    c => (c - t.baseline) * DATA.method.mv_per_count);
  const msOf = (t) => t.counts.map((_,i)=>(i - t.pre) * 1000 / t.fs_hz);

  /* ==================================================== 1. the two branches */
  function branchStages(t){
    if (t._stages) return t._stages;
    const raw = mvOf(t);
    const hp = hampel(raw, K().hampel_window, K().hampel_nsig);
    const clean = highpass(hp.y, K().hp_fc_hz, t.fs_hz);
    t._stages = {raw, despiked:hp.y, hit:hp.hit, clean};
    return t._stages;
  }

  function drawBranch(step){
    const t = DATA.method.traces[0], st = branchStages(t);
    const x = msOf(t);
    const traces = [];
    const dim = cssv("--baseline");

    if (step === 0){
      traces.push({type:"scatter", x, y:st.raw, mode:"lines",
        line:{color:cssv("--series1"), width:1}, name:"raw counts",
        hovertemplate:"%{x:.1f} ms<br><b>%{y:.0f}</b> mV<extra></extra>"});
    }
    if (step === 1){
      traces.push({type:"scatter", x, y:st.raw, mode:"lines",
        line:{color:dim, width:1}, name:"raw"});
      traces.push({type:"scatter", x, y:Array.from(st.despiked), mode:"lines",
        line:{color:cssv("--series1"), width:1}, name:"despiked"});
      if (st.hit.length) traces.push({type:"scatter",
        x:st.hit.map(i=>x[i]), y:st.hit.map(i=>st.raw[i]), mode:"markers",
        marker:{color:cssv("--strike"), size:6, symbol:"x"},
        name:`${st.hit.length} samples replaced`});
    }
    if (step >= 2){
      traces.push({type:"scatter", x, y:Array.from(st.despiked), mode:"lines",
        line:{color:dim, width:1}, name:"despiked"});
      traces.push({type:"scatter", x, y:Array.from(st.clean), mode:"lines",
        line:{color:cssv("--series1"), width:1.2},
        name:`high pass ${K().hp_fc_hz} Hz`});
    }
    linePlot("branchPlot", traces, {
      xtitle:"time from the hit (ms)", ytitle:"sensor output (mV)",
      xaxis:{range:[-40, 320]}, hovermode:"x"});

    const chips = ["raw block", "despike", `high pass ${K().hp_fc_hz} Hz`,
                   "spectral gate"];
    $("branchPipe").innerHTML = chips.map((c,i)=>{
      const on = i <= Math.min(step, 2);
      const gated = i === 3;
      const cls = gated ? (step >= 3 ? "off" : "") : (on ? "on" : "");
      return `<b class="${cls}">${c}</b>`;
    }).join('<i>&rarr;</i>');

    $("branchCap").innerHTML = step >= 3
      ? `The gate is drawn on the screen at the bench and <b>never measured `+
        `on</b>. Every number on this site comes from the branch above it.`
      : `${t.label}, mounting ${t.mount.replace("mount","")} at `+
        `(${t.x}, ${t.y}) mm. Re-filtered here in the browser at drumlab's `+
        `own settings.`;
  }

  /* ================================================ 2. the floor and the bar */
  function medianSpec(){
    if (DATA._mspec) return DATA._mspec;
    const med = medianSpectrum(DATA.kept);
    DATA._mspec = {f:freqAxis(), mag:Float64Array.from(med)};
    return DATA._mspec;
  }

  function drawFloor(step){
    const {f, mag} = medianSpec();
    const df = DATA.spectra.df;
    const wbin = Math.max(3, Math.round(K().cfar_window_hz / df) | 1);
    const floorDb = S.floorDb === null ? K().floor_db : S.floorDb;
    const res = pickPeaks(f, mag, {
      fmin:K().mode_fmin_hz, fmax:K().mode_fmax_hz, floorDb,
      valleyDb:K().valley_db, minSep:K().min_sep_hz, nModes:6, wbin});

    const traces = [{type:"scatter", x:f, y:Array.from(mag), mode:"lines",
      line:{color:cssv("--series1"), width:1.6}, name:"median of 372 strikes",
      hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b><extra></extra>"}];
    if (step >= 1) traces.push({type:"scatter", x:f,
      y:Array.from(res.floor), mode:"lines",
      line:{color:cssv("--muted"), width:1.2, dash:"dot"},
      name:`local median floor, ${K().cfar_window_hz} Hz window`});
    if (step >= 2) traces.push({type:"scatter", x:f,
      y:Array.from(res.floor, v=>v*Math.pow(10, floorDb/20)), mode:"lines",
      line:{color:cssv("--amber"), width:1.3},
      name:`the bar, floor + ${floorDb.toFixed(0)} dB`});
    if (step >= 2 && res.kept.length) traces.push({type:"scatter",
      x:res.kept.map(c=>c.hz), y:res.kept.map(c=>c.mag), mode:"markers",
      marker:{color:cssv("--good"), size:9, symbol:"circle-open",
              line:{width:2}},
      name:"kept", hovertemplate:"%{x:.0f} Hz, +%{text} dB over the floor"+
        "<extra></extra>", text:res.kept.map(c=>c.prom.toFixed(1))});

    const shapes = [];
    if (step >= 3){
      shapes.push({type:"rect", x0:f[0], x1:K().mode_fmin_hz, yref:"paper",
        y0:0, y1:1, fillcolor:cssv("--critical"), opacity:.09,
        line:{width:0}});
      for (let h=60; h<=K().mains_max_hz; h+=60)
        shapes.push({type:"rect", x0:h-K().notch_half_hz,
          x1:h+K().notch_half_hz, yref:"paper", y0:0, y1:1,
          fillcolor:cssv("--muted"), opacity:.22, line:{width:0}});
    }
    linePlot("floorPlot", traces, {
      xtitle:"frequency (Hz)", ytitle:"ring-down amplitude (rel.)",
      yaxis:{type:"log", showticklabels:false},
      xaxis:{range:[f[0], 900]}, shapes});

    $("floorKnob").classList.toggle("locked", step < 2);
    $("floorCap").innerHTML = step >= 3
      ? `Red: below ${K().mode_fmin_hz} Hz nothing counts, because the hanging `+
        `rig rings there and out-shouts the head. Grey: the mains harmonics, `+
        `notched &plusmn;${K().notch_half_hz} Hz up to `+
        `${K().mains_max_hz} Hz.`
      : `Kept peaks at this bar: <b>` +
        (res.kept.length ? res.kept.map(c=>c.hz.toFixed(0)+" Hz").join(", ")
                         : "none") + `</b>.`;
    $("floorOut").textContent = floorDb.toFixed(0) + " dB";
    $("floorCount").innerHTML = `<b>${res.kept.length}</b> peaks kept`;
  }

  /* ================================================== 3. one ridge or two? */
  function drawValley(step){
    const {f, mag} = medianSpec();
    const df = DATA.spectra.df;
    const wbin = Math.max(3, Math.round(K().cfar_window_hz / df) | 1);
    const res = pickPeaks(f, mag, {
      fmin:K().mode_fmin_hz, fmax:K().mode_fmax_hz, floorDb:K().floor_db,
      valleyDb: step >= 2 ? K().valley_db : 0,
      minSep: step >= 1 ? K().min_sep_hz : 0, nModes:8, wbin});

    const traces = [{type:"scatter", x:f, y:Array.from(mag), mode:"lines",
      line:{color:cssv("--series1"), width:1.8}, name:"median spectrum",
      hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b><extra></extra>"}];
    traces.push({type:"scatter", x:res.kept.map(c=>c.hz),
      y:res.kept.map(c=>c.mag), mode:"markers",
      marker:{color:cssv("--good"), size:10, symbol:"circle-open",
              line:{width:2}}, name:"counted as a mode"});
    const drop = res.rejected.filter(c=>c.why === "valley" || c.why === "sep");
    if (step >= 1 && drop.length) traces.push({type:"scatter",
      x:drop.map(c=>c.hz), y:drop.map(c=>c.mag), mode:"markers",
      marker:{color:cssv("--strike"), size:7, symbol:"x"},
      name:"same ridge, not a second mode"});

    linePlot("valleyPlot", traces, {
      xtitle:"frequency (Hz)", ytitle:"ring-down amplitude (rel.)",
      yaxis:{type:"log", showticklabels:false},
      xaxis:{range:[240, 560]}});

    $("valleyCap").innerHTML = step === 0
      ? `With no separation rule at all, every local maximum on the flank of a `+
        `ridge is a candidate.`
      : step === 1
      ? `Peaks closer than ${K().min_sep_hz} Hz collapse. The rule is not `+
        `wider, because an ${K().min_sep_hz} Hz gap is a real split this rig `+
        `has resolved before.`
      : `A candidate only survives if the spectrum dips <b>${K().valley_db} dB `+
        `below it</b> between it and every peak already kept. `+
        `<b>${res.kept.length}</b> peaks left in this window.`;
  }

  /* ============================================ 4. does it care where you hit */
  function drawContrast(step){
    const modes = DATA.campaign.modes;
    /* The steps drive the band UNTIL the reader touches the slider. After that
       it is his, and scrolling on must not yank it back to a preset. */
    const preset = [modes[1].hz, modes[1].hz, modes[0].hz, modes[2].hz];
    if (!S.touched) S.bandHz = preset[Math.max(0, Math.min(step, 3))];
    const fc = S.bandHz === null ? modes[1].hz : S.bandHz;
    $("contrastSlider").value = fc;
    const half = DATA.campaign.band_half_bw_hz;
    const acc = normalised(bandCells(DATA.kept, fc, half));
    const c = contrastOf(acc);
    heatmap("contrastMap", acc, {title:`${fc.toFixed(0)} Hz band`, unit:"rel.",
      hue:"blue", zmin:0, zmax:1, compact:true});

    const bar = K().contrast_min, barP = K().contrast_min_pinned;
    const pass = c !== null && c >= bar;
    $("contrastOut").textContent = fc.toFixed(0) + " Hz";
    $("contrastVal").innerHTML = c === null ? "" :
      `<span class="big">${c.toFixed(1)}<small>p90 / p10</small></span>`+
      `<span class="verdict ${pass?"seen":"susp"}">`+
      `${pass ? "above the bar" : "below the bar"}</span>`;
    $("contrastKnob").classList.toggle("locked", step < 1);
    $("contrastCap").innerHTML = step >= 3
      ? `The bar is <b>${bar}</b>, raised to <b>${barP}</b> for a peak that `+
        `sits at the same frequency under every mounting. A peak that does `+
        `not move when the head is re-tensioned is a room, not a drum.`
      : `Mean amplitude in ${fc.toFixed(0)} &plusmn; ${half} Hz per cell. `+
        `A membrane mode has nodes, places that stay dark however hard they `+
        `are struck.`;
  }

  /* ======================================================= 5. the placebo */
  function placeboRun(){
    const runs = DATA.method.placebo.runs;
    return runs[runs.length-1] || {hunts:[]};
  }

  function drawPlacebo(step){
    const run = placeboRun();
    const hunts = run.hunts;
    const names = hunts.map(h=>h.mode);
    const traces = [{type:"bar", x:names, y:hunts.map(h=>h.band_hunt_db),
      name:"struck at the antinode", marker:{color:cssv("--series1")},
      hovertemplate:"%{x}<br><b>%{y:.1f}</b> dB over its own floor<extra></extra>"}];
    if (step >= 2) traces.push({type:"bar", x:names,
      y:hunts.map(h=>h.band_ctrl_db), name:"struck at the node (the placebo)",
      marker:{color:cssv("--muted")},
      hovertemplate:"%{x}<br><b>%{y:.1f}</b> dB<extra></extra>"});

    const ann = [];
    if (step >= 3) hunts.forEach(h=>{
      const d = h.delta_db;
      ann.push({x:h.mode, y:Math.max(h.band_hunt_db, h.band_ctrl_db) + 1.4,
        text:`${d > 0 ? "+" : ""}${d.toFixed(1)} dB`, showarrow:false,
        font:{family:MONO, size:11,
          color: d >= K().placebo_min_db ? cssv("--good") : cssv("--amber")}});
    });
    linePlot("placeboPlot", traces, {
      ytitle:"band level over the strike's own floor (dB)", legend:true,
      hovermode:"closest", barmode:"group", xaxis:{type:"category"},
      annotations:ann, shapes: step >= 3 ? [] : []});

    const rows = hunts.map(h=>{
      const seen = h.seen_in > 0;
      const ok = h.delta_db >= K().placebo_min_db;
      const v = !seen ? ["none","not seen"]
              : ok ? ["seen","SEEN"] : ["susp","SUSPECT"];
      return `<tr><td class="l">${h.mode}</td>`+
        `<td>${h.f_expected_hz.toFixed(0)}</td>`+
        `<td>${h.f_found_hz === null ? "" : h.f_found_hz.toFixed(1)}</td>`+
        `<td>${h.band_hunt_db.toFixed(1)}</td>`+
        `<td>${h.band_ctrl_db.toFixed(1)}</td>`+
        `<td>${h.delta_db > 0 ? "+" : ""}${h.delta_db.toFixed(1)}</td>`+
        `<td class="l"><span class="verdict ${v[0]}">${v[1]}</span></td></tr>`;
    }).join("");
    $("placeboTable").innerHTML =
      `<table><thead><tr><th class="l">mode</th><th>predicted</th>`+
      `<th>found</th><th>antinode</th><th>node</th><th>&Delta;</th>`+
      `<th class="l">verdict</th></tr></thead><tbody>${rows}</tbody></table>`;
    $("placeboTable").classList.toggle("hidden", step < 3);
    $("placeboPlot").classList.toggle("hidden", step >= 3);

    $("placeboCap").innerHTML = step === 0
      ? `Every bar is one candidate, measured where the mode should be `+
        `loudest.`
      : step === 1
      ? `The placebo strike lands on the mode's own node: the centre for any `+
        `mode with a nodal diameter, the inner nodal circle for the rest.`
      : step === 2
      ? `Grey is the same band, measured with the head struck at that node. `+
        `A real mode cannot be there.`
      : `The rule is <b>median of the real strikes minus the loudest null `+
        `&ge; ${K().placebo_min_db} dB</b>. Run `+
        `<code>${run.run}</code>, anchored at ${run.anchor_hz} Hz.`;
  }

  /* ==================================================== 6. the disagreements */
  function pairsFFTvsESPRIT(){
    const out = [];
    for (const i of DATA.kept){
      const r = DATA.strikes[i];
      for (const a of (r.modes_hz || [])){
        let best = null;
        for (const b of (r.modes_hp_hz || []))
          if (best === null || Math.abs(b-a) < Math.abs(best-a)) best = b;
        if (best !== null) out.push([a, best]);
      }
    }
    return out;
  }

  function repeatability(){
    /* Cells the four mountings share on purpose. If gluing them into one map
       is legitimate, the same cell has to give the same fundamental whichever
       mounting visited it. */
    const a = DATA.campaign.anchor_hz;
    const byCell = new Map();
    for (const i of DATA.kept){
      const r = DATA.strikes[i];
      let best = null;
      for (const v of (r.modes_hz || []))
        if (v !== null && Math.abs(v-a) <= 15 &&
            (best === null || Math.abs(v-a) < Math.abs(best-a))) best = v;
      if (best === null) continue;
      const k = `${r.x}|${r.y}`;
      if (!byCell.has(k)) byCell.set(k, new Map());
      const m = byCell.get(k);
      if (!m.has(r.mount)) m.set(r.mount, []);
      m.get(r.mount).push(best);
    }
    const spreads = [];
    for (const m of byCell.values()){
      if (m.size < 2) continue;
      const meds = [...m.values()].map(median);
      spreads.push(Math.max(...meds) - Math.min(...meds));
    }
    return {n:spreads.length, med:median(spreads),
            worst:spreads.length ? Math.max(...spreads) : null};
  }

  function drawDisagree(step){
    if (step === 0){
      const p = pairsFFTvsESPRIT();
      linePlot("disagreePlot", [
        {type:"scatter", x:p.map(v=>v[0]), y:p.map(v=>v[1]), mode:"markers",
         marker:{color:cssv("--series1"), size:4, opacity:.45},
         name:"one picked peak",
         hovertemplate:"FFT %{x:.0f} Hz<br>ESPRIT %{y:.0f} Hz<extra></extra>"},
        {type:"scatter", x:[80,900], y:[80,900], mode:"lines",
         line:{color:cssv("--muted"), width:1, dash:"dot"}, name:"they agree"},
      ], {xtitle:"FFT peak (Hz)", ytitle:"ESPRIT pole (Hz)",
          hovermode:"closest", xaxis:{range:[80,900]}, yaxis:{range:[80,900]}});
      $("disagreeCap").innerHTML =
        `Two pickers on the same strike. Points on the line are the peaks `+
        `both methods found, and those are the ones this project trusts.`;
    }
    if (step === 1){
      const v = DATA.kept.map(i=>DATA.strikes[i])
        .filter(r=>r.T60_ms && r.T60_logenv_ms);
      const bad = v.filter(r=>Math.abs(r.decay_xcheck - 1) > K().xcheck_tol);
      linePlot("disagreePlot", [
        {type:"scatter", x:v.map(r=>r.T60_ms), y:v.map(r=>r.T60_logenv_ms),
         mode:"markers", marker:{color:cssv("--series2"), size:5, opacity:.5},
         name:"one strike",
         hovertemplate:"Schroeder %{x:.0f} ms<br>envelope %{y:.0f} ms"+
           "<extra></extra>"},
        {type:"scatter", x:[0,1200], y:[0,1200], mode:"lines",
         line:{color:cssv("--muted"), width:1, dash:"dot"}, name:"they agree"},
      ], {xtitle:"T60 by backward integration (ms)",
          ytitle:"T60 by the log envelope (ms)", hovermode:"closest",
          xaxis:{range:[0,900]}, yaxis:{range:[0,900]}});
      $("disagreeCap").innerHTML =
        `Two ways of measuring the same decay. They disagree by more than `+
        `${(K().xcheck_tol*100).toFixed(0)}% on <b>`+
        `${(100*bad.length/v.length).toFixed(0)}%</b> of the kept strikes `+
        `(${bad.length} of ${v.length}), which is why no damping number is `+
        `claimed on the poster.`;
    }
    if (step === 2){
      const kept = DATA.kept.map(i=>DATA.strikes[i]);
      const cl = kept.filter(r=>r.clipped), cn = kept.filter(r=>!r.clipped);
      linePlot("disagreePlot", [
        {type:"histogram", x:cn.map(r=>r.pp_mv), name:"clean",
         marker:{color:cssv("--series1")}, opacity:.75,
         xbins:{start:0, end:5200, size:120}},
        {type:"histogram", x:cl.map(r=>r.pp_mv), name:"clipped, a lower bound",
         marker:{color:cssv("--strike")}, opacity:.75,
         xbins:{start:0, end:5200, size:120}},
      ], {xtitle:"peak to peak (mV)", ytitle:"strikes", hovermode:"closest",
          barmode:"overlay", legend:true});
      $("disagreeCap").innerHTML =
        `<b>${cl.length}</b> of ${kept.length} kept strikes railed the `+
        `amplifier and pile up against the rail. Their amplitude is a `+
        `censored lower bound, so the site marks those cells and never reads `+
        `them as measurements.`;
    }
    if (step >= 3){
      const rep = repeatability();
      const a = DATA.campaign.anchor_hz;
      const byCell = new Map();
      for (const i of DATA.kept){
        const r = DATA.strikes[i];
        let best = null;
        for (const v of (r.modes_hz || []))
          if (v !== null && Math.abs(v-a) <= 15 &&
              (best === null || Math.abs(v-a) < Math.abs(best-a))) best = v;
        if (best === null) continue;
        const k = `${r.x}|${r.y}`;
        if (!byCell.has(k)) byCell.set(k, new Map());
        if (!byCell.get(k).has(r.mount)) byCell.get(k).set(r.mount, []);
        byCell.get(k).get(r.mount).push(best);
      }
      const xs = [], ys = [];
      for (const m of byCell.values()){
        if (m.size < 2) continue;
        const meds = [...m.values()].map(median);
        for (const v of meds){ xs.push(Math.min(...meds)); ys.push(v); }
      }
      linePlot("disagreePlot", [
        {type:"scatter", x:xs, y:ys, mode:"markers",
         marker:{color:cssv("--laser"), size:6, opacity:.6},
         name:"one mounting at a shared cell",
         hovertemplate:"%{y:.1f} Hz<extra></extra>"},
        {type:"scatter", x:[275,300], y:[275,300], mode:"lines",
         line:{color:cssv("--muted"), width:1, dash:"dot"}, name:"they agree"},
      ], {xtitle:"lowest fundamental at that cell (Hz)",
          ytitle:"each mounting's fundamental (Hz)", hovermode:"closest"});
      $("disagreeCap").innerHTML =
        `The four mountings share the x = 0 and y = 0 strips on purpose. At `+
        `the <b>${rep.n}</b> cells more than one of them visited, they agree `+
        `to <b>${rep.med.toFixed(1)} Hz</b> in the median and `+
        `<b>${rep.worst.toFixed(1)} Hz</b> at worst. That is what makes it `+
        `legitimate to glue four mountings into one map.`;
    }
  }

  /* ------------------------------------------------------------- build up */
  function build(){
    $("placeboNote").textContent = DATA.method.placebo.note;

    $("floorSlider").oninput = (e) => {
      S.floorDb = +e.target.value;
      drawFloor(Math.max(2, Scrolly.active("ch-floor")));
    };
    $("contrastSlider").oninput = (e) => {
      S.touched = true;
      S.bandHz = +e.target.value;
      drawContrast(Math.max(1, Scrolly.active("ch-contrast")));
    };
    $("floorSlider").value = K().floor_db;
    $("contrastSlider").value = DATA.campaign.modes[1].hz;

    Scrolly.register("ch-branch", drawBranch);
    Scrolly.register("ch-floor", drawFloor);
    Scrolly.register("ch-valley", drawValley);
    Scrolly.register("ch-contrast", drawContrast);
    Scrolly.register("ch-placebo", drawPlacebo);
    Scrolly.register("ch-disagree", drawDisagree);

    /* Every threshold on one line, so a reader can check the page against the
       source without hunting for them. */
    const k = K();
    $("constTable").innerHTML =
      `<table><thead><tr><th class="l">rule</th><th class="l">setting</th>`+
      `</tr></thead><tbody>` + [
        ["despike", `Hampel, window ${k.hampel_window}, ${k.hampel_nsig} sigma`],
        ["high pass", `${k.hp_fc_hz} Hz Butterworth order ${k.hp_order}, zero phase`],
        ["spectral gate", `${k.gate_nstd} sigma, ${k.gate_reduce_db} dB, display only`],
        ["mode search band", `${k.mode_fmin_hz} to ${k.mode_fmax_hz} Hz`],
        ["peak must clear the floor by", `${k.floor_db} dB over a ${k.cfar_window_hz} Hz local median`],
        ["two peaks are two modes if", `${k.min_sep_hz} Hz apart and a ${k.valley_db} dB dip between them`],
        ["mains", `notched ${k.notch_half_hz} Hz wide, up to ${k.mains_max_hz} Hz`],
        ["mode map band", `${k.band_half_bw_hz} Hz half width`],
        ["spatial contrast bar", `${k.contrast_min}, or ${k.contrast_min_pinned} if pinned across mountings`],
        ["placebo", `${k.placebo_min_db} dB over its own null, window ${k.placebo_tol_pct}%`],
        ["decay", `least squares over ${k.decay_span_db[0]} to ${k.decay_span_db[1]} dB, extrapolated to 60`],
        ["decay cross-check", `two estimates within ${(k.xcheck_tol*100).toFixed(0)}%`],
      ].map(([a,b])=>`<tr><td class="l">${a}</td><td class="l">${b}</td></tr>`)
       .join("") + `</tbody></table>`;
  }

  function enter(){ Scrolly.reset(); }
  function redraw(){
    drawBranch(Math.max(0, Scrolly.active("ch-branch")));
    drawFloor(Math.max(0, Scrolly.active("ch-floor")));
    drawValley(Math.max(0, Scrolly.active("ch-valley")));
    drawContrast(Math.max(0, Scrolly.active("ch-contrast")));
    drawPlacebo(Math.max(0, Scrolly.active("ch-placebo")));
    drawDisagree(Math.max(0, Scrolly.active("ch-disagree")));
  }

  return {build, enter, redraw};
})();
