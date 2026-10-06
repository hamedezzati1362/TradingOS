import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, deliver } from '../collector/alerts.mjs';
import { explainEvent } from '../public/assets/js/core/impact-kb.js';
const now = Date.UTC(2026, 9, 7, 12, 0);
const ev = (title, ccy, minutes, impact = 'HIGH') => { const e = { title, ccy, impact, ts: now + minutes * 60000, forecast: '0.3%', previous: '0.4%' }; return { ...e, kb: explainEvent(e) }; };

test('high-impact USD event 20 min ahead -> one Persian alert, deduped next run', () => {
  const cal = { events: [ev('CPI m/m', 'USD', 20), ev('CPI m/m', 'USD', 120), ev('Retail Sales', 'USD', 20, 'MEDIUM'), ev('GDP q/q', 'CAD', 20)] };
  const a = buildAlerts({ calendar: cal, assets: {}, now, sent: {} });
  assert.equal(a.length, 1); assert.match(a[0].text, /طلا: اگر عدد بالاتر از پیش‌بینی بیاید ممکن است پایین بیاید/);
  assert.equal(buildAlerts({ calendar: cal, assets: {}, now, sent: { [a[0].id]: now } }).length, 0);
});
test('gold 1H+4H alignment fires once and re-arms after it breaks', () => {
  const assets = (l1, l4) => ({ XAUUSD: { price: 4200, structure: 'BOS ↑', tech: { '1h': { summary: { label: l1 } }, '4h': { summary: { label: l4 } } } } });
  const sent = {};
  const a = buildAlerts({ calendar: null, assets: assets('STRONG BUY', 'STRONG BUY'), now, sent });
  assert.equal(a.length, 1); sent[a[0].id] = now;
  assert.equal(buildAlerts({ calendar: null, assets: assets('STRONG BUY', 'STRONG BUY'), now, sent }).length, 0);
  buildAlerts({ calendar: null, assets: assets('BUY', 'STRONG BUY'), now, sent });
  assert.equal(Object.keys(sent).length, 0);
});
test('no messenger configured -> nothing sent, no throw', async () => {
  const r = await deliver([{ id: 'x', text: 'y' }], {}, {}, () => {});
  assert.deepEqual(r.sent, {});
});
test('morning brief: once per day, weekdays 08:00-09:30 Tehran, Persian content', () => {
  const at = (iso) => Date.parse(iso);
  const g = { XAUUSD: { price: 4190.5, changePct: 0.4, regime: 'TRENDING', structure: 'HH → HL', levels: { adr: 80, levels: [{ name: 'PDH', price: 4200 }, { name: 'PDL', price: 4150 }] }, tech: { '1h': { summary: { label: 'BUY' } } } } };
  const wedMorning = at('2026-10-07T05:00:00Z');  // 08:30 Tehran, Wednesday
  const a = buildAlerts({ calendar: { events: [] }, assets: g, now: wedMorning, sent: {}, condition: { XAUUSD: { score: 72, band: 'CAUTION' } } });
  const b = a.find((x) => x.id.startsWith('brief:'));
  assert.ok(b); assert.match(b.text, /خلاصه‌ی صبح/); assert.match(b.text, /PDH 4200\.00/); assert.match(b.text, /احتیاط/);
  assert.ok(!buildAlerts({ calendar: null, assets: g, now: wedMorning, sent: { [b.id]: 1 } }).some((x) => x.id.startsWith('brief:')));
  assert.ok(!buildAlerts({ calendar: null, assets: g, now: at('2026-10-07T10:00:00Z'), sent: {} }).some((x) => x.id.startsWith('brief:')));  // 13:30
  assert.ok(!buildAlerts({ calendar: null, assets: g, now: at('2026-10-10T05:00:00Z'), sent: {} }).some((x) => x.id.startsWith('brief:')));  // Saturday
});
test('key level touch alert fires once per level per day', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const assets = { XAUUSD: { price: 4201, levels: { adrPct: 60, levels: [{ name: 'PDH', price: 4200 }, { name: 'PIVOT', price: 4198 }] } } };
  const lastBars = { XAUUSD: [{ h: 4202, l: 4195 }] };
  const a = buildAlerts({ calendar: null, assets, now, sent: {}, lastBars });
  assert.equal(a.length, 1); assert.match(a[0].text, /PDH/);
  assert.equal(buildAlerts({ calendar: null, assets, now, sent: { [a[0].id]: now }, lastBars }).length, 0);
});
