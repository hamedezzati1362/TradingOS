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
