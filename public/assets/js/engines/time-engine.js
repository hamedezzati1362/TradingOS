// Time Engine: pure functions on top of Intl + IANA zones. No network, no external library.
const fmtCache = new Map();
function partsFormatter(tz) {
  const key = tz || '__local';
  if (!fmtCache.has(key)) {
    fmtCache.set(key, new Intl.DateTimeFormat('en-US', {
      timeZone: tz || undefined, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return fmtCache.get(key);
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `date` in zone `tz` (null = browser zone). */
export function zonedParts(date, tz) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(date)) p[type] = value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: WD[p.weekday],
  };
}

/** UTC offset of zone `tz` at instant `date`, in minutes. */
export function zoneOffsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Instant for a wall-clock time in `tz`. Non-existent (spring-forward) times resolve forward. */
export function zonedToUtc(year, month, day, hour, minute, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess - zoneOffsetMinutes(new Date(guess), tz) * 60000;
  const off2 = zoneOffsetMinutes(new Date(t), tz);
  const t2 = guess - off2 * 60000;
  if (t2 !== t && zoneOffsetMinutes(new Date(t2), tz) === off2) t = t2;
  return new Date(t);
}

/** Broker server wall clock (e.g. LiteFinance = New York + 7h). Returns parts like zonedParts. */
export function serverParts(date, cfg) {
  return zonedParts(new Date(date.getTime() + cfg.offsetHours * 3600000), cfg.baseTz);
}
export function serverOffsetMinutes(date, cfg) {
  return zoneOffsetMinutes(date, cfg.baseTz) + cfg.offsetHours * 60;
}

/** Add whole days to a Y-M-D (calendar arithmetic, zone-free). */
export function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export const pad2 = (n) => String(n).padStart(2, '0');
export function fmtHMS(p) { return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`; }
export function fmtOffset(min) {
  const s = min < 0 ? '-' : '+'; const a = Math.abs(min);
  return `UTC${s}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}
export function fmtDuration(ms) {
  if (ms < 0) ms = 0;
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0 ? `${h}h ${pad2(m)}m` : `${pad2(m)}m ${pad2(s)}s`;
}
export function parseHM(s) { const [h, m] = s.split(':').map(Number); return { h, m }; }
