/* LILA BLACK · Player Journey Explorer
 * Plain JS + Canvas, no build step. Data comes from pipeline/build_data.py (see ARCHITECTURE.md).
 * Coordinates arrive as normalised UV (0..1, quantised to 1/Q); we only convert to image space here:
 *   px = u * 1024,  py = (1 - v) * 1024   (v is the world Z axis, image Y is flipped)
 */
'use strict';
const SZ = 1024;                       // logical map-space size
const $ = (id) => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');

// ---- event catalogue (index matches pipeline EVENTS) -----------------------------------------
const EVN = ['Position', 'BotPosition', 'Kill', 'Killed', 'BotKill', 'BotKilled', 'KilledByStorm', 'Loot'];
const E = Object.fromEntries(EVN.map((n, i) => [n, i]));
const MARK = {  // shape: diamond = got a kill, cross = died, dot = loot
  [E.Kill]:          { label: 'Kill (human)',        hint: 'a human killed another human', color: '#ff5d5d', shape: 'diamond' },
  [E.Killed]:        { label: 'Killed by human',     hint: 'a human was killed by another human', color: '#ff5d5d', shape: 'cross' },
  [E.BotKill]:       { label: 'Kill (bot)',          hint: 'a human killed a bot', color: '#ff9f1c', shape: 'diamond' },
  [E.BotKilled]:     { label: 'Killed by bot',       hint: 'a human was killed by a bot', color: '#ff9f1c', shape: 'cross' },
  [E.KilledByStorm]: { label: 'Storm death',         hint: 'died to the storm', color: '#b388ff', shape: 'storm' },
  [E.Loot]:          { label: 'Loot pickup',         hint: 'item picked up', color: '#4ade80', shape: 'dot' },
};
const KILL_EV = [E.Kill, E.BotKill], DEATH_EV = [E.Killed, E.BotKilled, E.KilledByStorm];
const HEAT = {
  traffic: { label: 'Traffic', ev: [E.Position, E.BotPosition], ramp: [[0,0,0,0],[.15,30,60,200],[.4,0,200,220],[.65,120,230,80],[.85,255,210,40],[1,255,60,40]] },
  kills:   { label: 'Kills',   ev: KILL_EV, ramp: [[0,0,0,0],[.2,120,0,0],[.5,230,40,20],[.8,255,150,20],[1,255,245,170]] },
  deaths:  { label: 'Deaths',  ev: DEATH_EV, ramp: [[0,0,0,0],[.2,70,10,120],[.5,190,40,200],[.8,255,110,160],[1,255,240,245]] },
  loot:    { label: 'Loot',    ev: [E.Loot], ramp: [[0,0,0,0],[.2,10,80,40],[.5,40,190,90],[.8,170,240,60],[1,255,255,180]] },
  storm:   { label: 'Storm',   ev: [E.KilledByStorm], ramp: [[0,0,0,0],[.25,60,30,140],[.6,150,100,255],[1,240,225,255]] },
};
const HUMAN_COLORS = ['#22d3ee', '#a3e635', '#f472b6', '#c4b5fd'];
const BOT_COLOR = '#f59e0b';

// ---- state ------------------------------------------------------------------------------------
const S = {
  index: null, map: null, data: {},          // data[mapId] = prepared matches
  days: new Set(), sel: new Set(), quick: new Set(), sort: 'start',
  heat: 'off', heatR: 22, heatOp: 0.75, heatFollow: false,
  humans: true, bots: true, dim: 0.25, evOn: new Set(Object.keys(MARK).map(Number)),
  hiddenPlayers: new Set(),
  t: 0, maxT: 1, playing: false, speed: 10, loop: false,
  view: { s: 1, x: 0, y: 0 }, img: {}, scope: null, heatCanvas: null, heatDirty: true,
};

