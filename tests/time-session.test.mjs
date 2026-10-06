import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedParts, zonedToUtc, serverParts } from '../public/assets/js/engines/time-engine.js';
import { sessionStates, isMarketOpen, timelineIntervals } from '../public/assets/js/engines/session-engine.js';
import { CONFIG } from '../public/assets/js/config.js';

const at = (iso) => new Date(iso);
const st = (iso) => Object.fromEntries(sessionStates(at(iso), CONFIG).states.map((s) => [s.id, s]));
const utcHM = (d) => d.toISOString().slice(11, 16);

test('zonedToUtc round-trips across zones', () => {
  const d = zonedToUtc(2026, 7, 1, 8, 0, 'Europe/London');
  assert.equal(d.toISOString(), '2026-07-01T07:00:00.000Z');
  assert.deepEqual([zonedParts(d, 'Europe/London').hour, zonedParts(d, 'Europe/London').minute], [8, 0]);
});

test('Test 10 DST: London open 08:00 UTC in winter, 07:00 UTC in summer (EU switch 2026-03-29)', () => {
  assert.equal(utcHM(st('2026-03-27T12:00:00Z').london.start), '08:00');
  assert.equal(utcHM(st('2026-03-30T12:00:00Z').london.start), '07:00');
});

test('Test 10 DST: New York open 13:00 UTC in winter, 12:00 UTC after US switch 2026-03-08', () => {
  assert.equal(utcHM(st('2026-03-06T15:00:00Z').newyork.start), '13:00');
  assert.equal(utcHM(st('2026-03-09T15:00:00Z').newyork.start), '12:00');
});

test('Test 10 DST: Sydney open 20:00 UTC (AEDT) before 2026-04-05, 21:00 UTC (AEST) after', () => {
  assert.equal(utcHM(st('2026-03-31T22:00:00Z').sydney.start), '20:00');
  assert.equal(utcHM(st('2026-04-07T23:00:00Z').sydney.start), '21:00');
});

test('DST gap period (US switched, EU not yet): London/NY overlap is longer', () => {
  const s = sessionStates(at('2026-03-17T16:30:00Z'), CONFIG);   // London 16:30 GMT open, NY 12:30 EDT open
  assert.ok(s.states.find((x) => x.id === 'london').open);
  assert.ok(s.states.find((x) => x.id === 'newyork').open);
  assert.equal(s.overlaps.length, 1);
});

test('Test 11 midnight: Tokyo session spanning UTC midnight keeps correct date', () => {
  const s = st('2026-06-10T23:30:00Z');           // Tokyo 08:30 Jun 11 -> closed, opens in 30m
  assert.equal(s.tokyo.open, false);
  assert.equal(s.tokyo.untilOpenMs, 30 * 60000);
  assert.equal(s.tokyo.start.toISOString(), '2026-06-11T00:00:00.000Z');
  const s2 = st('2026-06-11T00:00:01Z');
  assert.equal(s2.tokyo.open, true);
  assert.equal(s2.tokyo.end.toISOString(), '2026-06-11T09:00:00.000Z');
});

test('weekend: everything closed Saturday, market reopens Sunday 17:00 New York', () => {
  const s = sessionStates(at('2026-10-10T12:00:00Z'), CONFIG);  // Saturday
  assert.equal(s.marketOpen, false);
  assert.equal(s.active.length, 0);
  assert.ok(!isMarketOpen(at('2026-10-11T20:59:00Z'), CONFIG.marketWeek));  // Sun 16:59 EDT
  assert.ok(isMarketOpen(at('2026-10-11T21:00:00Z'), CONFIG.marketWeek));   // Sun 17:00 EDT
  assert.equal(s.next.id, 'sydney');
});

test('Friday after 17:00 NY: London-style windows not counted, next is Monday Sydney/Tokyo', () => {
  const s = sessionStates(at('2026-10-09T21:30:00Z'), CONFIG);
  assert.equal(s.marketOpen, false);
  assert.ok(['sydney', 'tokyo'].includes(s.next.id));
});

test('LiteFinance server = NY+7: 00:00 at NY 17:00 (both DST states)', () => {
  const w = serverParts(at('2026-01-15T22:00:00Z'), CONFIG.serverTime);   // NY 17:00 EST
  const su = serverParts(at('2026-07-15T21:00:00Z'), CONFIG.serverTime);  // NY 17:00 EDT
  assert.deepEqual([w.hour, su.hour], [0, 0]);
});

test('Tehran has no DST (since 2022): UTC+03:30 all year', () => {
  for (const iso of ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z']) assert.equal(zonedParts(at(iso), 'Asia/Tehran').minute, 30);
});

test('timeline returns clipped intervals within the day', () => {
  const day = zonedToUtc(2026, 6, 10, 0, 0, 'Asia/Tehran');
  for (const s of timelineIntervals(day, CONFIG))
    for (const iv of s.intervals) assert.ok(iv.start >= day.getTime() && iv.end <= day.getTime() + 86400000 && iv.end > iv.start);
});
