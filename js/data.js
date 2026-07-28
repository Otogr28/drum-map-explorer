"use strict";
/* ===========================================================================
   The Data part: the original explorer. Filters across the top, three views,
   every slice a link.

   Behaviour is unchanged from the first build of this site. What moved out is
   the machinery the other two parts also need (aggregation, spectra, the
   heatmap), which now lives in core.js so the Poster maps and these maps
   average identically.
   =========================================================================== */

const Data = (() => {

/* ===================================================================== state
   Everything a reader can change lives here and round-trips through the URL
   hash, so any view of this dataset is a link somebody can send. */
const S = {
  view:"map",
  mounts:new Set(), stations:new Set(),
  verdict:new Set(["used"]),       // poster default: the good strikes only
  clip:"all",
  raMin:0, raMax:1,
  metric:"poster",
  mode:1,                          // index into campaign.modes
  bandC:null, bandW:12,
  strike:null,
  sort:{key:"i", dir:1},
  mapTable:false,
};

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
  if (S.mode !== 1) p.set("p", String(S.mode));
  if (S.bandW !== 12) p.set("bw", String(S.bandW));
  if (S.bandC !== null) p.set("bc", String(S.bandC));
  if (S.strike !== null) p.set("x", String(S.strike));
  history.replaceState(null,"", "#"+p.toString());
}
function readHash(){
  const c = DATA.campaign;
  const p = new URLSearchParams(location.hash.slice(1));
  const list = (k, fb, cast) => p.has(k)
    ? new Set(p.get(k).split(",").filter(Boolean).map(cast))
    : new Set(fb);
  S.view     = ["map","modes","strikes"].includes(p.get("v")) ? p.get("v") : "map";
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
  if (p.has("p")) S.mode = Math.max(0, Math.min(c.modes.length-1, +p.get("p")||0));
  if (p.has("bw")) S.bandW = Math.max(2, Math.min(60, +p.get("bw")||12));
  S.bandC = p.has("bc") ? +p.get("bc") : null;
  S.strike = p.has("x") ? +p.get("x") : null;
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
  pp:   {title:"Amplitude", unit:"mV",  hue:"blue",   get:r=>r.pp_mv, clipped:true},
  t60:  {title:"Decay T60", unit:"ms",  hue:"orange", get:r=>r.T60_ms},
  mode1:{title:"Dominant mode", unit:"Hz", hue:"aqua",
         get:r=>(r.modes_hz && r.modes_hz.length ? r.modes_hz[0] : null)},
  snr:  {title:"Signal to noise", unit:"dB", hue:"blue", get:r=>r.snr_db},
  r2:   {title:"Decay fit quality", unit:"r²", hue:"orange", get:r=>r.decay_r2},
};

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
    heatmap(divs[i].id, cellsOf(idxs, METRICS[k].get), METRICS[k]);
    wireCellClick(divs[i].id, idxs);
  });
  const acc = cellsOf(idxs, METRICS[keys[0]].get);
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
  const accs = keys.map(k=>cellsOf(idxs, METRICS[k].get));
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

/* ------------------------------------------------------------------ modes */
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
  wireCellClick("bandPlot", idxs);
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

/* ---------------------------------------------------------------- strikes */
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
  drawStrikeSpec(idxs);
}

