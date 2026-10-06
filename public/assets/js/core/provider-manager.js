// Provider Manager (Phase 5): priority failover, timeout, retry, circuit breaker, health, validation, last-known-good cache.
// Runs unchanged in Node (data collector) and in the browser. Providers are plain async functions, so no API key ever lives here.

export const STATUS = { LIVE: 'LIVE', FALLBACK: 'FALLBACK', CACHE: 'CACHE', STALE: 'STALE', UNAVAILABLE: 'UNAVAILABLE' };
const CIRCUIT = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

/** In-memory LKG cache. Any object with get(key)/set(key, entry) works (file cache, KV, ...). */
export class MemoryCache {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  get(key) { return this.map.get(key) ?? null; }
  set(key, entry) { this.map.set(key, entry); }
  toJSON() { return Object.fromEntries(this.map); }
}

/** Redacts anything that looks like a secret before it reaches a log line. */
export function redact(s) {
  return String(s)
    .replace(/((?:api[_-]?key|apikey|token|secret|password|key)=)[^&\s"']+/gi, '$1***')
    .replace(/(authorization:\s*)(bearer\s+)?\S+/gi, '$1***');
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${ms}ms (${label})`)), ms); }),
  ]);
}

export class ProviderManager {
  /**
   * @param {object} o
   * @param {string} o.kind                        e.g. 'price'
   * @param {Array}  o.providers                   [{ name, priority, fetch: async (key, ctx) => data, timeoutMs?, retries? }]
   * @param {Function} [o.validate]                (data, key, ctx) => {ok, reason, value?}
   * @param {object} [o.cache]                     get/set store for last-known-good
   * @param {number} [o.staleAfterMs]              cache older than this is STALE
   * @param {object} [o.circuit]                   { failureThreshold, cooldownMs }
   * @param {Function} [o.now]                     clock (tests inject a fake one)
   * @param {Function} [o.log]                     (level, msg) => void
   * @param {Function} [o.sleep]                   backoff sleeper (tests use a no-op)
   */
  constructor(o) {
    this.kind = o.kind;
    this.validate = o.validate || (() => ({ ok: true }));
    this.cache = o.cache || new MemoryCache();
    this.staleAfterMs = o.staleAfterMs ?? 5 * 60000;
    this.circuitCfg = { failureThreshold: 3, cooldownMs: 5 * 60000, ...(o.circuit || {}) };
    this.now = o.now || (() => Date.now());
    this.log = o.log || (() => {});
    this.sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.defaults = { timeoutMs: o.timeoutMs ?? 8000, retries: o.retries ?? 1, backoffMs: o.backoffMs ?? 500 };
    this.providers = [...o.providers].sort((a, b) => a.priority - b.priority).map((p) => ({
      ...p,
      health: { status: 'STANDBY', circuit: CIRCUIT.CLOSED, failures: 0, consecutiveFailures: 0, successes: 0,
        latencyMs: null, lastSuccess: null, lastError: null, openedAt: null },
    }));
  }

  _log(level, msg) { try { this.log(level, redact(`[${this.kind}] ${msg}`)); } catch { /* logging must never break data flow */ } }

  _available(p) {
    const h = p.health;
    if (h.circuit !== CIRCUIT.OPEN) return true;
    if (this.now() - h.openedAt >= this.circuitCfg.cooldownMs) {
      h.circuit = CIRCUIT.HALF_OPEN;
      this._log('info', `${p.name} circuit HALF_OPEN (probe)`);
      return true;
    }
    return false;
  }

  _fail(p, err) {
    const h = p.health;
    h.failures++; h.consecutiveFailures++; h.lastError = redact(err.message || String(err)); h.status = 'DOWN';
    if (h.circuit === CIRCUIT.HALF_OPEN || h.consecutiveFailures >= this.circuitCfg.failureThreshold) {
      h.circuit = CIRCUIT.OPEN; h.openedAt = this.now();
      this._log('warn', `${p.name} circuit OPEN after ${h.consecutiveFailures} consecutive failures`);
    }
  }

  _ok(p, latency) {
    const h = p.health;
    h.successes++; h.consecutiveFailures = 0; h.latencyMs = latency; h.lastSuccess = this.now(); h.lastError = null;
    if (h.circuit !== CIRCUIT.CLOSED) this._log('info', `${p.name} circuit CLOSED (recovered)`);
    h.circuit = CIRCUIT.CLOSED; h.status = 'LIVE';
  }

  /** Health score 0..100 from success ratio, recent failures and latency. */
  static healthScore(h) {
    const total = h.successes + h.failures;
    if (!total) return null;
    let s = (h.successes / total) * 100 - h.consecutiveFailures * 15;
    if (h.latencyMs != null) s -= Math.max(0, (h.latencyMs - 500) / 100);
    if (h.circuit === CIRCUIT.OPEN) s = Math.min(s, 10);
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  /** Fetch `key` through the failover chain. Never throws. */
  async get(key, ctx = {}) {
    const attempts = [];
    for (let i = 0; i < this.providers.length; i++) {
      const p = this.providers[i];
      if (!this._available(p)) { attempts.push({ provider: p.name, result: 'skipped (circuit open)' }); continue; }
      const retries = p.circuitProbe ? 0 : (p.retries ?? this.defaults.retries);
      const tries = p.health.circuit === CIRCUIT.HALF_OPEN ? 1 : retries + 1;
      for (let t = 0; t < tries; t++) {
        const t0 = this.now();
        try {
          const prev = this.cache.get(key);
          const data = await withTimeout(Promise.resolve().then(() => p.fetch(key, ctx)), p.timeoutMs ?? this.defaults.timeoutMs, p.name);
          const v = this.validate(data, key, { ...ctx, prev: prev ? prev.data : null, now: this.now() });
          if (!v.ok) throw new Error(`INVALID DATA: ${v.reason}`);
          const value = v.value ?? data;
          const latency = this.now() - t0;
          this._ok(p, latency);
          const entry = { data: value, source: p.name, fetchedAt: this.now() };
          this.cache.set(key, entry);
          attempts.push({ provider: p.name, result: 'ok', latencyMs: latency });
          const status = (p.priority ?? i + 1) === 1 ? STATUS.LIVE : STATUS.FALLBACK;   // only the primary provider counts as LIVE
          this._log('info', `${key}: ${p.name} selected (${status}, ${latency}ms)`);
          this._markStandby(p);
          return { key, data: value, status, source: p.name, ageMs: 0, fetchedAt: entry.fetchedAt, attempts };
        } catch (e) {
          attempts.push({ provider: p.name, result: redact(e.message || String(e)) });
          this._log('warn', `${key}: ${p.name} failed (${t + 1}/${tries}): ${e.message || e}`);
          if (t === tries - 1) this._fail(p, e);
          else await this.sleep(this.defaults.backoffMs * 2 ** t);
        }
      }
    }
    const lkg = this.cache.get(key);
    if (lkg) {
      const age = this.now() - lkg.fetchedAt;
      const status = age > this.staleAfterMs ? STATUS.STALE : STATUS.CACHE;
      this._log('warn', `${key}: all providers failed -> ${status} from ${lkg.source} (${Math.round(age / 1000)}s old)`);
      return { key, data: lkg.data, status, source: lkg.source, ageMs: age, fetchedAt: lkg.fetchedAt, attempts };
    }
    this._log('error', `${key}: all providers failed and no cache -> UNAVAILABLE`);
    return { key, data: null, status: STATUS.UNAVAILABLE, source: null, ageMs: null, fetchedAt: null, attempts };
  }

  _markStandby(selected) {
    for (const p of this.providers) if (p !== selected && p.health.status === 'LIVE') p.health.status = 'STANDBY';
  }

  /** Snapshot for the Data Health panel. */
  health() {
    return this.providers.map((p) => ({ name: p.name, priority: p.priority, ...p.health, score: ProviderManager.healthScore(p.health) }));
  }
}

/** Re-classify a cached result's freshness at display time (the UI calls this every second). */
export function freshness(result, now = Date.now(), staleAfterMs = 5 * 60000) {
  if (!result || result.status === STATUS.UNAVAILABLE || result.fetchedAt == null) return { status: STATUS.UNAVAILABLE, ageMs: null };
  const ageMs = now - result.fetchedAt;
  if (ageMs > staleAfterMs) return { status: STATUS.STALE, ageMs };
  return { status: result.status, ageMs };
}
