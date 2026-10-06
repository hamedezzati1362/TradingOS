// Macro drivers (Phase 9): describe the backdrop for gold/oil/FX. Context only — not part of the condition score.
export const MACRO = [
  { id: 'DXY', name: 'DXY', yahoo: 'DX-Y.NYB', unit: '', dp: 2, gold: -1,
    fa: { up: 'دلار در ۵ روز اخیر قوی‌تر شده؛ فشار احتمالی روی طلا و EURUSD/GBPUSD.', down: 'دلار ضعیف‌تر شده؛ حمایت احتمالی از طلا.', flat: 'دلار بدون جهت مشخص.' } },
  { id: 'US10Y', name: 'US 10Y', yahoo: '^TNX', unit: '%', dp: 2, gold: -1, absChange: true,
    fa: { up: 'بازده اوراق ۱۰ ساله بالا رفته؛ هزینه‌ی فرصت نگه‌داری طلا بیشتر شده (فشار احتمالی).', down: 'بازده اوراق پایین آمده؛ معمولاً به نفع طلا.', flat: 'بازده اوراق تقریباً ثابت.' } },
  { id: 'VIX', name: 'VIX', yahoo: '^VIX', unit: '', dp: 2, gold: +1, level: [15, 22],
    fa: { up: 'ترس بازار سهام بالا رفته (ریسک‌گریزی)؛ تقاضای پناهگاه امن مثل طلا ممکن است بیشتر شود.', down: 'بازار آرام‌تر شده؛ تقاضای پناهگاه امن کمتر.', flat: 'سطح ترس بازار تغییر محسوسی نکرده.' } },
  { id: 'SILVER', name: 'SILVER', yahoo: 'SI=F', unit: '', dp: 2, gold: +1,
    fa: { up: 'نقره هم‌جهت بالا رفته؛ تأیید قدرت فلزات گران‌بها.', down: 'نقره ضعیف شده؛ احتیاط برای طلا.', flat: 'نقره بدون جهت مشخص.' } },
];

/** Per-driver change stats from daily candles (oldest first). Threshold for "flat": 0.3% (or 0.05 pt for yields). */
export function driverStats(def, candles) {
  if (!candles || candles.length < 7) return null;
  const c = candles.map((x) => x.c), last = c[c.length - 1];
  const ch = (n) => (def.absChange ? last - c[c.length - 1 - n] : (last / c[c.length - 1 - n] - 1) * 100);
  const chg1d = ch(1), chg5d = ch(5);
  const th = def.absChange ? 0.05 : 0.3;
  const dir = chg5d > th ? 1 : chg5d < -th ? -1 : 0;
  return { value: last, chg1d, chg5d, dir, goldEffect: dir * def.gold, noteFa: def.fa[dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat'] };
}

/** Net macro backdrop for gold: sum of driver effects. */
export function goldBias(items) {
  const s = items.reduce((a, x) => a + (x.goldEffect || 0), 0);
  if (s >= 2) return { score: s, labelFa: 'زمینه‌ی کلان به نفع طلا (Tailwind)', label: 'TAILWIND' };
  if (s <= -2) return { score: s, labelFa: 'زمینه‌ی کلان علیه طلا (Headwind)', label: 'HEADWIND' };
  return { score: s, labelFa: 'زمینه‌ی کلان خنثی یا متضاد', label: 'MIXED' };
}
