// Market engines (Phase 6/8 core): pure functions on OHLC candles [{t, o, h, l, c}] oldest -> newest.
// Used by the data collector (Node) and unit tests. No signals: only descriptions of state.

export function atrSeries(c, n = 14) {
  const out = new Array(c.length).fill(null); let sum = 0;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].h, c[i - 1].c) - Math.min(c[i].l, c[i - 1].c);
    if (i <= n) { sum += tr; if (i === n) out[i] = sum / n; } else out[i] = (out[i - 1] * (n - 1) + tr) / n;
  }
  return out;
}

/** Percentile rank (0..100) of the last ATR within the last `lookback` ATR values. */
export function atrPercentile(atr, lookback = 200) {
  const v = atr.filter((x) => x != null).slice(-lookback);
  if (v.length < 30) return null;
  const last = v[v.length - 1];
  return Math.round((v.filter((x) => x <= last).length / v.length) * 100);
}

export function rsi(c, n = 14) {
  if (c.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i].c - c[i - 1].c; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i].c - c[i - 1].c; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : Math.round((100 - 100 / (1 + g / l)) * 10) / 10;
}

/** Kaufman efficiency ratio: |net move| / path length over n bars (1 = straight line, 0 = noise). */
export function efficiencyRatio(c, n = 20) {
  if (c.length <= n) return null;
  const s = c.slice(-n - 1); let path = 0;
  for (let i = 1; i < s.length; i++) path += Math.abs(s[i].c - s[i - 1].c);
  return path ? Math.abs(s[s.length - 1].c - s[0].c) / path : 0;
}

/** Fractal swings: a high/low that is the extreme of `k` bars on each side. */
export function swings(c, k = 3) {
  const out = [];
  for (let i = k; i < c.length - k; i++) {
    let hi = true, lo = true;
    for (let j = i - k; j <= i + k; j++) { if (j === i) continue; if (c[j].h >= c[i].h) hi = false; if (c[j].l <= c[i].l) lo = false; }
    if (hi) out.push({ i, t: c[i].t, type: 'H', price: c[i].h });
    if (lo) out.push({ i, t: c[i].t, type: 'L', price: c[i].l });
  }
  return out;
}

/** Market structure: HH/HL/LH/LL from the last two swing highs/lows, BOS and CHoCH on the last close. */
export function structure(c, k = 3) {
  const sw = swings(c, k);
  const H = sw.filter((s) => s.type === 'H'), L = sw.filter((s) => s.type === 'L');
  if (H.length < 2 || L.length < 2) return { label: 'UNCLEAR', bias: 0, bos: null, choch: false, swings: sw.slice(-6) };
  const [h1, h2] = H.slice(-2), [l1, l2] = L.slice(-2);
  const hh = h2.price > h1.price, hl = l2.price > l1.price;
  let bias = 0, label = 'RANGE';
  if (hh && hl) { bias = 1; label = 'HH → HL'; } else if (!hh && !hl) { bias = -1; label = 'LH → LL'; } else if (hh && !hl) label = 'EXPANDING'; else label = 'CONTRACTING';
  const last = c[c.length - 1].c;
  let bos = null;
  if (last > h2.price) bos = 'UP'; else if (last < l2.price) bos = 'DOWN';
  const choch = (bos === 'UP' && bias === -1) || (bos === 'DOWN' && bias === 1);
  if (bos) label = choch ? `CHoCH ${bos === 'UP' ? '↑' : '↓'}` : `BOS ${bos === 'UP' ? '↑' : '↓'}`;
  return { label, bias: bos === 'UP' ? 1 : bos === 'DOWN' ? -1 : bias, bos, choch, lastHigh: h2.price, lastLow: l2.price, swings: sw.slice(-6) };
}

export function regime({ er, atrPct, structBias }) {
  if (er == null || atrPct == null) return 'UNCLEAR';
  if (atrPct >= 92) return 'HIGH VOLATILITY';
  if (atrPct <= 8) return 'LOW VOLATILITY';
  if (er >= 0.35 && structBias !== 0) return 'TRENDING';
  if (er <= 0.2) return 'RANGING';
  return 'TRANSITION';
}

export function volatilityLabel(p) {
  if (p == null) return null;
  return p < 20 ? 'LOW' : p <= 80 ? 'NORMAL' : p <= 95 ? 'HIGH' : 'EXTREME';
}

/** Momentum strength 0..100 (direction-agnostic) from RSI distance to 50 and ATR-normalised rate of change. */
export function momentumScore(c, atr, n = 10) {
  const r = rsi(c, 14); const a = atr[atr.length - 1];
  if (r == null || !a || c.length <= n) return null;
  const roc = (c[c.length - 1].c - c[c.length - 1 - n].c) / a;     // move in ATRs
  return Math.round(Math.min(100, Math.abs(r - 50) * 1.6 + Math.min(Math.abs(roc), 4) * 12));
}

const REGIME_SCORE = { TRENDING: 85, TRANSITION: 55, RANGING: 45, 'HIGH VOLATILITY': 35, 'LOW VOLATILITY': 30, UNCLEAR: null };

/** Full per-asset analysis from candles. */
export function analyse(candles) {
  const c = candles;
  const atr = atrSeries(c);
  const pct = atrPercentile(atr);
  const er = efficiencyRatio(c);
  const st = structure(c);
  const reg = regime({ er, atrPct: pct, structBias: st.bias });
  const mom = momentumScore(c, atr);
  const last = c[c.length - 1];
  let dayAgo = null;
  for (let i = c.length - 1; i >= 0; i--) if (c[i].t <= last.t - 86400000) { dayAgo = c[i]; break; }
  return {
    price: last.c, t: last.t,
    changePct: dayAgo ? Math.round(((last.c / dayAgo.c) - 1) * 10000) / 100 : null,
    atr: atr[atr.length - 1], atrPct: pct, volatility: volatilityLabel(pct), rsi: rsi(c), er: er == null ? null : Math.round(er * 100) / 100,
    structure: st.label, bias: st.bias, bos: st.bos, choch: st.choch, regime: reg, momentum: mom,
    regimeScore: REGIME_SCORE[reg], structureScore: st.label === 'UNCLEAR' ? null : st.bias !== 0 ? 80 : 45,
    spark: c.slice(-48).map((x) => x.c),
  };
}
