import { CONFIG } from './config.js';
import { zonedParts, serverParts, zoneOffsetMinutes, serverOffsetMinutes, zonedToUtc, fmtHMS, fmtOffset, fmtDuration, pad2 } from './engines/time-engine.js';
import { sessionStates, timelineIntervals } from './engines/session-engine.js';
import { t, getLang, setLang } from './i18n.js';
import { computeCondition, scoreSession } from './core/condition-engine.js';
import { DEMO_DRIVERS } from './demo-data.js';
import { scoreVolatility, scoreNewsRisk } from './core/condition-engine.js';
import { loadSnapshot, displayStatus, fmtAge } from './data-client.js';

let SNAP = null, SNAP_ERR = 'loading';
const dstatus = (a, now = Date.now()) => displayStatus(a && a.status, a && a.fetchedAt, now, CONFIG.data);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = (p) => `${DAYS[p.weekday]} ${pad2(p.day)} ${MONTHS[p.month - 1]} ${p.year}`;
const hm = (d, tz) => { const p = zonedParts(d, tz); return `${pad2(p.hour)}:${pad2(p.minute)}`; };
const pill = (cls, label) => `<span class="pill ${cls}">${esc(label)}</span>`;
const scoreColor = (v) => (v >= 75 ? 'var(--good)' : v >= 50 ? 'var(--warn)' : 'var(--bad)');
const bandLabel = (v) => (v >= CONFIG.conditionBands.favorable[0] ? t('favorable') : v >= CONFIG.conditionBands.caution[0] ? t('caution') : t('noTrade'));

/* Each panel renders inside its own try/catch so one failing panel never takes the dashboard down. */
function safe(id, fn) {
  try { fn(); } catch (e) { console.warn(`[panel ${id}]`, e); const el = $(id); if (el) el.innerHTML = `<div class="card-h"><h2>${esc(id)}</h2>${pill('down', 'ERROR')}</div>`; }
}

function renderClocks(now) {
  $('clocks').innerHTML = CONFIG.clocks.map((c, i) => {
    const p = c.server ? serverParts(now, CONFIG.serverTime) : zonedParts(now, c.tz);
    const off = c.server ? serverOffsetMinutes(now, CONFIG.serverTime) : zoneOffsetMinutes(now, c.tz);
    const label = c.id === 'local' ? t('local') : c.label;
    return `<div class="clock ${i === 0 ? 'primary' : ''}"><div class="lbl"><span>${esc(label)}</span><span class="mono">${fmtOffset(off)}</span></div>
      <div class="time num">${fmtHMS(p)}</div><div class="date num">${fmtDate(p)}</div></div>`;
  }).join('');
}

function gaugeSvg(v) {
  const r = 80, cx = 95, cy = 95, a = Math.PI * (1 - v / 100);
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  return `<svg viewBox="0 0 190 110" role="img" aria-label="score ${v}">
    <path d="M15 95 A80 80 0 0 1 175 95" fill="none" stroke="var(--panel-2)" stroke-width="12" stroke-linecap="round"/>
    <path d="M15 95 A80 80 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${scoreColor(v)}" stroke-width="12" stroke-linecap="round"/>
    <line x1="${(cx + (r - 18) * Math.cos(Math.PI * 0.49)).toFixed(1)}" y1="${(cy - (r - 18) * Math.sin(Math.PI * 0.49)).toFixed(1)}" x2="${(cx + (r - 6) * Math.cos(Math.PI * 0.49)).toFixed(1)}" y2="${(cy - (r - 6) * Math.sin(Math.PI * 0.49)).toFixed(1)}" stroke="var(--ink-3)" stroke-width="2"/>
    <line x1="${(cx + (r - 18) * Math.cos(Math.PI * 0.25)).toFixed(1)}" y1="${(cy - (r - 18) * Math.sin(Math.PI * 0.25)).toFixed(1)}" x2="${(cx + (r - 6) * Math.cos(Math.PI * 0.25)).toFixed(1)}" y2="${(cy - (r - 6) * Math.sin(Math.PI * 0.25)).toFixed(1)}" stroke="var(--ink-3)" stroke-width="2"/>
  </svg>`;
}

function assetFactors(a, now) {
  const st = dstatus(a, now);
  if (!a || st === 'UNAVAILABLE' || st === 'STALE') return {};
  const vol = scoreVolatility(a.atrPct);
  return {
    volatility: { value: vol.value, status: st, note: `${a.volatility || ''} volatility (ATR p${a.atrPct})` },
    momentum: { value: a.momentum, status: st, note: `Momentum ${a.momentum}` },
    structure: { value: a.structureScore, status: st, note: `Structure ${a.structure}` },
    regime: { value: a.regimeScore, status: st, note: `Regime ${a.regime}` },
  };
}

