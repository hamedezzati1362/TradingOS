// Loads the collector snapshot and classifies freshness at display time. Never throws.
export async function loadSnapshot(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    if (!j || j.version !== 1 || typeof j.generatedAt !== 'number' || typeof j.assets !== 'object') return { ok: false, error: 'invalid snapshot' };
    return { ok: true, snap: j };
  } catch (e) {
    return { ok: false, error: navigator.onLine === false ? 'offline' : 'network error' };
  }
}

/** Display status for a data item fetched at `fetchedAt` with collector status `status`. */
export function displayStatus(status, fetchedAt, now, { liveMaxAgeMs, staleAfterMs }) {
  if (!status || status === 'UNAVAILABLE' || fetchedAt == null) return 'UNAVAILABLE';
  const age = now - fetchedAt;
  if (age > staleAfterMs || status === 'STALE') return 'STALE';
  if (age > liveMaxAgeMs || status === 'CACHE') return 'CACHE';
  return status;   // LIVE (primary provider) or FALLBACK
}

export function fmtAge(ms) {
  if (ms == null) return '--';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.round(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}
