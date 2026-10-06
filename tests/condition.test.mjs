import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCondition, scoreNewsRisk, scoreVolatility, scoreSpread, scoreSession } from '../public/assets/js/core/condition-engine.js';
import { CONFIG } from '../public/assets/js/config.js';
const W = CONFIG.conditionWeights, B = CONFIG.conditionBands;
const L = (value, note) => ({ value, status: 'LIVE', note });
const all = (v) => Object.fromEntries(Object.keys(W).map((k) => [k, L(v, k)]));

test('bands: 80 FAVORABLE, 60 CAUTION, 30 NO_TRADE', () => {
  assert.equal(computeCondition(all(80), W, B).band, 'FAVORABLE');
  assert.equal(computeCondition(all(60), W, B).band, 'CAUTION');
  assert.equal(computeCondition(all(30), W, B).band, 'NO_TRADE');
});
test('weights come from config and change the score', () => {
  const f = { ...all(50), session: L(100) };
  const a = computeCondition(f, W, B).score, b = computeCondition(f, { ...W, session: 60 }, B).score;
  assert.ok(b > a);
});
test('missing factors are renormalised; low coverage -> INSUFFICIENT', () => {
  const r = computeCondition({ session: L(90), liquidity: L(90), volatility: L(90), news: L(90), structure: L(90) }, W, B);
  assert.equal(r.score, 90); assert.deepEqual(r.missing, ['momentum', 'regime', 'spread']); assert.equal(r.coverage, 0.75);
  assert.equal(computeCondition({ session: L(90) }, W, B).band, 'INSUFFICIENT');
});
test('STALE factors never drive the decision; DEMO taints overall status', () => {
  const f = { ...all(80), news: { value: 100, status: 'STALE' } };
  const r = computeCondition(f, W, B);
  assert.ok(r.missing.includes('news'));
  assert.equal(computeCondition({ ...all(80), spread: { value: 80, status: 'DEMO' } }, W, B).status, 'DEMO');
});
test('news veto forces NO_TRADE even with high average', () => {
  const r = computeCondition({ ...all(90), news: L(10, 'US CPI in 12m') }, W, B, { vetoes: [{ key: 'news', below: 20, reason: 'High-impact event imminent' }] });
  assert.equal(r.band, 'NO_TRADE'); assert.equal(r.minus[0], 'High-impact event imminent');
});
test('WHY lists strengths and weaknesses', () => {
  const r = computeCondition({ ...all(60), session: L(95, 'London/New York overlap'), news: L(10, 'US CPI in 12m') }, W, B);
  assert.deepEqual(r.plus, ['London/New York overlap']); assert.ok(r.minus.includes('US CPI in 12m'));
});
test('factor scorers', () => {
  const now = Date.UTC(2026, 9, 6, 12);
  assert.equal(scoreNewsRisk([{ time: now + 10 * 60000, impact: 'HIGH', title: 'CPI' }], now).value, 10);
  assert.equal(scoreNewsRisk([{ time: now + 60 * 60000, impact: 'HIGH', title: 'CPI' }], now).value, 40);
  assert.equal(scoreNewsRisk([{ time: now + 5 * 3600000, impact: 'HIGH', title: 'CPI' }], now).value, 100);
  assert.equal(scoreVolatility(50).value, 90); assert.equal(scoreVolatility(99).value, 20);
  assert.equal(scoreSpread(20, 20).value, 100); assert.ok(scoreSpread(60, 20).value === 0);
  assert.equal(scoreSession({ marketOpen: false, active: [] }).value, 0);
  assert.equal(scoreSession({ marketOpen: true, active: [{ id: 'london' }, { id: 'newyork' }] }).value, 95);
});