function calStatus(now) {
  const c = SNAP && SNAP.calendar;
  if (!c || !c.fetchedAt) return 'UNAVAILABLE';
  return displayStatus(c.status, c.fetchedAt, now, { liveMaxAgeMs: 6 * 3600000, staleAfterMs: 26 * 3600000 });
}
/** News-risk factor for one asset from calendar events relevant to it. */
function newsFactor(sym, now) {
  const st = calStatus(now);
  if (st === 'UNAVAILABLE' || st === 'STALE') return {};
  const ev = SNAP.calendar.events.filter((e) => e.impact !== 'LOW' && e.kb && e.kb.relevance.includes(sym)).map((e) => ({ time: e.ts, impact: e.impact, title: `${e.ccy} ${e.title}` }));
  const r = scoreNewsRisk(ev, now);
  return { news: { value: r.value, status: st, note: r.note } };
}

function renderCondition(ss) {
  const sess = scoreSession(ss);
  const now = Date.now();
  const factors = { session: { value: sess.value, status: 'LIVE', note: sess.note }, ...assetFactors(SNAP && SNAP.assets[CONFIG.data.primaryAsset], now), ...newsFactor(CONFIG.data.primaryAsset, now) };
  const r = computeCondition(factors, CONFIG.conditionWeights, CONFIG.conditionBands,
    { minCoverage: CONFIG.minCoverage, vetoes: CONFIG.conditionVetoes });
  const v = r.score ?? 0;
  const label = { FAVORABLE: t('favorable'), CAUTION: t('caution'), NO_TRADE: t('noTrade'), INSUFFICIENT: t('insufficient') }[r.band];
  const col = r.score == null ? 'var(--ink-3)' : scoreColor(v);
  const pillCls = r.status.toLowerCase();
  $('condition').innerHTML = `<div class="card-h"><h2>${t('marketCondition')}</h2>${pill(pillCls, t(pillCls))}</div>
    <div class="cond-body">
      <div class="gauge">${gaugeSvg(v)}<div class="val num" style="color:${col}">${r.score ?? '--'}</div><div class="state" style="color:${col}">${esc(label)}</div></div>
      <div class="bars">${r.breakdown.map((b) => `<div class="bar"><span class="k"><i class="sd ${b.status.toLowerCase()}" title="${b.status}"></i>${esc(t(b.key))}</span>
        <span class="track"><span class="fill" style="width:${b.value ?? 0}%;background:${b.value == null ? 'transparent' : scoreColor(b.value)}"></span></span><span class="v">${b.value ?? '--'}</span></div>`).join('')}</div>
    </div>
    <div class="why"><b>${t('why')}</b>${r.plus.map((x) => `<span class="p">+ ${esc(x)}</span>`).join('')}${r.minus.map((x) => `<span class="m">− ${esc(x)}</span>`).join('')}</div>
    <p class="demo-note" style="color:var(--ink-3)">${CONFIG.data.primaryAsset} · ${t('coverage')} ${Math.round(r.coverage * 100)}%${r.missing.length ? ` · ${t('noData')}: ${r.missing.map((k) => t(k)).join(', ')}` : ''}</p>`;
}

function renderSessions(ss, now) {
  const tz = CONFIG.timelineTz;
  $('sessions').innerHTML = `<div class="card-h"><h2>${t('sessionBoard')}</h2>${ss.marketOpen ? pill('live', t('live')) : pill('muted', t('closed'))}</div>
    <div class="sess-grid">${ss.states.map((s) => `<div class="sess ${s.open ? 'on' : ''}" style="--c:${s.color}">
      <div class="nm"><span class="dot"></span>${esc(s.name)}</div>
      <div class="st">${s.open ? t('open') : t('closed')}</div>
      <div class="hrs num">${s.start ? `${hm(s.start, tz)} – ${hm(s.end, tz)}` : '--'}</div>
      <div class="cd num">${s.open ? fmtDuration(s.remainingMs) : s.untilOpenMs != null ? fmtDuration(s.untilOpenMs) : '--'}</div>
      <div class="hrs">${s.open ? t('remaining') : t('opensIn')}</div></div>`).join('')}</div>
    <div class="sess-foot">
      <span class="tag">${t('active')}: ${esc(ss.active.map((s) => s.name).join(' + ') || t('none'))}</span>
      ${ss.overlaps.map((o) => `<span class="tag hot">${esc(o[0].name)} + ${esc(o[1].name)} ${t('overlap')}</span>`).join('')}
      ${ss.next ? `<span class="tag">${t('next')}: ${esc(ss.next.name)} · <span class="num">${fmtDuration(ss.next.untilOpenMs)}</span></span>` : ''}
      ${!ss.marketOpen ? `<span class="tag hot">${t('marketClosed')}</span>` : ''}
    </div><p class="demo-note" style="color:var(--ink-3)">${esc(tz)}</p>`;
}

