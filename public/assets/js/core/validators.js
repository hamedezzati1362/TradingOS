// Data validation (Phase 5). Each validator returns { ok: true } or { ok: false, reason }.

/** Price quote: { symbol, price, ts(ms) [, bid, ask] }. */
export function validateQuote(q, { now = Date.now(), maxAgeMs = 5 * 60000, prev = null, maxJumpPct = 3, futureToleranceMs = 60000 } = {}) {
  if (!q || typeof q !== 'object') return { ok: false, reason: 'empty response' };
  if (typeof q.symbol !== 'string' || !q.symbol) return { ok: false, reason: 'missing symbol' };
  if (typeof q.price !== 'number' || !Number.isFinite(q.price)) return { ok: false, reason: 'price not a number' };
  if (q.price <= 0) return { ok: false, reason: 'non-positive price' };
  if (!Number.isFinite(q.ts)) return { ok: false, reason: 'invalid timestamp' };
  if (q.ts > now + futureToleranceMs) return { ok: false, reason: 'timestamp in the future' };
  if (now - q.ts > maxAgeMs) return { ok: false, reason: `quote too old (${Math.round((now - q.ts) / 1000)}s)` };
  if (q.bid != null && q.ask != null && q.ask < q.bid) return { ok: false, reason: 'ask below bid' };
  if (prev && prev.price > 0) {
    const jump = Math.abs(q.price / prev.price - 1) * 100;
    if (jump > maxJumpPct) return { ok: false, reason: `jump ${jump.toFixed(2)}% vs last good` };
  }
  return { ok: true };
}

const IMPACTS = new Set(['HIGH', 'MEDIUM', 'LOW']);
/** Calendar / news item: { id?, title, ts(ms), impact, source, ccy? }. */
export function validateEvent(e) {
  if (!e || typeof e.title !== 'string' || !e.title.trim()) return { ok: false, reason: 'missing title' };
  if (!Number.isFinite(e.ts)) return { ok: false, reason: 'invalid timestamp' };
  if (!IMPACTS.has(e.impact)) return { ok: false, reason: `invalid impact ${e.impact}` };
  if (typeof e.source !== 'string' || !e.source) return { ok: false, reason: 'missing source' };
  return { ok: true };
}

/** Validate a list; the list is accepted when at least `minValidRatio` of items pass. Invalid items are dropped. */
export function validateEventList(list, { minValidRatio = 0.8 } = {}) {
  if (!Array.isArray(list)) return { ok: false, reason: 'not a list' };
  const good = list.filter((e) => validateEvent(e).ok);
  if (list.length && good.length / list.length < minValidRatio) return { ok: false, reason: `${list.length - good.length}/${list.length} items invalid` };
  return { ok: true, items: good, dropped: list.length - good.length };
}

/** Duplicate detection across sources: same normalised title + currency within `windowMs`. Keeps the first (highest-priority) copy. */
export function dedupeEvents(items, { windowMs = 30 * 60000 } = {}) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
  const out = []; let removed = 0;
  for (const e of items) {
    const k = norm(e.title);
    if (out.some((o) => norm(o.title) === k && (o.ccy || '') === (e.ccy || '') && Math.abs(o.ts - e.ts) <= windowMs)) { removed++; continue; }
    out.push(e);
  }
  return { items: out, removed };
}