// ---- bootstrap --------------------------------------------------------------------------------
init();
async function init() {
  const r = await fetch('data/index.json'); S.index = await r.json();
  const mapIds = Object.keys(S.index.maps).sort((a, b) => S.index.maps[b].matches.length - S.index.maps[a].matches.length);
  S.index.days.forEach((d) => S.days.add(d));
  readHash();
  if (!S.map || !S.index.maps[S.map]) S.map = mapIds[0];
  buildStaticUI(mapIds);
  bindEvents();
  await switchMap(S.map, true);
  if (!localStorage.getItem('lila_seen_help')) $('help').hidden = false;
}

async function loadMap(id) {
  if (S.data[id]) return S.data[id];
  const raw = await (await fetch(`data/${id}.json`)).json();
  const cfg = S.index.maps[id], Q = S.index.q;
  const matches = raw.matches.map((m) => {
    const players = m.players.map((p, i) => ({ ...p, i, pts: [], evs: [], color: BOT_COLOR }));
    let hn = 0; players.forEach((p) => { if (!p.bot) p.color = HUMAN_COLORS[hn++ % HUMAN_COLORS.length]; });
    for (let k = 0; k < m.t.length; k++) {
      const p = players[m.p[k]], x = m.u[k] / Q * SZ, y = (1 - m.v[k] / Q) * SZ, e = m.e[k], t = m.t[k];
      if (e === E.Position || e === E.BotPosition) p.pts.push(t, x, y);
      else p.evs.push({ t, x, y, e });
    }
    players.forEach((p) => { p.endT = p.pts.length ? p.pts[p.pts.length - 3] : 0; });
    const meta = cfg.matches.find((x) => x.id === m.id);
    return { ...meta, players, shortId: m.id.slice(0, 8), storm: m.e.includes(E.KilledByStorm), pvp: m.e.includes(E.Kill) || m.e.includes(E.Killed) };
  });
  S.data[id] = { matches, byId: Object.fromEntries(matches.map((m) => [m.id, m])) };
  if (S._pendingSel) { matches.forEach((m) => { if (S._pendingSel.includes(m.shortId)) S.sel.add(m.id); }); S._pendingSel = null; }  // restore selection from a shared link
  const img = new Image(); img.src = cfg.img;
  await img.decode().catch(() => {}); S.img[id] = img;
  return S.data[id];
}

async function switchMap(id, first) {
  $('loading').classList.remove('hide');
  S.map = id; if (!first) { S.sel.clear(); S.hiddenPlayers.clear(); S.t = 0; stop(); }
  await loadMap(id);
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.map === id));
  renderMatchList(); recomputeScope(); fitView();
  $('loading').classList.add('hide'); draw();
}

// ---- scope: which matches are "in view" --------------------------------------------------------
function visibleMatches() {   // list filter (date + quick chips)
  const d = S.data[S.map]; if (!d) return [];
  return d.matches.filter((m) => S.days.has(m.day)
    && (!S.quick.has('storm') || m.storm) && (!S.quick.has('pvp') || m.pvp) && (!S.quick.has('bots') || m.bots > 0));
}
function recomputeScope() {
  const d = S.data[S.map]; if (!d) return;
  const vis = visibleMatches();
  const matches = S.sel.size ? [...S.sel].map((id) => d.byId[id]).filter(Boolean) : vis;
  const players = [], flat = { x: [], y: [], t: [], e: [], b: [], pl: [] };
  matches.forEach((m) => m.players.forEach((p) => {
    players.push(p);
    for (let i = 0; i < p.pts.length; i += 3) { flat.t.push(p.pts[i]); flat.x.push(p.pts[i + 1]); flat.y.push(p.pts[i + 2]); flat.e.push(p.bot ? E.BotPosition : E.Position); flat.b.push(p.bot); flat.pl.push(p); }
    p.evs.forEach((ev) => { flat.t.push(ev.t); flat.x.push(ev.x); flat.y.push(ev.y); flat.e.push(ev.e); flat.b.push(p.bot); flat.pl.push(p); });
  }));
  S.scope = { matches, players, flat, n: flat.t.length, aggregate: matches.length > 3 };
  S.maxT = Math.max(1, ...matches.map((m) => m.dur));
  if (S.t > S.maxT) S.t = S.maxT;
  S.heatDirty = true;
  $('scrubber').max = S.maxT; $('clockMax').textContent = fmt(S.maxT);
  $('empty').hidden = matches.length > 0;
  renderStats(); renderPlayers(); drawTicks(); updateHash();
}

