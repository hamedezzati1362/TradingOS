// Track record: forward outcome of past readings, in ATR units, from the history CSVs. Pure + file helpers.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function parseCsv(text) {
  const [head, ...lines] = text.trim().split('\n'); const cols = head.split(',');
  return lines.filter(Boolean).map((l) => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
}

/**
 * For each row of `sym`, find the price `h` hours later and express the move in ATR(15m) units.
 * Groups by a label column. A reading "worked" when the move went in the label's direction (BUY up / SELL down).
 */
export function trackRecord(rows, sym, col, hours) {
  const r = rows.filter((x) => x.symbol === sym && x.price && x.atr).map((x) => ({ t: Date.parse(x.ts_utc), p: +x.price, atr: +x.atr, label: x[col] }));
  const groups = {};
  let j = 0;
  for (let i = 0; i < r.length; i++) {
    const target = r[i].t + hours * 3600000;
    while (j < r.length && r[j].t < target) j++;
    if (j >= r.length) break;
    if (r[j].t - target > 45 * 60000) continue;           // gap (weekend / missing runs)
    const move = (r[j].p - r[i].p) / r[i].atr;
    const g = (groups[r[i].label] ||= { n: 0, sum: 0, up: 0 });
    g.n++; g.sum += move; if (move > 0) g.up++;
  }
  const out = {};
  for (const [k, g] of Object.entries(groups)) {
    const dir = /BUY/.test(k) ? 1 : /SELL/.test(k) ? -1 : 0;
    out[k] = { n: g.n, avgAtr: Math.round((g.sum / g.n) * 100) / 100, upPct: Math.round((g.up / g.n) * 100), hitPct: dir ? Math.round(((dir > 0 ? g.up : g.n - g.up) / g.n) * 100) : null };
  }
  return out;
}

export function loadHistory(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^records-\d{4}-\d{2}\.csv$/.test(f)).sort().slice(-3).flatMap((f) => parseCsv(readFileSync(join(dir, f), 'utf8')));
}

export function performanceSummary(rows, sym = 'XAUUSD') {
  if (!rows.length) return null;
  const first = rows.find((x) => x.symbol === sym);
  return {
    sym, rows: rows.filter((x) => x.symbol === sym).length, since: first ? first.ts_utc : null,
    r1h_1h: trackRecord(rows, sym, 'r1h', 1), r4h_4h: trackRecord(rows, sym, 'r4h', 4), band_4h: trackRecord(rows, sym, 'cond_band', 4),
  };
}
