// Economic calendar and news providers. All return normalised items; keys come from env only.
const UA = { 'User-Agent': 'Mozilla/5.0 (TradingOS personal dashboard)' };
async function get(url, label, as = 'json') {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${label} HTTP ${r.status}`);
  return as === 'json' ? r.json() : r.text();
}
const IMPACT = { High: 'HIGH', Medium: 'MEDIUM', Low: 'LOW', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', 3: 'HIGH', 2: 'MEDIUM', 1: 'LOW' };

/** ForexFactory weekly JSON (free, no key; no "actual" field). */
export function forexFactory() {
  return { name: 'ForexFactory', priority: 1, timeoutMs: 15000, retries: 1,
    async fetch() {
      const weeks = await Promise.allSettled(['thisweek', 'nextweek'].map((w) => get(`https://nfs.faireconomy.media/ff_calendar_${w}.json`, 'ForexFactory')));
      const lists = weeks.filter((w) => w.status === 'fulfilled').map((w) => w.value);
      if (!lists.length) throw new Error(weeks[0].reason.message);
      return lists.flat().filter((e) => IMPACT[e.impact]).map((e) => ({
        title: e.title, ccy: e.country, ts: Date.parse(e.date), impact: IMPACT[e.impact],
        forecast: e.forecast || null, previous: e.previous || null, actual: e.actual || null, source: 'ForexFactory',
      }));
    } };
}

/** Finnhub economic calendar (may require a paid plan; failover handles a 403). */
export function finnhubCalendar(key) {
  return { name: 'FinnhubCalendar', priority: 2, timeoutMs: 15000, retries: 0, enabled: !!key,
    async fetch() {
      const d = new Date(), from = d.toISOString().slice(0, 10), to = new Date(+d + 8 * 86400000).toISOString().slice(0, 10);
      const j = await get(`https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`, 'FinnhubCalendar');
      const list = (j && j.economicCalendar) || [];
      if (!Array.isArray(list) || !list.length) throw new Error('FinnhubCalendar: empty');
      const C = { US: 'USD', EU: 'EUR', GB: 'GBP', UK: 'GBP', JP: 'JPY', AU: 'AUD', CA: 'CAD', CH: 'CHF', NZ: 'NZD', CN: 'CNY' };
      return list.map((e) => ({ title: e.event, ccy: C[e.country] || e.country, ts: Date.parse(e.time.replace(' ', 'T') + 'Z'), impact: IMPACT[e.impact] || 'LOW',
        forecast: e.estimate != null ? `${e.estimate}${e.unit || ''}` : null, previous: e.prev != null ? `${e.prev}${e.unit || ''}` : null,
        actual: e.actual != null ? `${e.actual}${e.unit || ''}` : null, source: 'Finnhub' }));
    } };
}

export function finnhubNews(key) {
  return { name: 'FinnhubNews', priority: 1, timeoutMs: 15000, retries: 1, enabled: !!key,
    async fetch() {
      const [g, f] = await Promise.all(['general', 'forex'].map((c) => get(`https://finnhub.io/api/v1/news?category=${c}&token=${key}`, 'FinnhubNews')));
      return [...(Array.isArray(g) ? g : []), ...(Array.isArray(f) ? f : [])].map((n) => ({
        title: n.headline, summary: n.summary || '', ts: n.datetime * 1000, url: n.url, source: n.source || 'Finnhub', impact: 'LOW' }));
    } };
}

const decode = (s) => s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
export function googleNews() {
  return { name: 'GoogleNews', priority: 2, timeoutMs: 15000, retries: 1,
    async fetch() {
      const q = encodeURIComponent('gold OR oil OR fed OR dollar OR opec when:1d');
      const xml = await get(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, 'GoogleNews', 'text');
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
        const tag = (n) => { const x = m[1].match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)); return x ? decode(x[1]) : ''; };
        const src = tag('source');
        const title = src && tag('title').endsWith(` - ${src}`) ? tag('title').slice(0, -(src.length + 3)) : tag('title').replace(/\s+[-|]\s+[^-|]{2,60}$/, '');
        return { title, summary: '', ts: Date.parse(tag('pubDate')), url: tag('link'), source: tag('source') || 'Google News', impact: 'LOW' };
      });
      if (!items.length) throw new Error('GoogleNews: no items');
      return items;
    } };
}