// ---- UI building -------------------------------------------------------------------------------
function buildStaticUI(mapIds) {
  $('mapTabs').innerHTML = mapIds.map((id) => `<button class="tab" data-map="${id}">${id.replace(/([a-z])([A-Z])/g, '$1 $2')} <small>${S.index.maps[id].matches.length}</small></button>`).join('');
  $('dayChips').innerHTML = S.index.days.map((d) => `<button class="chip on" data-day="${d}">${d.replace('Feb ', 'Feb ')}</button>`).join('');
  $('heatModes').innerHTML = ['off', ...Object.keys(HEAT)].map((k) => `<button data-heat="${k}">${k === 'off' ? 'Off' : HEAT[k].label}</button>`).join('');
  $('legend').innerHTML = Object.keys(MARK).map((e) => `<button class="lg" data-ev="${e}" title="${MARK[e].hint}"><canvas width="32" height="32"></canvas>${MARK[e].label}</button>`).join('');
  document.querySelectorAll('.lg').forEach((b) => { const c = b.firstChild.getContext('2d'); c.translate(16, 16); drawMarker(c, MARK[b.dataset.ev], 0, 0, 10, 1); });
  syncControls();
}
function syncControls() {
  document.querySelectorAll('#dayChips .chip').forEach((c) => c.classList.toggle('on', S.days.has(c.dataset.day)));
  $('dayHint').textContent = S.days.size === S.index.days.length ? 'all days' : [...S.days].join(', ') || 'none';
  document.querySelectorAll('#quickChips .chip').forEach((c) => c.classList.toggle('on', S.quick.has(c.dataset.q)));
  document.querySelectorAll('#heatModes button').forEach((b) => b.classList.toggle('on', b.dataset.heat === S.heat));
  document.querySelectorAll('.lg').forEach((b) => b.classList.toggle('off', !S.evOn.has(+b.dataset.ev)));
  $('heatRadius').nextElementSibling.textContent = S.heatR; $('heatOpacity').nextElementSibling.textContent = Math.round(S.heatOp * 100) + '%';
  $('mapDim').nextElementSibling.textContent = Math.round(S.dim * 100) + '%';
  $('heatRadius').value = S.heatR; $('heatOpacity').value = S.heatOp * 100; $('mapDim').value = S.dim * 100;
  $('lyHumans').checked = S.humans; $('lyBots').checked = S.bots; $('heatFollow').checked = S.heatFollow;
}

function renderMatchList() {
  const vis = visibleMatches().slice();
  const key = { start: (m) => m.start, dur: (m) => -m.dur, kills: (m) => -m.kills, deaths: (m) => -m.deaths, bots: (m) => -m.bots }[S.sort];
  vis.sort((a, b) => key(a) - key(b));
  $('matchCount').textContent = `${vis.length} shown`;
  $('matchList').innerHTML = vis.map((m) => {
    const t = new Date(m.start * 1000).toISOString().slice(11, 16);
    return `<div class="mrow${S.sel.has(m.id) ? ' on' : ''}" data-id="${m.id}" role="option" aria-selected="${S.sel.has(m.id)}">
      <span class="box"></span><span class="t">${m.day} ${t}<span class="muted"> · ${fmt(m.dur)}</span>${m.storm ? '<span class="tag s">storm</span>' : ''}${m.pvp ? '<span class="tag p">PvP</span>' : ''}</span>
      <span class="m">${m.humans}H ${m.bots}B · ${m.kills}K ${m.deaths}D</span></div>`;
  }).join('') || '<div class="mrow muted">No matches match these filters</div>';
  $('scopeHint').textContent = S.sel.size ? `${S.sel.size} selected. Click again to deselect.` : 'Nothing selected: showing all matches listed above, combined.';
}

