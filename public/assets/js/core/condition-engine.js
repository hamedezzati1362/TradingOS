// Market Condition Engine (Phase 4). Pure functions: factors in -> score, band, breakdown, reasons out.
// A factor is { value: 0..100 | null, status: 'LIVE'|'FALLBACK'|'CACHE'|'STALE'|'DEMO'|'UNAVAILABLE', note?: string }.
// Missing / unusable factors are dropped and the remaining weights are renormalised; coverage is reported.

const RANK = { LIVE: 0, FALLBACK: 1, CACHE: 2, STALE: 3, DEMO: 4, UNAVAILABLE: 5 };
const USABLE = new Set(['LIVE', 'FALLBACK', 'CACHE', 'DEMO']);   // STALE/UNAVAILABLE never drive a decision

export function worstStatus(list) {
  return list.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), 'LIVE');
}

export function bandOf(score, bands) {
  if (score == null) return 'INSUFFICIENT';
  if (score >= bands.favorable[0]) return 'FAVORABLE';
  if (score >= bands.caution[0]) return 'CAUTION';
  return 'NO_TRADE';
}

/**
 * @param factors  { [key]: {value, status, note} }
 * @param weights  { [key]: number }  (from config; need not sum to 100)
 * @param bands    { noTrade:[a,b], caution:[a,b], favorable:[a,b] }
 * @param opts     { minCoverage: 0..1 (default .6), vetoes: [{key, below, reason}] }
 */
export function computeCondition(factors, weights, bands, opts = {}) {
  const minCoverage = opts.minCoverage ?? 0.6;
  const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
  const breakdown = Object.keys(weights).map((key) => {
    const f = factors[key] || { value: null, status: 'UNAVAILABLE' };
    const usable = f.value != null && Number.isFinite(f.value) && USABLE.has(f.status);
    return { key, weight: weights[key], value: usable ? clamp(f.value) : null, status: usable ? f.status : (f.status === 'STALE' ? 'STALE' : 'UNAVAILABLE'), note: f.note || null };
  });
  const used = breakdown.filter((b) => b.value != null);
  const usedW = used.reduce((a, b) => a + b.weight, 0);
  const coverage = totalW ? usedW / totalW : 0;
  let score = usedW ? Math.round(used.reduce((s, b) => s + b.value * b.weight, 0) / usedW) : null;
  if (coverage < minCoverage) score = null;

  // Hard vetoes: e.g. a high-impact event minutes away forces NO_TRADE regardless of the average.
  const vetoes = [];
  for (const v of opts.vetoes || []) {
    const b = breakdown.find((x) => x.key === v.key);
    if (b && b.value != null && b.value < v.below) vetoes.push(v.reason);
  }
  let band = bandOf(score, bands);
  if (vetoes.length && score != null) band = 'NO_TRADE';

  const plus = used.filter((b) => b.value >= 75).sort((a, b) => b.value * b.weight - a.value * a.weight).map((b) => b.note || `${b.key} ${b.value}`);
  const minus = [...vetoes, ...used.filter((b) => b.value < 50).sort((a, b) => a.value * a.weight - b.value * b.weight).map((b) => b.note || `${b.key} ${b.value}`)];
  const missing = breakdown.filter((b) => b.value == null).map((b) => b.key);
  const status = used.length ? worstStatus(used.map((b) => b.status)) : 'UNAVAILABLE';
  return { score, band, status, coverage: Math.round(coverage * 100) / 100, breakdown, plus, minus: [...new Set(minus)], missing };
}

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

/* ---------- factor scorers (each returns {value, note}) ---------- */

/** Session liquidity from the Session Engine state. */
export function scoreSession(ss) {
  if (!ss.marketOpen) return { value: 0, note: 'FX market closed' };
  const ids = ss.active.map((s) => s.id);
  if (ids.includes('london') && ids.includes('newyork')) return { value: 95, note: 'London/New York overlap' };
  if (ids.includes('london')) return { value: 80, note: 'London session' };
  if (ids.includes('newyork')) return { value: 72, note: 'New York session' };
  if (ids.includes('tokyo')) return { value: 50, note: 'Tokyo session only' };
  return { value: 30, note: 'Low-liquidity hours' };
}

/**
 * News risk: 100 = clear. High-impact event within `blockMin` -> 10; within `warnMin` -> 40; medium within blockMin -> 60.
 * events: [{ time: Date|ms, impact: 'HIGH'|'MEDIUM'|'LOW', title }]
 */
export function scoreNewsRisk(events, now, { blockMin = 30, warnMin = 90, afterMin = 15 } = {}) {
  const t = +now; let best = { value: 100, note: 'No high-impact events nearby' };
  for (const e of events) {
    const dm = (+e.time - t) / 60000;
    if (dm < -afterMin || dm > warnMin) continue;
    let v = 100;
    if (e.impact === 'HIGH') v = Math.abs(dm) <= blockMin || dm < 0 ? 10 : 40;
    else if (e.impact === 'MEDIUM' && Math.abs(dm) <= blockMin) v = 60;
    if (v < best.value) best = { value: v, note: dm >= 0 ? `${e.title} in ${Math.round(dm)}m` : `${e.title} ${Math.round(-dm)}m ago` };
  }
  return best;
}

/** Volatility from ATR percentile (0..100): mid-range is best, extremes are poor. */
export function scoreVolatility(pct) {
  if (pct == null) return { value: null };
  const v = pct < 10 ? 25 : pct < 30 ? 60 : pct <= 80 ? 90 : pct <= 95 ? 55 : 20;
  const label = pct < 10 ? 'Very low volatility' : pct < 30 ? 'Low volatility' : pct <= 80 ? 'Normal volatility' : pct <= 95 ? 'High volatility' : 'Extreme volatility';
  return { value: v, note: label };
}

/** Spread vs its typical value: ratio 1 -> 100, ratio 3+ -> 0. */
export function scoreSpread(spread, typical) {
  if (spread == null || !typical) return { value: null };
  const r = spread / typical;
  return { value: Math.max(0, Math.min(100, Math.round(100 - (r - 1) * 50))), note: r > 1.5 ? `Spread ${r.toFixed(1)}× normal` : 'Normal spread' };
}
