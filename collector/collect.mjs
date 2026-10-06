// Data collector: runs in GitHub Actions (or locally). Fetches candles through the ProviderManager, analyses them,
// and writes public/data/snapshot.json. Previous published snapshot = last-known-good cache.
// Usage: node collector/collect.mjs <outFile> [previousSnapshotUrl]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ProviderManager, MemoryCache, redact } from '../public/assets/js/core/provider-manager.js';
import { analyse } from '../public/assets/js/core/market-engines.js';
import { twelveData, yahoo } from './providers.mjs';
import { SOURCES } from './sources.config.mjs';
import { validateCandles } from './validate.mjs';

const [out, prevUrl] = process.argv.slice(2);
const log = [];
const L = (level, msg) => { const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redact(msg)}`; log.push(line); console.log(line); };

async function loadPrevious() {
  if (!prevUrl) return null;
  try { const r = await fetch(prevUrl, { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}

const prev = await loadPrevious();
const cache = new MemoryCache();
if (prev && prev.raw) for (const [k, v] of Object.entries(prev.raw)) cache.set(k, v);
L('info', prev ? `previous snapshot loaded (${prev.generatedAt})` : 'no previous snapshot (cold start)');

const providers = [twelveData(process.env.TWELVEDATA_API_KEY, SOURCES.twelveData), yahoo(SOURCES.yahoo)].filter((p) => {
  if (!p.enabled) L('warn', `${p.name} disabled (no API key in environment)`);
  return p.enabled;
});
const pm = new ProviderManager({ kind: 'price', providers, cache, validate: validateCandles, staleAfterMs: 45 * 60000, log: L, retries: 1, backoffMs: 1500 });

const assets = {}, raw = {};
for (const sym of SOURCES.assets) {
  const r = await pm.get(sym, { interval: '15min', bars: 300 });
  if (r.data) {
    raw[sym] = { data: { ...r.data, candles: r.data.candles.slice(-200) }, source: r.source, fetchedAt: r.fetchedAt };
    let a = null;
    try { a = analyse(r.data.candles); } catch (e) { L('error', `${sym}: analysis failed ${e.message}`); }
    assets[sym] = { status: r.status, source: r.source, ref: r.data.ref, fetchedAt: r.fetchedAt, proxy: SOURCES.proxyNote[`${r.source}:${sym}`] || null, ...(a || {}) };
  } else assets[sym] = { status: 'UNAVAILABLE', source: null };
  if (providers[0] && providers[0].name === 'TwelveData') await new Promise((res) => setTimeout(res, 8000)); // free tier: 8 req/min
}

const snapshot = { version: 1, generatedAt: Date.now(), interval: '15min', assets, health: { price: pm.health() }, log: log.slice(-60), raw };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snapshot));
L('info', `snapshot written: ${Object.values(assets).map((a) => a.status).join(',')}`);
