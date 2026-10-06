// Technical indicators + TradingView-style rating (Phase 10). Pure functions on candles [{t,o,h,l,c,v?}] oldest -> newest.
// Each indicator returns a full series (null where undefined) so the chart can plot it; rating uses the last values.

const last = (a, k = 1) => a[a.length - k];
export const closes = (c) => c.map((x) => x.c);

export function sma(v, n) {
  const out = new Array(v.length).fill(null); let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
export function ema(v, n) {
  const out = new Array(v.length).fill(null), k = 2 / (n + 1); let prev = null;
  for (let i = 0; i < v.length; i++) {
    if (i < n - 1) continue;
    if (prev == null) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += v[j]; prev = s / n; } else prev = v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
const emaNullable = (v, n) => { const i0 = v.findIndex((x) => x != null); if (i0 < 0) return v.map(() => null); const e = ema(v.slice(i0), n); return [...new Array(i0).fill(null), ...e]; };
export function wma(v, n) {
  const out = new Array(v.length).fill(null), d = (n * (n + 1)) / 2;
  for (let i = n - 1; i < v.length; i++) { let s = 0; for (let j = 0; j < n; j++) s += v[i - j] * (n - j); out[i] = s / d; }
  return out;
}
export function hma(v, n) {
  const a = wma(v, Math.floor(n / 2)), b = wma(v, n);
  const diff = v.map((_, i) => (a[i] == null || b[i] == null ? null : 2 * a[i] - b[i]));
  const i0 = diff.findIndex((x) => x != null); if (i0 < 0) return diff;
  const h = wma(diff.slice(i0), Math.floor(Math.sqrt(n)));
  return [...new Array(i0).fill(null), ...h];
}
export function rsiSeries(v, n = 14) {
  const out = new Array(v.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}
export function macd(v, f = 12, s = 26, sig = 9) {
  const a = ema(v, f), b = ema(v, s);
  const m = v.map((_, i) => (a[i] == null || b[i] == null ? null : a[i] - b[i]));
  const sg = emaNullable(m, sig);
  return { macd: m, signal: sg, hist: m.map((x, i) => (x == null || sg[i] == null ? null : x - sg[i])) };
}
export function stoch(c, k = 14, sk = 3, sd = 3) {
  const raw = c.map((_, i) => {
    if (i < k - 1) return null;
    let hh = -Infinity, ll = Infinity; for (let j = i - k + 1; j <= i; j++) { hh = Math.max(hh, c[j].h); ll = Math.min(ll, c[j].l); }
    return hh === ll ? 50 : ((c[i].c - ll) / (hh - ll)) * 100;
  });
  const K = smaNullable(raw, sk), D = smaNullable(K, sd);
  return { k: K, d: D };
}
function smaNullable(v, n) { const i0 = v.findIndex((x) => x != null); if (i0 < 0) return v.map(() => null); return [...new Array(i0).fill(null), ...sma(v.slice(i0), n)]; }
export function cci(c, n = 20) {
  const tp = c.map((x) => (x.h + x.l + x.c) / 3), m = sma(tp, n);
  return tp.map((x, i) => { if (m[i] == null) return null; let md = 0; for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]); md /= n; return md === 0 ? 0 : (x - m[i]) / (0.015 * md); });
}
export function adx(c, n = 14) {
  const len = c.length, pdi = new Array(len).fill(null), mdi = new Array(len).fill(null), ax = new Array(len).fill(null);
  let tr = 0, pdm = 0, mdm = 0, dxs = [], adxv = null;
  for (let i = 1; i < len; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
    const p = up > dn && up > 0 ? up : 0, m = dn > up && dn > 0 ? dn : 0;
    const t = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    if (i <= n) { tr += t; pdm += p; mdm += m; if (i < n) continue; } else { tr = tr - tr / n + t; pdm = pdm - pdm / n + p; mdm = mdm - mdm / n + m; }
    pdi[i] = tr ? (100 * pdm) / tr : 0; mdi[i] = tr ? (100 * mdm) / tr : 0;
    const dx = pdi[i] + mdi[i] ? (100 * Math.abs(pdi[i] - mdi[i])) / (pdi[i] + mdi[i]) : 0;
    if (adxv == null) { dxs.push(dx); if (dxs.length === n) { adxv = dxs.reduce((a, b) => a + b, 0) / n; ax[i] = adxv; } }
    else { adxv = (adxv * (n - 1) + dx) / n; ax[i] = adxv; }
  }
  return { adx: ax, pdi, mdi };
}
export function williamsR(c, n = 14) {
  return c.map((x, i) => { if (i < n - 1) return null; let hh = -Infinity, ll = Infinity; for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, c[j].h); ll = Math.min(ll, c[j].l); } return hh === ll ? -50 : ((hh - x.c) / (hh - ll)) * -100; });
}
export function awesome(c) {
  const mid = c.map((x) => (x.h + x.l) / 2), a = sma(mid, 5), b = sma(mid, 34);
  return mid.map((_, i) => (a[i] == null || b[i] == null ? null : a[i] - b[i]));
}
export function momentum(v, n = 10) { return v.map((x, i) => (i < n ? null : x - v[i - n])); }
export function bollinger(v, n = 20, k = 2) {
  const m = sma(v, n);
  const sd = v.map((_, i) => { if (m[i] == null) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += (v[j] - m[i]) ** 2; return Math.sqrt(s / n); });
  return { mid: m, up: m.map((x, i) => (x == null ? null : x + k * sd[i])), dn: m.map((x, i) => (x == null ? null : x - k * sd[i])) };
}
export function ultimate(c) {
  const bp = [], tr = [];
  for (let i = 0; i < c.length; i++) { const pc = i ? c[i - 1].c : c[i].o; bp.push(c[i].c - Math.min(c[i].l, pc)); tr.push(Math.max(c[i].h, pc) - Math.min(c[i].l, pc)); }
  const avg = (n, i) => { let b = 0, t = 0; for (let j = i - n + 1; j <= i; j++) { b += bp[j]; t += tr[j]; } return t ? b / t : 0; };
  return c.map((_, i) => (i < 28 ? null : (100 * (4 * avg(7, i) + 2 * avg(14, i) + avg(28, i))) / 7));
}
export function ichimokuBase(c, n = 26) {
  return c.map((_, i) => { if (i < n - 1) return null; let hh = -Infinity, ll = Infinity; for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, c[j].h); ll = Math.min(ll, c[j].l); } return (hh + ll) / 2; });
}
export function vwma(c, n = 20) {
  if (!c.every((x) => x.v > 0)) return null;
  return c.map((_, i) => { if (i < n - 1) return null; let pv = 0, vs = 0; for (let j = i - n + 1; j <= i; j++) { pv += c[j].c * c[j].v; vs += c[j].v; } return vs ? pv / vs : null; });
}

