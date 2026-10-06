// DEMO data. Every object carries status:'DEMO' and must never be rendered as LIVE.
export const DEMO_ASSETS = [
  { sym: 'XAUUSD', price: 4141.35, dp: 2, chg: 0.42, trend: 1, structure: 'HH → HL', momentum: 81, volatility: 64, regime: 'TRENDING', condition: 78 },
  { sym: 'EURUSD', price: 1.08423, dp: 5, chg: -0.11, trend: 0, structure: 'RANGE', momentum: 38, volatility: 31, regime: 'RANGING', condition: 52 },
  { sym: 'GBPUSD', price: 1.27118, dp: 5, chg: -0.27, trend: -1, structure: 'LH → LL', momentum: 57, volatility: 48, regime: 'TRANSITION', condition: 61 },
  { sym: 'USDJPY', price: 149.832, dp: 3, chg: 0.18, trend: 1, structure: 'HH → HL', momentum: 66, volatility: 72, regime: 'HIGH VOLATILITY', condition: 58 },
  { sym: 'BRENT', price: 78.41, dp: 2, chg: -1.06, trend: -1, structure: 'BOS ↓', momentum: 44, volatility: 83, regime: 'HIGH VOLATILITY', condition: 41 },
].map((a, i) => ({ ...a, status: 'DEMO', spark: demoSpark(i, a.trend) }));

function demoSpark(seed, dir) {   // deterministic, obviously synthetic shape
  const out = []; let v = 50;
  for (let k = 0; k < 40; k++) { v += Math.sin(k * 0.7 + seed) * 2 + dir * 0.6; out.push(v); }
  return out;
}

export const DEMO_FACTORS = { session: null, liquidity: 82, volatility: 71, news: 34, structure: 72, momentum: 78, regime: 66, spread: 90 };
export const DEMO_REASONS = { plus: ['Good liquidity', 'Strong momentum on XAUUSD'], minus: ['High impact event approaching'] };

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
