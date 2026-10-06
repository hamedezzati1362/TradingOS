import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, structure, regime, atrSeries, atrPercentile, rsi, efficiencyRatio } from '../public/assets/js/core/market-engines.js';
import { validateCandles } from '../collector/validate.mjs';
import { displayStatus } from '../public/assets/js/data-client.js';

const T0 = Date.UTC(2026, 9, 1), M15 = 900000;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mk = (closes) => closes.map((c, i) => { const w = 0.3 + rnd() * 0.6; return { t: T0 + i * M15, o: c, h: c + w, l: c - w, c }; });
const zig = (n, slope, amp = 3, per = 10) => Array.from({ length: n }, (_, i) => 100 + i * slope + amp * Math.sin((i / per) * 2 * Math.PI));

test('uptrend with pullbacks -> HH→HL or BOS↑, bias +1', () => {
  const s = structure(mk(zig(200, 0.3)));
  assert.equal(s.bias, 1);
});
test('downtrend -> bias -1', () => { assert.equal(structure(mk(zig(200, -0.3))).bias, -1); });
test('flat oscillation -> RANGING regime, low efficiency', () => {
  const a = analyse(mk(zig(250, 0)));
  assert.ok(a.er < 0.2); assert.equal(a.regime, 'RANGING');
});
test('strong steady trend -> TRENDING', () => {
  const a = analyse(mk(zig(250, 0.6, 2.5)));
  assert.equal(a.regime, 'TRENDING');
});
test('volatility expansion -> high ATR percentile', () => {
  const closes = zig(250, 0, 1).map((v, i) => (i > 235 ? v + (i % 2 ? 8 : -8) : v));
  const c = closes.map((x, i) => ({ t: T0 + i * M15, o: x, h: x + (i > 235 ? 8 : 0.5), l: x - (i > 235 ? 8 : 0.5), c: x }));
  assert.ok(atrPercentile(atrSeries(c)) >= 90);
  assert.equal(regime({ er: 0.5, atrPct: 95, structBias: 1 }), 'HIGH VOLATILITY');
});
test('RSI bounds and 24h change', () => {
  const r = rsi(mk(zig(100, 1, 0))); assert.equal(r, 100);
  const a = analyse(mk(Array.from({ length: 200 }, (_, i) => 100 + i)));
  assert.ok(a.changePct > 0);
  assert.equal(efficiencyRatio(mk(Array.from({ length: 30 }, (_, i) => i + 1))), 1);
});
test('candle validation: too few, malformed, future, jump', () => {
  const now = T0 + 300 * M15;
  const good = { candles: mk(zig(200, 0)).map((x) => ({ ...x, t: x.t + 100 * M15 })) };
  assert.equal(validateCandles(good, 'X', { now }).ok, true);
  assert.equal(validateCandles({ candles: mk(zig(50, 0)) }, 'X', { now }).ok, false);
  assert.equal(validateCandles({ candles: good.candles.map((x, i) => (i % 10 ? x : { ...x, c: NaN })) }, 'X', { now }).ok, false);
  assert.equal(validateCandles(good, 'X', { now: T0 }).ok, false);
  const prev = { candles: [{ c: 50 }] };
  assert.match(validateCandles(good, 'X', { now, prev }).reason, /jump/);
});
test('display status ages LIVE -> CACHE -> STALE', () => {
  const cfg = { liveMaxAgeMs: 25 * 60000, staleAfterMs: 45 * 60000 }, n = Date.now();
  assert.equal(displayStatus('LIVE', n - 5 * 60000, n, cfg), 'LIVE');
  assert.equal(displayStatus('LIVE', n - 30 * 60000, n, cfg), 'CACHE');
  assert.equal(displayStatus('FALLBACK', n - 60 * 60000, n, cfg), 'STALE');
  assert.equal(displayStatus('UNAVAILABLE', n, n, cfg), 'UNAVAILABLE');
});
import { keyLevels, serverDayId } from '../public/assets/js/core/market-engines.js';
test('broker day rolls at 17:00 New York (EDT and EST)', () => {
  assert.equal(serverDayId(Date.UTC(2026, 6, 15, 20, 59)), '2026-07-15');   // 16:59 EDT
  assert.equal(serverDayId(Date.UTC(2026, 6, 15, 21, 0)), '2026-07-16');    // 17:00 EDT
  assert.equal(serverDayId(Date.UTC(2026, 0, 15, 22, 0)), '2026-01-16');    // 17:00 EST
});
test('key levels: PDH/PDL from previous broker day, pivots, ADR%', () => {
  const start = Date.UTC(2026, 6, 13, 21, 0);  // Tue 00:00 server
  const m15 = [];
  for (let i = 0; i < 96 * 2; i++) { const day = i < 96 ? 0 : 1; const base = day ? 110 : 100; m15.push({ t: start + i * M15, o: base, h: base + 2, l: base - 2, c: base + (i % 96) / 96 }); }
  const daily = Array.from({ length: 20 }, (_, i) => ({ t: Date.UTC(2026, 5, 20 + i), o: 100, h: 105, l: 95, c: 100 }));
  const L = keyLevels(m15, daily);
  const g = (n) => L.levels.find((x) => x.name === n).price;
  assert.equal(g('PDH'), 102); assert.equal(g('PDL'), 98);
  assert.ok(Math.abs(g('PIVOT') - (102 + 98 + (100 + 95 / 96)) / 3) < 1e-9);
  assert.equal(L.adr, 10); assert.equal(L.todayRange, 4); assert.equal(L.adrPct, 40);
  assert.ok(L.above.price > L.price && L.below.price < L.price);
});
import { sessionLevels } from '../public/assets/js/core/market-engines.js';
import { CONFIG } from '../public/assets/js/config.js';
test('session levels: London high swept then price back inside -> SWEPT; Asia low broken -> BROKEN', () => {
  // Wed 2026-10-07, London 07:00-16:00 UTC (BST), Tokyo 00:00-09:00 UTC
  const t0 = Date.UTC(2026, 9, 7, 0, 0), bars = [];
  for (let i = 0; i < 80; i++) {
    const t = t0 + i * M15, hUTC = i / 4;
    let c = 100;
    if (hUTC >= 7 && hUTC < 16) c = 101 + (hUTC === 12 ? 1 : 0);        // London range 100.5..102.5 (spike at 12:00)
    if (hUTC >= 16 && hUTC < 17) c = 103;                               // NY pushes above London high
    if (hUTC >= 17) c = 101.5;                                          // ...and comes back inside
    if (hUTC >= 9 && hUTC < 10) c = 98;                                 // dips below Asia low after Tokyo close
    bars.push({ t, o: c, h: c + 0.5, l: c - 0.5, c });
  }
  const now = t0 + 80 * M15;
  const L = Object.fromEntries(sessionLevels(bars, CONFIG.sessions, now).map((x) => [x.id, x]));
  assert.equal(L.london.highState.state, 'SWEPT');
  assert.equal(L.tokyo.lowState.state, 'SWEPT');     // dipped below Asia low, then came back inside
  assert.equal(L.newyork.forming, true);
  assert.equal(L.london.stars, 4);
});
test('session levels: price stays beyond London low -> BROKEN; untouched high -> INTACT', () => {
  const t0 = Date.UTC(2026, 9, 7, 7, 0), bars = [];
  for (let i = 0; i < 48; i++) { const c = i < 36 ? 101 : 99; bars.push({ t: t0 + i * M15, o: c, h: c + 0.5, l: c - 0.5, c }); }
  const L = Object.fromEntries(sessionLevels(bars, CONFIG.sessions, t0 + 48 * M15).map((x) => [x.id, x]));
  assert.equal(L.london.lowState.state, 'BROKEN'); assert.equal(L.london.highState.state, 'INTACT');
});