function sparkSvg(pts, dir) {
  const min = Math.min(...pts), max = Math.max(...pts), w = 200, h = 40;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * w).toFixed(1)} ${(h - 3 - ((v - min) / (max - min || 1)) * (h - 6)).toFixed(1)}`).join(' ');
  const c = dir > 0 ? 'var(--up)' : dir < 0 ? 'var(--down)' : 'var(--ink-2)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderAssets() {
  const now = Date.now();
  $('assets').innerHTML = CONFIG.assets.map((sym) => {
    const a = SNAP && SNAP.assets[sym];
    const st = dstatus(a, now);
    const dp = (CONFIG.assetMeta[sym] || {}).dp ?? 2;
    const head = `<div class="row1"><span class="sym">${sym}</span>${pill(st.toLowerCase(), t(st.toLowerCase()))}</div>`;
    if (!a || a.price == null) return `<article class="card asset">${head}<div class="px num" style="color:var(--ink-3)">--</div><p class="demo-note" style="color:var(--ink-3)">${esc(SNAP_ERR || t('unavailable'))}</p></article>`;
    const cls = a.changePct > 0 ? 'up' : a.changePct < 0 ? 'down' : 'flat';
    const tr = a.bias > 0 ? '▲ BULLISH' : a.bias < 0 ? '▼ BEARISH' : '◆ NEUTRAL';
    const cond = assetCondition(a, now, sym);
    return `<article class="card asset">${head}
      <div class="px num">${a.price.toFixed(dp)}</div><div class="chg ${cls} num">${a.changePct > 0 ? '▲ +' : a.changePct < 0 ? '▼ ' : ''}${a.changePct == null ? '--' : a.changePct.toFixed(2)}% <span style="color:var(--ink-3)">24h</span></div>
      ${a.spark && a.spark.length > 2 ? sparkSvg(a.spark, a.bias) : ''}
      <div class="kv"><span class="k">${t('trend')}</span><span class="v ${a.bias > 0 ? 'up' : a.bias < 0 ? 'down' : 'flat'}">${tr}</span>
        <span class="k">${t('structure')}</span><span class="v">${esc(a.structure)}</span>
        <span class="k">${t('momentum')}</span><span class="meter" title="${a.momentum}"><i style="width:${a.momentum ?? 0}%"></i></span>
        <span class="k">${t('volatility')}</span><span class="meter" title="ATR p${a.atrPct}"><i style="width:${a.atrPct ?? 0}%;background:var(--warn)"></i></span>
        <span class="k">${t('regime')}</span><span class="v">${esc(a.regime)}</span>
        <span class="k">RSI</span><span class="v">${a.rsi ?? '--'}</span></div>
      <div class="cond"><span class="k" style="font-size:11px;color:var(--ink-3)">${t('condition')}</span><span class="score num" style="color:${cond == null ? 'var(--ink-3)' : scoreColor(cond)}">${cond ?? '--'}</span></div>
      <div class="src mono">${esc(a.source)} · ${fmtAge(now - a.fetchedAt)}${a.proxy ? ` · ${esc(a.proxy)}` : ''}</div></article>`;
  }).join('');
}

let LAST_SS = null;
function assetCondition(a, now, sym) {
  if (!LAST_SS) return null;
  const s = scoreSession(LAST_SS);
  return computeCondition({ session: { value: s.value, status: 'LIVE' }, ...assetFactors(a, now), ...newsFactor(sym, now) }, CONFIG.conditionWeights, CONFIG.conditionBands, { minCoverage: CONFIG.minCoverage }).score;
}

function renderTimeline(now) {
  const tz = CONFIG.timelineTz, p = zonedParts(now, tz);
  const day = zonedToUtc(p.year, p.month, p.day, 0, 0, tz), a = day.getTime(), span = 86400000;
  const pos = (ms) => (((ms - a) / span) * 100).toFixed(3);
  const rows = timelineIntervals(day, CONFIG).map((s) => `<div class="tl-row"><span class="nm">${esc(s.name)}</span><div class="tl-track">
    ${s.intervals.map((iv) => `<span class="tl-seg ${iv.tradable ? '' : 'weekend'}" style="--c:${s.color};left:${pos(iv.start)}%;width:${(((iv.end - iv.start) / span) * 100).toFixed(3)}%"></span>`).join('')}</div></div>`).join('');
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${pad2(h % 24)}</span>`).join('');
  $('timeline').innerHTML = `<div class="card-h"><h2>${t('timeline')}</h2><span class="pill muted">${esc(tz)}</span></div>
    <div class="tl-wrap"><div class="tl">${rows}
      <div style="position:absolute;inset:0 0 0 94px;pointer-events:none" class="tl-nowbox"><span class="tl-now" data-l="${t('now')}" style="left:${pos(now.getTime())}%"></span></div></div>
    <div class="tl-axis">${ticks}</div></div>`;
}

