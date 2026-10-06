import { CONFIG } from './config.js';
import { zonedParts, serverParts, zoneOffsetMinutes, serverOffsetMinutes, zonedToUtc, fmtHMS, fmtOffset, fmtDuration, pad2 } from './engines/time-engine.js';
import { sessionStates, timelineIntervals } from './engines/session-engine.js';
import { t, getLang, setLang } from './i18n.js';
import { DEMO_ASSETS, DEMO_FACTORS, DEMO_REASONS, DEMO_EVENTS, DEMO_DRIVERS } from './demo-data.js';

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

/** Session factor is computed live from the Session Engine; every other factor is DEMO until providers exist. */
function sessionFactor(ss) {
  if (!ss.marketOpen) return 0;
  const ids = ss.active.map((s) => s.id);
  if (ids.includes('london') && ids.includes('newyork')) return 95;
  if (ids.includes('london') || ids.includes('newyork')) return 78;
  if (ids.includes('tokyo')) return 52;
  return 35;
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

function renderCondition(ss) {
  const f = { ...DEMO_FACTORS, session: sessionFactor(ss) };
  const W = CONFIG.conditionWeights, tot = Object.values(W).reduce((a, b) => a + b, 0);
  const score = Math.round(Object.keys(W).reduce((s, k) => s + (f[k] ?? 0) * W[k], 0) / tot);
  const plus = [], minus = [];
  if (ss.overlaps.length) plus.push(`${ss.overlaps.map((o) => `${o[0].name}/${o[1].name}`).join(', ')} ${t('overlap').toLowerCase()}`);
  else if (!ss.marketOpen) minus.push(t('marketClosed'));
  else if (f.session < 60) minus.push(`Low-liquidity session (${ss.active.map((s) => s.name).join(', ') || t('none')})`);
  const order = ['session', 'liquidity', 'volatility', 'news', 'structure', 'momentum', 'regime', 'spread'];
  $('condition').innerHTML = `<div class="card-h"><h2>${t('marketCondition')}</h2>${pill('demo', t('demo'))}</div>
    <div class="cond-body">
      <div class="gauge">${gaugeSvg(score)}<div class="val num" style="color:${scoreColor(score)}">${score}</div><div class="state" style="color:${scoreColor(score)}">${esc(bandLabel(score))}</div></div>
      <div class="bars">${order.map((k) => `<div class="bar"><span class="k">${esc(t(k === 'news' ? 'news' : k))}${k === 'session' ? ' ●' : ''}</span>
        <span class="track"><span class="fill" style="width:${f[k]}%;background:${scoreColor(f[k])}"></span></span><span class="v">${f[k]}</span></div>`).join('')}</div>
    </div>
    <div class="why"><b>${t('why')}</b>${[...plus, ...DEMO_REASONS.plus].map((x) => `<span class="p">+ ${esc(x)}</span>`).join('')}${[...minus, ...DEMO_REASONS.minus].map((x) => `<span class="m">− ${esc(x)}</span>`).join('')}</div>
    <p class="demo-note">● ${esc(t('session'))} = LIVE (Session Engine). ${esc(t('demoNote'))}</p>`;
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
  $('assets').innerHTML = DEMO_ASSETS.map((a) => {
    const cls = a.chg > 0 ? 'up' : a.chg < 0 ? 'down' : 'flat';
    const tr = a.trend > 0 ? '▲ BULLISH' : a.trend < 0 ? '▼ BEARISH' : '◆ NEUTRAL';
    return `<article class="card asset"><div class="row1"><span class="sym">${a.sym}</span>${pill('demo', t('demo'))}</div>
      <div class="px num">${a.price.toFixed(a.dp)}</div><div class="chg ${cls} num">${a.chg > 0 ? '▲ +' : a.chg < 0 ? '▼ ' : ''}${a.chg.toFixed(2)}%</div>
      ${sparkSvg(a.spark, a.trend)}
      <div class="kv"><span class="k">${t('trend')}</span><span class="v ${a.trend > 0 ? 'up' : a.trend < 0 ? 'down' : 'flat'}">${tr}</span>
        <span class="k">${t('structure')}</span><span class="v">${esc(a.structure)}</span>
        <span class="k">${t('momentum')}</span><span class="meter"><i style="width:${a.momentum}%"></i></span>
        <span class="k">${t('volatility')}</span><span class="meter"><i style="width:${a.volatility}%;background:var(--warn)"></i></span>
        <span class="k">${t('regime')}</span><span class="v">${esc(a.regime)}</span></div>
      <div class="cond"><span class="k" style="font-size:11px;color:var(--ink-3)">${t('condition')}</span><span class="score num" style="color:${scoreColor(a.condition)}">${a.condition}</span></div></article>`;
  }).join('');
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

function renderEvents() {
  $('events').innerHTML = `<div class="card-h"><h2>${t('events')}</h2>${pill('demo', t('demo'))}</div>
    ${DEMO_EVENTS.map((e) => `<div class="evt"><span class="tm num">${e.time}</span><div>
      <div><span class="imp ${e.impact}">${e.impact}</span> <span class="mono" style="color:var(--ink-3);font-size:11px">${e.ccy}</span></div>
      <div class="ttl">${esc(e.title)}</div>
      <div class="meta"><span>${t('actual')} ${e.actual ?? '--'}</span><span>${t('forecast')} ${e.forecast ?? '--'}</span><span>${t('previous')} ${e.previous ?? '--'}</span></div>
      <div class="meta"><span>${t('potential')}: ${e.rel.join(' · ')}</span></div></div></div>`).join('')}`;
}

function renderHealth() {
  const online = navigator.onLine;
  const cells = [
    [t('timeEngine'), pill('live', t('live')), 'Intl / IANA · ' + t('local')],
    [t('price'), pill('demo', t('demo')), t('notConfigured')],
    [t('newsTab'), pill('demo', t('demo')), t('notConfigured')],
    [t('calendar'), pill('demo', t('demo')), t('notConfigured')],
    [t('volatility'), pill('demo', t('demo')), t('notConfigured')],
    ['NETWORK', online ? pill('live', t('online')) : pill('offline', t('offline')), online ? 'navigator.onLine' : 'cached shell'],
  ];
  $('health').innerHTML = `<div class="card-h"><h2>${t('dataHealth')}</h2></div>
    <div class="health-grid">${cells.map(([k, p, d]) => `<div class="hcell"><div class="k">${esc(k)}</div>${p}<div class="d">${esc(d)}</div></div>`).join('')}</div>`;
  $('net-pill').className = `pill ${online ? 'live' : 'offline'}`;
  $('net-pill').textContent = `${t('system')} ${online ? t('online') : t('offline')}`;
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
  safe('sessions', () => { ss = sessionStates(now, CONFIG); renderSessions(ss, now); });
  const m = Math.floor(now.getTime() / 60000);
  if (m !== lastMinute && ss) { lastMinute = m; safe('condition', () => renderCondition(ss)); safe('timeline', () => renderTimeline(now)); }
}
function renderAll() {
  lastMinute = -1; staticText();
  safe('assets', renderAssets); safe('drivers', renderDrivers); safe('events', renderEvents); safe('health', renderHealth);
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
renderAll();
setInterval(tick, 1000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e));
}
