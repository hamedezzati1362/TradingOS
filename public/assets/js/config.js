// Client-side configuration. Everything that is tunable lives here (no hard-coding in engines).
export const CONFIG = {
  clocks: [
    { id: 'tehran', label: 'TEHRAN', tz: 'Asia/Tehran' },
    { id: 'utc', label: 'UTC', tz: 'UTC' },
    { id: 'server', label: 'LITEFINANCE SERVER', server: true },
    { id: 'local', label: 'LOCAL', tz: null }, // null = browser zone
  ],
  // Broker server clock = New York wall time + N hours (EET convention: GMT+2 winter / GMT+3 summer, US DST).
  serverTime: { baseTz: 'America/New_York', offsetHours: 7 },
  // FX week: closed from Friday 17:00 New York to Sunday 17:00 New York.
  marketWeek: { tz: 'America/New_York', closeDay: 5, closeTime: '17:00', openDay: 0, openTime: '17:00' },
  sessions: [
    { id: 'sydney', name: 'SYDNEY', tz: 'Australia/Sydney', start: '07:00', end: '16:00', color: 'var(--s-sydney)' },
    { id: 'tokyo', name: 'TOKYO', tz: 'Asia/Tokyo', start: '09:00', end: '18:00', color: 'var(--s-tokyo)' },
    { id: 'london', name: 'LONDON', tz: 'Europe/London', start: '08:00', end: '17:00', color: 'var(--s-london)' },
    { id: 'newyork', name: 'NEW YORK', tz: 'America/New_York', start: '08:00', end: '17:00', color: 'var(--s-newyork)' },
  ],
  // Condition score weights (Phase 4 engine reads these; must sum to 100).
  conditionWeights: { session: 15, liquidity: 15, volatility: 15, news: 15, structure: 15, momentum: 10, regime: 10, spread: 5 },
  minCoverage: 0.6,   // below this share of weight with usable data -> INSUFFICIENT DATA
  conditionVetoes: [{ key: 'news', below: 20, reason: 'High-impact event imminent' }],
  conditionBands: { noTrade: [0, 49], caution: [50, 74], favorable: [75, 100] },
  assets: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BRENT'],
  timelineTz: 'Asia/Tehran',
};