function renderDrivers() {
  $('drivers').innerHTML = `<div class="card-h"><h2>${t('drivers')} · XAUUSD</h2>${pill('demo', t('demo'))}</div>
    ${DEMO_DRIVERS.map((d) => `<div class="drv"><span class="n">${d.name}</span><span class="note">${esc(d.note)}</span>
      <span class="v ${d.dir > 0 ? 'up' : d.dir < 0 ? 'down' : 'flat'}">${d.dir > 0 ? '▲' : d.dir < 0 ? '▼' : '◆'} ${esc(d.value)}</span></div>`).join('')}`;
}

const FILTERS = ['ALL', 'HIGH', 'MEDIUM', 'USD', 'EUR', 'GBP', 'JPY', 'GOLD', 'OIL'];
let evFilter = 'HIGH';
try { const v = localStorage.getItem('tos.evf'); if (FILTERS.includes(v)) evFilter = v; } catch { /* ignore */ }
const ARROW = (v) => (v > 0 ? '<b class="up">↑</b>' : v < 0 ? '<b class="down">↓</b>' : '');

function eventPasses(e) {
  if (evFilter === 'ALL') return e.impact !== 'LOW' || (e.kb && e.kb.relevance.length);
  if (evFilter === 'HIGH' || evFilter === 'MEDIUM') return e.impact === evFilter;
  if (evFilter === 'GOLD') return e.kb && e.kb.relevance.includes('XAUUSD');
  if (evFilter === 'OIL') return e.kb && e.kb.relevance.includes('BRENT');
  return e.ccy === evFilter;
}

function renderEvents() {
  const now = Date.now(), st = calStatus(now), tz = CONFIG.timelineTz;
  const c = SNAP && SNAP.calendar;
  const head = `<div class="card-h"><h2>${t('events')}</h2>${pill(st.toLowerCase(), t(st.toLowerCase()))}</div>
    <div class="filters">${FILTERS.map((f) => `<button type="button" data-evf="${f}" class="${f === evFilter ? 'on' : ''}">${f}</button>`).join('')}</div>`;
  if (!c || !c.events) { $('events').innerHTML = `${head}<p class="demo-note" style="color:var(--ink-3)">${esc(SNAP_ERR || t('unavailable'))}</p>`; return; }
  const list = c.events.filter((e) => e.ts >= now - 2 * 3600000 && e.ts <= now + 48 * 3600000 && eventPasses(e)).slice(0, 30);
  const day = (ts) => { const p = zonedParts(new Date(ts), tz); return `${DAYS[p.weekday]} ${pad2(p.day)} ${MONTHS[p.month - 1]}`; };
  $('events').innerHTML = `${head}<div class="list-scroll">${list.length ? list.map((e) => {
    const k = e.kb, dm = Math.round((e.ts - now) / 60000);
    const when = dm >= 0 ? (dm < 120 ? `in ${dm}m` : `in ${fmtDuration(e.ts - now)}`) : `${-dm}m ago`;
    const fx = k && !k.noDirection ? Object.entries(k.effects).filter(([, v]) => v).map(([s2, v]) => `<span>${s2} ${ARROW(v)}</span>`).join('') : '';
    return `<div class="evt ${e.ts < now ? 'past' : ''}"><div><div class="tm num">${hm(new Date(e.ts), tz)}</div><div class="when">${day(e.ts)}</div><div class="when">${when}</div></div><div>
      <div><span class="imp ${e.impact}">${e.impact}</span> <span class="mono" style="color:var(--ink-3);font-size:11px">${esc(e.ccy)}</span></div>
      <div class="ttl">${esc(e.title)}</div>
      <div class="meta"><span>${t('actual')} ${esc(e.actual ?? '--')}</span><span>${t('forecast')} ${esc(e.forecast ?? '--')}</span><span>${t('previous')} ${esc(e.previous ?? '--')}</span></div>
      ${k ? `<div class="fa"><b>${esc(k.nameFa)} · ${esc(k.ccyFa)}</b> — ${esc(k.whyFa)}<br>▲ ${esc(k.ifHigherFa)}<br>▼ ${esc(k.ifLowerFa)}</div>
        ${fx ? `<div class="fx"><span class="lab">IF ABOVE FORECAST:</span>${fx}</div>` : ''}` : ''}
    </div></div>`;
  }).join('') : `<p class="demo-note" style="color:var(--ink-3)">—</p>`}</div>
  <p class="demo-note" style="color:var(--ink-3)">${esc(c.source || '')} · ${t('age')} ${fmtAge(c.fetchedAt ? now - c.fetchedAt : null)} · ${esc(tz)} · <span class="fa" style="display:inline">تفسیر قاعده‌محور و احتمالی است، نه پیش‌بینی.</span></p>`;
}

