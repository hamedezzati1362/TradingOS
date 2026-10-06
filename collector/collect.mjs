// Data collector: runs in GitHub Actions (or locally). Fetches candles through the ProviderManager, analyses them,
// and writes public/data/snapshot.json. Previous published snapshot = last-known-good cache.
// Usage: node collector/collect.mjs <outFile> [previousSnapshotUrl]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ProviderManager, MemoryCache, redact } from '../public/assets/js/core/provider-manager.js';
import { analyse, keyLevels } from '../public/assets/js/core/market-engines.js';
import { technicalRating, aggregate } from '../public/assets/js/core/technicals.js';
import { twelveData, yahoo } from './providers.mjs';
import { SOURCES } from './sources.config.mjs';
import { validateCandles } from './validate.mjs';
import { forexFactory, finnhubCalendar, finnhubNews, googleNews } from './news-providers.mjs';
import { validateEventList, dedupeEvents } from '../public/assets/js/core/validators.js';
import { explainEvent, explainHeadline } from '../public/assets/js/core/impact-kb.js';
import { MACRO, driverStats, goldBias } from '../public/assets/js/core/macro-engine.js';
import { buildAlerts, deliver, morningBrief } from './alerts.mjs';
import { assetCondition } from '../public/assets/js/core/asset-condition.js';
import { CONFIG } from '../public/assets/js/config.js';
import { appendHistory } from './history.mjs';
import { loadHistory, performanceSummary } from './evaluate.mjs';

