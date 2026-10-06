// Full-screen chart (TradingView Lightweight Charts, vendored) + full technical table. Loaded on demand.
import { technicalRating, ema, bollinger, rsiSeries, macd } from './core/technicals.js';

let libPromise = null;
function loadLib() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (!libPromise) libPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/lightweight-charts.standalone.production.js';
    s.onload = () => res(window.LightweightCharts); s.onerror = () => { libPromise = null; rej(new Error('chart library failed to load')); };
    document.head.appendChild(s);
  });
  return libPromise;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
let chart = null, ro = null;

export function destroyChart() { if (ro) { ro.disconnect(); ro = null; } if (chart) { chart.remove(); chart = null; } }

/**
 * @param el     container element
 * @param file   candle file object {candles:[[t,o,h,l,c]], volume:{bars:[[t,v]], source}}
 * @param opts   { tz, dp, showBB }
 */
export async function drawChart(el, file, opts) {
  const LW = await loadLib();
  destroyChart();
  const tzFmt = new Intl.DateTimeFormat('en-GB', { timeZone: opts.tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  chart = LW.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: css('--panel') }, textColor: css('--ink-2'), fontFamily: 'JetBrains Mono, monospace', fontSize: 11, panes: { separatorColor: css('--line-2') } },
    grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
    rightPriceScale: { borderColor: css('--line-2') },
    timeScale: { borderColor: css('--line-2'), timeVisible: true, secondsVisible: false, rightOffset: 4 },
    crosshair: { mode: 0 },
    localization: { timeFormatter: (t) => tzFmt.format(new Date(t * 1000)) },
  });
  const c = file.candles.map(([t, o, h, l, cl]) => ({ time: t / 1000, open: o, high: h, low: l, close: cl }));
  const closes = c.map((x) => x.close);
  const up = css('--up'), down = css('--down');
  const cs = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat: { type: 'price', precision: opts.dp, minMove: 1 / 10 ** opts.dp } });
  cs.setData(c);
  const line = (vals, color, pane = 0, width = 1, extra = {}) => {
    const s = chart.addSeries(LW.LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra }, pane);
    s.setData(vals.map((v, i) => (v == null ? { time: c[i].time } : { time: c[i].time, value: v }))); return s;
  };
  line(ema(closes, 20), '#3987e5'); line(ema(closes, 50), '#c98500'); line(ema(closes, 200), '#d55181', 0, 2);
  if (opts.showBB) { const b = bollinger(closes); line(b.up, css('--ink-3')); line(b.dn, css('--ink-3')); }

  let pane = 1;
  if (file.volume && file.volume.bars && file.volume.bars.length) {
    const vs = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: true, color: css('--ink-3') }, pane);
    const vmap = file.volume.bars;
    vs.setData(vmap.map(([t, v], i) => ({ time: t / 1000, value: v, color: i && vmap[i - 1][1] > v ? 'rgba(239,83,80,.55)' : 'rgba(38,194,129,.55)' })));
    pane++;
  }
  const rsiPane = pane++;
  const r = line(rsiSeries(closes, 14), '#9085e9', rsiPane, 1, { lastValueVisible: true });
  r.createPriceLine({ price: 70, color: css('--ink-3'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
  r.createPriceLine({ price: 30, color: css('--ink-3'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
  const macdPane = pane++;
  const m = macd(closes);
  const hs = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, macdPane);
  hs.setData(m.hist.map((v, i) => (v == null ? { time: c[i].time } : { time: c[i].time, value: v, color: v >= 0 ? 'rgba(38,194,129,.6)' : 'rgba(239,83,80,.6)' })));
  line(m.macd, '#3987e5', macdPane); line(m.signal, '#d95926', macdPane);
  // Main pane ~55%, the rest shared by volume / RSI / MACD.
  const weights = [6, ...(pane - 1 === 3 ? [1.4, 1.6, 2] : [2, 2])];
  const sizePanes = () => {
    const ps = chart && chart.panes(); if (!ps) return;
    const h = el.clientHeight || 600, tot = weights.reduce((a, b) => a + b, 0);
    ps.forEach((p, i) => { if (typeof p.setStretchFactor === 'function') p.setStretchFactor(weights[i] || 1); else p.setHeight(Math.round((h * (weights[i] || 1)) / tot)); });
  };
  sizePanes(); requestAnimationFrame(sizePanes);
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, c.length - 150), to: c.length + 4 });
  return { bars: c.length };
}

export function techTable(file, labels) {
  const c = file.candles.map(([t, o, h, l, cl]) => ({ t, o, h, l, c: cl }));
  return technicalRating(c);
}