function renderNews() {
  const now = Date.now(), n = SNAP && SNAP.news;
  const st = !n || !n.fetchedAt ? 'UNAVAILABLE' : displayStatus(n.status, n.fetchedAt, now, { liveMaxAgeMs: 3600000, staleAfterMs: 6 * 3600000 });
  const head = `<div class="card-h"><h2>${t('newsTab')}</h2>${pill(st.toLowerCase(), t(st.toLowerCase()))}</div>`;
  if (!n || !n.items || !n.items.length) { $('news').innerHTML = `${head}<p class="demo-note" style="color:var(--ink-3)">${esc(SNAP_ERR || t('unavailable'))}</p>`; return; }
  $('news').innerHTML = `${head}<div class="news-grid">${n.items.map((x) => `<div class="nitem">
      <a href="${esc(/^https?:\/\//.test(x.url) ? x.url : '#')}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>
      <div class="meta">${esc(x.source)} · ${fmtAge(now - x.ts)} · ${x.kb.relevance.join(' · ')}</div>
      <div class="tags">${x.kb.topicsFa.map((tp) => `<span>${esc(tp)}</span>`).join('')}</div>
      <div class="fa">${x.kb.notesFa.map(esc).join('<br>')}</div></div>`).join('')}</div>
    <p class="demo-note" style="color:var(--ink-3)">${esc(n.source || '')} · ${t('age')} ${fmtAge(now - n.fetchedAt)} · <span class="fa" style="display:inline">تیتر اصلی به زبان منبع است؛ برچسب و توضیح فارسی خودکار و قاعده‌محور است.</span></p>`;
}

function listCell(x, cfg) {
  const st = !x || !x.fetchedAt ? 'UNAVAILABLE' : displayStatus(x.status, x.fetchedAt, Date.now(), cfg);
  return [pill(st.toLowerCase(), t(st.toLowerCase())), x && x.source ? `${x.source} · ${fmtAge(Date.now() - x.fetchedAt)}` : (SNAP_ERR || '')];
}

