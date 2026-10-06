import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsiSeries, macd, stoch, cci, adx, williamsR, bollinger, technicalRating, label, aggregate, hma } from '../public/assets/js/core/technicals.js';

const mk = (v) => v.map((c, i) => ({ t: i * 3600000, o: c, h: c + 1, l: c - 1, c }));
test('SMA/EMA basics', () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const e = ema([1, 2, 3, 4, 5], 3); assert.equal(e[2], 2); assert.equal(e[3], 3); assert.equal(e[4], 4);
});
test('RSI: Wilder reference values', () => {
  // classic Wilder sample (14 periods)
  const p = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  const r = rsiSeries(p, 14);
  assert.ok(Math.abs(r[14] - 70.46) < 0.1, `rsi14=${r[14]}`);
  assert.ok(Math.abs(r[19] - 57.92) < 0.3, `rsi19=${r[19]}`);
});
test('MACD sign follows trend', () => {
  const up = macd(Array.from({ length: 80 }, (_, i) => 100 + i)); assert.ok(up.macd[79] > 0);
  const dn = macd(Array.from({ length: 80 }, (_, i) => 200 - i)); assert.ok(dn.macd[79] < 0);
});
test('oscillator bounds', () => {
  const c = mk(Array.from({ length: 120 }, (_, i) => 100 + 5 * Math.sin(i / 5)));
  const s = stoch(c); assert.ok(s.k.filter((x) => x != null).every((x) => x >= 0 && x <= 100));
  assert.ok(williamsR(c).filter((x) => x != null).every((x) => x <= 0 && x >= -100));
  const a = adx(c); assert.ok(a.adx.filter((x) => x != null).every((x) => x >= 0 && x <= 100));
  assert.ok(cci(c).some((x) => x != null));
  const b = bollinger(c.map((x) => x.c)); assert.ok(b.up[119] > b.mid[119] && b.dn[119] < b.mid[119]);
  assert.ok(hma(c.map((x) => x.c), 9).filter((x) => x != null).length > 100);
});
test('strong uptrend -> BUY side rating, downtrend -> SELL', () => {
  const up = technicalRating(mk(Array.from({ length: 260 }, (_, i) => 100 + i * 0.5 + Math.sin(i))));
  assert.ok(up.ma.score > 0.8, `ma ${up.ma.score}`); assert.ok(['BUY', 'STRONG BUY'].includes(up.summary.label));
  const dn = technicalRating(mk(Array.from({ length: 260 }, (_, i) => 300 - i * 0.5 + Math.sin(i))));
  assert.ok(['SELL', 'STRONG SELL'].includes(dn.summary.label));
  assert.ok(up.oscillators.length >= 10 && up.movingAverages.length >= 13);
});
test('short history drops long MAs instead of inventing values', () => {
  const r = technicalRating(mk(Array.from({ length: 60 }, (_, i) => 100 + i)));
  assert.ok(!r.movingAverages.some((x) => x.name === 'SMA (200)'));
});
test('labels and 4h aggregation', () => {
  assert.equal(label(0.6), 'STRONG BUY'); assert.equal(label(0), 'NEUTRAL'); assert.equal(label(-0.3), 'SELL');
  const h = aggregate(Array.from({ length: 8 }, (_, i) => ({ t: i * 3600000, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 10 })), 4 * 3600000);
  assert.equal(h.length, 2); assert.deepEqual(h[0], { t: 0, o: 0, h: 4, l: -1, c: 3.5, v: 40 });
});
