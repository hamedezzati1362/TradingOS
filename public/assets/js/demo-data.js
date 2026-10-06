// DEMO data. Every object carries status:'DEMO' and must never be rendered as LIVE.
export const DEMO_EVENTS = [
  { time: '16:00', ccy: 'USD', impact: 'HIGH', title: 'US CPI (m/m)', actual: null, forecast: '0.3%', previous: '0.4%', rel: ['USD', 'XAUUSD', 'FX'] },
  { time: '18:30', ccy: 'USD', impact: 'HIGH', title: 'FOMC Member Speech', actual: null, forecast: null, previous: null, rel: ['USD', 'XAUUSD'] },
  { time: '19:00', ccy: 'OIL', impact: 'MEDIUM', title: 'EIA Crude Inventories', actual: null, forecast: '-1.2M', previous: '2.1M', rel: ['BRENT'] },
];
export const DEMO_DRIVERS = [
  { name: 'DXY', value: '104.2', dir: 1, note: 'USD strength' },
  { name: 'US10Y', value: '4.21%', dir: -1, note: 'Yields easing' },
  { name: 'FED', value: 'HOLD 72%', dir: 0, note: 'Rate expectations' },
  { name: 'RISK', value: 'NEUTRAL', dir: 0, note: 'Equities flat' },
  { name: 'GEO', value: 'ELEVATED', dir: 1, note: 'Middle East' },
];
