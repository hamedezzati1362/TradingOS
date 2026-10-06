// Provider symbol maps and asset list (edit here to add assets/providers).
export const SOURCES = {
  assets: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BRENT'],
  twelveData: { XAUUSD: 'XAU/USD', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY' },   // Brent is not on the Twelve Data free plan (HTTP 404)
  yahoo: { XAUUSD: 'GC=F', EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', BRENT: 'BZ=F' },
  // CME/ICE futures with real exchange volume (spot FX and gold are OTC: no consolidated volume exists).
  volume: { XAUUSD: 'GC=F', EURUSD: '6E=F', GBPUSD: '6B=F', USDJPY: '6J=F', BRENT: 'BZ=F' },
  timeframes: { '15m': { interval: '15min', bars: 500, refreshMs: 0 }, '1h': { interval: '1h', bars: 500, refreshMs: 55 * 60000 }, '1d': { interval: '1day', bars: 250, refreshMs: 6 * 3600000 } },
  proxyNote: { 'Yahoo:XAUUSD': 'COMEX gold futures (GC=F), not spot', 'Yahoo:BRENT': 'ICE Brent futures (BZ=F)' },
};
