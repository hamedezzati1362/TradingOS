// Alert rules + messenger delivery (Bale / Telegram, same Bot API shape). Persian messages, conditional wording.
// Dedup state lives in the published snapshot (only opaque alert ids, no personal data).
import { ProviderManager, redact } from '../public/assets/js/core/provider-manager.js';

const IR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const IRDAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
const FADATE = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long' });
const BAND_FA = { FAVORABLE: 'مناسب', CAUTION: 'احتیاط', NO_TRADE: 'معامله نکن / صبر', INSUFFICIENT: 'داده‌ی ناکافی' };
const tehranHM = (t) => { const [h, m] = IR.format(new Date(t)).split(':').map(Number); return h * 60 + m; };
const tehranWd = (t) => new Date(new Date(t).toLocaleString('en-US', { timeZone: 'Asia/Tehran' })).getDay();
const FA_LABEL = { 'STRONG BUY': 'صعودی قوی', BUY: 'صعودی', NEUTRAL: 'خنثی', SELL: 'نزولی', 'STRONG SELL': 'نزولی قوی' };

/** Returns [{id, text}] for alerts that should fire now and were not sent before. */
export function buildAlerts({ calendar, assets, now = Date.now(), sent = {}, leadMin = [5, 35], condition = {}, macro = null, lastBars = {}, briefAt = [8 * 60, 9 * 60 + 30] }) {
  const out = [];
  const g = assets && assets.XAUUSD;
  // 0) Morning brief (Mon-Fri, first run between 08:00 and 09:30 Tehran).
  const today = IRDAY.format(new Date(now)), hm = tehranHM(now), wd = tehranWd(now);
  if (g && g.price != null && wd >= 1 && wd <= 5 && hm >= briefAt[0] && hm <= briefAt[1] && !sent[`brief:${today}`]) {
    out.push({ id: `brief:${today}`, text: morningBrief({ g, calendar, now, today, condition: condition.XAUUSD, macro }) });
  }
  // 3) Gold touches a key level on the latest closed 15m bars (once per level per broker day).
  if (g && g.levels && lastBars.XAUUSD) {
    const watch = new Set(['PDH', 'PDL', 'WEEK HIGH', 'WEEK LOW', 'PWH', 'PWL']);
    for (const lv of g.levels.levels.filter((x) => watch.has(x.name))) {
      const hit = lastBars.XAUUSD.find((b) => b.h >= lv.price && b.l <= lv.price);
      const id = `lvl:${today}:${lv.name}:${lv.price.toFixed(2)}`;
      if (!hit || sent[id]) continue;
      const above = g.price >= lv.price;
      out.push({ id, text: [`🎯 طلا به سطح ${lv.name} (${lv.price.toFixed(2)}) رسید.`, `قیمت فعلی: ${g.price.toFixed(2)} — ${above ? 'بالای' : 'زیر'} سطح.`,
        lv.name.includes('H') ? 'سقف مهم: محل احتمالی برگشت یا در صورت تثبیت بالای آن، شکست.' : 'کف مهم: محل احتمالی برگشت یا در صورت تثبیت زیر آن، شکست.',
        `ADR امروز: ${g.levels.adrPct ?? '--'}% · برآیند 1H: ${(g.tech && g.tech['1h'] && FA_LABEL[g.tech['1h'].summary.label]) || '--'}`, 'TradingOS · اطلاع‌رسانی، نه توصیه‌ی معامله'].join('\n') });
    }
  }
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

function morningBrief({ g, calendar, now, today, condition, macro }) {
  const tf = (k) => (g.tech && g.tech[k] ? FA_LABEL[g.tech[k].summary.label] : '--');
  const L = g.levels || {}, lv = (n) => { const x = (L.levels || []).find((y) => y.name === n); return x ? x.price.toFixed(2) : '--'; };
  const evs = ((calendar && calendar.events) || []).filter((e) => IRDAY.format(new Date(e.ts)) === today && e.impact !== 'LOW' && e.kb && (e.ccy === 'USD' || e.kb.relevance.includes('XAUUSD')))
    .sort((a, b) => (a.impact === b.impact ? a.ts - b.ts : a.impact === 'HIGH' ? -1 : 1)).slice(0, 6);
  return [
    `☀️ خلاصه‌ی صبح TradingOS — ${FADATE.format(new Date(now))}`,
    '',
    `🟡 طلا: ${g.price.toFixed(2)} (${g.changePct > 0 ? '+' : ''}${g.changePct ?? '--'}% در ۲۴ ساعت)`,
    `وضعیت: ${condition ? `${condition.score ?? '--'} — ${BAND_FA[condition.band]}` : '--'} | رژیم: ${g.regime} | ساختار 15m: ${g.structure}`,
    `برآیند اندیکاتورها → 15m: ${tf('15m')} | 1H: ${tf('1h')} | 4H: ${tf('4h')} | 1D: ${tf('1d')}`,
    '',
    `📏 سطوح: PDH ${lv('PDH')} | PDL ${lv('PDL')} | Pivot ${lv('PIVOT')}`,
    `هفته: ${lv('WEEK HIGH')} / ${lv('WEEK LOW')} | ADR(14): ${L.adr ? L.adr.toFixed(1) : '--'}`,
    macro && macro.goldBias ? `🌐 زمینه‌ی کلان: ${macro.goldBias.labelFa}` : '',
    '',
    evs.length ? `📅 خبرهای امروز (تهران):\n${evs.map((e) => `• ${IR.format(new Date(e.ts))} ${e.impact === 'HIGH' ? '🔴' : '🟠'} ${e.ccy} ${e.title}${e.forecast ? ` (پیش‌بینی ${e.forecast})` : ''}`).join('\n')}` : '📅 امروز خبر مهمی برای طلا/دلار در تقویم نیست.',
    '',
    'احتمالی، نه توصیه‌ی معامله.',
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
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

/** When no chat id is configured, use the most recent private chat that messaged the bot (never logged). */
async function discoverChatId(base, token) {
  if (!token) return null;
  try {
    const r = await fetch(`${base}/bot${token}/getUpdates`);
    const j = await r.json();
    const chats = (j.result || []).map((u) => (u.message || u.edited_message || {}).chat).filter((c) => c && c.type === 'private');
    return chats.length ? String(chats[chats.length - 1].id) : null;
  } catch { return null; }
}

/** Sends alerts through Bale -> Telegram failover. Returns updated `sent` map. Never throws. */
export async function deliver(alerts, sent, env, log) {
  if (!alerts.length) return { sent, health: [] };
  env = { ...env };
  if (env.BALE_BOT_TOKEN && !env.BALE_CHAT_ID) env.BALE_CHAT_ID = await discoverChatId('https://tapi.bale.ai', env.BALE_BOT_TOKEN);
  if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_CHAT_ID) env.TELEGRAM_CHAT_ID = await discoverChatId('https://api.telegram.org', env.TELEGRAM_BOT_TOKEN);
  if (env.BALE_BOT_TOKEN && !env.BALE_CHAT_ID) log('warn', 'Bale: chat id not found - send any message to the bot first');
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
