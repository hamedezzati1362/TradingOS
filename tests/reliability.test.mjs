import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderManager, MemoryCache, redact, freshness } from '../public/assets/js/core/provider-manager.js';
import { validateQuote, validateEventList, dedupeEvents } from '../public/assets/js/core/validators.js';

let clock = 1_800_000_000_000;
const now = () => clock;
const quote = (price, ts = clock) => ({ symbol: 'XAUUSD', price, ts });
const ok = (price) => async () => quote(price);
const down = async () => { throw new Error('HTTP 503'); };
const garbage = async () => ({ symbol: 'XAUUSD', price: 'NaN', ts: clock });
const hang = () => new Promise(() => {});
function pm(fns, extra = {}) {
  const logs = [];
  const m = new ProviderManager({ kind: 'price', now, sleep: async () => {}, retries: 0, timeoutMs: 50,
    providers: fns.map((f, i) => ({ name: 'ABC'[i], priority: i + 1, fetch: f })),
    validate: (d, k, ctx) => validateQuote(d, { now: ctx.now, prev: ctx.prev }), log: (l, msg) => logs.push(msg), ...extra });
  m.logs = logs; return m;
}

test('Test 1: all healthy -> Provider A, LIVE', async () => {
  const r = await pm([ok(4100), ok(4101), ok(4102)]).get('XAUUSD');
  assert.equal(r.status, 'LIVE'); assert.equal(r.source, 'A'); assert.equal(r.data.price, 4100);
});
test('Test 2: A fails -> B, FALLBACK', async () => {
  const r = await pm([down, ok(4101), ok(4102)]).get('XAUUSD');
  assert.equal(r.status, 'FALLBACK'); assert.equal(r.source, 'B');
});
test('Test 3: A and B fail -> C', async () => {
  const r = await pm([down, hang, ok(4102)]).get('XAUUSD');
  assert.equal(r.source, 'C'); assert.match(r.attempts[1].result, /timeout/);
});
test('Test 4: all fail -> last known good CACHE with age', async () => {
  const cache = new MemoryCache();
  await pm([ok(4100)], { cache }).get('XAUUSD');
  clock += 20_000;
  const r = await pm([down, down, down], { cache }).get('XAUUSD');
  assert.equal(r.status, 'CACHE'); assert.equal(r.data.price, 4100); assert.equal(r.ageMs, 20_000);
});
test('Test 5: cache older than staleAfter -> STALE (never LIVE)', async () => {
  const cache = new MemoryCache();
  await pm([ok(4100)], { cache }).get('XAUUSD');
  clock += 10 * 60000;
  const r = await pm([down], { cache }).get('XAUUSD');
  assert.equal(r.status, 'STALE');
  assert.equal(freshness({ status: 'LIVE', fetchedAt: clock - 6 * 60000 }, clock).status, 'STALE');
});
test('no providers and no cache -> UNAVAILABLE, never fabricated', async () => {
  const r = await pm([down]).get('XAUUSD');
  assert.equal(r.status, 'UNAVAILABLE'); assert.equal(r.data, null);
});
test('Test 12: invalid response -> failover', async () => {
  const r = await pm([garbage, ok(4101)]).get('XAUUSD');
  assert.equal(r.source, 'B'); assert.match(r.attempts[0].result, /INVALID DATA/);
});
test('Test 12b: unrealistic jump vs last good -> rejected', async () => {
  const cache = new MemoryCache();
  await pm([ok(4100)], { cache }).get('XAUUSD');
  const r = await pm([ok(4600), ok(4105)], { cache }).get('XAUUSD');
  assert.equal(r.source, 'B'); assert.match(r.attempts[0].result, /jump/);
});
test('stale timestamp from provider is rejected', async () => {
  const r = await pm([async () => quote(4100, clock - 30 * 60000), ok(4101)]).get('XAUUSD');
  assert.equal(r.source, 'B');
});
test('circuit breaker: opens after 3 failures, skips, half-opens after cooldown, closes on success', async () => {
  let aUp = false;
  const m = pm([async (k) => { if (!aUp) throw new Error('down'); return quote(4100); }, ok(4101)], { circuit: { failureThreshold: 3, cooldownMs: 60000 } });
  for (let i = 0; i < 3; i++) await m.get('XAUUSD');
  assert.equal(m.health()[0].circuit, 'OPEN');
  const r = await m.get('XAUUSD');
  assert.match(r.attempts[0].result, /circuit open/);
  aUp = true; clock += 61000;
  const r2 = await m.get('XAUUSD');
  assert.equal(r2.source, 'A'); assert.equal(m.health()[0].circuit, 'CLOSED');
});
test('half-open probe failure re-opens immediately', async () => {
  const m = pm([down, ok(4101)], { circuit: { failureThreshold: 2, cooldownMs: 1000 } });
  await m.get('X'); await m.get('X');
  clock += 1500; await m.get('X');
  assert.equal(m.health()[0].circuit, 'OPEN');
});
test('retry with backoff recovers a transient failure on the same provider', async () => {
  let n = 0;
  const m = pm([async () => { if (n++ === 0) throw new Error('blip'); return quote(4100); }], { retries: 1 });
  const r = await m.get('XAUUSD');
  assert.equal(r.source, 'A'); assert.equal(r.status, 'LIVE');
});
test('logs never contain secrets', async () => {
  const m = pm([async () => { throw new Error('GET https://api.x.com/q?symbol=XAU&apikey=SECRET123 failed'); }, ok(1)]);
  await m.get('XAUUSD');
  assert.ok(m.logs.every((l) => !l.includes('SECRET123')));
  assert.equal(redact('token=abc&x=1'), 'token=***&x=1');
});
test('health score reflects failures and latency', async () => {
  const m = pm([down, ok(4101)]);
  await m.get('XAUUSD');
  const [a, b] = m.health();
  assert.ok(a.score < b.score); assert.equal(b.status, 'LIVE');
});
test('news validation drops bad items and dedupes across sources', () => {
  const t = clock;
  const v = validateEventList([
    { title: 'US CPI m/m', ts: t, impact: 'HIGH', source: 'A', ccy: 'USD' },
    { title: 'US CPI (m/m)', ts: t + 60000, impact: 'HIGH', source: 'B', ccy: 'USD' },
    { title: 'GDP', ts: t, impact: 'HIGH', source: 'A', ccy: 'EUR' },
    { title: 'Retail Sales', ts: t, impact: 'HIGH', source: 'A', ccy: 'GBP' },
    { title: 'bad', ts: NaN, impact: 'HIGH', source: 'A' },
  ], { minValidRatio: 0.7 });
  assert.equal(v.ok, true); assert.equal(v.dropped, 1);
  const d = dedupeEvents(v.items);
  assert.equal(d.removed, 1); assert.equal(d.items.length, 3);
  assert.equal(validateEventList([{ title: 'x', ts: NaN }, { title: 'y', ts: NaN }]).ok, false);
});