function renderStats() {
  const sc = S.scope, c = (arr) => sc.flat.e.reduce((n, e) => n + (arr.includes(e) ? 1 : 0), 0);
  const humans = sc.players.filter((p) => !p.bot).length, bots = sc.players.length - humans;
  const cells = [[sc.matches.length, 'matches'], [humans, 'human journeys'], [bots, 'bot journeys'], [c([E.Loot]), 'loot pickups'],
    [c(KILL_EV), 'kills'], [c(DEATH_EV), 'deaths'], [c([E.KilledByStorm]), 'storm deaths'], [c([E.Kill, E.Killed]) / 2 | 0, 'PvP fights']];
  $('stats').innerHTML = cells.map(([n, l]) => `<div class="stat"><b>${n.toLocaleString()}</b><span>${l}</span></div>`).join('');
}

function renderPlayers() {
  const sc = S.scope, show = sc.matches.length === 1;
  $('playersSec').hidden = !show; if (!show) return;
  const ps = sc.players.slice().sort((a, b) => a.bot - b.bot);
  $('playerList').innerHTML = ps.map((p) => `<div class="prow${S.hiddenPlayers.has(p.id) ? ' off' : ''}" data-pid="${p.id}"><i style="background:${p.color}"></i><span>${p.bot ? 'Bot' : 'Human'} ${p.id.length > 12 ? p.id.slice(0, 8) + '…' : p.id}</span><em>${p.evs.filter((e) => e.e === E.Loot).length} loot · ${p.evs.filter((e) => KILL_EV.includes(e.e)).length}K</em></div>`).join('');
}

function drawTicks() {   // event ticks above the scrubber so designers can jump to key moments
  const c = $('ticks'), w = c.clientWidth || 600; c.width = w * devicePixelRatio; c.height = 16 * devicePixelRatio;
  const g = c.getContext('2d'); g.scale(devicePixelRatio, devicePixelRatio);
  const sc = S.scope; if (!sc) return; const many = sc.n > 4000;
  for (let i = 0; i < sc.n; i++) {
    const e = sc.flat.e[i]; if (e === E.Position || e === E.BotPosition || e === E.Loot) continue;
    g.globalAlpha = many ? .15 : .9; g.fillStyle = MARK[e].color;
    g.fillRect(sc.flat.t[i] / S.maxT * (w - 14) + 7 - 1, 3, 2, 12);
  }
}

