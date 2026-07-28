"use strict";
/* ===========================================================================
   One strike: the five panels the bench figure draws, and the sound it made.

   The Data part picks the strike; this file owns everything that then happens
   to it. The player (an AudioContext, the scope canvas and the playhead) lives
   here because the buffer it plays is the same decoded record the vibration
   panel plots, and decoding it twice would be silly.

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
  function drawWave(d, into, bare){
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

    linePlot(into || "svWave", traces, {
      xtitle: bare ? "" : "time (ms), t = 0 at the trigger",
      ytitle: bare ? "" : "signal (mV from baseline)",
      xaxis:{range:[t[0], t[d.n-1]]}, shapes, annotations: bare ? [] : ann,
      legend: !bare, hovermode:"x", toolbar: !bare,
      margin: bare ? {l:38, r:8, t:10, b:30} : undefined});
  }

  /* ---------------------------------------------------------------- decay */
  function drawDecay(d, into, bare){
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
    linePlot(into || "svDecay", traces, {
      xtitle: bare ? "" : "ms after the decay starts (post-clip peak)",
      ytitle: bare ? "" : "level (dB re peak)", yaxis:{range:[-65, 4]},
      shapes:[], annotations: bare ? [] : ann, legend: !bare,
      hovermode:"x", toolbar: !bare,
      margin: bare ? {l:38, r:8, t:10, b:30} : undefined});
  }

  /* ------------------------------------------------------------- spectrum */
  function drawSpec(d, into, bare){
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
    linePlot(into || "svSpec", traces, {
      xtitle: bare ? "" : "frequency (Hz)",
      ytitle: bare ? "" : "amplitude (a.u.)",
      yaxis:{type:"log", dtick:1, showticklabels: !bare},
      xaxis:{range:[0, 1000]}, legend: !bare,
      shapes, annotations: bare ? [] : ann, toolbar: !bare,
      margin: bare ? {l:34, r:8, t:10, b:30} : undefined});
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

  /* ---------------------------------------------------------------- sound
     The pickup samples at 8 kHz and the membrane rings between 270 and 520 Hz,
     so the record already IS an audible waveform. The buffer here is the same
     raw counts the vibration panel draws, played at the rate they were taken.
     Nothing is resampled and nothing is filtered: the reader hears the branch
     the metrics were never taken from, mains hum and all, because that is what
     the sensor saw. Half speed is offered as an explicit choice and it drops
     the pitch an octave, which the caption says.

     Each clip is normalised to its own peak, the same way `spectra.json` is,
     for the same reason: a soft strike would otherwise be inaudible next to a
     railed one. Loudness in the ear carries no information about how hard the
     drum was struck, and the caption says so.

     300 ms is a blip, so the reader gets three ways to hold on to it: the hit
     list plays one strike per click, "hear every hit here" chains the lot, and
     the scope under the button sweeps a playhead across the waveform while the
     sound runs. Seeing the ring-down go quiet as it goes quiet is the point. */
  let actx = null, node = null, rate = 1, chain = 0;
  let playIdx = null, raf = 0, tStart = 0, tDur = 0;

  function ctx(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    /* Built on the click, never before it: browsers refuse an AudioContext
       that no gesture asked for. */
    if (!actx) actx = new AC();
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  function audioBuffer(d, ac){
    const raw = i16(d.w.raw), n = raw.length;
    let pk = 0;
    for (let k = 0; k < n; k++) pk = Math.max(pk, Math.abs(raw[k]));
    const g = pk ? 0.9 / pk : 0;
    /* 3 ms of taper at both ends. The record is a window cut out of a longer
       signal and the cut would click. It costs the first and last 24 samples,
       well outside the onset and the decay span the fit uses. */
    const ramp = Math.min(Math.round(0.003 * d.fs), n >> 1) || 1;
    const buf = ac.createBuffer(1, n, d.fs);
    const ch = buf.getChannelData(0);
    for (let k = 0; k < n; k++){
      let a = raw[k] * g;
      if (k < ramp) a *= k / ramp;
      else if (k >= n - ramp) a *= (n - 1 - k) / ramp;
      ch[k] = a;
    }
    return buf;
  }

  /* The one place that tells the page what the sound is doing. Data owns the
     button and the hit rows, so it hands over a listener instead of this file
     reaching across into markup it does not own. */
  const fire = (i, on) => { if (api.onState) api.onState(i, on); };

  /* Silence what is playing. `halt` leaves the queue alone, because starting
     the next clip of a chain goes through here; `stop` is the reader saying
     enough, and it drops the queue too. Keeping those apart is what stops
     "hear every hit" from cancelling itself on its own second clip. */
  function halt(){
    if (raf){ cancelAnimationFrame(raf); raf = 0; }
    const was = playIdx;
    playIdx = null;
    if (node){
      const n = node;
      node = null;                  // before stop(), so onended is a no-op
      try { n.stop(); } catch (e) {}
    }
    scope.prog = 1;
    drawScope();
    if (was !== null) fire(was, false);
  }
  function stop(){ chain++; halt(); }

  function sweep(){
    if (playIdx === null || !actx){ raf = 0; return; }
    const el = (actx.currentTime - tStart) / tDur;
    scope.prog = Math.max(0, Math.min(1, el));
    drawScope();
    raf = scope.prog < 1 ? requestAnimationFrame(sweep) : 0;
  }

  /* Resolves when the clip has finished, so playAll can chain on it. */
  function start(i, d){
    const ac = ctx();
    if (!ac) return Promise.resolve(false);
    halt();
    const token = chain;
    const src = ac.createBufferSource();
    src.buffer = audioBuffer(d, ac);
    src.playbackRate.value = rate;
    src.connect(ac.destination);
    scope.i = i; scope.d = d; scope.prog = 0;
    node = src; playIdx = i;
    tStart = ac.currentTime; tDur = (d.n / d.fs) / rate;
    fire(i, true);
    raf = requestAnimationFrame(sweep);
    return new Promise(res => {
      src.onended = () => {
        if (node !== src) { res(false); return; }
        node = null; playIdx = null;
        if (raf){ cancelAnimationFrame(raf); raf = 0; }
        scope.prog = 1;
        drawScope();
        fire(i, false);
        res(token === chain);
      };
      src.start();
    });
  }

  /* ctx() runs here, synchronously inside the click that asked for sound. Put
     it after the fetch and Safari sees an AudioContext built by a promise
     callback with no gesture behind it, and refuses to make a noise. */
  function play(i){
    if (playIdx === i){ stop(); return Promise.resolve(false); }
    stop();
    if (!ctx()) return Promise.resolve(false);
    return fetchStrike(i).then(d => start(i, d)).catch(() => false);
  }

  /* Every hit at the cell, in order, with a gap between them. The gap is what
     makes two hits comparable by ear: back to back they run together. */
  function playAll(idxs){
    stop();
    if (!ctx()) return;
    const token = chain;
    const step = (k) => {
      if (k >= idxs.length || token !== chain) return;
      const i = idxs[k];
      if (api.onAdvance) api.onAdvance(i);
      fetchStrike(i)
        .then(d => (token === chain ? start(i, d) : false))
        .then(ok => { if (ok) setTimeout(() => step(k+1), 240); })
        .catch(() => {});
    };
    step(0);
  }

  function setRate(r){
    const was = playIdx;
    rate = r;
    /* The caption carries the octave warning, so it has to be rewritten even
       when the speed changes with nothing playing. */
    if (pending !== null && cache.has(pending)) playNote(cache.get(pending));
    if (was !== null){ stop(); play(was); }
  }

  /* ---------------------------------------------------------------- scope
     The waveform under the play button, on a canvas rather than in Plotly:
     it redraws on every animation frame while a clip runs, and a Plotly
     relayout at 60 Hz is not free. Played samples are inked, the rest waits
     in grey. */
  const scope = {i:null, d:null, prog:1, obs:null};

  function drawScope(){
    const cv = $("exScope");
    if (!cv || !cv.parentNode) return;
    const W = cv.parentNode.clientWidth, H = cv.parentNode.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W*dpr) || cv.height !== Math.round(H*dpr)){
      cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
    }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const mid = Math.round(H/2) + 0.5;
    g.strokeStyle = cssv("--baseline"); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();

    const d = scope.d;
    if (!d) return;
    const raw = i16(d.w.raw), n = raw.length;
    let pk = 1;
    for (let k = 0; k < n; k++) pk = Math.max(pk, Math.abs(raw[k]));
    const sy = (H/2 - 5) / pk;
    const head = Math.round(W * scope.prog);
    /* One column per pixel, drawn from the min and max of the samples that
       land in it. Anything smoother would hide the clipped flat tops. */
    const span = (x0, x1, col) => {
      if (x1 <= x0) return;
      g.fillStyle = col;
      for (let x = x0; x < x1; x++){
        const a = Math.floor(x*n/W), b = Math.max(a+1, Math.floor((x+1)*n/W));
        let lo = Infinity, hi = -Infinity;
        for (let k = a; k < b && k < n; k++){
          if (raw[k] < lo) lo = raw[k];
          if (raw[k] > hi) hi = raw[k];
        }
        if (lo === Infinity) continue;
        const y = mid - hi*sy;
        g.fillRect(x, y, 1, Math.max(1.2, (hi-lo)*sy));
      }
    };
    span(0, head, cssv("--series1"));
    span(head, W, cssv("--muted"));

    if (d.clip.idx && d.clip.idx.length){
      g.fillStyle = cssv("--amber");
      const seen = new Set();
      for (const k of d.clip.idx){
        const x = Math.floor(k*W/n);
        if (seen.has(x)) continue;
        seen.add(x);
        g.fillRect(x, 0, 1, 4);
      }
    }
    if (scope.prog < 1){
      g.strokeStyle = cssv("--strike"); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(head+0.5, 2); g.lineTo(head+0.5, H-2); g.stroke();
    }
  }

  /* The canvas has no intrinsic size, so it is redrawn from the box it sits
     in whenever that box changes. Registered once, on the first draw. */
  function watchScope(){
    const cv = $("exScope");
    if (!cv || scope.obs || typeof ResizeObserver === "undefined") return;
    scope.obs = new ResizeObserver(() => drawScope());
    scope.obs.observe(cv.parentNode);
  }

  /* --------------------------------------------------------------- driver */
  function render(d, r, i){
    drawWave(d, "svWave", false);
    drawDecay(d, "svDecay", false);
    drawSpec(d, "svSpec", false);
    drawGram(d, "svGram", false);
    drawRadar(d);
    $("svNote").innerHTML =
      `Display branch: <b>${(d.steps_d || []).join(" &rarr; ") || "raw"}</b>. `+
      `Every number comes from the despike and high pass branch only, never `+
      `from the gated one. These panels are drawn from series drumlab computed, `+
      `not recomputed here.`;
    $("svNote").classList.remove("hidden");
  }

  /* The caption under the player. It is written from the strike in hand, so a
     clipped record says out loud that the distortion in your ear is the
     amplifier and not the drum. */
  function playNote(d){
    const el = $("exPlayNote");
    if (!el) return;
    el.innerHTML =
      `${(d.n / d.fs * 1000).toFixed(0)} ms of the raw pickup, played at the `+
      `${(d.fs/1000).toFixed(0)}&nbsp;kHz it was sampled at. Nothing is `+
      `filtered, so the mains hum is in there too. Every clip is normalised to `+
      `its own peak, which means how loud it sounds says nothing about how hard `+
      `the head was struck.` +
      (rate !== 1 ? ` Half speed puts the pitch an octave down.` : ``) +
      (d.clip.clipped ? ` <b>This one railed the amplifier, and the flattened `+
        `top is audible as distortion.</b>` : ``);
  }

  function show(i){
    const r = DATA.strikes[i];
    if (!r) return;
    watchScope();
    $("svPanels").classList.add("hidden");
    $("svNote").classList.add("hidden");
    $("svBoot").classList.remove("hidden");
    $("svBoot").textContent = "loading this strike…";
    const done = (d) => {
      if (pending !== i) return;            // the reader clicked on already
      cache.set(i, d);
      $("svBoot").classList.add("hidden");
      $("svPanels").classList.remove("hidden");
      /* Only the scope of a strike nobody is listening to gets replaced: the
         waveform under the playhead has to stay the one making the noise. */
      if (playIdx === null){
        scope.i = i; scope.d = d; scope.prog = 1;
        drawScope();
      }
      playNote(d);
      const tag = $("exScopeTag");
      if (tag) tag.textContent =
        `${(d.n/d.fs*1000).toFixed(0)} ms  ${(d.fs/1000).toFixed(0)} kHz`;
      render(d, r, i);
    };
    pending = i;
    if (cache.has(i)){ done(cache.get(i)); return; }
    fetchStrike(i)
      .then(done)
      .catch(err => {
        if (pending !== i) return;
        $("svBoot").textContent =
          `could not load this strike (${err.message})`;
      });
  }

  function clear(){
    pending = null;
    stop();
    scope.i = null; scope.d = null; scope.prog = 1;
    drawScope();
    const tag = $("exScopeTag");
    if (tag) tag.textContent = "";
    $("exPlayNote").innerHTML = "";
    $("svPanels").classList.add("hidden");
    $("svNote").classList.add("hidden");
    $("svBoot").classList.add("hidden");
  }

  /* ============================================================ one cell
     Opened by the compare button under a cell: every hit that landed there,
     each with its own four panels. Three hits at one cell look alike when they
     agree and obviously different when they do not, which is the whole reason
     the campaign fires more than once per cell.

     One file per strike, so a cell with six hits costs six fetches. They run
     together and the card fills in as they land. Off by default, because the
     shared strips carry 19 hits and that is 76 plots nobody asked for. */
  /* Clicking a hit row selects it AND plays it, which asks for the same file
     twice within a millisecond of itself. In-flight requests are shared, so
     that is one fetch. */
  const inflight = new Map();
  const fetchStrike = (i) => {
    if (cache.has(i)) return Promise.resolve(cache.get(i));
    if (inflight.has(i)) return inflight.get(i);
    const p = fetch(`data/strikes/${i}.json`)
      .then(r => { if (!r.ok) throw new Error(String(r.status));
                   return r.json(); })
      .then(d => { cache.set(i, d); inflight.delete(i); return d; })
      .catch(e => { inflight.delete(i); throw e; });
    inflight.set(i, p);
    return p;
  };

  let cellToken = 0;
  let cellObs = null;

  /* Each strike at the cell gets the SAME four panels the bench figure draws:
     the vibration, the decay with its fit, the ring-down spectrum and the
     spectrogram. Twelve strikes at the centre cell is 48 plots, so a row is
     drawn only when it comes near the viewport and never again. */
  const CELL_PANELS = [
    ["wave",  "vibration",   (d, id) => drawWave(d, id, true)],
    ["decay", "decay",       (d, id) => drawDecay(d, id, true)],
    ["spec",  "spectrum",    (d, id) => drawSpec(d, id, true)],
    ["gram",  "spectrogram", (d, id) => drawGram(d, id, true)],
  ];

  function gallery(x, y, idxs){
    const token = ++cellToken;
    const card = $("cellCard"), host = $("cellGrid");
    if (cellObs){ cellObs.disconnect(); cellObs = null; }
    card.classList.remove("hidden");
    $("cellTitle").textContent = `Every hit at (${x}, ${y}) mm, side by side`;
    if (!idxs.length){
      $("cellSub").textContent = "No hit here passes the filters.";
      host.innerHTML = "";
      return;
    }
    const r0 = DATA.strikes[idxs[0]];
    $("cellSub").innerHTML = `<b>${idxs.length}</b> hit`+
      (idxs.length === 1 ? "" : "s") + ` at r/a ${r0.r_over_a.toFixed(2)}, in `+
      `the order `+
      `they were struck. Every panel the bench figure draws, for each one. `+
      `Click a row to put that hit in the player above.`;

    host.innerHTML = idxs.map(i => {
      const r = DATA.strikes[i];
      const v = r.jam ? ["no","jam"] : (r.used ? ["ok","used"] : ["no","rejected"]);
      return `<section class="cellrow" data-i="${i}">
        <header>
          <b>${r.mount.replace("mount","M")} &middot; strike ${r.strike}</b>
          <span class="pill ${v[0]}"><span>${v[1]}</span></span>
          ${r.clipped ? '<span class="pill no"><span>clipped</span></span>' : ""}
          <span class="cellmeta">S${r.station} &middot; pp ${r.pp_mv} mV
            &middot; T60 ${r.T60_ms} ms &middot; r&sup2; ${r.decay_r2}
            &middot; ${(r.modes_hz||[]).slice(0,3).map(f=>f.toFixed(0)+" Hz")
                         .join(" / ") || "no mode picked"}</span>
        </header>
        <div class="cellpanels">` +
        CELL_PANELS.map(([k, title]) =>
          `<figure><figcaption>${title}</figcaption>
             <div class="plot cellplot" id="cp_${k}_${i}"></div></figure>`).join("") +
        `</div>
      </section>`;
    }).join("");

    /* Draw a row when it is about to be seen, once. */
    const draw = (el) => {
      if (el.dataset.drawn) return;
      el.dataset.drawn = "1";
      const i = +el.dataset.i;
      fetchStrike(i).then(d => {
        if (token !== cellToken) return;
        for (const [k, , fn] of CELL_PANELS) fn(d, `cp_${k}_${i}`);
      }).catch(() => {
        if (token !== cellToken) return;
        el.querySelector(".cellpanels").innerHTML =
          `<p class="sub">could not load this strike</p>`;
      });
    };
    const rows = [...host.querySelectorAll(".cellrow")];
    if (typeof IntersectionObserver === "undefined"){
      rows.forEach(draw);
    } else {
      cellObs = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) draw(e.target);
      }, {rootMargin: "300px 0px"});
      rows.forEach(el => cellObs.observe(el));
    }

    host.onclick = (e) => {
      const row = e.target.closest(".cellrow");
      if (!row) return;
      Data.selectStrike(+row.dataset.i);
    };
    card.scrollIntoView({behavior:"smooth", block:"start"});
  }

  function clearGallery(){
    cellToken++;
    if (cellObs){ cellObs.disconnect(); cellObs = null; }
    $("cellCard").classList.add("hidden");
    $("cellGrid").innerHTML = "";
  }

  function redraw(){
    drawScope();
    if (pending !== null && cache.has(pending))
      render(cache.get(pending), DATA.strikes[pending], pending);
  }

  const api = {show, clear, redraw, gallery, clearGallery,
               play, playAll, stop, setRate,
               playing: () => playIdx,
               rate: () => rate,
               /* Data sets these: onState paints the button and the row that
                  is sounding, onAdvance follows a chain from hit to hit. */
               onState: null, onAdvance: null};
  return api;
})();