const [out, prevUrl] = process.argv.slice(2);
const log = [];
const L = (level, msg) => { const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redact(msg)}`; log.push(line); console.log(line); };

async function loadPrevious() {
  if (!prevUrl) return null;
  try { const r = await fetch(prevUrl, { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const candleDir = join(dirname(out), 'candles');
mkdirSync(candleDir, { recursive: true });
function writeCandleFile(sym, tf, obj) { writeFileSync(join(candleDir, `${sym}_${tf}.json`), JSON.stringify(obj)); }

// Real exchange volume from futures (Yahoo, keyless). Separate failover chain: Yahoo -> cached volume.
const volPm = new ProviderManager({ kind: 'volume', cache: new MemoryCache(), providers: [yahoo(SOURCES.volume, 1)], validate: (d) => (d && d.candles && d.candles.length > 20 ? { ok: true } : { ok: false, reason: 'no volume bars' }), log: L, retries: 1, backoffMs: 1000 });
const volCache = new Map();
async function volumeFor(sym, tf) {
  const interval = { '15m': '15min', '1h': '1h', '4h': '1h', '1d': '1day' }[tf];
  const key = `${sym}:${interval}`;
  if (!volCache.has(key)) volCache.set(key, await volPm.get(key, { interval }));
  const r = volCache.get(key);
  if (!r.data) return null;
  let bars = r.data.candles.map((x) => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }));
  if (tf === '4h') bars = aggregate(bars, 4 * 3600000);
  return { source: `${r.source} ${r.data.ref}`, status: r.status, bars: bars.slice(-400).map((x) => [x.t, x.v]) };
}

const prev = await loadPrevious();
const cache = new MemoryCache();
if (prev && prev.raw) for (const [k, v] of Object.entries(prev.raw)) cache.set(k.startsWith('macro:') ? k.slice(6) : k, v);
if (prev && prev.rawLists) for (const [k, v] of Object.entries(prev.rawLists)) cache.set(k, v);
L('info', prev ? `previous snapshot loaded (${prev.generatedAt})` : 'no previous snapshot (cold start)');

const providers = [twelveData(process.env.TWELVEDATA_API_KEY, SOURCES.twelveData), yahoo(SOURCES.yahoo)].filter((p) => {
  if (!p.enabled) L('warn', `${p.name} disabled (no API key in environment)`);
  return p.enabled;
});
const pm = new ProviderManager({ kind: 'price', providers, cache, validate: validateCandles, staleAfterMs: 45 * 60000, log: L, retries: 1, backoffMs: 1500 });

const assets = {}, raw = {}, lastBars = {};
for (const sym of SOURCES.assets) {
  // Higher timeframes refresh on their own cadence (saves API credits); 15m every run.
  const tfData = {};
  for (const [tf, cfg] of Object.entries(SOURCES.timeframes)) {
    if (tf === '15m') continue;
    const key = `${sym}:${cfg.interval}`, cached = cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < cfg.refreshMs && cached.data.candles.length >= (tf === '1d' ? 200 : 300)) { tfData[tf] = cached; raw[key] = cached; continue; }
    const tr = await pm.get(key, { interval: cfg.interval, bars: cfg.bars });
    if (tr.data) { tfData[tf] = { data: tr.data, source: tr.source, fetchedAt: tr.fetchedAt, status: tr.status }; raw[key] = { data: tr.data, source: tr.source, fetchedAt: tr.fetchedAt }; }
    if (tr.source === 'TwelveData') await sleep(8000);
  }
  const daily = tfData['1d'] ? tfData['1d'].data.candles : null;
  const r = await pm.get(sym, { interval: '15min', bars: 500 });
  if (r.data) {
    lastBars[sym] = r.data.candles.slice(-2);
    raw[sym] = { data: { ...r.data, candles: r.data.candles.slice(-150) }, source: r.source, fetchedAt: r.fetchedAt };
    let a = null;
    try { a = analyse(r.data.candles); } catch (e) { L('error', `${sym}: analysis failed ${e.message}`); }
    try { if (a) a.levels = keyLevels(r.data.candles, daily, { sessions: CONFIG.sessions }); } catch (e) { L('error', `${sym}: levels failed ${e.message}`); }
    // Per-timeframe candle files for charts + technical rating summary for cards.
    const series = { '15m': { data: r.data, source: r.source, fetchedAt: r.fetchedAt, status: r.status }, ...tfData };
    if (series['1h']) series['4h'] = { ...series['1h'], data: { ...series['1h'].data, candles: aggregate(series['1h'].data.candles, 4 * 3600000) } };
    if (a) a.tech = {};
    for (const [tf, sd] of Object.entries(series)) {
      const vol = await volumeFor(sym, tf);
      const cs = sd.data.candles.slice(-400);
      try { if (a) { const tr = technicalRating(cs); a.tech[tf] = { summary: tr.summary, osc: tr.osc, ma: tr.ma, status: sd.status || 'CACHE', fetchedAt: sd.fetchedAt, source: sd.source }; } }
      catch (e) { L('error', `${sym} ${tf}: rating failed ${e.message}`); }
      writeCandleFile(sym, tf, { sym, tf, source: sd.source, ref: sd.data.ref, fetchedAt: sd.fetchedAt, status: sd.status || 'CACHE',
        candles: cs.map((x) => [x.t, x.o, x.h, x.l, x.c]), volume: vol });
    }
    assets[sym] = { status: r.status, source: r.source, ref: r.data.ref, fetchedAt: r.fetchedAt, proxy: SOURCES.proxyNote[`${r.source}:${sym}`] || null, ...(a || {}) };
  } else assets[sym] = { status: 'UNAVAILABLE', source: null };
  if (r.source === 'TwelveData') await sleep(8000); // free tier: 8 req/min
}

// ---- Economic calendar ----
const listValidator = (min) => (d) => { const v = validateEventList(d, { minValidRatio: 0.8 }); return v.ok && v.items.length >= min ? { ok: true, value: v.items } : { ok: false, reason: v.reason || `only ${v.items ? v.items.length : 0} items` }; };
const calPm = new ProviderManager({ kind: 'calendar', cache, providers: [forexFactory(), finnhubCalendar(process.env.FINNHUB_API_KEY)].filter((p) => p.enabled !== false),
  validate: listValidator(5), staleAfterMs: 24 * 3600000, log: L, retries: 1, backoffMs: 1500 });
const cal = await calPm.get('calendar');
let calendar = { status: cal.status, source: cal.source, fetchedAt: cal.fetchedAt, events: [] };
if (cal.data) {
  const nowMs = Date.now();
  const d = dedupeEvents(cal.data.filter((e) => e.ts >= nowMs - 12 * 3600000 && e.ts <= nowMs + 7 * 86400000).sort((a, b) => a.ts - b.ts));
  if (d.removed) L('info', `calendar: ${d.removed} duplicate events removed`);
  calendar.events = d.items.map((e) => ({ ...e, kb: explainEvent(e) }));
}

// ---- News headlines ----
const newsPm = new ProviderManager({ kind: 'news', cache, providers: [finnhubNews(process.env.FINNHUB_API_KEY), googleNews()].filter((p) => p.enabled !== false),
  validate: listValidator(3), staleAfterMs: 6 * 3600000, log: L, retries: 1, backoffMs: 1500 });
const nr = await newsPm.get('news');
let news = { status: nr.status, source: nr.source, fetchedAt: nr.fetchedAt, items: [] };
if (nr.data) {
  const fresh = nr.data.filter((n) => n.ts >= Date.now() - 48 * 3600000).sort((a, b) => b.ts - a.ts);
  const d = dedupeEvents(fresh.map((n) => ({ ...n, ccy: '' })), { windowMs: 12 * 3600000 });
  if (d.removed) L('info', `news: ${d.removed} duplicate headlines removed`);
  news.items = d.items.map((n) => ({ title: n.title, ts: n.ts, url: n.url, source: n.source, kb: explainHeadline(`${n.title} ${n.summary || ''}`) }))
    .filter((n) => n.kb).slice(0, 20);
}

// ---- Macro drivers (context only) ----
const macroPm = new ProviderManager({ kind: 'macro', cache, providers: [yahoo(Object.fromEntries(MACRO.map((m) => [m.id, m.yahoo])), 1)],
  validate: (d, k, ctx) => validateCandles(d, `${k}:1day`, ctx), staleAfterMs: 3 * 86400000, log: L, retries: 1, backoffMs: 1500 });
const macroItems = []; let macroStatus = 'LIVE', macroFetched = Date.now(), macroSrc = 'Yahoo';
for (const m of MACRO) {
  const r = await macroPm.get(m.id, { interval: '1day' });
  if (r.data) {
    raw[`macro:${m.id}`] = { data: { ...r.data, candles: r.data.candles.slice(-30) }, source: r.source, fetchedAt: r.fetchedAt };
    const st = driverStats(m, r.data.candles);
    if (st) macroItems.push({ id: m.id, name: m.name, unit: m.unit, dp: m.dp, status: r.status, ...st });
    if (r.status !== 'LIVE') macroStatus = r.status; macroFetched = Math.min(macroFetched, r.fetchedAt);
  } else macroStatus = 'UNAVAILABLE';
}
const gsr = assets.XAUUSD && assets.XAUUSD.price && macroItems.find((x) => x.id === 'SILVER') ? assets.XAUUSD.price / macroItems.find((x) => x.id === 'SILVER').value : null;
const macro = { status: macroItems.length ? macroStatus : 'UNAVAILABLE', source: macroSrc, fetchedAt: macroItems.length ? macroFetched : null,
  items: macroItems, goldBias: macroItems.length ? goldBias(macroItems) : null, goldSilverRatio: gsr };

// ---- Condition per asset (same engine as the dashboard) ----
const conditions = {};
for (const sym of SOURCES.assets) { try { conditions[sym] = assetCondition(sym, { asset: assets[sym], calendar, cfg: CONFIG }); } catch (e) { L('error', `${sym}: condition failed ${e.message}`); } }

// ---- History (durable, written to the 'history' branch by the workflow) ----
if (process.env.HISTORY_DIR) {
  try { appendHistory(process.env.HISTORY_DIR, { now: Date.now(), assets, conditions }); L('info', 'history record appended'); }
  catch (e) { L('error', `history failed: ${e.message}`); }
}
let performance = null;
try { performance = performanceSummary(loadHistory(process.env.HISTORY_DIR)); } catch (e) { L('error', `track record failed: ${e.message}`); }

// ---- Alerts (Bale / Telegram) ----
let alertState = { sent: (prev && prev.alerts && prev.alerts.sent) || {}, health: [] };
try {
  const pending = buildAlerts({ calendar, assets, sent: alertState.sent, condition: conditions, macro, lastBars });
  if (process.env.ALERT_TEST === '1') pending.push({ id: `test:${Date.now()}`, text: '✅ TradingOS: پیام آزمایشی. اتصال هشدارها برقرار است.' });
  if (process.env.ALERT_TEST === 'brief' && assets.XAUUSD && assets.XAUUSD.price != null) {
    const now = Date.now(), today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date(now));
    pending.push({ id: `test-brief:${now}`, text: '🧪 (نمونه‌ی آزمایشی)\n' + morningBrief({ g: assets.XAUUSD, calendar, now, today, condition: conditions.XAUUSD, macro }) });
  }
  alertState = await deliver(pending, alertState.sent, process.env, L);
} catch (e) { L('error', `alerts failed: ${e.message}`); }

const snapshot = { version: 1, generatedAt: Date.now(), interval: '15min', assets, calendar, news, macro, performance, conditions, alerts: { sent: alertState.sent, configured: !!(process.env.BALE_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN) },
  health: { price: pm.health(), calendar: calPm.health(), news: newsPm.health(), macro: macroPm.health(), alerts: alertState.health }, log: log.slice(-80), raw,
  rawLists: Object.fromEntries(['calendar', 'news'].map((k) => [k, cache.get(k)]).filter(([, v]) => v)) };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snapshot));
L('info', `snapshot written: ${Object.values(assets).map((a) => a.status).join(',')}`);
