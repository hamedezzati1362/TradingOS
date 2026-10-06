// Session Engine: DST-correct trading sessions from IANA zones. Works fully offline.
import { zonedParts, zonedToUtc, addDays, parseHM } from './time-engine.js';

/** True when the FX market is open (closed Fri closeTime -> Sun openTime in market tz). */
export function isMarketOpen(date, week) {
  const p = zonedParts(date, week.tz);
  const mins = p.hour * 60 + p.minute;
  const close = parseHM(week.closeTime), open = parseHM(week.openTime);
  if (p.weekday === 6) return false;
  if (p.weekday === week.closeDay && mins >= close.h * 60 + close.m) return false;
  if (p.weekday === week.openDay && mins < open.h * 60 + open.m) return false;
  return true;
}

/** Session windows [start,end) whose local start date is within `from..to` days of `date`'s local date. */
export function sessionWindows(session, date, from = -1, to = 1) {
  const p = zonedParts(date, session.tz);
  const s = parseHM(session.start), e = parseHM(session.end);
  const out = [];
  for (let k = from; k <= to; k++) {
    const d = addDays(p.year, p.month, p.day, k);
    const start = zonedToUtc(d.year, d.month, d.day, s.h, s.m, session.tz);
    let endDay = d;
    if (e.h * 60 + e.m <= s.h * 60 + s.m) endDay = addDays(d.year, d.month, d.day, 1);
    const end = zonedToUtc(endDay.year, endDay.month, endDay.day, e.h, e.m, session.tz);
    out.push({ start, end });
  }
  return out;
}

/** A window counts as a trading session only if the market is open at its midpoint (skips weekends). */
function tradable(w, week) {
  return isMarketOpen(new Date((w.start.getTime() + w.end.getTime()) / 2), week);
}

/** Full state for every session at instant `date`. */
export function sessionStates(date, cfg) {
  const now = date.getTime();
  const marketOpen = isMarketOpen(date, cfg.marketWeek);
  const states = cfg.sessions.map((s) => {
    const wins = sessionWindows(s, date, -1, 8).filter((w) => tradable(w, cfg.marketWeek));
    const cur = wins.find((w) => w.start.getTime() <= now && now < w.end.getTime());
    const open = !!cur && marketOpen;
    const next = wins.find((w) => w.start.getTime() > now);
    const ref = open ? cur : next;
    return {
      id: s.id, name: s.name, tz: s.tz, color: s.color, open,
      start: ref ? ref.start : null, end: ref ? ref.end : null,
      remainingMs: open ? cur.end.getTime() - now : null,
      untilOpenMs: !open && next ? next.start.getTime() - now : null,
    };
  });
  const active = states.filter((s) => s.open);
  const overlaps = [];
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) overlaps.push([active[i], active[j]]);
  const upcoming = states.filter((s) => !s.open && s.untilOpenMs != null).sort((a, b) => a.untilOpenMs - b.untilOpenMs);
  return { marketOpen, states, active, overlaps, next: upcoming[0] || null };
}

/** Session intervals clipped to the 24h day [dayStart, dayStart+24h) for the timeline. */
export function timelineIntervals(dayStart, cfg) {
  const a = dayStart.getTime(), b = a + 86400000;
  return cfg.sessions.map((s) => {
    const mid = new Date(a + 43200000);
    const wins = sessionWindows(s, mid, -2, 2)
      .filter((w) => w.end.getTime() > a && w.start.getTime() < b)
      .map((w) => ({ start: Math.max(a, w.start.getTime()), end: Math.min(b, w.end.getTime()), tradable: tradable(w, cfg.marketWeek) }));
    return { id: s.id, name: s.name, color: s.color, intervals: wins };
  });
}