// ---- events ------------------------------------------------------------------------------------
function bindEvents() {
  $('mapTabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b && b.dataset.map !== S.map) switchMap(b.dataset.map); };
  $('dayChips').onclick = (e) => {
    const c = e.target.closest('.chip'); if (!c) return; const d = c.dataset.day;
    if (S.days.has(d) && S.days.size === 1) S.days = new Set(S.index.days); // un-pick last → all
    else if (S.days.size === S.index.days.length) S.days = new Set([d]);       // first click isolates a day
    else S.days.has(d) ? S.days.delete(d) : S.days.add(d);
    S.sel.clear(); syncControls(); renderMatchList(); recomputeScope(); draw();
  };
  $('quickChips').onclick = (e) => { const c = e.target.closest('.chip'); if (!c) return; S.quick.has(c.dataset.q) ? S.quick.delete(c.dataset.q) : S.quick.add(c.dataset.q); S.sel.clear(); syncControls(); renderMatchList(); recomputeScope(); draw(); };
  $('sortSel').onchange = (e) => { S.sort = e.target.value; renderMatchList(); };
  $('btnClearSel').onclick = () => { S.sel.clear(); renderMatchList(); recomputeScope(); draw(); };
  $('matchList').onclick = (e) => {
    const r = e.target.closest('.mrow'); if (!r || !r.dataset.id) return; const id = r.dataset.id;
    S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.hiddenPlayers.clear();
    S.t = 0; renderMatchList(); recomputeScope(); draw();
  };
  $('heatModes').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.heat = b.dataset.heat; S.heatDirty = true; syncControls(); updateHash(); draw(); };
  $('heatRadius').oninput = (e) => { S.heatR = +e.target.value; S.heatDirty = true; syncControls(); draw(); };
  $('heatOpacity').oninput = (e) => { S.heatOp = e.target.value / 100; syncControls(); draw(); };
  $('mapDim').oninput = (e) => { S.dim = e.target.value / 100; syncControls(); draw(); };
  $('heatFollow').onchange = (e) => { S.heatFollow = e.target.checked; S.heatDirty = true; draw(); };
  $('lyHumans').onchange = (e) => { S.humans = e.target.checked; S.heatDirty = true; draw(); };
  $('lyBots').onchange = (e) => { S.bots = e.target.checked; S.heatDirty = true; draw(); };
  $('legend').onclick = (e) => { const b = e.target.closest('.lg'); if (!b) return; const k = +b.dataset.ev; S.evOn.has(k) ? S.evOn.delete(k) : S.evOn.add(k); syncControls(); draw(); };
  $('playerList').onclick = (e) => { const r = e.target.closest('.prow'); if (!r) return; const id = r.dataset.pid; S.hiddenPlayers.has(id) ? S.hiddenPlayers.delete(id) : S.hiddenPlayers.add(id); renderPlayers(); draw(); };
  $('scrubber').oninput = (e) => { S.t = +e.target.value; S.heatFollow && (S.heatDirty = true); draw(); };
  $('btnPlay').onclick = togglePlay;
  $('speedSel').onchange = (e) => { S.speed = +e.target.value; };
  $('loop').onchange = (e) => { S.loop = e.target.checked; };
  $('btnHelp').onclick = () => { $('help').hidden = false; };
  $('helpClose').onclick = () => { $('help').hidden = true; try { localStorage.setItem('lila_seen_help', '1'); } catch (_) {} };
  $('btnShare').onclick = async () => { updateHash(); try { await navigator.clipboard.writeText(location.href); $('btnShare').textContent = 'Copied ✓'; } catch (_) { $('btnShare').textContent = 'Copy from address bar'; } setTimeout(() => $('btnShare').textContent = 'Copy link', 1600); };
  addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); } });
  addEventListener('resize', () => { resize(); drawTicks(); draw(); });
  // pan / zoom
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y }; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); });
  cv.addEventListener('pointerup', () => { drag = null; cv.classList.remove('drag'); });
  cv.addEventListener('pointermove', (e) => {
    if (drag) { S.view.x = drag.vx + e.clientX - drag.x; S.view.y = drag.vy + e.clientY - drag.y; draw(); return; }
    hover(e);
  });
  cv.addEventListener('pointerleave', () => { $('tip').hidden = true; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  $('zIn').onclick = () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.3);
  $('zOut').onclick = () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.3);
  $('zFit').onclick = () => { fitView(); draw(); };
  new ResizeObserver(() => { resize(); draw(); drawTicks(); }).observe($('wrap'));
}

// ---- view transforms -----------------------------------------------------------------------------
function resize() { const r = $('wrap').getBoundingClientRect(), d = devicePixelRatio || 1; cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d); }
function fitView() { resize(); const w = cv.clientWidth, h = cv.clientHeight, s = Math.min(w, h) / SZ * 0.96; S.view = { s, x: (w - SZ * s) / 2, y: (h - SZ * s) / 2 }; }
function zoomAt(px, py, f) {
  const v = S.view, ns = Math.min(Math.max(v.s * f, 0.3), 14), k = ns / v.s;
  v.x = px - (px - v.x) * k; v.y = py - (py - v.y) * k; v.s = ns; draw();
}
const toMap = (px, py) => [(px - S.view.x) / S.view.s, (py - S.view.y) / S.view.s];

