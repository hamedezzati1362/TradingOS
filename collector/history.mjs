// Durable history: one CSV row per asset per run, monthly files. Lives on the 'history' git branch.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const HEADER = 'ts_utc,symbol,price,source,status,cond_score,cond_band,regime,structure,atr,atr_pct,rsi,adr_pct,r15m,r1h,r4h,r1d,s15m,s1h,s4h,s1d';
const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function historyRows(now, assets, conditions) {
  const iso = new Date(now).toISOString();
  return Object.entries(assets).filter(([, a]) => a && a.price != null).map(([sym, a]) => {
    const c = conditions[sym] || {}, t = a.tech || {};
    const lab = (k) => (t[k] ? t[k].summary.label : ''), sc = (k) => (t[k] ? t[k].summary.score : '');
    return [iso, sym, a.price, a.source, a.status, c.score, c.band, a.regime, a.structure, a.atr, a.atrPct, a.rsi, a.levels && a.levels.adrPct,
      lab('15m'), lab('1h'), lab('4h'), lab('1d'), sc('15m'), sc('1h'), sc('4h'), sc('1d')].map(q).join(',');
  });
}

export function appendHistory(dir, { now, assets, conditions }) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `records-${new Date(now).toISOString().slice(0, 7)}.csv`);
  if (!existsSync(file)) writeFileSync(file, HEADER + '\n');
  const rows = historyRows(now, assets, conditions);
  if (rows.length) appendFileSync(file, rows.join('\n') + '\n');
  return { file, rows: rows.length };
}
