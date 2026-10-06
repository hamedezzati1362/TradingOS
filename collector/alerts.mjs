// Alert rules + messenger delivery (Bale / Telegram, same Bot API shape). Persian messages, conditional wording.
// Dedup state lives in the published snapshot (only opaque alert ids, no personal data).
import { ProviderManager, redact } from '../public/assets/js/core/provider-manager.js';

const IR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const FA_LABEL = { 'STRONG BUY': 'صعودی قوی', BUY: 'صعودی', NEUTRAL: 'خنثی', SELL: 'نزولی', 'STRONG SELL': 'نزولی قوی' };

/** Returns [{id, text}] for alerts that should fire now and were not sent before. */
export function buildAlerts({ calendar, assets, now = Date.now(), sent = {}, leadMin = [5, 35] }) {
  const out = [];
  // 1) High-impact event relevant to gold or USD starting within the lead window.
  for (const e of (calendar && calendar.events) || []) {
    if (e.impact !== 'HIGH' || !e.kb) continue;
    if (!(e.ccy === 'USD' || e.kb.relevance.includes('XAUUSD'))) continue;
    const dm = (e.ts - now) / 60000;
    if (dm < leadMin[0] || dm > leadMin[1]) continue;
    const id = `ev:${e.ccy}:${e.title}:${e.ts}`;
    if (sent[id]) continue;
    const g = e.kb.effects.XAUUSD || 0;
    const goldLine = e.kb.noDirection ? 'طلا: لحن انقباضی ← فشار احتمالی؛ لحن انبساطی ← حمایت احتمالی.'
      : g ? `طلا: اگر عدد بالاتر از پیش‌بینی بیاید ممکن است ${g > 0 ? 'بالا برود ▲' : 'پایین بیاید ▼'}؛ اگر پایین‌تر بیاید برعکس.` : '';
    out.push({ id, text: [`⚠️ خبر مهم تا ${Math.round(dm)} دقیقه دیگر (ساعت ${IR.format(new Date(e.ts))} تهران)`, `${e.ccy} · ${e.title}`,
      `پیش‌بینی: ${e.forecast ?? '--'} | قبلی: ${e.previous ?? '--'}`, `${e.kb.nameFa}: ${e.kb.whyFa}`, goldLine, 'TradingOS · احتمالی، نه پیش‌بینی قطعی'].filter(Boolean).join('\n') });
  }
  // 2) Gold technical alignment: 1H and 4H both STRONG BUY or both STRONG SELL (fires on change only).
  const tech = assets && assets.XAUUSD && assets.XAUUSD.tech;
  if (tech && tech['1h'] && tech['4h']) {
    const a = tech['1h'].summary.label, b = tech['4h'].summary.label;
    const aligned = a === b && (a === 'STRONG BUY' || a === 'STRONG SELL') ? a : 'NONE';
    const id = `gold-align:${aligned}`;
    if (aligned !== 'NONE' && !sent[id]) {
      out.push({ id, resetPrefix: 'gold-align:', text: [`📊 طلا (XAUUSD): برآیند اندیکاتورها در 1H و 4H هم‌زمان «${FA_LABEL[aligned]}» شد.`,
        `قیمت: ${assets.XAUUSD.price.toFixed(2)} | ساختار 15m: ${assets.XAUUSD.structure}`, 'جمع‌بندی اندیکاتورهاست، نه توصیه‌ی معامله.'].join('\n') });
    }
    if (aligned === 'NONE') for (const k of Object.keys(sent)) if (k.startsWith('gold-align:')) delete sent[k];   // re-arm
  }
  return out;
}

function messenger(name, base, token, chatId) {
  return { name, priority: name === 'Bale' ? 1 : 2, timeoutMs: 15000, retries: 1, enabled: !!(token && chatId),
    async fetch(_key, { text }) {
      const r = await fetch(`${base}/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(`${name} HTTP ${r.status} ${j.description || ''}`);
      return { ok: true };
    } };
}

/** Sends alerts through Bale -> Telegram failover. Returns updated `sent` map. Never throws. */
export async function deliver(alerts, sent, env, log) {
  const providers = [
    messenger('Bale', 'https://tapi.bale.ai', env.BALE_BOT_TOKEN, env.BALE_CHAT_ID),
    messenger('Telegram', 'https://api.telegram.org', env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID),
  ].filter((p) => p.enabled);
  if (!providers.length) { if (alerts.length) log('warn', `alerts: ${alerts.length} pending but no messenger configured`); return { sent, health: [] }; }
  const pm = new ProviderManager({ kind: 'alerts', providers, validate: (d) => (d && d.ok ? { ok: true } : { ok: false, reason: 'not delivered' }), log, retries: 1, backoffMs: 2000 });
  for (const a of alerts) {
    const r = await pm.get(a.id, { text: a.text });
    if (r.status === 'LIVE' || r.status === 'FALLBACK') { sent[a.id] = Date.now(); log('info', `alert delivered via ${r.source}`); }
    else log('error', `alert not delivered: ${redact(JSON.stringify(r.attempts))}`);
  }
  // forget ids older than 3 days
  for (const [k, ts] of Object.entries(sent)) if (Date.now() - ts > 3 * 86400000) delete sent[k];
  return { sent, health: pm.health() };
}