// ---- playback ------------------------------------------------------------------------------------
let last = 0;
function togglePlay() { S.playing ? stop() : play(); }
function play() { if (S.t >= S.maxT) S.t = 0; S.playing = true; $('btnPlay').textContent = '❚❚'; last = performance.now(); requestAnimationFrame(tick); }
function stop() { S.playing = false; $('btnPlay').textContent = '▶'; }
function tick(now) {
  if (!S.playing) return;
  S.t += (now - last) / 1000 * S.speed; last = now;
  if (S.t >= S.maxT) { if (S.loop) S.t = 0; else { S.t = S.maxT; stop(); } }
  if (S.heatFollow) S.heatDirty = true;
  draw(); requestAnimationFrame(tick);
}

// ---- drawing -------------------------------------------------------------------------------------
function visibleEvent(i) {
  const f = S.scope.flat, e = f.e[i];
  if (e === E.Position || e === E.BotPosition) return false;
  if (!S.evOn.has(e)) return false;
  const p = f.pl[i]; if (p.bot ? !S.bots : !S.humans) return false;
  return !S.hiddenPlayers.has(p.id);
}
function drawMarker(g, m, x, y, r, a) {
  g.save(); g.globalAlpha = a; g.translate(x, y); g.fillStyle = m.color; g.strokeStyle = '#000'; g.lineWidth = Math.max(r * 0.18, 0.5);
  g.beginPath();
  if (m.shape === 'diamond') { g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); g.closePath(); g.fill(); g.stroke(); }
  else if (m.shape === 'cross') {   // black outline stroke under a coloured stroke
    for (const [w, c] of [[r * 0.72, '#000'], [r * 0.45, m.color]]) { g.lineWidth = w; g.strokeStyle = c; g.beginPath(); g.moveTo(-r * .8, -r * .8); g.lineTo(r * .8, r * .8); g.moveTo(r * .8, -r * .8); g.lineTo(-r * .8, r * .8); g.stroke(); }
  }
  else if (m.shape === 'storm') { g.arc(0, 0, r, 0, 7); g.fill(); g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = r * .28; g.beginPath(); g.moveTo(-r * .5, -r * .5); g.lineTo(r * .5, r * .5); g.moveTo(r * .5, -r * .5); g.lineTo(-r * .5, r * .5); g.stroke(); }
  else { g.arc(0, 0, r, 0, 7); g.fill(); if (r > 3) g.stroke(); }
  g.restore();
}

function interp(p, t) {  // position of a player at time t (null when the journey hasn't started / has ended)
  const a = p.pts, n = a.length / 3; if (!n || t < a[0]) return null;
  if (t >= a[(n - 1) * 3]) return t <= p.endT + 6 ? [a[(n - 1) * 3 + 1], a[(n - 1) * 3 + 2]] : null;
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; a[m * 3] <= t ? lo = m : hi = m; }
  const f = (t - a[lo * 3]) / Math.max(1e-6, a[hi * 3] - a[lo * 3]);
  return [a[lo * 3 + 1] + (a[hi * 3 + 1] - a[lo * 3 + 1]) * f, a[lo * 3 + 2] + (a[hi * 3 + 2] - a[lo * 3 + 2]) * f];
}

