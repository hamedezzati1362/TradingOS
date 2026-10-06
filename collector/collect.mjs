// Data collector: runs in GitHub Actions (or locally). Fetches candles through the ProviderManager, analyses them,
// and writes public/data/snapshot.json. Previous published snapshot = last-known-good cache.
// Usage: node collector/collect.mjs <outFile> [previousSnapshotUrl]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ProviderManager, MemoryCache, redact } from '../public/assets/js/core/provider-manager.js';
import { analyse, keyLevels } from '../public/assets/js/core/market-engines.js';
import { twelveData, yahoo } from './providers.mjs';
import { SOURCES } from './sources.config.mjs';
import { validateCandles } from './validate.mjs';
import { forexFactory, finnhubCalendar, finnhubNews, googleNews } from './news-providers.mjs';
import { validateEventList, dedupeEvents } from '../public/assets/js/core/validators.js';
import { explainEvent, explainHeadline } from '../public/assets/js/core/impact-kb.js';
import { MACRO, driverStats, goldBias } from '../public/assets/js/core/macro-engine.js';

const [out, prevUrl] = process.argv.slice(2);
const log = [];
const L = (level, msg) => { const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redact(msg)}`; log.push(line); console.log(line); };

async function loadPrevious() {
  if (!prevUrl) return null;
  try { const r = await fetch(prevUrl, { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
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

const assets = {}, raw = {};
for (const sym of SOURCES.assets) {
  // Daily candles change slowly: refresh every 6h, otherwise reuse the cached set (saves API credits).
  const dkey = `${sym}:1day`, dc = cache.get(dkey);
  let daily = dc ? dc.data.candles : null;
  if (!dc || Date.now() - dc.fetchedAt > 6 * 3600000) {
    const dr = await pm.get(dkey, { interval: '1day', bars: 40 });
    if (dr.data) { daily = dr.data.candles; raw[dkey] = { data: dr.data, source: dr.source, fetchedAt: dr.fetchedAt }; }
    if (providers[0] && providers[0].name === 'TwelveData') await new Promise((res) => setTimeout(res, 8000));
  } else raw[dkey] = dc;
  const r = await pm.get(sym, { interval: '15min', bars: 500 });
  if (r.data) {
    raw[sym] = { data: { ...r.data, candles: r.data.candles.slice(-150) }, source: r.source, fetchedAt: r.fetchedAt };
    let a = null;
    try { a = analyse(r.data.candles); } catch (e) { L('error', `${sym}: analysis failed ${e.message}`); }
    try { if (a) a.levels = keyLevels(r.data.candles, daily); } catch (e) { L('error', `${sym}: levels failed ${e.message}`); }
    assets[sym] = { status: r.status, source: r.source, ref: r.data.ref, fetchedAt: r.fetchedAt, proxy: SOURCES.proxyNote[`${r.source}:${sym}`] || null, ...(a || {}) };
  } else assets[sym] = { status: 'UNAVAILABLE', source: null };
  if (providers[0] && providers[0].name === 'TwelveData') await new Promise((res) => setTimeout(res, 8000)); // free tier: 8 req/min
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

const snapshot = { version: 1, generatedAt: Date.now(), interval: '15min', assets, calendar, news, macro,
  health: { price: pm.health(), calendar: calPm.health(), news: newsPm.health(), macro: macroPm.health() }, log: log.slice(-80), raw,
  rawLists: Object.fromEntries(['calendar', 'news'].map((k) => [k, cache.get(k)]).filter(([, v]) => v)) };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snapshot));
L('info', `snapshot written: ${Object.values(assets).map((a) => a.status).join(',')}`);