function drawStrikeSpec(idxs){
  if (S.strike === null || !DATA.strikes[S.strike]){
    $("strikeTitle").textContent = "Pick a strike";
    $("strikeSub").textContent = "Click any row above.";
    $("svNote").classList.add("hidden");
    StrikeView.clear();
    Plotly.purge("strikePlot");
    return;
  }
  /* The five measurement panels live in their own file, fetched on demand.
     31 kB per strike, so a reader who only reads the table pays nothing. */
  StrikeView.show(S.strike);
  $("svNote").classList.remove("hidden");
  const r = DATA.strikes[S.strike], f = freqAxis();
  const sc = DATA.spectra.amp_scale;
  const med = medianSpectrum(idxs);
  const traces = [];
  if (med) traces.push({type:"scatter", x:f, y:med, mode:"lines",
    name:"median of the selection", line:{color:cssv("--series1"), width:2},
    hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b><extra></extra>"});
  if (specOf(S.strike)) traces.push({type:"scatter", x:f,
    y:Array.from(specOf(S.strike), v=>v/sc), mode:"lines",
    name:"this strike", line:{color:cssv("--series2"), width:1.8},
    hovertemplate:"%{x:.0f} Hz<br><b>%{y:.3g}</b><extra></extra>"});
  linePlot("strikePlot", traces, {xtitle:"frequency (Hz)",
    ytitle:"ring-down amplitude (rel.)", toolbar:true,
    yaxis:{type:"log", showticklabels:false}});
  const v = r.jam ? "a jam" : (r.used ? "kept by the operator" : "REJECTED by the operator");
  $("strikeTitle").textContent =
    `${r.mount.replace("mount","Mounting ")} · strike ${r.strike} at (${r.x}, ${r.y}) mm`;
  $("strikeSub").innerHTML = `r/a ${r.r_over_a} · sensor station `+
    `${r.station} at (${r.sensor_x}, ${r.sensor_y}) mm · pp ${r.pp_mv} mV`+
    (r.clipped ? ` <b>(clipped: lower bound)</b>` : ``) +
    ` · T60 ${r.T60_ms} ms (r² ${r.decay_r2}) · ${v}.`;
}

/* The panels carry fixed hues from the bench figure, but their axes and boxes
   follow the theme, so a theme flip has to redraw them. */
function redrawStrikeView(){ StrikeView.redraw(); }

/* A square on any membrane map opens every strike that landed on it. The
   handler is re-attached after each draw because Plotly.react replaces the
   node's event bindings. */
function wireCellClick(divId, idxs){
  const el = $(divId);
  if (!el || !el.on) return;
  el.removeAllListeners && el.removeAllListeners("plotly_click");
  el.on("plotly_click", (ev) => {
    const pt = ev.points && ev.points[0];
    if (!pt) return;
    const x = +pt.x, y = +pt.y;
    const here = idxs.filter(i => DATA.strikes[i].x === x &&
                                  DATA.strikes[i].y === y);
    StrikeView.showCell(x, y, here);
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
    `${c.membrane.note}.</li>`+
    `<li>Lobe axis ${c.axis_deg}&deg;: ${c.axis_note}.</li></ul>`;
}

/* =================================================================== render */
function render(){
  if (SITE.part !== "data") return;
  const idxs = selection();
  $("fCount").innerHTML = `<b>${idxs.length}</b> / ${DATA.strikes.length} strikes`;
  $("raOut").textContent = `${S.raMin.toFixed(2)} – ${S.raMax.toFixed(2)}`;
  $("bandGroup").classList.toggle("hidden", S.view !== "modes");
  for (const v of ["map","modes","strikes"]){
    $("view-"+v).classList.toggle("hidden", v !== S.view);
    $("tab-"+v).setAttribute("aria-selected", String(v === S.view));
  }
  buildFilters();
  $("mapTableBtn").textContent = S.mapTable ? "hide table" : "table view";
  if (!idxs.length){
    $("mapPlots").innerHTML = `<p class="sub">No strike matches these `+
      `filters. Widen the r/a range, or press reset.</p>`;
    ["specPlot","bandPlot","strikePlot"].forEach(id=>Plotly.purge(id));
    $("strikeTable").innerHTML = "";
    $("mapNote").innerHTML = "";
    $("mapTable").classList.add("hidden");
    $("mapLegend").classList.add("hidden");
    writeHash();
    return;
  }
  $("mapLegend").classList.remove("hidden");
  if (S.view === "map") drawMap(idxs);
  if (S.view === "modes") drawModes(idxs);
  if (S.view === "strikes") drawStrikes(idxs);
  writeHash();
}

/* ===================================================================== wire */
function wire(){
  document.querySelectorAll(".tab").forEach(t=>{
    t.onclick = () => { S.view = t.dataset.view; render(); };
  });
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
    if (tr){ S.strike = +tr.dataset.i; render(); }
  };
}
function syncInputs(){
  $("raMin").value = S.raMin; $("raMax").value = S.raMax;
  $("bandW").value = S.bandW;
  $("bandC").value = (S.bandC === null ? DATA.campaign.modes[S.mode].hz : S.bandC)
    .toFixed(0);
}

/* The cell gallery hands a strike back here so the whole app agrees on which
   one is selected: the table highlights it, the hash carries it, and the five
   panels draw. */
function selectStrike(i){
  S.strike = i;
  S.view = "strikes";
  render();
  const el = $("strikeTitle");
  if (el) el.scrollIntoView({behavior:"smooth", block:"start"});
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
