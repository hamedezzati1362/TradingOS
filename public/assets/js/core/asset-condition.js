// Condition score for one asset from collector data (used by the collector for alerts, briefs and history).
import { computeCondition, scoreSession, scoreVolatility, scoreNewsRisk } from './condition-engine.js';
import { sessionStates } from '../engines/session-engine.js';

export function assetCondition(sym, { asset, calendar, cfg, now = Date.now() }) {
  if (!asset || asset.price == null) return null;
  const ss = sessionStates(new Date(now), cfg);
  const s = scoreSession(ss), st = asset.status === 'FALLBACK' ? 'FALLBACK' : 'LIVE';
  const f = {
    session: { value: s.value, status: 'LIVE', note: s.note },
    volatility: { value: scoreVolatility(asset.atrPct).value, status: st },
    momentum: { value: asset.momentum, status: st },
    structure: { value: asset.structureScore, status: st },
    regime: { value: asset.regimeScore, status: st },
  };
  if (calendar && calendar.events) {
    const ev = calendar.events.filter((e) => e.impact !== 'LOW' && e.kb && e.kb.relevance.includes(sym)).map((e) => ({ time: e.ts, impact: e.impact, title: `${e.ccy} ${e.title}` }));
    const n = scoreNewsRisk(ev, now); f.news = { value: n.value, status: 'LIVE', note: n.note };
  }
  return computeCondition(f, cfg.conditionWeights, cfg.conditionBands, { minCoverage: cfg.minCoverage, vetoes: cfg.conditionVetoes });
}