/* ---------------- rating ---------------- */
const A = { BUY: 1, NEUTRAL: 0, SELL: -1 };
const act = (b, s) => (b ? 'BUY' : s ? 'SELL' : 'NEUTRAL');
const rising = (s) => last(s) != null && last(s, 2) != null && last(s) > last(s, 2);
const falling = (s) => last(s) != null && last(s, 2) != null && last(s) < last(s, 2);

/** Computes every indicator and its action. Returns { oscillators:[], movingAverages:[], summary } (rows: {name, value, action}). */
export function technicalRating(c) {
  const v = closes(c), price = last(v);
  const osc = [];
  const push = (arr, name, value, action, fa) => { if (value != null && Number.isFinite(value)) arr.push({ name, value, action, fa }); };

  const r = rsiSeries(v, 14);
  push(osc, 'RSI (14)', last(r), act(last(r) < 30 && rising(r), last(r) > 70 && falling(r)), 'زیر ۳۰ و در حال برگشت = خرید، بالای ۷۰ و در حال برگشت = فروش');
  const st = stoch(c);
  push(osc, 'Stochastic %K (14,3,3)', last(st.k), act(last(st.k) < 20 && last(st.k) > last(st.d), last(st.k) > 80 && last(st.k) < last(st.d)), 'اشباع فروش/خرید با تقاطع %K و %D');
  const cc = cci(c);
  push(osc, 'CCI (20)', last(cc), act(last(cc) < -100 && rising(cc), last(cc) > 100 && falling(cc)), 'زیر ‎-100 و صعودی = خرید، بالای ‎+100 و نزولی = فروش');
  const ad = adx(c);
  push(osc, 'ADX (14)', last(ad.adx), act(last(ad.adx) > 20 && last(ad.pdi) > last(ad.mdi) && rising(ad.adx), last(ad.adx) > 20 && last(ad.mdi) > last(ad.pdi) && rising(ad.adx)), 'قدرت روند؛ جهت با +DI و ‎-DI');
  const ao = awesome(c);
  push(osc, 'Awesome Oscillator', last(ao), act(last(ao) > 0 && rising(ao), last(ao) < 0 && falling(ao)), 'بالای صفر و صعودی = خرید');
  const mo = momentum(v, 10);
  push(osc, 'Momentum (10)', last(mo), act(rising(mo), falling(mo)), 'شتاب حرکت قیمت');
  const md = macd(v);
  push(osc, 'MACD (12,26,9)', last(md.macd), act(last(md.macd) > last(md.signal), last(md.macd) < last(md.signal)), 'MACD بالای خط سیگنال = خرید');
  const sr = stoch(rsiSeries(v, 14).map((x, i) => ({ h: x ?? 50, l: x ?? 50, c: x ?? 50 })), 14, 3, 3);
  push(osc, 'Stoch RSI Fast', last(sr.k), act(last(sr.k) < 20 && last(sr.k) > last(sr.d), last(sr.k) > 80 && last(sr.k) < last(sr.d)), 'استوکاستیک روی RSI');
  const wr = williamsR(c);
  push(osc, 'Williams %R (14)', last(wr), act(last(wr) < -80 && rising(wr), last(wr) > -20 && falling(wr)), 'زیر ‎-80 = اشباع فروش');
  const e13 = ema(v, 13), bull = c.map((x, i) => (e13[i] == null ? null : x.h - e13[i])), bear = c.map((x, i) => (e13[i] == null ? null : x.l - e13[i]));
  const bbp = bull.map((x, i) => (x == null ? null : x + bear[i]));
  push(osc, 'Bull Bear Power', last(bbp), act(last(bbp) > 0 && rising(bbp), last(bbp) < 0 && falling(bbp)), 'قدرت خریداران در برابر فروشندگان');
  const uo = ultimate(c);
  push(osc, 'Ultimate Oscillator', last(uo), act(last(uo) > 70, last(uo) < 30), 'بالای ۷۰ = خرید، زیر ۳۰ = فروش');

  const mas = [];
  for (const n of [10, 20, 30, 50, 100, 200]) {
    const e = last(ema(v, n)), s = last(sma(v, n));
    push(mas, `EMA (${n})`, e, act(price > e, price < e), 'قیمت بالای میانگین = خرید');
    push(mas, `SMA (${n})`, s, act(price > s, price < s), 'قیمت بالای میانگین = خرید');
  }
  const ib = last(ichimokuBase(c)); push(mas, 'Ichimoku Base (26)', ib, act(price > ib, price < ib), 'خط پایه ایچیموکو');
  const vw = vwma(c); if (vw) { const x = last(vw); push(mas, 'VWMA (20)', x, act(price > x, price < x), 'میانگین وزنی با حجم'); }
  const hm = last(hma(v, 9)); push(mas, 'Hull MA (9)', hm, act(price > hm, price < hm), 'میانگین هال');

  const group = (rows) => {
    const n = { BUY: 0, SELL: 0, NEUTRAL: 0 }; rows.forEach((x) => n[x.action]++);
    const score = rows.length ? (n.BUY - n.SELL) / rows.length : 0;
    return { ...n, score: Math.round(score * 100) / 100, label: label(score), count: rows.length };
  };
  const og = group(osc), mg = group(mas);
  const score = Math.round(((og.score + mg.score) / 2) * 100) / 100;
  return { oscillators: osc, movingAverages: mas, osc: og, ma: mg, summary: { score, label: label(score) }, bars: c.length };
}
export function label(s) { return s > 0.5 ? 'STRONG BUY' : s > 0.1 ? 'BUY' : s < -0.5 ? 'STRONG SELL' : s < -0.1 ? 'SELL' : 'NEUTRAL'; }

/** Aggregate candles into larger buckets (e.g. 1h -> 4h). Buckets aligned to UTC multiples of `ms`. */
export function aggregate(c, ms) {
  const out = []; let cur = null;
  for (const x of c) {
    const b = Math.floor(x.t / ms) * ms;
    if (!cur || cur.t !== b) { cur = { t: b, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0 }; out.push(cur); }
    else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v || 0; }
  }
  return out;
}
