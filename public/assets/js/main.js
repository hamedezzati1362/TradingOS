import { CONFIG } from './config.js';
import { zonedParts, serverParts, zoneOffsetMinutes, serverOffsetMinutes, zonedToUtc, fmtHMS, fmtOffset, fmtDuration, pad2 } from './engines/time-engine.js';
import { sessionStates, timelineIntervals } from './engines/session-engine.js';
import { t, getLang, setLang } from './i18n.js';
import { computeCondition, scoreSession } from './core/condition-engine.js';
import { scoreVolatility, scoreNewsRisk } from './core/condition-engine.js';
import { loadSnapshot, displayStatus, fmtAge } from './data-client.js';
import { technicalRating } from './core/technicals.js';

let SNAP = null, SNAP_ERR = 'loading';
const TFS = ['15m', '1h', '4h', '1d'];
let selTf = '1h';
try { const v = localStorage.getItem('tos.tf'); if (TFS.includes(v)) selTf = v; } catch { /* ignore */ }
const FILES = new Map();   // `${sym}_${tf}` -> { file, rating, loadedAt }
async function loadCandleFile(sym, tf) {
  const key = `${sym}_${tf}`, hit = FILES.get(key);
  if (hit && Date.now() - hit.loadedAt < 5 * 60000) return hit;
  try {
    const r = await fetch(`data/candles/${key}.json`, { cache: 'no-store' });
    if (!r.ok) return hit || null;
    const file = await r.json();
    const rating = technicalRating(file.candles.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
    const v = { file, rating, loadedAt: Date.now() }; FILES.set(key, v); return v;
  } catch { return hit || null; }
}
async function loadTf(tf) { await Promise.all(CONFIG.assets.map((s) => loadCandleFile(s, tf))); safe('assets', renderAssets); }
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
  try { fn(); } catch (e) { console.warn(`[panel ${id}]`, e); const el = $(id); if (el) el.innerHTML = `<div class="card-h" data-panel-error><h2>${esc(id)}</h2>${pill('down', 'ERROR')}</div>`; }
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

const RCOL = { 'STRONG BUY': 'var(--up)', BUY: 'var(--up)', NEUTRAL: 'var(--ink-2)', SELL: 'var(--down)', 'STRONG SELL': 'var(--down)' };
const ACT = (a) => `<span class="act ${a.toLowerCase()}">${t('a_' + a.toLowerCase())}</span>`;
const KEY_IND = ['RSI (14)', 'MACD (12,26,9)', 'Stochastic %K (14,3,3)', 'ADX (14)', 'CCI (20)', 'EMA (50)', 'EMA (200)'];
function ratingMeter(score) {
  const pos = Math.round(((score + 1) / 2) * 100);
  return `<div class="rmeter"><span style="left:${pos}%"></span></div><div class="rscale"><span>S.SELL</span><span>SELL</span><span>NEUTRAL</span><span>BUY</span><span>S.BUY</span></div>`;
}
function techBlock(sym, a) {
  const f = FILES.get(`${sym}_${selTf}`);
  const sum = f ? { ...f.rating.summary, osc: f.rating.osc, ma: f.rating.ma } : a.tech && a.tech[selTf] ? { ...a.tech[selTf].summary, osc: a.tech[selTf].osc, ma: a.tech[selTf].ma } : null;
  if (!sum) return `<p class="demo-note" style="color:var(--ink-3)">${t('noData')} · ${selTf}</p>`;
  const rows = f ? KEY_IND.map((n) => [...f.rating.oscillators, ...f.rating.movingAverages].find((x) => x.name === n)).filter(Boolean) : [];
  return `<div class="tech"><div class="tsum"><span class="tf mono">${selTf.toUpperCase()}</span><b style="color:${RCOL[sum.label]}">${t('r_' + sum.label.replace(' ', '_').toLowerCase())}</b></div>
    ${ratingMeter(sum.score)}
    <div class="tcount mono"><span>OSC <b class="up">${sum.osc.BUY}</b>/<b>${sum.osc.NEUTRAL}</b>/<b class="down">${sum.osc.SELL}</b></span><span>MA <b class="up">${sum.ma.BUY}</b>/<b>${sum.ma.NEUTRAL}</b>/<b class="down">${sum.ma.SELL}</b></span></div>
    ${rows.length ? `<div class="tind">${rows.map((x) => `<span class="n">${esc(x.name.replace(/ \(.*\)/, ''))}${x.name.includes('EMA') ? ' ' + x.name.match(/\d+/)[0] : ''}</span>${ACT(x.action)}`).join('')}</div>` : ''}</div>`;
}

function renderAssets() {
  const now = Date.now();
  $('assets').innerHTML = `<div class="tfbar"><span class="k">${t('timeframe')}</span>${TFS.map((x) => `<button type="button" data-tf="${x}" class="${x === selTf ? 'on' : ''}">${x.toUpperCase()}</button>`).join('')}<span class="demo-note" style="margin:0;color:var(--ink-3)">${t('techNote')}</span></div>` + CONFIG.assets.map((sym) => {
    const a = SNAP && SNAP.assets[sym];
    const st = dstatus(a, now);
    const dp = (CONFIG.assetMeta[sym] || {}).dp ?? 2;
    const head = `<div class="row1"><span class="sym">${sym}</span><span style="display:flex;gap:6px;align-items:center">${pill(st.toLowerCase(), t(st.toLowerCase()))}<button type="button" class="chart-btn" data-chart="${sym}" aria-label="chart">⤢</button></span></div>`;
    if (!a || a.price == null) return `<article class="card asset">${head}<div class="px num" style="color:var(--ink-3)">--</div><p class="demo-note" style="color:var(--ink-3)">${esc(SNAP_ERR || t('unavailable'))}</p></article>`;
    const cls = a.changePct > 0 ? 'up' : a.changePct < 0 ? 'down' : 'flat';
    const tr = a.bias > 0 ? '▲ BULLISH' : a.bias < 0 ? '▼ BEARISH' : '◆ NEUTRAL';
    const cond = assetCondition(a, now, sym);
    return `<article class="card asset">${head}
      <div class="px num">${a.price.toFixed(dp)}</div><div class="chg ${cls} num">${a.changePct > 0 ? '▲ +' : a.changePct < 0 ? '▼ ' : ''}${a.changePct == null ? '--' : a.changePct.toFixed(2)}% <span style="color:var(--ink-3)">24h</span></div>
      ${techBlock(sym, a)}
      <div class="kv"><span class="k">${t('structure')}</span><span class="v">${esc(a.structure)} · 15m</span>
        <span class="k">${t('regime')}</span><span class="v">${esc(a.regime)}</span></div>
      ${a.levels ? `<div class="mini-lv"><span class="k">ADR</span><span class="v" style="color:${adrColor(a.levels.adrPct)}">${a.levels.adrPct ?? '--'}%</span>
        <span class="k">▲ ${esc(a.levels.above ? a.levels.above.name : '--')}</span><span class="v">${a.levels.above ? fmtDist(a.levels.above.price, a, dp) : '--'}</span>
        <span class="k">▼ ${esc(a.levels.below ? a.levels.below.name : '--')}</span><span class="v">${a.levels.below ? fmtDist(a.levels.below.price, a, dp) : '--'}</span></div>` : ''}
      <div class="cond"><span class="k" style="font-size:11px;color:var(--ink-3)">${t('condition')}</span><span class="score num" style="color:${cond == null ? 'var(--ink-3)' : scoreColor(cond)}">${cond ?? '--'}</span></div>
      <div class="src mono">${esc(a.source)} · ${fmtAge(now - a.fetchedAt)}${a.proxy ? ` · ${esc(a.proxy)}` : ''}</div></article>`;
  }).join('');
}

const adrColor = (p) => (p == null ? 'var(--ink-3)' : p >= 100 ? 'var(--bad)' : p >= 75 ? 'var(--warn)' : 'var(--up)');
function fmtDist(level, a, dp) {
  const d = a.atr ? (level - a.price) / a.atr : null;
  return `${level.toFixed(dp)}${d != null ? ` (${d > 0 ? '+' : ''}${d.toFixed(1)} ATR)` : ''}`;
}

let lvSym = CONFIG.data.primaryAsset;
try { const v = localStorage.getItem('tos.lv'); if (CONFIG.assets.includes(v)) lvSym = v; } catch { /* ignore */ }
function renderLevels() {
  const a = SNAP && SNAP.assets[lvSym], now = Date.now(), st = dstatus(a, now), dp = (CONFIG.assetMeta[lvSym] || {}).dp ?? 2;
  const head = `<div class="card-h"><h2>${t('keyLevels')}</h2>${pill(st.toLowerCase(), t(st.toLowerCase()))}</div>
    <div class="filters">${CONFIG.assets.map((x) => `<button type="button" data-lv="${x}" class="${x === lvSym ? 'on' : ''}">${x}</button>`).join('')}</div>`;
  const L = a && a.levels;
  if (!L) { $('levels').innerHTML = `${head}<p class="demo-note" style="color:var(--ink-3)">${esc(SNAP_ERR || t('unavailable'))}</p>`; return; }
  const rows = [...L.levels, { name: t('now'), price: a.price, now: true }].sort((x, y) => y.price - x.price);
  const idx = rows.findIndex((r) => r.now);
  const view = rows.slice(Math.max(0, idx - 7), idx + 8);
  const p = L.adrPct ?? 0;
  $('levels').innerHTML = `${head}<div class="lv-body">
    <div class="ladder">${view.map((r, i) => {
      const cls = r.now ? 'now' : r.price > a.price ? 'res' : 'sup';
      const near = !r.now && Math.abs(rows.indexOf(r) - idx) === 1 ? 'near' : '';
      const d = a.atr && !r.now ? ((r.price - a.price) / a.atr) : null;
      return `<div class="lrow ${cls} ${near}"><span class="n">${esc(r.name)}</span><span class="p">${r.price.toFixed(dp)}</span><span class="d">${d != null ? `${d > 0 ? '+' : ''}${d.toFixed(1)} ATR` : ''}</span></div>`;
    }).join('')}</div>
    <div class="adr"><div class="k" style="font:600 10px var(--sans);letter-spacing:1.2px;color:var(--ink-3)">ADR (14D)</div>
      <div class="big" style="color:${adrColor(L.adrPct)}">${L.adrPct ?? '--'}%</div>
      <div class="track"><i style="width:${Math.min(100, p)}%;background:${adrColor(L.adrPct)}"></i></div>
      <div class="mono" style="font-size:11px;color:var(--ink-2)">${t('today')} ${L.todayRange != null ? L.todayRange.toFixed(dp) : '--'} / ADR ${L.adr != null ? L.adr.toFixed(dp) : '--'}</div>
      <div class="fa">${esc(adrNote(L.adrPct))}</div>
    </div></div>
    ${L.sessions && L.sessions.length ? sessionTable(L.sessions, a, dp) : ''}
    <p class="demo-note" style="color:var(--ink-3)">PDH/PDL/Pivots: ${t('serverDay')} · Week/ADR: ${esc(a.source)} daily · ${fmtAge(now - a.fetchedAt)}</p>`;
}
const ST_FA = { FORMING: 'در حال شکل‌گیری', INTACT: 'دست‌نخورده', SWEPT: 'شکار شد و برگشت', BROKEN: 'شکسته شد' };
const ST_CLS = { FORMING: 'muted', INTACT: 'live', SWEPT: 'cache', BROKEN: 'down' };
function sessionTable(sessions, a, dp) {
  const tz = CONFIG.timelineTz;
  const cell = (lvl, st) => `<div class="slv"><span class="num">${lvl.toFixed(dp)}</span><span class="pill ${ST_CLS[st.state]}">${getLang() === 'fa' ? ST_FA[st.state] : st.state}</span>${st.at ? `<span class="mono" style="color:var(--ink-3);font-size:10px">${hm(new Date(st.at), tz)}</span>` : ''}</div>`;
  return `<div class="stbl"><div class="k" style="font:600 10px var(--sans);letter-spacing:1.2px;color:var(--ink-3)">${t('sessionLevels')}</div>
    ${sessions.map((x) => `<div class="srow"><div><b class="mono">${x.label}</b> <span class="stars">${'★'.repeat(x.stars)}${'☆'.repeat(4 - x.stars)}</span>
      <div class="mono" style="font-size:10px;color:var(--ink-3)">${hm(new Date(x.start), tz)}–${hm(new Date(x.end), tz)}</div></div>
      <div><span class="k2">H</span>${cell(x.high, x.highState)}</div><div><span class="k2">L</span>${cell(x.low, x.lowState)}</div>
      <div class="fa" style="grid-column:1/-1;margin:0">${esc(x.hunterFa)}</div></div>`).join('')}
    <p class="fa" style="color:var(--ink-3);margin:4px 0 0">«شکار شد و برگشت» (Sweep): قیمت سطح را زد ولی دوباره به داخل برگشت؛ اغلب نشانه‌ی جمع‌کردن Stopها و برگشت. «شکسته شد»: قیمت بیرون سطح مانده؛ احتمال ادامه.</p></div>`;
}

function adrNote(p) {
  if (p == null) return '';
  if (p >= 100) return 'رنج امروز از میانگین روزانه گذشته؛ ادامه‌ی حرکت بزرگ کم‌احتمال‌تر است و ریسک برگشت بیشتر.';
  if (p >= 75) return 'بیشتر رنج معمول روز طی شده؛ فضای حرکت باقی‌مانده محدود است.';
  if (p >= 40) return 'رنج امروز در حد معمول؛ هنوز فضای حرکت وجود دارد.';
  return 'رنج امروز کم است؛ ممکن است حرکت اصلی روز هنوز شروع نشده باشد.';
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
  const m = SNAP && SNAP.macro, now = Date.now();
  const st = !m || !m.fetchedAt ? 'UNAVAILABLE' : displayStatus(m.status, m.fetchedAt, now, { liveMaxAgeMs: 26 * 3600000, staleAfterMs: 4 * 86400000 });
  const head = `<div class="card-h"><h2>${t('drivers')} · XAUUSD</h2>${pill(st.toLowerCase(), t(st.toLowerCase()))}</div>`;
  if (!m || !m.items || !m.items.length) { $('drivers').innerHTML = `${head}<p class="demo-note" style="color:var(--ink-3)">${esc(SNAP_ERR || t('unavailable'))}</p>`; return; }
  const ar = (d) => (d > 0 ? '▲' : d < 0 ? '▼' : '◆');
  const gb = m.goldBias;
  const gcol = gb.label === 'TAILWIND' ? 'var(--up)' : gb.label === 'HEADWIND' ? 'var(--down)' : 'var(--warn)';
  $('drivers').innerHTML = `${head}
    <div class="gbias" style="border-color:${gcol}"><span class="mono" style="color:${gcol}">${gb.label}</span><span class="fa" style="margin:0">${esc(gb.labelFa)}</span></div>
    ${m.items.map((x) => `<div class="drv2"><span class="n">${esc(x.name)}</span>
      <span class="v num">${x.value.toFixed(x.dp)}${esc(x.unit)}</span>
      <span class="c num ${x.dir > 0 ? 'up' : x.dir < 0 ? 'down' : 'flat'}">${ar(x.dir)} 5D ${x.chg5d > 0 ? '+' : ''}${x.chg5d.toFixed(2)}${x.unit === '%' ? 'pt' : '%'}</span>
      <span class="g" title="effect on gold">${x.goldEffect > 0 ? '<b class="up">AU ↑</b>' : x.goldEffect < 0 ? '<b class="down">AU ↓</b>' : '<b class="flat">AU ·</b>'}</span>
      <div class="fa">${esc(x.noteFa)}</div></div>`).join('')}
    ${m.goldSilverRatio ? `<div class="drv2"><span class="n">GOLD/SILVER</span><span class="v num">${m.goldSilverRatio.toFixed(1)}</span><span></span><span></span></div>` : ''}
    <p class="demo-note" style="color:var(--ink-3)">${esc(m.source)} · daily · ${t('age')} ${fmtAge(now - m.fetchedAt)} · <span class="fa" style="display:inline">فقط زمینه‌ی کلان؛ در امتیاز تصمیم حساب نمی‌شود.</span></p>`;
}

/* ---------- day selection (shared by Focus and Calendar) ---------- */
const DAY_TZ = CONFIG.timelineTz;
const dayId = (ts) => { const p = zonedParts(new Date(ts), DAY_TZ); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`; };
let selDay = null;   // null = today
const faDay = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: DAY_TZ, weekday: 'long', day: 'numeric', month: 'long' });
const faWd = new Intl.DateTimeFormat('fa-IR', { timeZone: DAY_TZ, weekday: 'long' });
function dayLabel(id, todayId) {
  const d0 = Date.parse(todayId + 'T12:00:00Z'), d = Date.parse(id + 'T12:00:00Z'), diff = Math.round((d - d0) / 86400000);
  const rel = { 0: t('dToday'), 1: t('dTomorrow'), 2: t('dAfter') }[diff];
  const wd = faWd.format(new Date(d));
  return { main: rel || (getLang() === 'fa' ? wd : new Date(d).toUTCString().slice(0, 3)), sub: id.slice(5) };
}
function dayPicker(events) {
  const todayId = dayId(Date.now()), cur = selDay || todayId;
  const ids = [...new Set(events.map((e) => dayId(e.ts)))].filter((d) => d >= todayId).sort();
  if (!ids.includes(todayId)) ids.unshift(todayId);
  const hi = (id) => events.filter((e) => dayId(e.ts) === id && e.impact === 'HIGH').length;
  return `<div class="days">${ids.map((id) => { const l = dayLabel(id, todayId); const n = hi(id);
    return `<button type="button" data-day="${id}" class="${id === cur ? 'on' : ''}">${esc(l.main)}<small>${l.sub}${n ? ` · <span class="cnt">${n} HIGH</span>` : ''}</small></button>`; }).join('')}
    <input type="date" data-daypick value="${cur}" min="${ids[0]}" max="${ids[ids.length - 1]}" aria-label="date"></div>`;
}
const dayEvents = (events) => { const cur = selDay || dayId(Date.now()); return events.filter((e) => dayId(e.ts) === cur); };

/* ---------- Gold & USD focus ---------- */
const RULE_RANK = { rate: 9, cpi: 8, nfp: 8, cbspeak: 6, unemp: 6, gdp: 5, pmi: 4, retail: 4, crude: 3, opec: 3 };
const IMP_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const prio = (e) => IMP_RANK[e.impact] * 10 + (RULE_RANK[e.kb && e.kb.rule] || 0);
const UP = '<b class="up">بالا برود ▲</b>', DOWN = '<b class="down">پایین بیاید ▼</b>';

/** Persian sentence: how `target` ('gold' | 'usd') may react to event e. */
function focusSentence(e, target) {
  const k = e.kb, at = `ساعت ${hm(new Date(e.ts), DAY_TZ)}`;
  const who = target === 'gold' ? 'طلا' : 'دلار';
  let dir;   // +1: target tends to rise if the release is ABOVE forecast / hawkish
  if (target === 'gold') dir = k.effects.XAUUSD || 0;
  else dir = e.ccy === 'USD' ? (k.effects.USDJPY || 0) : -(k.effects.EURUSD || k.effects.GBPUSD || -(k.effects.USDJPY || 0) || 0);
  const fc = e.forecast ? ` (پیش‌بینی ${esc(e.forecast)}، قبلی ${esc(e.previous ?? '--')})` : '';
  if (!dir) return `${who} ممکن است ${at} تحت تأثیر <b>${esc(e.title)}</b> نوسان کند؛ جهت به جزئیات خبر بستگی دارد.`;
  if (k.noDirection) return `${who} ${at} تحت تأثیر <b>${esc(e.title)}</b>: لحن انقباضی ← ${who} ممکن است ${dir > 0 ? UP : DOWN}؛ لحن انبساطی ← ممکن است ${dir > 0 ? DOWN : UP}.`;
  return `${who} ${at} تحت تأثیر <b>${esc(e.title)}</b>${fc}: اگر عدد بالاتر از پیش‌بینی بیاید ${who} ممکن است ${dir > 0 ? UP : DOWN}؛ اگر پایین‌تر بیاید ممکن است ${dir > 0 ? DOWN : UP}.`;
}

function renderFocus() {
  const c = SNAP && SNAP.calendar, now = Date.now(), st = calStatus(now);
  const head = `<div class="card-h"><h2>${t('focus')}</h2>${pill(st.toLowerCase(), t(st.toLowerCase()))}</div>`;
  if (!c || !c.events) { $('focus').innerHTML = `${head}<p class="demo-note" style="color:var(--ink-3)">${esc(SNAP_ERR || t('unavailable'))}</p>`; return; }
  const evs = dayEvents(c.events).filter((e) => e.kb && e.impact !== 'LOW');
  const gold = evs.filter((e) => e.kb.relevance.includes('XAUUSD')).sort((a, b) => prio(b) - prio(a) || a.ts - b.ts);
  const usd = evs.filter((e) => e.ccy === 'USD' || (['EUR', 'GBP', 'JPY'].includes(e.ccy) && e.impact === 'HIGH')).sort((a, b) => prio(b) - prio(a) || a.ts - b.ts);
  const cur = selDay || dayId(now), lbl = faDay.format(new Date(Date.parse(cur + 'T12:00:00Z')));
  const box = (title, sub, list, target) => `<div class="fbox"><h3>${title}<span class="fa">${esc(sub)}</span></h3>
    ${list.length ? list.map((e, i) => `<div class="fitem"><div><div class="tm">${hm(new Date(e.ts), DAY_TZ)}</div><div class="rank">#${i + 1} <span class="imp ${e.impact}">${e.impact}</span></div><div class="rank">${esc(e.ccy)}</div></div>
      <div><div class="fa">${focusSentence(e, target)}</div></div></div>`).join('')
      : `<div class="fempty">برای ${esc(lbl)} رویداد مهمی برای ${target === 'gold' ? 'طلا' : 'دلار'} در تقویم نیست.</div>`}</div>`;
  $('focus').innerHTML = `${head}${dayPicker(c.events)}<div class="focus-grid">
    ${box('XAUUSD · GOLD', `طلا · ${lbl}`, gold, 'gold')}${box('USD · DOLLAR', `دلار · ${lbl}`, usd, 'usd')}</div>
    <p class="demo-note" style="color:var(--ink-3)"><span class="fa" style="display:inline">مرتب‌شده بر اساس اهمیت خبر. «ممکن است» یعنی واکنش معمول بازار، نه پیش‌بینی قطعی؛ واکنش واقعی به فاصله‌ی عدد با پیش‌بینی و شرایط آن روز بستگی دارد.</span> · ${esc(DAY_TZ)}</p>`;
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
  const now = Date.now(), st = calStatus(now), tz = CONFIG.timelineTz, c0 = SNAP && SNAP.calendar;
  const c = SNAP && SNAP.calendar;
  const head = `<div class="card-h"><h2>${t('events')}</h2>${pill(st.toLowerCase(), t(st.toLowerCase()))}</div>
    ${c0 && c0.events ? dayPicker(c0.events) : ''}<div class="filters">${FILTERS.map((f) => `<button type="button" data-evf="${f}" class="${f === evFilter ? 'on' : ''}">${f}</button>`).join('')}</div>`;
  if (!c || !c.events) { $('events').innerHTML = `${head}<p class="demo-note" style="color:var(--ink-3)">${esc(SNAP_ERR || t('unavailable'))}</p>`; return; }
  const list = dayEvents(c.events).filter(eventPasses).slice(0, 40);
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

function renderPerf() {
  const p = SNAP && SNAP.performance;
  const head = `<div class="card-h"><h2>${t('trackRecord')} · XAUUSD</h2>${p ? `<span class="pill muted">${p.rows} ${t('records')}</span>` : ''}</div>`;
  if (!p) { $('perf').innerHTML = `${head}<p class="fa">سابقه هنوز ثبت نشده؛ از این به بعد هر اجرا (هر ~۱۵ دقیقه) ذخیره می‌شود. بعد از چند روز نتیجه‌ی واقعی سیگنال‌ها اینجا نمایش داده می‌شود.</p>`; return; }
  const tbl = (title, d) => `<div><div class="k" style="font:600 10px var(--sans);letter-spacing:1.2px;color:var(--ink-3);margin-bottom:6px">${title}</div>
    <table><tr><th>${t('reading')}</th><th>n</th><th>${t('avgMove')}</th><th>${t('hit')}</th></tr>
    ${Object.entries(d).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td class="${v.avgAtr > 0 ? 'up' : v.avgAtr < 0 ? 'down' : ''}">${v.avgAtr > 0 ? '+' : ''}${v.avgAtr} ATR</td><td>${v.hitPct == null ? '--' : v.hitPct + '%'}</td></tr>`).join('') || '<tr><td colspan="4">--</td></tr>'}</table></div>`;
  $('perf').innerHTML = `${head}<div class="perf-grid">${tbl(t('rating1h') + ' → +1h', p.r1h_1h)}${tbl(t('rating4h') + ' → +4h', p.r4h_4h)}${tbl(t('condition') + ' → +4h', p.band_4h)}</div>
    <p class="fa" style="color:var(--ink-3)">حرکت بعدی قیمت به واحد ATR. «hit» یعنی درصد دفعاتی که قیمت در جهت سیگنال رفته. تا وقتی n کم است (زیر ۱۰۰) نتیجه را جدی نگیرید. از ${esc(p.since ? p.since.slice(0, 10) : '--')}.</p>`;
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
    ${provTable('PRICE', prov)}${provTable('CALENDAR', (SNAP && SNAP.health.calendar) || [])}${provTable('NEWS', (SNAP && SNAP.health.news) || [])}${provTable('ALERTS', (SNAP && SNAP.health.alerts) || [])}`;
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
  safe('assets', renderAssets); safe('levels', renderLevels); safe('drivers', renderDrivers); safe('focus', renderFocus); safe('events', renderEvents); safe('news', renderNews); safe('perf', renderPerf); safe('health', renderHealth); lastMinute = -1; tick();
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
  safe('assets', renderAssets); safe('levels', renderLevels); safe('drivers', renderDrivers); safe('focus', renderFocus); safe('events', renderEvents); safe('news', renderNews); safe('health', renderHealth);
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
$('assets').addEventListener('click', (e) => {
  const tb = e.target.closest('button[data-tf]');
  if (tb) { selTf = tb.dataset.tf; try { localStorage.setItem('tos.tf', selTf); } catch { /* ignore */ } safe('assets', renderAssets); loadTf(selTf); return; }
  const cb = e.target.closest('button[data-chart]'); if (cb) openChart(cb.dataset.chart);
});

let modalSym = null, modalBB = false;
async function openChart(sym) {
  modalSym = sym;
  const m = $('modal'); m.hidden = false; document.body.classList.add('modal-open');
  await renderModal();
}
function closeChart() { $('modal').hidden = true; document.body.classList.remove('modal-open'); import('./chart-view.js').then((cv) => cv.destroyChart()).catch(() => {}); }
async function renderModal() {
  const sym = modalSym, dp = (CONFIG.assetMeta[sym] || {}).dp ?? 2;
  const m = $('modal');
  m.innerHTML = `<div class="mwrap"><div class="mhead"><b class="mono">${sym}</b>
    <div class="filters" style="margin:0">${TFS.map((x) => `<button type="button" data-mtf="${x}" class="${x === selTf ? 'on' : ''}">${x.toUpperCase()}</button>`).join('')}
    <button type="button" data-bb class="${modalBB ? 'on' : ''}">BB</button></div>
    <button type="button" class="mclose" data-close aria-label="close">✕</button></div>
    <div class="mbody"><div class="mchart" id="mchart"><p class="demo-note" style="padding:16px;color:var(--ink-3)">loading…</p></div><div class="mtable" id="mtable"></div></div>
    <div class="mfoot demo-note" id="mfoot"></div></div>`;
  const f = await loadCandleFile(sym, selTf);
  if (!f) { $('mchart').innerHTML = `<p class="demo-note" style="padding:16px">${t('unavailable')}</p>`; return; }
  try {
    const cv = await import('./chart-view.js');
    $('mchart').innerHTML = '';
    await cv.drawChart($('mchart'), f.file, { tz: CONFIG.timelineTz, dp, showBB: modalBB });
  } catch (err) { console.warn('[chart]', err); $('mchart').innerHTML = `<p class="demo-note" style="padding:16px">chart unavailable</p>`; }
  const r = f.rating;
  const tbl = (title, rows, g) => `<div class="tblk"><div class="tsum"><span class="k">${title}</span><b style="color:${RCOL[g.label]}">${t('r_' + g.label.replace(' ', '_').toLowerCase())}</b></div>
    <div class="tcount mono"><span>${t('a_buy')} <b class="up">${g.BUY}</b></span><span>${t('a_neutral')} <b>${g.NEUTRAL}</b></span><span>${t('a_sell')} <b class="down">${g.SELL}</b></span></div>
    <table class="ttab">${rows.map((x) => `<tr><td>${esc(x.name)}</td><td class="mono">${Math.abs(x.value) >= 100 ? x.value.toFixed(dp > 2 ? 2 : dp) : x.value.toFixed(Math.max(2, Math.min(dp, 5)))}</td><td>${ACT(x.action)}</td></tr>`).join('')}</table></div>`;
  $('mtable').innerHTML = `<div class="tblk"><div class="tsum"><span class="k">${t('summary')} · ${selTf.toUpperCase()}</span><b style="color:${RCOL[r.summary.label]};font-size:18px">${t('r_' + r.summary.label.replace(' ', '_').toLowerCase())}</b></div>${ratingMeter(r.summary.score)}</div>
    ${tbl(t('oscillators'), r.oscillators, r.osc)}${tbl(t('movingAverages'), r.movingAverages, r.ma)}`;
  const vol = f.file.volume;
  $('mfoot').innerHTML = `${esc(f.file.source)} · ${fmtAge(Date.now() - f.file.fetchedAt)} · EMA 20/50/200 · Volume: ${vol ? esc(vol.source) + ' (CME/ICE futures)' : '—'} · <span class="fa" style="display:inline">جمع‌بندی اندیکاتورهاست، نه توصیه‌ی معامله.</span>`;
}
$('modal').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === $('modal')) { closeChart(); return; }
  const tb = e.target.closest('button[data-mtf]'); if (tb) { selTf = tb.dataset.mtf; try { localStorage.setItem('tos.tf', selTf); } catch { /* ignore */ } renderModal(); safe('assets', renderAssets); loadTf(selTf); return; }
  if (e.target.closest('button[data-bb]')) { modalBB = !modalBB; renderModal(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeChart(); });

function onDay(id) { selDay = id === dayId(Date.now()) ? null : id; safe('focus', renderFocus); safe('events', renderEvents); }
for (const id of ['focus', 'events']) {
  $(id).addEventListener('click', (e) => { const b = e.target.closest('button[data-day]'); if (b) onDay(b.dataset.day); });
  $(id).addEventListener('change', (e) => { if (e.target.matches('input[data-daypick]') && e.target.value) onDay(e.target.value); });
}
$('levels').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lv]'); if (!b) return;
  lvSym = b.dataset.lv; try { localStorage.setItem('tos.lv', lvSym); } catch { /* ignore */ }
  safe('levels', renderLevels);
});
$('events').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-evf]'); if (!b) return;
  evFilter = b.dataset.evf; try { localStorage.setItem('tos.evf', evFilter); } catch { /* ignore */ }
  safe('events', renderEvents);
});
renderAll();
setInterval(tick, 1000);
refreshData().then(() => loadTf(selTf));
setInterval(() => refreshData().then(() => { FILES.clear(); loadTf(selTf); }), CONFIG.data.refreshMs * 5);
setInterval(refreshData, CONFIG.data.refreshMs);
setInterval(() => { safe('assets', renderAssets); safe('health', renderHealth); }, 30000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e));
}
