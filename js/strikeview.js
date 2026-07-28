"use strict";
/* ===========================================================================
   The per-strike measurement view: click a row in the Data part and get the
   same five panels the bench figure draws.

   NOTHING here is computed. Every series was produced by drumlab itself at
   export time, by the same calls `views.plot_strike_master` draws from
   (`dsp.strike_metrics` for the branches, the envelope, the Schroeder EDC and
   its fit; `views.mains_trend`; `scipy.signal.welch`; `scipy.signal.spectrogram`,
   all at the same settings). This file decodes and plots. That is deliberate:
   a second implementation in JavaScript would drift from the bench figure and
   nobody would notice which one was wrong.

   One file per strike, about 31 kB, fetched the first time it is asked for and
   then kept. A reader who never opens a strike never downloads one.
   =========================================================================== */

const StrikeView = (() => {
  const cache = new Map();
  let pending = null;

  const i16 = (b64) => {
    const s = atob(b64), n = s.length >> 1, a = new Int16Array(n);
    for (let k = 0; k < n; k++)
      a[k] = (s.charCodeAt(2*k) | (s.charCodeAt(2*k+1) << 8)) << 16 >> 16;
    return a;
  };
  const u8 = (b64) => {
    const s = atob(b64), a = new Uint8Array(s.length);
    for (let k = 0; k < s.length; k++) a[k] = s.charCodeAt(k);
    return a;
  };

  /* The bench figure's colours, kept so the two are recognisably the same
     picture. They are fixed hues rather than theme variables for that reason;
     only the grid and the ink around them follow the theme. */
  const C = {raw:"#b5b5b5", trend:"#9467bd", clean:"#1f77b4", env:"#d62728",
             onset:"#2ca02c", bounce:"#ff7f0e", fit:"#d62728"};
  /* magma, the matplotlib map the bench spectrogram uses. Perceptually uniform
     and monotone in lightness, so it survives the no-rainbow rule. */
  const MAGMA = [[0,"#000004"],[0.2,"#2c115f"],[0.4,"#721f81"],
                 [0.6,"#b73779"],[0.8,"#f1605d"],[0.9,"#feaf77"],[1,"#fcfdbf"]];

  function tAxis(d){
    const t = new Float64Array(d.n);
    for (let k = 0; k < d.n; k++) t[k] = (k - d.pre) / d.fs * 1000;
    return t;
  }
  const toMv = (a, mv) => Array.from(a, v => v * mv);

  /* ------------------------------------------------------------- waveform */
  function drawWave(d, r){
    const t = tAxis(d), mv = d.mv_per_count;
    const raw = i16(d.w.raw), env = i16(d.w.env);
    const traces = [
      {type:"scatter", x:t, y:toMv(raw, mv), mode:"lines", name:"raw",
       line:{color:C.raw, width:0.7}, hoverinfo:"skip"},
      {type:"scatter", x:t, y:toMv(i16(d.w.trend), mv), mode:"lines",
       name:"trend (1 cycle avg)", line:{color:C.trend, width:1.2},
       hoverinfo:"skip"},
      {type:"scatter", x:t, y:toMv(i16(d.w.disp), mv), mode:"lines",
       name:"clean (display)", line:{color:C.clean, width:1},
       hovertemplate:"%{x:.1f} ms<br><b>%{y:.0f}</b> mV<extra></extra>"},
      {type:"scatter", x:t, y:toMv(env, mv), mode:"lines",
       name:"envelope (metrics)", line:{color:C.env, width:1}, opacity:.8,
       hoverinfo:"skip"},
      {type:"scatter", x:t, y:toMv(env, -mv), mode:"lines", showlegend:false,
       line:{color:C.env, width:1}, opacity:.8, hoverinfo:"skip"},
      {type:"scatter", x:[t[d.marks.peak]], y:[raw[d.marks.peak]*mv],
       mode:"markers", name:"peak", showlegend:false,
       marker:{color:C.clean, size:8, line:{color:cssv("--ink"), width:1}},
       hovertemplate:"peak<extra></extra>"},
    ];
    if (d.clip.idx.length) traces.push({type:"scatter",
      x:d.clip.idx.map(i=>t[i]), y:d.clip.idx.map(i=>raw[i]*mv),
      mode:"markers", marker:{color:C.bounce, size:3},
      name:`clipped (${d.clip.n})`,
      hovertemplate:"at the rail<extra></extra>"});

    const shapes = [], ann = [];
    const vline = (i, col, dash, label) => {
      if (i === null || i === undefined || i >= d.n) return;
      shapes.push({type:"line", x0:t[i], x1:t[i], yref:"paper", y0:0, y1:1,
        line:{color:col, width:1.1, dash}});
      /* along the BOTTOM: the legend owns the top of this panel and the two
         collided there. */
      ann.push({x:t[i], y:0, yref:"paper", yanchor:"top", yshift:-2,
        text:label, showarrow:false,
        font:{family:MONO, size:10, color:col}});
    };
    vline(d.marks.onset, C.onset, "dash", "onset");
    vline(d.marks.offset, C.onset, "dot", "settled");
    vline(d.marks.bounce, C.bounce, "dash", "2nd hit");
    if (d.clip.clipped) ann.push({x:1, y:0.04, xref:"paper", yref:"paper",
      xanchor:"right", showarrow:false,
      text:`<b>CLIPPED ${d.clip.rail_ms.toFixed(1)} ms at the rail, `+
           `peak and pp are LOWER bounds</b>`,
      font:{family:MONO, size:10.5, color:C.env}});

    linePlot("svWave", traces, {
      xtitle:"time (ms), t = 0 at the trigger",
      ytitle:"signal (mV from baseline)",
      xaxis:{range:[t[0], t[d.n-1]]}, shapes, annotations:ann,
      hovermode:"x", toolbar:true});
  }

  /* ---------------------------------------------------------------- decay */
  function drawDecay(d){
    const env = i16(d.w.env), i0 = d.marks.decay;
    const traces = [], ann = [];
    let epk = 1e-9;
    for (let k = i0; k < env.length; k++) epk = Math.max(epk, env[k]);
    const ex = [], ey = [];
    for (let k = i0; k < env.length; k++){
      ex.push((k - i0) / d.fs * 1000);
      ey.push(20 * Math.log10(Math.max(env[k], 1e-9) / epk));
    }
    traces.push({type:"scatter", x:ex, y:ey, mode:"lines", name:"envelope",
      line:{color:C.raw, width:0.9}, hoverinfo:"skip"});

    const dec = d.decay;
    if (dec.edc_db){
      const e = i16(dec.edc_db), x = [], y = [];
      for (let k = 0; k < e.length; k++){
        x.push(dec.edc_t0_ms + k * dec.edc_dt_ms);
        y.push(e[k] / 100);
      }
      traces.push({type:"scatter", x, y, mode:"lines", name:"Schroeder EDC",
        line:{color:C.clean, width:1.8},
        hovertemplate:"%{x:.0f} ms<br><b>%{y:.1f}</b> dB<extra></extra>"});
    }
    if (dec.slope_db_s !== undefined && dec.slope_db_s !== null){
      const [lo, hi] = dec.span_db;
      const t1 = (lo - dec.icpt_db) / dec.slope_db_s;
      const t2 = (hi - dec.icpt_db) / dec.slope_db_s;
      traces.push({type:"scatter", x:[t1*1000, t2*1000],
        y:[dec.slope_db_s*t1 + dec.icpt_db, dec.slope_db_s*t2 + dec.icpt_db],
        mode:"lines", name:`fit ${lo} to ${hi} dB`,
        line:{color:C.fit, width:2, dash:"dash"}, hoverinfo:"skip"});
      let box = `T60 ${dec.T60_ms.toFixed(0)} ms   tau `+
                `${dec.tau_ms.toFixed(0)} ms   r\u00b2 ${dec.r2.toFixed(3)}`;
      if (dec.edc_truncated) box += "<br>EDC cut at the noise floor";
      if (dec.logenv_T60_ms !== null){
        const ag = dec.agree;
        box += `<br>log envelope T60 ${dec.logenv_T60_ms.toFixed(0)} ms`;
        if (ag !== null) box += `   \u0394 ${(ag*100).toFixed(0)}% `+
          (ag < DATA.method.constants.xcheck_tol ? "OK" : "multi-mode?");
      }
      ann.push({x:0.03, y:0.04, xref:"paper", yref:"paper", xanchor:"left",
        yanchor:"bottom", text:box, showarrow:false, align:"left",
        font:{family:MONO, size:10, color:cssv("--ink")},
        bgcolor:cssv("--panel"), bordercolor:cssv("--line"), borderwidth:1,
        borderpad:5});
    } else {
      ann.push({x:0.5, y:0.5, xref:"paper", yref:"paper", showarrow:false,
        text:"the ring-down outlives the window<br>(under 20 dB of decay to fit)",
        font:{family:MONO, size:11, color:cssv("--muted")}});
    }
    linePlot("svDecay", traces, {
      xtitle:"ms after the decay starts (post-clip peak)",
      ytitle:"level (dB re peak)", yaxis:{range:[-65, 4]},
      shapes:[], annotations:ann, hovermode:"x", toolbar:true});
  }

  /* ------------------------------------------------------------- spectrum */
  function drawSpec(d){
    const s = d.spec, traces = [], ann = [], shapes = [];
    if (s){
      const x = Array.from({length:s.n}, (_,k)=>s.f0 + k*s.df);
      for (const [key, col, name, w] of [["raw", C.raw, "raw", 0.9],
                                         ["disp", C.clean, "clean (display)", 1.4]]){
        if (!s[key]) continue;
        const v = i16(s[key]);
        traces.push({type:"scatter", x, mode:"lines", name,
          y:Array.from(v, q => Math.pow(10, (q/50)/20)),
          line:{color:col, width:w},
          hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b><extra></extra>"});
      }
    }
    (d.modes || []).forEach((m, j) => {
      shapes.push({type:"line", x0:m.f_hz, x1:m.f_hz, yref:"paper", y0:0, y1:1,
        line:{color:C.fit, width:1, dash:"dot"}, opacity:.75});
      ann.push({x:m.f_hz, y:1, yref:"paper", yanchor:"top",
        text:` ${m.f_hz.toFixed(0)}`, showarrow:false, xanchor:"left",
        yshift:-8 - 13*j, font:{family:MONO, size:10.5, color:C.fit}});
    });
    linePlot("svSpec", traces, {
      xtitle:"frequency (Hz)", ytitle:"amplitude (a.u.)",
      yaxis:{type:"log", dtick:1}, xaxis:{range:[0, 1000]},
      shapes, annotations:ann, toolbar:true});
  }

  /* ---------------------------------------------------------- spectrogram */
  function drawGram(d, into, bare){
    const div = into || "svGram";
    const g = d.gram;
    if (!g){ Plotly.purge(div); return; }
    const q = u8(g.z), z = [];
    for (let i = 0; i < g.nf; i++){
      const row = new Array(g.nt);
      for (let j = 0; j < g.nt; j++)
        row[j] = g.floor_db + (q[i*g.nt + j] / 255) * (-g.floor_db);
      z.push(row);
    }
    const x = Array.from({length:g.nt}, (_,j)=>g.t0_ms + j*(g.dt_ms||1));
    const y = Array.from({length:g.nf}, (_,i)=>g.f0 + i*g.df);
    Plotly.react(div, [{
      type:"heatmap", x, y, z, colorscale:MAGMA, zmin:g.floor_db, zmax:0,
      zsmooth:"best",
      showscale: !bare,
      colorbar:{title:{text:"dB re max", side:"right", font:{size:10}},
        thickness:10, len:0.9, outlinewidth:0, tickfont:{size:9},
        tickcolor:cssv("--baseline"), ticklen:3},
      hovertemplate:"%{x:.0f} ms &nbsp; %{y:.0f} Hz<br><b>%{z:.0f}</b> dB"+
        "<extra></extra>",
    }], baseLayout({
      margin:{l:52, r:12, t:28, b:58},
      xaxis:{title:{text: bare ? "" : "time (ms)", font:{size:11}, standoff:6},
        zeroline:false, showgrid:false, linecolor:cssv("--baseline"),
        ticks:"outside", ticklen:3, tickcolor:cssv("--baseline"),
        range:[x[0], x[x.length-1]]},
      yaxis:{title:{text: bare ? "" : "Hz", font:{size:11}, standoff:8},
        zeroline:false, showgrid:false, linecolor:cssv("--baseline"),
        ticks:"outside", ticklen:3, tickcolor:cssv("--baseline"),
        range:[0, y[y.length-1]]},
      margin: bare ? {l:34, r:6, t:22, b:32} : undefined,
    }, boxOf($(div))), CFG_BARE);
    settle(div);
  }

  /* --------------------------------------------------------------- radar */
  function drawRadar(d){
    const a = DATA.campaign.membrane.a_mm;
    const traces = [
      {type:"scatter", x:[d.aim.x], y:[d.aim.y], mode:"markers",
       name:"struck here",
       marker:{symbol:"circle-cross-open", size:16, color:C.env,
               line:{width:2.2}},
       hovertemplate:`struck (${d.aim.x}, ${d.aim.y}) mm<br>`+
         `r/a ${d.aim.r_over_a}<extra></extra>`},
      {type:"scatter", x:[d.sensor.x], y:[d.sensor.y], mode:"markers",
       name:"sensor",
       marker:{size:15, color:cssv("--laser"), opacity:.55,
               line:{color:cssv("--laser"), width:2}},
       hovertemplate:`sensor (${d.sensor.x}, ${d.sensor.y}) mm<extra></extra>`},
    ];
    const lim = a + 2.5;
    Plotly.react("svRadar", traces, baseLayout({
      showlegend:true,
      legend:{orientation:"h", y:1.12, x:0, font:{size:10},
              bgcolor:"rgba(0,0,0,0)"},
      margin:{l:44, r:10, t:44, b:44},
      xaxis:{range:[-lim,lim], zeroline:false, showgrid:false,
        constrain:"domain", linecolor:cssv("--baseline"), ticks:"outside",
        ticklen:3, tickcolor:cssv("--baseline"),
        title:{text:"x (mm)", font:{size:10.5}, standoff:6}},
      yaxis:{range:[-lim,lim], zeroline:false, showgrid:false, scaleanchor:"x",
        constrain:"domain", linecolor:cssv("--baseline"), ticks:"outside",
        ticklen:3, tickcolor:cssv("--baseline"),
        title:{text:"y (mm)", font:{size:10.5}, standoff:4}},
      shapes:drumShapes(),
    }, boxOf($("svRadar"))), CFG_BARE);
    settle("svRadar");
  }

  /* --------------------------------------------------------------- driver */
  function render(d, r, i){
    drawWave(d, r);
    drawDecay(d);
    drawSpec(d);
    drawGram(d, "svGram", false);
    drawRadar(d);
    $("svNote").innerHTML =
      `Display branch: <b>${(d.steps_d || []).join(" &rarr; ") || "raw"}</b>. `+
      `Every number comes from the despike and high pass branch only, never `+
      `from the gated one. These panels are drawn from series drumlab computed, `+
      `not recomputed here.`;
  }

  function show(i){
    const r = DATA.strikes[i];
    if (!r) return;
    $("svPanels").classList.add("hidden");
    $("svBoot").classList.remove("hidden");
    $("svBoot").textContent = "loading this strike…";
    const done = (d) => {
      if (pending !== i) return;            // the reader clicked on already
      cache.set(i, d);
      $("svBoot").classList.add("hidden");
      $("svPanels").classList.remove("hidden");
      render(d, r, i);
    };
    pending = i;
    if (cache.has(i)){ done(cache.get(i)); return; }
    fetch(`data/strikes/${i}.json`)
      .then(res => { if (!res.ok) throw new Error(String(res.status));
                     return res.json(); })
      .then(done)
      .catch(err => {
        if (pending !== i) return;
        $("svBoot").textContent =
          `could not load this strike (${err.message})`;
      });
  }

  function clear(){
    pending = null;
    $("svPanels").classList.add("hidden");
    $("svBoot").classList.add("hidden");
  }

  /* ============================================================ one cell
     Click a square on any map of the membrane and get every strike that
     landed there, each as its own spectrogram. Three hits at one cell look
     alike when they agree and obviously different when they do not, which is
     the whole reason the campaign fires more than once per cell.

     One file per strike, so a cell with six hits costs six fetches. They run
     together and the card fills in as they land. */
  const fetchStrike = (i) => cache.has(i)
    ? Promise.resolve(cache.get(i))
    : fetch(`data/strikes/${i}.json`)
        .then(r => { if (!r.ok) throw new Error(String(r.status));
                     return r.json(); })
        .then(d => { cache.set(i, d); return d; });

  let cellToken = 0;

  function showCell(x, y, idxs){
    const token = ++cellToken;
    const card = $("cellCard"), host = $("cellGrid");
    card.classList.remove("hidden");
    $("cellTitle").textContent = `The cell at (${x}, ${y}) mm`;
    if (!idxs.length){
      $("cellSub").textContent = "No strike here passes the filters above.";
      host.innerHTML = "";
      return;
    }
    const r0 = DATA.strikes[idxs[0]];
    $("cellSub").innerHTML = `<b>${idxs.length}</b> strike`+
      (idxs.length === 1 ? "" : "s") + ` at r/a ${r0.r_over_a}, one `+
      `spectrogram each, in the order they were struck. Click one for its `+
      `full measurement view.`;

    host.innerHTML = idxs.map(i => {
      const r = DATA.strikes[i];
      const v = r.jam ? ["no","jam"] : (r.used ? ["ok","used"] : ["no","rejected"]);
      return `<figure class="cellitem" data-i="${i}">
        <div class="plot cellgram" id="cg_${i}"></div>
        <figcaption>
          <b>${r.mount.replace("mount","M")} &middot; strike ${r.strike}</b>
          <span class="pill ${v[0]}"><span>${v[1]}</span></span>
          ${r.clipped ? '<span class="pill no"><span>clipped</span></span>' : ""}
          <br>S${r.station} &middot; pp ${r.pp_mv} mV &middot; T60 ${r.T60_ms} ms
          &middot; ${(r.modes_hz||[]).slice(0,2).map(f=>f.toFixed(0)+" Hz")
                       .join(" / ") || "no mode picked"}
        </figcaption>
      </figure>`;
    }).join("");

    idxs.forEach(i => {
      fetchStrike(i)
        .then(d => { if (token === cellToken) drawGram(d, `cg_${i}`, true); })
        .catch(() => {
          if (token !== cellToken) return;
          const el = $(`cg_${i}`);
          if (el) el.innerHTML = `<p class="sub">could not load</p>`;
        });
    });

    host.onclick = (e) => {
      const f = e.target.closest(".cellitem");
      if (!f) return;
      const i = +f.dataset.i;
      Data.selectStrike(i);
    };
    card.scrollIntoView({behavior:"smooth", block:"start"});
  }

  function clearCell(){
    cellToken++;
    $("cellCard").classList.add("hidden");
    $("cellGrid").innerHTML = "";
  }

  function redraw(){
    if (pending !== null && cache.has(pending))
      render(cache.get(pending), DATA.strikes[pending], pending);
  }

  return {show, clear, redraw, showCell, clearCell};
})();
