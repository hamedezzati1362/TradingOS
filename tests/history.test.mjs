import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendHistory } from '../collector/history.mjs';
import { parseCsv, trackRecord, loadHistory, performanceSummary } from '../collector/evaluate.mjs';

test('history append + track record in ATR units', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tos-'));
  const t0 = Date.UTC(2026, 9, 7, 8);
  for (let i = 0; i < 12; i++) {
    const p = 4000 + i * 2;   // steady rise
    appendHistory(dir, { now: t0 + i * 900000, assets: { XAUUSD: { price: p, atr: 4, source: 'T', status: 'LIVE', tech: { '1h': { summary: { label: i % 2 ? 'BUY' : 'SELL', score: 0.3 } } } } }, conditions: { XAUUSD: { score: 70, band: 'CAUTION' } } });
  }
  const rows = loadHistory(dir);
  assert.equal(rows.length, 12);
  const tr = trackRecord(rows, 'XAUUSD', 'r1h', 1);
  assert.equal(tr.BUY.avgAtr, 2); assert.equal(tr.BUY.hitPct, 100); assert.equal(tr.SELL.hitPct, 0);
  assert.ok(performanceSummary(rows).rows === 12);
  assert.equal(parseCsv(readFileSync(join(dir, 'records-2026-10.csv'), 'utf8'))[0].cond_band, 'CAUTION');
});
