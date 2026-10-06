import test from 'node:test';
import assert from 'node:assert/strict';
import { MACRO, driverStats, goldBias } from '../public/assets/js/core/macro-engine.js';
const series = (f) => Array.from({ length: 20 }, (_, i) => ({ t: i, o: f(i), h: f(i), l: f(i), c: f(i) }));
const def = (id) => MACRO.find((m) => m.id === id);

test('rising DXY is a headwind for gold', () => {
  const s = driverStats(def('DXY'), series((i) => 100 + i * 0.2));
  assert.equal(s.dir, 1); assert.equal(s.goldEffect, -1);
});
test('yields use absolute change in points', () => {
  const s = driverStats(def('US10Y'), series((i) => 4 + i * 0.02));
  assert.ok(Math.abs(s.chg5d - 0.1) < 1e-9); assert.equal(s.goldEffect, -1);
});
test('flat driver -> no effect; bias aggregation', () => {
  assert.equal(driverStats(def('VIX'), series(() => 15)).goldEffect, 0);
  assert.equal(goldBias([{ goldEffect: 1 }, { goldEffect: 1 }, { goldEffect: 0 }]).label, 'TAILWIND');
  assert.equal(goldBias([{ goldEffect: -1 }, { goldEffect: -1 }]).label, 'HEADWIND');
  assert.equal(goldBias([{ goldEffect: 1 }, { goldEffect: -1 }]).label, 'MIXED');
  assert.equal(driverStats(def('DXY'), series(() => 1).slice(0, 3)), null);
});
