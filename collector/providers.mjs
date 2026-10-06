// Price providers. Each returns normalised candles [{t,o,h,l,c}] (UTC ms, oldest first). Keys come from env only.
const UA = { 'User-Agent': 'TradingOS-collector/1.0 (personal use)' };

async function getJson(url, label) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return res.json();
}

export function twelveData(apiKey, symbolMap) {
  return {
    name: 'TwelveData', priority: 1, timeoutMs: 15000, retries: 1,
    enabled: !!apiKey,
    supports: (sym) => !!symbolMap[sym.split(':')[0]],
    async fetch(sym, { interval = '15min', bars = 300 } = {}) {
      sym = sym.split(':')[0];
      const s = symbolMap[sym]; if (!s) throw new Error(`TwelveData: no mapping for ${sym}`);
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(s)}&interval=${interval}&outputsize=${bars}&timezone=UTC&order=ASC&apikey=${apiKey}`;
      const j = await getJson(url, 'TwelveData');
      if (j.status === 'error' || !Array.isArray(j.values)) throw new Error(`TwelveData: ${j.message || 'no values'}`);
      return { symbol: sym, source: 'TwelveData', ref: s, candles: j.values.map((v) => ({ t: Date.parse(v.datetime.replace(' ', 'T') + 'Z'), o: +v.open, h: +v.high, l: +v.low, c: +v.close })) };
    },
  };
}

export function yahoo(symbolMap, priority = 2) {
  return {
    name: 'Yahoo', priority, timeoutMs: 15000, retries: 1, enabled: true,
    supports: (sym) => !!symbolMap[sym.split(':')[0]],
    async fetch(sym, { interval = '15min' } = {}) {
      sym = sym.split(':')[0];
      const s = symbolMap[sym]; if (!s) throw new Error(`Yahoo: no mapping for ${sym}`);
      const iv = { '15min': '15m', '1h': '60m', '1day': '1d' }[interval] || '15m';
      const range = interval === '1day' ? '3mo' : '10d';
      const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=${iv}&range=${range}`, 'Yahoo');
      const r = j.chart && j.chart.result && j.chart.result[0];
      if (!r || !r.timestamp) throw new Error(`Yahoo: ${(j.chart && j.chart.error && j.chart.error.description) || 'no data'}`);
      const q = r.indicators.quote[0]; const candles = [];
      r.timestamp.forEach((ts, i) => { if ([q.open[i], q.high[i], q.low[i], q.close[i]].every((x) => typeof x === 'number')) candles.push({ t: ts * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }); });
      return { symbol: sym, source: 'Yahoo', ref: s, candles };
    },
  };
}
