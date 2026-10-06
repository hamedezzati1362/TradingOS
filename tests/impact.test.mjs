import test from 'node:test';
import assert from 'node:assert/strict';
import { explainEvent, explainHeadline } from '../public/assets/js/core/impact-kb.js';

test('US CPI: hot print -> gold and EURUSD down, USDJPY up', () => {
  const k = explainEvent({ title: 'Core CPI m/m', ccy: 'USD' });
  assert.equal(k.rule, 'cpi'); assert.equal(k.effects.XAUUSD, -1); assert.equal(k.effects.EURUSD, -1); assert.equal(k.effects.USDJPY, 1);
});
test('unemployment is inverse', () => { assert.equal(explainEvent({ title: 'Unemployment Rate', ccy: 'USD' }).effects.XAUUSD, 1); });
test('EUR event only touches EURUSD; JPY event inverts USDJPY', () => {
  assert.deepEqual(explainEvent({ title: 'German Flash Manufacturing PMI', ccy: 'EUR' }).relevance, ['EURUSD']);
  assert.equal(explainEvent({ title: 'Tokyo Core CPI y/y', ccy: 'JPY' }).effects.USDJPY, -1);
});
test('oil inventories -> Brent inverse', () => {
  const k = explainEvent({ title: 'Crude Oil Inventories', ccy: 'USD' });
  assert.equal(k.effects.BRENT, -1); assert.ok(k.relevance.includes('BRENT'));
});
test('speeches have no numeric direction', () => { assert.equal(explainEvent({ title: 'FOMC Member Bowman Speaks', ccy: 'USD' }).noDirection, true); });
test('no false matches inside words (Optimism != ISM, Feiade != EIA)', () => {
  assert.equal(explainEvent({ title: 'RCM/TIPP Economic Optimism', ccy: 'USD' }), null);
  assert.equal(explainEvent({ title: 'Bank Holiday', ccy: 'AUD' }), null);
});
test('headline tagging', () => {
  const h = explainHeadline('Oil jumps as Middle East tension threatens supply');
  assert.ok(h.topicsFa.includes('ژئوپلیتیک')); assert.ok(h.relevance.includes('BRENT'));
  assert.equal(explainHeadline('Apple unveils new iPhone'), null);
});
test('noise headlines are dropped', () => {
  for (const h of ['OBITUARY: Frances Joyce Sutton Dollar, 1947-2026', "Ming-Na Wen's recipe for 'Popo's Wontons' is as good as gold", 'Multimillion-dollar campaign focuses on Save Our Bacon Act'])
    assert.equal(explainHeadline(h), null, h);
  assert.ok(explainHeadline('Gold prices steady as dollar index climbs'));
});
