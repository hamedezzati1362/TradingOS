/** Candle-set validation: enough bars, sane OHLC, recent last bar (market-hours aware via maxAgeMs). */
export function validateCandles(d, key, ctx) {
  if (!d || !Array.isArray(d.candles)) return { ok: false, reason: 'no candles' };
  const c = d.candles.filter((x) => [x.t, x.o, x.h, x.l, x.c].every(Number.isFinite) && x.c > 0 && x.h >= x.l);
  const minBars = String(key).endsWith(':1day') ? 20 : 120;
  if (c.length < minBars) return { ok: false, reason: `only ${c.length} valid candles` };
  if (c.length < d.candles.length * 0.95) return { ok: false, reason: 'too many malformed candles' };
  const last = c[c.length - 1];
  if (last.t > ctx.now + (String(key).endsWith(':1day') ? 86400000 : 20 * 60000)) return { ok: false, reason: 'last candle in the future' };
  if (ctx.prev && ctx.prev.candles) {
    const p = ctx.prev.candles[ctx.prev.candles.length - 1].c;
    if (Math.abs(last.c / p - 1) > 0.08) return { ok: false, reason: `jump ${(Math.abs(last.c / p - 1) * 100).toFixed(1)}% vs last good` };
  }
  return { ok: true, value: { ...d, candles: c } };
}