function buildHeat() {
  const sc = S.scope, H = HEAT[S.heat], G = 256, cell = SZ / G, f = sc.flat;
  const grid = new Float32Array(G * G), rc = Math.max(1, Math.round(S.heatR / cell * 1.0)), sig = rc / 2;
  const kern = []; for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) { const d2 = dx * dx + dy * dy; if (d2 <= rc * rc) kern.push([dx, dy, Math.exp(-d2 / (2 * sig * sig))]); }
  const set = new Set(H.ev), tmax = S.heatFollow ? S.t : Infinity;
  for (let i = 0; i < sc.n; i++) {
    if (!set.has(f.e[i]) || f.t[i] > tmax) continue;
    if (f.b[i] ? !S.bots : !S.humans) continue; if (S.hiddenPlayers.has(f.pl[i].id)) continue;
    const cx = f.x[i] / cell | 0, cy = f.y[i] / cell | 0;
    for (const [dx, dy, w] of kern) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < G && y < G) grid[y * G + x] += w; }
  }
  let mx = 0; for (let i = 0; i < grid.length; i++) if (grid[i] > mx) mx = grid[i];
  // robust normalisation: ignore extreme single-cell spikes so mid-density areas stay visible
  const sorted = Float32Array.from(grid).sort(); const nz = sorted.findIndex((v) => v > 0);
  const ref = nz < 0 ? 1 : Math.max(sorted[Math.floor(nz + (sorted.length - nz) * 0.985)] || mx, mx * 0.15, 1e-6);
  const c = document.createElement('canvas'); c.width = c.height = G; const g = c.getContext('2d'), img = g.createImageData(G, G);
  const lut = rampLUT(H.ramp);
  for (let i = 0; i < grid.length; i++) {
    const v = Math.min(1, Math.pow(grid[i] / ref, 0.7)), k = grid[i] <= 0 ? 0 : Math.max(1, v * 255 | 0) * 4;
    img.data.set(k ? [lut[k], lut[k + 1], lut[k + 2], lut[k + 3]] : [0, 0, 0, 0], i * 4);
  }
  g.putImageData(img, 0, 0); S.heatCanvas = c; S.heatDirty = false;
}
function rampLUT(stops) {
  const out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = i / 255; let a = stops[0], b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) if (v >= stops[s][0] && v <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
    const f = b[0] === a[0] ? 0 : (v - a[0]) / (b[0] - a[0]);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = a[k + 1] + (b[k + 1] - a[k + 1]) * f;
    out[i * 4 + 3] = Math.min(255, 255 * Math.min(1, v * 2.2));
  }
  return out;
}

let raf = 0;
function draw() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function render() {
  const d = devicePixelRatio || 1, w = cv.width, h = cv.height, sc = S.scope; if (!sc) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#06090d'; ctx.fillRect(0, 0, w, h);
  const v = S.view; ctx.setTransform(d * v.s, 0, 0, d * v.s, d * v.x, d * v.y);
  const im = S.img[S.map]; if (im && im.complete) ctx.drawImage(im, 0, 0, SZ, SZ);
  if (S.dim > 0) { ctx.fillStyle = `rgba(4,7,11,${S.dim})`; ctx.fillRect(0, 0, SZ, SZ); }
  const px = 1 / v.s;   // 1 screen pixel in map units
  // heatmap
  if (S.heat !== 'off') {
    if (S.heatDirty || !S.heatCanvas) buildHeat();
    ctx.save(); ctx.globalAlpha = S.heatOp; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(S.heatCanvas, 0, 0, SZ, SZ); ctx.restore();
  }
  // paths
  const many = sc.matches.length > 3, ghost = !many;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const p of sc.players) {
    if (p.bot ? !S.bots : !S.humans) continue; if (S.hiddenPlayers.has(p.id)) continue;
    const a = p.pts, n = a.length / 3; if (n < 2) continue;
    ctx.strokeStyle = p.color; ctx.setLineDash(p.bot ? [5 * px, 4 * px] : []);
    if (ghost) { ctx.globalAlpha = 0.16; ctx.lineWidth = (p.bot ? 1.2 : 1.8) * px; ctx.beginPath(); ctx.moveTo(a[1], a[2]); for (let i = 1; i < n; i++) ctx.lineTo(a[i * 3 + 1], a[i * 3 + 2]); ctx.stroke(); }
    ctx.globalAlpha = many ? (S.heat !== 'off' ? 0.12 : 0.28) : 0.95; ctx.lineWidth = (many ? 1 : p.bot ? 1.6 : 2.6) * px;
    ctx.beginPath(); let started = false;
    for (let i = 0; i < n; i++) { if (a[i * 3] > S.t) break; started ? ctx.lineTo(a[i * 3 + 1], a[i * 3 + 2]) : (ctx.moveTo(a[i * 3 + 1], a[i * 3 + 2]), started = true); }
    const cur = interp(p, S.t); if (started && cur && S.t < a[(n - 1) * 3]) ctx.lineTo(cur[0], cur[1]);
    ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  // events
  const f = sc.flat, dense = sc.n > 5000, r0 = (dense ? 3.2 : 5.5) * px;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < sc.n; i++) {   // loot underneath, combat above
    const e = f.e[i]; if ((e === E.Loot) !== (pass === 0)) continue;
    if (f.t[i] > S.t || !visibleEvent(i)) continue;
    drawMarker(ctx, MARK[e], f.x[i], f.y[i], e === E.Loot ? r0 * 0.5 : r0, e === E.Loot ? (many ? .55 : .9) : 1);
  }
  // heads
  if (sc.players.length <= 40) for (const p of sc.players) {
    if (p.bot ? !S.bots : !S.humans) continue; if (S.hiddenPlayers.has(p.id)) continue;
    const cur = interp(p, S.t); if (!cur) continue;
    ctx.beginPath(); ctx.arc(cur[0], cur[1], (p.bot ? 4 : 5.5) * px, 0, 7); ctx.fillStyle = p.color; ctx.fill(); ctx.lineWidth = 1.6 * px; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  // ui sync
  $('scrubber').value = S.t; $('clockNow').textContent = fmt(S.t);
}

