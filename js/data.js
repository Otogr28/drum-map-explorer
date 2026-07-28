"use strict";
/* ===========================================================================
   The Data part.

   Rebuilt 2026-07-28. The first version opened on six rows of filter chips
   above three tabs of plots, and every reader had to work out what a mounting
   and a sensor station were before the page would tell them anything. This one
   opens on the drum: the membrane IS the control. Click a place on the head,
   get the hits that landed there, hear them, then read the panels.

   Four views, each with one job:

     Explore   the head, the hits at the cell you picked, and the player
     Maps      the poster's three per-cell heatmaps, live
     Peaks     the median ring-down spectrum and a band map
     Table     every strike as a sortable row

   The filters did not go away, they folded into one line. Aggregation still
   runs through core.js (`cellsOf`, `bandCells`), so these maps and the Poster
   part's maps cannot drift apart.
   =========================================================================== */

const Data = (() => {

/* ===================================================================== state
   Everything a reader can change lives here and round-trips through the URL
   hash, so any view of this dataset is a link somebody can send. */
const S = {
  view:"explore",
  mounts:new Set(), stations:new Set(),
  verdict:new Set(["used"]),       // poster default: the good strikes only
  clip:"all",
  raMin:0, raMax:1,
  metric:"poster",                 // Maps view
  emetric:"pp",                    // Explore view: the poster's own map first
  mode:1,                          // index into campaign.modes
  bandC:null, bandW:12,
  cell:null,                       // {x, y} in mm, the picked cell
  strike:null,
  sort:{key:"i", dir:1},
  mapTable:false,
};
const VIEWS = ["explore","maps","modes","strikes"];

function writeHash(){
  const c = DATA.campaign;
  const p = new URLSearchParams();
  p.set("part", "data");
  p.set("v", S.view);
  if (S.mounts.size !== c.mounts.length) p.set("m",[...S.mounts].join(","));
  if (S.stations.size !== c.stations_used.length) p.set("s",[...S.stations].join(","));
  if (S.verdict.size !== 1 || !S.verdict.has("used")) p.set("u",[...S.verdict].join(","));
  if (S.clip !== "all") p.set("c", S.clip);
  if (S.raMin > 0 || S.raMax < 1) p.set("ra", `${S.raMin},${S.raMax}`);
  if (S.metric !== "poster") p.set("k", S.metric);
  if (S.emetric !== "pp") p.set("ek", S.emetric);
  if (S.mode !== 1) p.set("p", String(S.mode));
  if (S.bandW !== 12) p.set("bw", String(S.bandW));
  if (S.bandC !== null) p.set("bc", String(S.bandC));
  if (S.cell) p.set("q", `${S.cell.x},${S.cell.y}`);
  if (S.strike !== null) p.set("x", String(S.strike));
  history.replaceState(null,"", "#"+p.toString());
}
function readHash(){
  const c = DATA.campaign;
  const p = new URLSearchParams(location.hash.slice(1));
  const list = (k, fb, cast) => p.has(k)
    ? new Set(p.get(k).split(",").filter(Boolean).map(cast))
    : new Set(fb);
  /* `map` was the old name of the Maps view. Links printed or sent before the
     rebuild still have to land somewhere sensible. */
  const v = p.get("v") === "map" ? "maps" : p.get("v");
  S.view     = VIEWS.includes(v) ? v : "explore";
  S.mounts   = list("m", c.mounts.map(m=>"mount"+m.mount), String);
  S.stations = list("s", c.stations_used, Number);
  S.verdict  = list("u", ["used"], String);
  S.clip     = ["all","yes","no"].includes(p.get("c")) ? p.get("c") : "all";
  if (p.has("ra")){
    const [a,b] = p.get("ra").split(",").map(Number);
    if (isFinite(a)) S.raMin = a;
    if (isFinite(b)) S.raMax = b;
  }
  if (p.has("k")) S.metric = p.get("k");
  if (p.has("ek") && METRICS[p.get("ek")]) S.emetric = p.get("ek");
  if (p.has("p")) S.mode = Math.max(0, Math.min(c.modes.length-1, +p.get("p")||0));
  if (p.has("bw")) S.bandW = Math.max(2, Math.min(60, +p.get("bw")||12));
  S.bandC = p.has("bc") ? +p.get("bc") : null;
  S.strike = p.has("x") ? +p.get("x") : null;
  S.cell = null;
  if (p.has("q")){
    const [x,y] = p.get("q").split(",").map(Number);
    if (isFinite(x) && isFinite(y)) S.cell = {x, y};
  }
  /* A link to one strike carries the cell it landed on, so the drum opens
     already pointing at it. */
  if (!S.cell && S.strike !== null && DATA.strikes[S.strike]){
    const r = DATA.strikes[S.strike];
    S.cell = {x:r.x, y:r.y};
  }
}

/* ================================================================= filtering
   Rejected strikes and jams are never dropped from the dataset; they are
   filtered like anything else, and the default just happens to be the same
   selection the poster figure uses. */
function passes(r){
  if (!S.mounts.has(r.mount)) return false;
  if (r.station !== null && !S.stations.has(r.station)) return false;
  const v = r.jam ? "jam" : (r.used ? "used" : "rejected");
  if (!S.verdict.has(v)) return false;
  if (S.clip === "yes" && !r.clipped) return false;
  if (S.clip === "no" && r.clipped) return false;
  const ra = r.r_over_a;
  if (ra === null || ra < S.raMin - 1e-9 || ra > S.raMax + 1e-9) return false;
  return true;
}
function selection(){
  const out = [];
  DATA.strikes.forEach((r,i)=>{ if (passes(r)) out.push(i); });
  return out;
}

const METRICS = {
  hits: {title:"Hits per cell", unit:"hits", hue:"aqua", get:()=>1,
         count:true, clipped:true},
  pp:   {title:"Amplitude", unit:"mV",  hue:"blue",   get:r=>r.pp_mv, clipped:true},
  t60:  {title:"Decay T60", unit:"ms",  hue:"orange", get:r=>r.T60_ms},
  mode1:{title:"Dominant mode", unit:"Hz", hue:"aqua",
         get:r=>(r.modes_hz && r.modes_hz.length ? r.modes_hz[0] : null)},
  snr:  {title:"Signal to noise", unit:"dB", hue:"blue", get:r=>r.snr_db},
  r2:   {title:"Decay fit quality", unit:"r²", hue:"orange", get:r=>r.decay_r2},
};
/* "hits" is a count, not an average, so it takes the tally cellsOf already
   keeps rather than the mean of a value. */
function accOf(k, idxs){
  const M = METRICS[k], acc = cellsOf(idxs, M.get);
  if (M.count) for (const e of acc.values()) e.mean = e.n;
  return acc;
}

/* ==================================================================== explore
   The membrane as an index: one entry per cell that has a hit in the current
   selection, holding the hits in the order they were struck. */
let _cells = new Map();
const ckey = (x,y) => `${x}|${y}`;

function cellIndex(idxs){
  const m = new Map();
  for (const i of idxs){
    const r = DATA.strikes[i], k = ckey(r.x, r.y);
    let e = m.get(k);
    if (!e){ e = {x:r.x, y:r.y, list:[]}; m.set(k, e); }
    e.list.push(i);
  }
  return m;
}

/* Which hit to open on, and which cell it drags with it.

   "The first one struck" was the old answer and it sounded bad. The centre of
   the head rings hardest, so every hit there railed the amplifier: 18 of the
   101 cells have nothing but railed records, and opening on the centre meant
   the first thing anybody heard was distortion the drum never made.

   Rank instead: kept over rejected, clean over railed, least time at the rail
   among the railed, then the best signal to noise. On this campaign that opens
   on a 4.2 V hit at r/a 0.80 with a 430 ms ring-down, which is what the head
   actually sounds like. */
function rankHits(list){
  return list.slice().sort((a,b)=>{
    const A = DATA.strikes[a], B = DATA.strikes[b];
    const good = r => (r.used && !r.jam) ? 0 : 1;
    if (good(A) !== good(B)) return good(A) - good(B);
    if (A.clipped !== B.clipped) return A.clipped ? 1 : -1;
    const ra = A.rail_ms || 0, rb = B.rail_ms || 0;
    if (ra !== rb) return ra - rb;
    const sa = A.snr_db === null ? -1e9 : A.snr_db;
    const sb = B.snr_db === null ? -1e9 : B.snr_db;
    return sb - sa;
  });
}
const bestHit = (list) => list.length ? rankHits(list)[0] : null;

function defaultCell(idxs){
  const i = bestHit(idxs);
  if (i === null) return null;
  const r = DATA.strikes[i];
  return {x:r.x, y:r.y};
}

function drawExplore(idxs){
  _cells = cellIndex(idxs);
  if (!S.cell || !_cells.has(ckey(S.cell.x, S.cell.y))) S.cell = defaultCell(idxs);
  const e = S.cell ? _cells.get(ckey(S.cell.x, S.cell.y)) : null;
  const list = e ? e.list : [];
  if (S.strike === null || list.indexOf(S.strike) < 0) S.strike = bestHit(list);

  const M = METRICS[S.emetric];
  heatmap("exMap", accOf(S.emetric, idxs), {
    title:M.title, unit:M.unit, hue:M.hue, clipped:M.clipped,
    mark:S.cell});
  wireCellClick("exMap", false);

  if (!e){
    $("exTitle").textContent = "Pick a cell";
    $("exSub").textContent = "Click a square on the head.";
    $("exHits").innerHTML = "";
    $("exPlay").disabled = true;
    $("exAll").disabled = true;
    $("exCompare").classList.add("hidden");
    clearDetail();
    return;
  }

  const r0 = DATA.strikes[list[0]];
  const nclip = list.filter(i=>DATA.strikes[i].clipped).length;
  const mounts = [...new Set(list.map(i=>DATA.strikes[i].mount))].length;
  $("exTitle").textContent = `The cell at (${e.x}, ${e.y}) mm`;
  $("exSub").innerHTML = `<b>${list.length}</b> hit`+
    (list.length === 1 ? "" : "s") + ` here, at r/a ${r0.r_over_a.toFixed(2)}`+
    (mounts > 1 ? `, from ${mounts} mountings` : ``) + `, in the order they `+
    `were struck. ` +
    (nclip ? `<b>${nclip}</b> railed the amplifier. ` : ``) +
    (list.length > 1 ? `The cleanest one is picked for you.` : ``);
  renderHits(list);
  $("exPlay").disabled = S.strike === null;
  $("exAll").disabled = list.length < 2;
  $("exCompare").classList.toggle("hidden", list.length < 2);
  $("exCompare").textContent = `compare all ${list.length} hits at this cell`;
  if (S.strike !== null) showStrike(S.strike, idxs); else clearDetail();
}

function renderHits(list){
  $("exHits").innerHTML = list.length ? list.map(i=>{
    const r = DATA.strikes[i];
    const v = r.jam ? ["no","jam"] : (r.used ? ["ok","used"] : ["no","rejected"]);
    return `<button type="button" class="hit" data-i="${i}" `+
      `aria-pressed="${S.strike === i}">`+
      `<span class="hp" aria-hidden="true">&#9654;</span>`+
      `<b>${r.mount.replace("mount","M")} &middot; #${r.strike}</b>`+
      `<span class="pill ${v[0]}"><span>${v[1]}</span></span>`+
      (r.clipped ? `<span class="pill no"><span>clipped</span></span>` : ``)+
      `<span class="hitmeta">S${r.station} &middot; ${r.pp_mv} mV `+
      `&middot; T60 ${r.T60_ms} ms</span></button>`;
  }).join("") : `<p class="emptyhits">No hit at this cell passes the `+
    `filters.</p>`;
  /* The list keeps the order the hits were struck and the cleanest one is
     rarely the first, so at a cell with twelve of them the selected row can
     open below the fold of its own scroll box. Bring it up, without moving
     the page under the reader. */
  const host = $("exHits"), sel = host.querySelector('.hit[aria-pressed="true"]');
  if (sel){
    const top = sel.offsetTop - host.offsetTop;
    if (top < host.scrollTop ||
        top + sel.offsetHeight > host.scrollTop + host.clientHeight)
      host.scrollTop = Math.max(0, top - 8);
  }
}

/* The panels are 31 kB a strike and a redraw of five plots, so they are only
   asked for when the selected strike actually changed. A filter tweak or a
   theme flip must not refetch. */
let _shown = null;
function showStrike(i, idxs){
  const r = DATA.strikes[i];
  const v = r.jam ? "a jam" : (r.used ? "kept by the operator"
                                      : "REJECTED by the operator");
  $("strikeTitle").textContent =
    `${r.mount.replace("mount","Mounting ")} · strike ${r.strike} at `+
    `(${r.x}, ${r.y}) mm`;
  $("strikeSub").innerHTML = `r/a ${r.r_over_a} · sensor station `+
    `${r.station} at (${r.sensor_x}, ${r.sensor_y}) mm · pp ${r.pp_mv} mV`+
    (r.clipped ? ` <b>(clipped: lower bound)</b>` : ``) +
    ` · T60 ${r.T60_ms} ms (r² ${r.decay_r2}) · ${v}.`;
  if (_shown !== i){ StrikeView.show(i); _shown = i; }
  drawStrikeSpec(i, idxs);
  $("svSpecBlock").classList.remove("hidden");
}

function clearDetail(){
  _shown = null;
  StrikeView.clear();
  StrikeView.clearGallery();
  $("strikeTitle").textContent = "Pick a hit";
  $("strikeSub").textContent = "Click a square on the head.";
  $("svSpecBlock").classList.add("hidden");
  Plotly.purge("strikePlot");
}

/* This hit's exported tail spectrum against the median of everything the
   filters keep. The mode maps integrate exactly this curve. */
function drawStrikeSpec(i, idxs){
  const f = freqAxis(), sc = DATA.spectra.amp_scale;
  const med = medianSpectrum(idxs);
  const traces = [];
  if (med) traces.push({type:"scatter", x:f, y:med, mode:"lines",
    name:"median of the selection", line:{color:cssv("--series1"), width:2},
    hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b><extra></extra>"});
  if (specOf(i)) traces.push({type:"scatter", x:f,
    y:Array.from(specOf(i), v=>v/sc), mode:"lines",
    name:"this hit", line:{color:cssv("--series2"), width:1.8},
    hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b><extra></extra>"});
  linePlot("strikePlot", traces, {xtitle:"frequency (Hz)",
    ytitle:"ring-down amplitude (rel.)", toolbar:true,
    yaxis:{type:"log", showticklabels:false}});
}

/* ------------------------------------------------------------- selection */
function selectCell(x, y, jump){
  S.cell = {x, y};
  S.strike = null;                 // the first hit at the new cell takes over
  StrikeView.stop();
  StrikeView.clearGallery();
  if (jump) S.view = "explore";
  render();
  const card = $("exMapCard");
  if (card) card.focus({preventScroll:true});
  if (jump) $("view-explore").scrollIntoView({behavior:"smooth", block:"start"});
}

/* The gallery and the table hand a strike back here, so the whole part agrees
   on which one is selected: the drum points at its cell, the hit row lights
   up, the hash carries it and the panels draw. */
function selectStrike(i){
  const r = DATA.strikes[i];
  if (!r) return;
  S.cell = {x:r.x, y:r.y};
  S.strike = i;
  S.view = "explore";
  StrikeView.stop();
  render();
  const el = $("exTitle");
  if (el) el.scrollIntoView({behavior:"smooth", block:"center"});
}

function selectHit(i, play){
  S.strike = i;
  render();
  if (play) StrikeView.play(i);
}

/* Arrow keys walk the grid, and they skip cells with nothing in them, so the
   reader crosses the head rather than falling into a gap the filters made. */
function moveCell(dx, dy){
  if (!S.cell) return;
  const g = grid();
  const ix = g.ix.get(S.cell.x), iy = g.iy.get(S.cell.y);
  if (ix === undefined || iy === undefined) return;
  const n = Math.max(g.xs.length, g.ys.length);
  for (let s = 1; s <= n; s++){
    const nx = ix + dx*s, ny = iy + dy*s;
    if (nx < 0 || ny < 0 || nx >= g.xs.length || ny >= g.ys.length) return;
    const k = ckey(g.xs[nx], g.ys[ny]);
    if (_cells.has(k)){ selectCell(g.xs[nx], g.ys[ny], false); return; }
  }
}

/* -------------------------------------------------------------- the maps */
function drawMap(idxs){
  const keys = S.metric === "poster" ? ["pp","t60","mode1"] : [S.metric];
  const host = $("mapPlots");
  host.innerHTML = "";
  /* Append EVERY panel before plotting any of them. Plotly sizes a plot from
     the div's width at draw time, and in an auto-fit grid the first child is
     briefly the full row wide: plotting inside the append loop drew panel 1
     at 1180 px and then let CSS clip it. */
  const divs = keys.map(k => {
    const d = document.createElement("div");
    d.className = "plot" + (keys.length === 1 ? " tall" : "");
    d.id = "map_" + k;
    host.appendChild(d);
    return d;
  });
  keys.forEach((k,i)=>{
    heatmap(divs[i].id, accOf(k, idxs), METRICS[k]);
    wireCellClick(divs[i].id, true);
  });
  const acc = accOf(keys[0], idxs);
  const nclip = [...acc.values()].filter(e=>e.clip).length;
  $("mapNote").innerHTML = `<b>${acc.size}</b> of the campaign's `+
    `${DATA.campaign.counts.cells} cells are in this slice`+
    (nclip ? `, and <b>${nclip}</b> of them contain a strike that railed the `+
      `amplifier, so their amplitude is a censored <b>lower bound</b>, `+
      `not a measurement.` : `. None of them clipped.`);
  drawMapTable(idxs, keys);
}

/* The table-view twin: every number the colour carries, in text. */
function drawMapTable(idxs, keys){
  if (!S.mapTable){ $("mapTable").classList.add("hidden"); return; }
  const accs = keys.map(k=>accOf(k, idxs));
  const cells = new Map();
  accs.forEach((acc,j)=>{ for (const [k,e] of acc){
    let row = cells.get(k);
    if (!row){ row = {x:e.x, y:e.y, n:e.n, clip:e.clip, v:[]}; cells.set(k,row); }
    row.v[j] = e.mean;
  }});
  const rows = [...cells.values()].sort((a,b)=>a.y-b.y || a.x-b.x);
  const head = `<tr><th class="l">x (mm)</th><th>y (mm)</th><th>strikes</th>`+
    keys.map(k=>`<th>${METRICS[k].title} (${METRICS[k].unit})</th>`).join("")+
    `<th>clipped</th></tr>`;
  const body = rows.map(r=>`<tr><td class="l">${r.x.toFixed(1)}</td>`+
    `<td>${r.y.toFixed(1)}</td><td>${r.n}</td>`+
    keys.map((_,j)=>`<td>${r.v[j]===undefined?"":fmt(r.v[j])}</td>`).join("")+
    `<td class="pill ${r.clip?"no":"ok"}"><span>${r.clip?"yes":"no"}</span></td></tr>`
  ).join("");
  $("mapTable").innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  $("mapTable").classList.remove("hidden");
}

/* ------------------------------------------------------------------ peaks */
function drawModes(idxs){
  const med = medianSpectrum(idxs);
  const f = freqAxis();
  const traces = [];
  if (med){
    traces.push({type:"scatter", x:f, y:med, mode:"lines",
      name:"median of the selection", line:{color:cssv("--series1"), width:2},
      hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b> (rel.)<extra></extra>"});
  }
  const sel = S.strike !== null && specOf(S.strike);
  if (sel){
    const r = DATA.strikes[S.strike], sc = DATA.spectra.amp_scale;
    traces.push({type:"scatter", x:f, y:Array.from(specOf(S.strike), v=>v/sc),
      mode:"lines", name:`strike ${r.mount} #${r.strike} at (${r.x}, ${r.y})`,
      line:{color:cssv("--series2"), width:1.6},
      hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b> (rel.)<extra></extra>"});
  }
  const ann = [];
  if (med) DATA.campaign.modes.forEach((m,i)=>{
    const k = Math.round((m.hz - DATA.spectra.f0)/DATA.spectra.df);
    if (k < 0 || k >= med.length) return;
    const elec = m.kind === "electrical";
    ann.push({x:m.hz, y:Math.log10(Math.max(med[k],1e-4)), xref:"x", yref:"y",
      text:`<b>${m.hz.toFixed(0)} Hz</b>` + (elec ? "<br>electrical" : ""),
      showarrow:true, arrowhead:0, arrowwidth:1, arrowcolor:cssv("--baseline"),
      ax:0, ay:i===2 ? -46 : -26,
      font:{family:MONO, size:elec?10.5:12.5, color:elec?cssv("--muted"):cssv("--ink")},
      bgcolor:cssv("--panel"), bordercolor:"rgba(0,0,0,0)", borderpad:2});
  });
  linePlot("specPlot", traces, {xtitle:"frequency (Hz)",
    ytitle:"ring-down amplitude (rel.)", toolbar:true,
    yaxis:{type:"log", showticklabels:false}, annotations:ann});
  drawBand(idxs);
}

function drawBand(idxs){
  const m = DATA.campaign.modes[S.mode];
  const fc = S.bandC === null ? m.hz : S.bandC;
  const half = S.bandW;
  const acc = normalised(bandCells(idxs, fc, half));
  heatmap("bandPlot", acc, {title:`${fc.toFixed(0)} Hz band`,
    unit:"rel.", hue:"blue"});
  wireCellClick("bandPlot", true);
  const elec = m.kind === "electrical";
  $("bandTitle").textContent = `Where the ${fc.toFixed(0)} Hz content sits on the head`;
  $("bandSub").innerHTML = `Mean tail amplitude in ${fc.toFixed(0)} &plusmn; `+
    `${half} Hz per cell, each map scaled to its own maximum. `+
    (elec ? `This line is <b>electrical pickup</b>, not the drum.`
          : `A real membrane mode has nodes, places where the map goes `+
            `dark no matter how hard you hit them.`);
  $("bandNote").innerHTML = `This is the <b>simple</b> band map: the mean of `+
    `|F| over the band, per cell. The poster's figure uses the masked rank-1 `+
    `factorisation, which additionally glues the three sensor stations onto `+
    `one scale. The two agree in shape; they do not agree in absolute scale, `+
    `and this one will look noisier wherever one station dominates a cell.`;
}

/* ------------------------------------------------------------------ table */
/* Verdict and clipped sit EARLY, because they are the honesty columns and the
   table is the one thing here wide enough to scroll sideways: the reader must
   never have to go looking for "was this hit any good". The modes list is last
   for the same reason: it is the column that may fall off the edge. */
const COLS = [
  {k:"i",      t:"#",        l:true, get:(r,i)=>i+1},
  {k:"mount",  t:"mounting", l:true, get:r=>r.mount.replace("mount","M")},
  {k:"verdict",t:"verdict",  l:true, pill:true,
   get:r=>r.jam ? "jam" : (r.used ? "used" : "rejected"),
   ok:r=>r.used && !r.jam},
  {k:"clipped",t:"clipped",  l:true, pill:true,
   get:r=>r.clipped ? "yes" : "no", ok:r=>!r.clipped},
  {k:"x",      t:"x (mm)",   get:r=>r.x},
  {k:"y",      t:"y (mm)",   get:r=>r.y},
  {k:"r_over_a", t:"r/a",    get:r=>r.r_over_a, d:3},
  {k:"station", t:"station", get:r=>r.station},
  {k:"strike", t:"strike",   get:r=>r.strike},
  {k:"pp_mv",  t:"pp (mV)",  get:r=>r.pp_mv, d:1},
  {k:"peak_mv",t:"peak (mV)",get:r=>r.peak_mv, d:1},
  {k:"snr_db", t:"SNR (dB)", get:r=>r.snr_db, d:1},
  {k:"T60_ms", t:"T60 (ms)", get:r=>r.T60_ms, d:1},
  {k:"decay_r2", t:"r²", get:r=>r.decay_r2, d:3},
  {k:"modes",  t:"modes (Hz)", l:true,
   get:r=>(r.modes_hz||[]).map(v=>v.toFixed(0)).join(" / ")},
];

function drawStrikes(idxs){
  const rows = idxs.slice();
  const c = COLS.find(c=>c.k === S.sort.key) || COLS[0];
  rows.sort((a,b)=>{
    const va = c.get(DATA.strikes[a], a), vb = c.get(DATA.strikes[b], b);
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va > vb ? 1 : va < vb ? -1 : 0) * S.sort.dir;
  });
  const head = `<tr>` + COLS.map(col=>{
    const on = col.k === S.sort.key;
    return `<th class="${col.l?"l":""}" data-sort="${col.k}">${col.t}`+
      (on ? (S.sort.dir>0 ? " ↑" : " ↓") : "") + `</th>`;
  }).join("") + `</tr>`;
  const body = rows.map(i=>{
    const r = DATA.strikes[i];
    return `<tr data-i="${i}" aria-selected="${S.strike===i}">` + COLS.map(col=>{
      let val = col.get(r, i);
      if (col.pill)
        return `<td class="l pill ${col.ok(r)?"ok":"no"}"><span>${val}</span></td>`;
      if (typeof val === "number" && col.d !== undefined) val = val.toFixed(col.d);
      return `<td class="${col.l?"l":""}">${val===null||val===undefined?"":val}</td>`;
    }).join("") + `</tr>`;
  }).join("");
  $("strikeTable").innerHTML =
    `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/* A square on ANY map of the membrane picks that cell. From Maps or Peaks it
   also carries the reader to Explore, where the hits are. The handler is
   re-attached after each draw because Plotly.react replaces the node's event
   bindings. */
function wireCellClick(divId, jump){
  const el = $(divId);
  if (!el || !el.on) return;
  el.removeAllListeners && el.removeAllListeners("plotly_click");
  el.on("plotly_click", (ev) => {
    const pt = ev.points && ev.points[0];
    if (!pt) return;
    selectCell(+pt.x, +pt.y, jump);
  });
}

/* ==================================================================== chips */
function chips(host, items, isOn, onClick, cls){
  host.innerHTML = "";
  for (const it of items){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (cls ? " " + (it.cls || cls) : "");
    b.textContent = it.label;
    if (it.title) b.title = it.title;
    b.setAttribute("aria-pressed", String(isOn(it)));
    b.onclick = () => { onClick(it); render(); };
    host.appendChild(b);
  }
}

function buildFilters(){
  const c = DATA.campaign;
  chips($("fMount"), c.mounts.map(m=>({
      id:"mount"+m.mount, label:"M"+m.mount, title:m.label})),
    it=>S.mounts.has(it.id),
    it=>{ toggle(S.mounts, it.id, c.mounts.map(m=>"mount"+m.mount)); });
  chips($("fStation"), c.stations_used.map(s=>{
      const st = c.stations[s-1] || {};
      return {id:s, label:"S"+s,
        title:`sensor at (${st.x}, ${st.y}) mm, r/a ${st.r_over_a}`};
    }),
    it=>S.stations.has(it.id),
    it=>{ toggle(S.stations, it.id, c.stations_used); });
  chips($("fVerdict"), [
      {id:"used", label:"used", cls:"good", title:"the operator kept this hit"},
      {id:"rejected", label:"rejected", cls:"bad",
       title:"saved but rejected at the bench: shown, never hidden"},
      {id:"jam", label:"jam", cls:"bad", title:"the plunger stuck"},
    ], it=>S.verdict.has(it.id),
    it=>{ toggle(S.verdict, it.id, ["used","rejected","jam"]); }, "x");
  chips($("fClip"), [
      {id:"all", label:"all"}, {id:"no", label:"clean"},
      {id:"yes", label:"clipped", title:"the amplifier railed: amplitude is a lower bound"},
    ], it=>S.clip === it.id, it=>{ S.clip = it.id; });
  chips($("fMetric"), [
      {id:"poster", label:"poster trio"},
      {id:"pp", label:"amplitude"}, {id:"t60", label:"T60"},
      {id:"mode1", label:"dominant mode"}, {id:"snr", label:"SNR"},
      {id:"r2", label:"decay r²"},
    ], it=>S.metric === it.id, it=>{ S.metric = it.id; });
  chips($("exMetric"), [
      {id:"hits", label:"hits", title:"how many strikes landed on each cell"},
      {id:"pp", label:"amplitude"}, {id:"t60", label:"T60"},
      {id:"mode1", label:"dominant mode"},
    ], it=>S.emetric === it.id, it=>{ S.emetric = it.id; });
  chips($("exRate"), [
      {id:1, label:"1×", title:"the rate the pickup sampled at"},
      {id:0.5, label:"½×", title:"half speed, one octave down"},
    ], it=>StrikeView.rate() === it.id, it=>{ StrikeView.setRate(it.id); });
  chips($("fMode"), c.modes.map((m,i)=>({id:i,
      label:`${m.hz.toFixed(0)} Hz`, title:`${m.label}: ${m.note}`})),
    it=>S.mode === it.id, it=>{ S.mode = it.id; S.bandC = null;
      $("bandC").value = c.modes[it.id].hz.toFixed(0); });
}
/* A filter with nothing selected shows nothing, which reads as a broken page.
   Clearing the last chip therefore restores the full set. */
function toggle(set, id, all){
  if (set.has(id)) set.delete(id); else set.add(id);
  if (!set.size) all.forEach(v=>set.add(v));
}

/* The one line the filter bar shows when it is closed. A reader who never
   opens the panel still knows what is being counted. */
function filterSummary(){
  const c = DATA.campaign, out = [];
  const v = [...S.verdict];
  out.push(S.verdict.size === 1 && S.verdict.has("used")
    ? "strikes the operator kept" : "verdict: " + v.join(", "));
  out.push(S.mounts.size === c.mounts.length ? "all mountings"
    : [...S.mounts].map(m=>m.replace("mount","M")).sort().join(" "));
  out.push(S.stations.size === c.stations_used.length ? "all stations"
    : [...S.stations].map(s=>"S"+s).sort().join(" "));
  if (S.clip === "yes") out.push("clipped only");
  if (S.clip === "no") out.push("clean only");
  if (S.raMin > 0 || S.raMax < 1)
    out.push(`r/a ${S.raMin.toFixed(2)} to ${S.raMax.toFixed(2)}`);
  return out.join(" · ");
}

function buildStats(){
  const c = DATA.campaign, k = c.counts;
  const rows = [
    [k.strikes, "strikes"], [k.used, "kept"], [k.cells, "cells"],
    [k.mounts, "mountings"], [c.stations_used.length, "sensor stations"],
    [c.anchor_hz.toFixed(0)+" Hz", "fundamental"],
  ];
  $("stats").innerHTML = rows.map(([v,l])=>
    `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
  $("honesty").innerHTML = `<b>How to read this honestly</b><ul>`+
    c.honesty.map(h=>`<li>${h}</li>`).join("") +
    `<li>Campaign <code>${c.run}</code>, measured ${c.date}. `+
    `Membrane: ${c.membrane.diameter_mm} mm ${c.membrane.material}, `+
    `${c.membrane.note}.</li></ul>`;
}

/* =================================================================== render */
function render(){
  if (SITE.part !== "data") return;
  const idxs = selection();
  $("fCount").innerHTML = `<b>${idxs.length}</b> / ${DATA.strikes.length}`+
    `<span class="wide"> strikes</span>`;
  $("fSum").textContent = filterSummary();
  $("raOut").textContent = `${S.raMin.toFixed(2)} – ${S.raMax.toFixed(2)}`;
  $("bandGroup").classList.toggle("hidden", S.view !== "modes");
  for (const v of VIEWS){
    $("view-"+v).classList.toggle("hidden", v !== S.view);
    $("tab-"+v).setAttribute("aria-selected", String(v === S.view));
  }
  buildFilters();
  $("mapTableBtn").textContent = S.mapTable ? "hide table" : "table view";
  if (!idxs.length){
    _cells = new Map();
    $("mapPlots").innerHTML = `<p class="sub">No strike matches these `+
      `filters. Widen the r/a range, or press reset.</p>`;
    ["exMap","specPlot","bandPlot","strikePlot"].forEach(id=>Plotly.purge(id));
    $("strikeTable").innerHTML = "";
    $("mapNote").innerHTML = "";
    $("mapTable").classList.add("hidden");
    $("mapLegend").classList.add("hidden");
    $("exTitle").textContent = "Nothing selected";
    $("exSub").textContent = "No strike matches these filters. "+
      "Open the filters and widen them, or press reset.";
    $("exHits").innerHTML = "";
    $("exPlay").disabled = true;
    $("exAll").disabled = true;
    $("exCompare").classList.add("hidden");
    clearDetail();
    writeHash();
    return;
  }
  $("mapLegend").classList.remove("hidden");
  if (S.view === "explore") drawExplore(idxs);
  if (S.view === "maps")    drawMap(idxs);
  if (S.view === "modes")   drawModes(idxs);
  if (S.view === "strikes") drawStrikes(idxs);
  /* Explore owns the cell, and the other views only read it, so the cell
     index has to exist even when Explore is not the one on screen: the
     table can send a strike here at any moment. */
  if (S.view !== "explore") _cells = cellIndex(idxs);
  writeHash();
}

/* ===================================================================== wire */
function wire(){
  document.querySelectorAll(".tab").forEach(t=>{
    t.onclick = () => { S.view = t.dataset.view; render(); };
  });
  $("fToggle").onclick = () => {
    const open = $("fPanel").classList.toggle("hidden") === false;
    $("fToggle").setAttribute("aria-expanded", String(open));
  };
  $("raMin").oninput = e => {
    S.raMin = Math.min(+e.target.value, S.raMax); e.target.value = S.raMin; render(); };
  $("raMax").oninput = e => {
    S.raMax = Math.max(+e.target.value, S.raMin); e.target.value = S.raMax; render(); };
  $("bandC").onchange = e => {
    const v = +e.target.value;
    S.bandC = isFinite(v) && v > 0 ? v : null; render(); };
  $("bandW").onchange = e => {
    S.bandW = Math.max(2, Math.min(60, +e.target.value || 12));
    e.target.value = S.bandW; render(); };
  $("mapTableBtn").onclick = () => { S.mapTable = !S.mapTable; render(); };
  $("reset").onclick = () => {
    location.hash = "part=data"; readHash(); syncInputs(); render(); };
  $("mapTable").onclick = (e) => {
    const th = e.target.closest("th[data-sort]");
    if (th){ S.sort = {key:th.dataset.sort, dir:1}; render(); }
  };
  $("strikeTable").onclick = (e) => {
    const th = e.target.closest("th[data-sort]");
    if (th){
      const k = th.dataset.sort;
      S.sort = {key:k, dir: S.sort.key === k ? -S.sort.dir : 1};
      render(); return;
    }
    const tr = e.target.closest("tr[data-i]");
    if (tr) selectStrike(+tr.dataset.i);
  };

  /* -------------------------------------------------------------- player */
  $("exHits").onclick = (e) => {
    const b = e.target.closest(".hit");
    if (b) selectHit(+b.dataset.i, true);
  };
  $("exPlay").onclick = () => { if (S.strike !== null) StrikeView.play(S.strike); };
  $("exAll").onclick = () => {
    const e = S.cell && _cells.get(ckey(S.cell.x, S.cell.y));
    if (e && e.list.length) StrikeView.playAll(e.list);
  };
  /* Clicking around the head is a one way trip otherwise: the cell you started
     on is not marked on the map any more and nobody remembers its
     coordinates. This walks back to the cell and the hit the page opens on,
     and leaves the filters alone. */
  $("exReset").onclick = () => {
    S.cell = null; S.strike = null;
    StrikeView.stop();
    StrikeView.clearGallery();
    render();
    $("exMapCard").focus({preventScroll:true});
  };
  $("exCompare").onclick = () => {
    const e = S.cell && _cells.get(ckey(S.cell.x, S.cell.y));
    if (e) StrikeView.gallery(e.x, e.y, e.list);
  };
  /* The button and the row that is sounding are painted from the player's own
     state, so a clip that ends on its own leaves nothing lit. */
  StrikeView.onState = (i, on) => {
    const b = $("exPlay");
    b.classList.toggle("on", on && i === S.strike);
    b.setAttribute("aria-label", on ? "stop" : "play this hit");
    document.querySelectorAll("#exHits .hit").forEach(el=>{
      el.classList.toggle("playing", on && +el.dataset.i === i);
    });
  };
  StrikeView.onAdvance = (i) => selectHit(i, false);

  /* Keys are bound to the map card, not to the window: a page that swallows
     the arrow keys and the space bar everywhere cannot be scrolled. */
  $("exMapCard").addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) return;
    if (e.key === " " || e.key === "Enter"){
      if (S.strike === null) return;
      e.preventDefault();
      StrikeView.play(S.strike);
      return;
    }
    const step = {ArrowLeft:[-1,0], ArrowRight:[1,0],
                  ArrowUp:[0,1], ArrowDown:[0,-1]}[e.key];
    if (!step) return;
    e.preventDefault();
    moveCell(step[0], step[1]);
  });
}
function syncInputs(){
  $("raMin").value = S.raMin; $("raMax").value = S.raMax;
  $("bandW").value = S.bandW;
  $("bandC").value = (S.bandC === null ? DATA.campaign.modes[S.mode].hz : S.bandC)
    .toFixed(0);
}

function build(){
  readHash();
  buildStats();
  wire();
  syncInputs();
}
function enter(){ render(); }

return {build, enter, render, selectStrike};
})();