function renderHealth() {
  const online = navigator.onLine, now = Date.now();
  const age = SNAP ? now - SNAP.generatedAt : null;
  const priceSt = !SNAP ? 'UNAVAILABLE' : age > CONFIG.data.staleAfterMs ? 'STALE' : age > CONFIG.data.liveMaxAgeMs ? 'CACHE'
    : Object.values(SNAP.assets).some((x) => x.status === 'LIVE') ? 'LIVE' : Object.values(SNAP.assets).some((x) => x.status === 'FALLBACK') ? 'FALLBACK' : 'CACHE';
  const prov = SNAP && SNAP.health && SNAP.health.price ? SNAP.health.price : [];
  const cells = [
    [t('timeEngine'), pill('live', t('live')), 'Intl / IANA · ' + t('local')],
    [t('price'), pill(priceSt.toLowerCase(), t(priceSt.toLowerCase())), SNAP ? `${t('age')} ${fmtAge(age)}` : (SNAP_ERR || '')],
    [t('newsTab'), ...listCell(SNAP && SNAP.news, { liveMaxAgeMs: 3600000, staleAfterMs: 6 * 3600000 })],
    [t('calendar'), ...listCell(SNAP && SNAP.calendar, { liveMaxAgeMs: 6 * 3600000, staleAfterMs: 26 * 3600000 })],
    [t('volatility'), pill(priceSt.toLowerCase(), t(priceSt.toLowerCase())), 'ATR · 15m'],
    ['NETWORK', online ? pill('live', t('online')) : pill('offline', t('offline')), online ? 'navigator.onLine' : 'cached shell'],
  ];
  $('health').innerHTML = `<div class="card-h"><h2>${t('dataHealth')}</h2></div>
    <div class="health-grid">${cells.map(([k, p, d]) => `<div class="hcell"><div class="k">${esc(k)}</div>${p}<div class="d">${esc(d)}</div></div>`).join('')}</div>
    ${provTable('PRICE', prov)}${provTable('CALENDAR', (SNAP && SNAP.health.calendar) || [])}${provTable('NEWS', (SNAP && SNAP.health.news) || [])}`;
  $('net-pill').className = `pill ${online ? 'live' : 'offline'}`;
  $('net-pill').textContent = `${t('system')} ${online ? t('online') : t('offline')}`;
}

function provTable(label, prov) {
  return `${prov.length ? `<div class="prov"><div class="k">${label} PROVIDERS</div>${prov.map((p) => `<div class="prow mono"><span>${p.priority}. ${esc(p.name)}</span>
      ${pill(p.circuit === 'OPEN' ? 'down' : p.status === 'LIVE' ? 'live' : p.status === 'DOWN' ? 'down' : 'muted', p.circuit === 'OPEN' ? 'CIRCUIT OPEN' : p.status)}
      <span>${p.latencyMs != null ? p.latencyMs + 'ms' : '--'}</span><span>${t('fails')} ${p.failures}</span><span>${p.score ?? '--'}</span>
      <span class="err">${esc(p.lastError || '')}</span></div>`).join('')}</div>` : ''}`;
}

async function refreshData() {
  const r = await loadSnapshot(CONFIG.data.snapshotUrl);
  if (r.ok) { SNAP = r.snap; SNAP_ERR = null; } else SNAP_ERR = r.error;   // keep the previous snapshot (its age keeps growing)
  safe('assets', renderAssets); safe('events', renderEvents); safe('news', renderNews); safe('health', renderHealth); lastMinute = -1; tick();
}

function staticText() {
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  $('lang-btn').textContent = getLang() === 'fa' ? 'EN' : 'FA';
}

let lastMinute = -1;
function tick() {
  const now = new Date();
  let ss = null;
  safe('clocks', () => renderClocks(now));
  safe('sessions', () => { ss = sessionStates(now, CONFIG); LAST_SS = ss; renderSessions(ss, now); });
  const m = Math.floor(now.getTime() / 60000);
  if (m !== lastMinute && ss) { lastMinute = m; safe('condition', () => renderCondition(ss)); safe('timeline', () => renderTimeline(now)); }
}
function renderAll() {
  lastMinute = -1; staticText();
  safe('assets', renderAssets); safe('drivers', renderDrivers); safe('events', renderEvents); safe('news', renderNews); safe('health', renderHealth);
  tick();
}

function setupTabs() {
  const nav = $('bottom-nav');
  const go = (tab) => {
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.go === tab));
    document.querySelectorAll('[data-tab]').forEach((el) => el.classList.toggle('tab-hidden', !el.dataset.tab.split(' ').includes(tab)));
    window.scrollTo({ top: 0 });
  };
  nav.addEventListener('click', (e) => { const b = e.target.closest('button[data-go]'); if (b) go(b.dataset.go); });
  go('home');
}

setLang(getLang());
$('lang-btn').addEventListener('click', () => { setLang(getLang() === 'fa' ? 'en' : 'fa'); renderAll(); });
window.addEventListener('online', () => safe('health', renderHealth));
window.addEventListener('offline', () => safe('health', renderHealth));
setupTabs();
$('events').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-evf]'); if (!b) return;
  evFilter = b.dataset.evf; try { localStorage.setItem('tos.evf', evFilter); } catch { /* ignore */ }
  safe('events', renderEvents);
});
renderAll();
setInterval(tick, 1000);
refreshData();
setInterval(refreshData, CONFIG.data.refreshMs);
setInterval(() => { safe('assets', renderAssets); safe('health', renderHealth); }, 30000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e));
}