// ---- hover ---------------------------------------------------------------------------------------
function hover(e) {
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, [mx, my] = toMap(sx, sy);
  const cfg = S.index.maps[S.map], wx = (mx / SZ) * cfg.scale + cfg.ox, wz = (1 - my / SZ) * cfg.scale + cfg.oz;
  $('coord').textContent = (mx >= 0 && my >= 0 && mx <= SZ && my <= SZ) ? `world x ${wx.toFixed(0)}  z ${wz.toFixed(0)}` : 'outside map';
  const sc = S.scope, f = sc.flat, lim = 9 / S.view.s; let best = -1, bd = lim * lim;
  for (let i = 0; i < sc.n; i++) {
    if (f.t[i] > S.t || !visibleEvent(i)) continue;
    const dx = f.x[i] - mx, dy = f.y[i] - my, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; }
  }
  const tip = $('tip');
  if (best < 0) { tip.hidden = true; return; }
  const m = MARK[f.e[best]], p = f.pl[best], x = (f.x[best] / SZ) * cfg.scale + cfg.ox, z = (1 - f.y[best] / SZ) * cfg.scale + cfg.oz;
  tip.innerHTML = `<b style="color:${m.color}">${m.label}</b>${p.bot ? 'Bot' : 'Human'} ${p.id.length > 12 ? p.id.slice(0, 8) + '…' : p.id}<br>match time ${fmt(f.t[best])} · world (${x.toFixed(0)}, ${z.toFixed(0)})`;
  tip.hidden = false; tip.style.left = Math.min(sx + 14, r.width - 250) + 'px'; tip.style.top = Math.max(4, sy - 12) + 'px';
}

// ---- helpers / url state -------------------------------------------------------------------------
function fmt(s) { s = Math.max(0, Math.round(s)); return `${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`; }
function updateHash() {
  const p = new URLSearchParams(); p.set('map', S.map);
  if (S.days.size !== S.index.days.length) p.set('days', [...S.days].map((d) => d.replace('Feb ', '')).join(','));
  if (S.sel.size) p.set('m', [...S.sel].map((id) => id.slice(0, 8)).join(','));
  if (S.heat !== 'off') p.set('heat', S.heat);
  history.replaceState(null, '', '#' + p.toString());
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('map')) S.map = p.get('map');
  if (p.get('days')) S.days = new Set(p.get('days').split(',').map((d) => 'Feb ' + d));
  if (p.get('heat') && (HEAT[p.get('heat')])) S.heat = p.get('heat');
  S._pendingSel = p.get('m') ? p.get('m').split(',') : null;
}
