// Provider symbol maps and asset list (edit here to add assets/providers).
export const SOURCES = {
  assets: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BRENT'],
  twelveData: { XAUUSD: 'XAU/USD', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', BRENT: 'XBR/USD' },
  yahoo: { XAUUSD: 'GC=F', EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', BRENT: 'BZ=F' },
  proxyNote: { 'Yahoo:XAUUSD': 'COMEX gold futures (GC=F), not spot', 'Yahoo:BRENT': 'ICE Brent futures (BZ=F)' },
};
