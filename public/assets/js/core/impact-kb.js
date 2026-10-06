// Rule-based impact knowledge base (Phase 7). Explains in Persian (and short English) how an economic event or a headline
// can affect XAUUSD / FX / Brent. Language is always conditional ("potential pressure"), never a prediction.
// Direction convention: effects[sym] = +1 means the symbol tends to RISE when the release is ABOVE forecast ("hot"), -1 means fall.

const USD_POS = { XAUUSD: -1, EURUSD: -1, GBPUSD: -1, USDJPY: +1, BRENT: 0 };   // stronger USD / higher US yields
const neg = (e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, -v]));
const ccyPos = (ccy) => ({
  EUR: { EURUSD: +1 }, GBP: { GBPUSD: +1 }, JPY: { USDJPY: -1 }, USD: USD_POS,
}[ccy] || {});

/* Each rule: match (regex on title), ccy (optional filter), inverse (higher number = weaker economy), fa/en texts. */
const RULES = [
  { id: 'cpi', match: /\b(cpi|inflation|pce|ppi|price index)\b/i,
    fa: { name: 'تورم', why: 'تورم بالاتر احتمال نگه‌داشتن نرخ بهره در سطح بالا یا افزایش آن را بیشتر می‌کند.',
      hi: 'بالاتر از پیش‌بینی: معمولاً ارز آن کشور و بازده اوراق تقویت می‌شوند؛ برای طلا فشار نزولی احتمالی (اگر دلار باشد).',
      lo: 'پایین‌تر از پیش‌بینی: انتظار کاهش نرخ بهره بیشتر می‌شود؛ ارز تضعیف و طلا معمولاً حمایت می‌شود.' },
    en: 'Hot inflation → tighter policy expectations → currency up; for USD, potential pressure on gold.' },
  { id: 'nfp', match: /(non-?farm|nfp|employment change|adp)/i,
    fa: { name: 'اشتغال', why: 'بازار کار قوی یعنی اقتصاد داغ و فضای کمتر برای کاهش نرخ بهره.',
      hi: 'بالاتر از پیش‌بینی: ارز تقویت؛ برای داده‌ی آمریکا فشار نزولی احتمالی روی طلا و EURUSD/GBPUSD.',
      lo: 'پایین‌تر از پیش‌بینی: ارز تضعیف؛ برای داده‌ی آمریکا حمایت احتمالی از طلا.' },
    en: 'Strong jobs → currency up; weak jobs → currency down (US: gold up).' },
  { id: 'unemp', match: /(unemployment rate|jobless claims|claimant count)/i, inverse: true,
    fa: { name: 'بیکاری', why: 'عدد بالاتر بیکاری یعنی ضعف اقتصاد (اثر معکوس).',
      hi: 'بالاتر از پیش‌بینی: ارز تضعیف؛ برای آمریکا حمایت احتمالی از طلا.',
      lo: 'پایین‌تر از پیش‌بینی: ارز تقویت؛ برای آمریکا فشار احتمالی روی طلا.' },
    en: 'Higher unemployment → currency down (US: gold up).' },
  { id: 'rate', match: /(rate decision|interest rate|federal funds rate|policy rate|cash rate|bank rate|monetary policy|fomc statement|main refinancing)/i,
    fa: { name: 'نرخ بهره', why: 'مهم‌ترین رویداد برای ارز؛ جمله‌بندی بیانیه و پیش‌بینی‌های آینده گاهی مهم‌تر از خود عدد است.',
      hi: 'افزایش یا لحن انقباضی‌تر از انتظار: ارز تقویت؛ برای فدرال رزرو فشار احتمالی روی طلا.',
      lo: 'کاهش یا لحن انبساطی‌تر: ارز تضعیف؛ برای فدرال رزرو حمایت احتمالی از طلا.' },
    en: 'Hawkish surprise → currency up; dovish → down. Fed decisions move gold strongly.' },
  { id: 'cbspeak', match: /(fomc|fed chair|powell|gov .*speaks|president .*speaks|meeting minutes|press conference|lagarde|bailey|ueda)/i, noDirection: true,
    fa: { name: 'سخنرانی/صورت‌جلسه بانک مرکزی', why: 'عدد ندارد؛ اثر به لحن بستگی دارد. نوسان ناگهانی محتمل است.',
      hi: 'لحن انقباضی (Hawkish): ارز تقویت؛ برای فدرال رزرو فشار احتمالی روی طلا.',
      lo: 'لحن انبساطی (Dovish): ارز تضعیف؛ برای فدرال رزرو حمایت احتمالی از طلا.' },
    en: 'No number; tone matters. Expect sudden volatility.' },
  { id: 'gdp', match: /\bgdp\b/i,
    fa: { name: 'رشد اقتصادی', why: 'رشد قوی‌تر از انتظار یعنی اقتصاد سالم‌تر و احتمال نرخ بهره‌ی بالاتر.',
      hi: 'بالاتر از پیش‌بینی: ارز تقویت.', lo: 'پایین‌تر از پیش‌بینی: ارز تضعیف؛ نگرانی رکود می‌تواند به نفع طلا باشد.' },
    en: 'Strong growth → currency up.' },
  { id: 'retail', match: /retail sales/i,
    fa: { name: 'خرده‌فروشی', why: 'نشان‌دهنده‌ی قدرت مصرف خانوار.', hi: 'بالاتر از پیش‌بینی: ارز تقویت.', lo: 'پایین‌تر از پیش‌بینی: ارز تضعیف.' },
    en: 'Strong consumer → currency up.' },
  { id: 'pmi', match: /\b(pmi|ism)\b/i,
    fa: { name: 'شاخص مدیران خرید (PMI)', why: 'بالای ۵۰ یعنی رشد فعالیت، زیر ۵۰ یعنی انقباض.',
      hi: 'بالاتر از پیش‌بینی: ارز تقویت؛ برای چین/آمریکا تقاضای نفت هم احتمالاً بهتر دیده می‌شود.', lo: 'پایین‌تر از پیش‌بینی: ارز تضعیف.' },
    en: 'PMI above forecast → currency up.' },
  { id: 'crude', match: /(crude oil inventories|crude inventories|api weekly|\beia\b)/i, oil: true,
    fa: { name: 'ذخایر نفت آمریکا', why: 'افزایش ذخایر یعنی عرضه بیشتر از تقاضا (اثر معکوس روی قیمت نفت).',
      hi: 'افزایش بیشتر از پیش‌بینی ذخایر: فشار نزولی احتمالی روی نفت.', lo: 'کاهش بیشتر از پیش‌بینی ذخایر: حمایت احتمالی از نفت.' },
    en: 'Bigger inventory build → potential pressure on oil.' },
  { id: 'opec', match: /opec/i, oil: true, noDirection: true,
    fa: { name: 'اوپک', why: 'تصمیم درباره‌ی سقف تولید مستقیماً روی عرضه‌ی نفت اثر دارد.',
      hi: 'کاهش تولید یا تمدید کاهش: حمایت احتمالی از نفت.', lo: 'افزایش تولید: فشار نزولی احتمالی روی نفت.' },
    en: 'Output cuts support oil; increases pressure it.' },
];

const CCY_FA = { USD: 'دلار آمریکا', EUR: 'یورو', GBP: 'پوند', JPY: 'ین', AUD: 'دلار استرالیا', CAD: 'دلار کانادا', CHF: 'فرانک', NZD: 'دلار نیوزیلند', CNY: 'یوآن', All: 'جهانی' };

/** Explain one calendar event. Returns null when no rule matches (still shown, without commentary). */
export function explainEvent(ev) {
  const rule = RULES.find((r) => r.match.test(ev.title));
  if (!rule) return null;
  let effects;
  if (rule.oil) effects = { BRENT: rule.id === 'crude' ? -1 : +1, USDJPY: 0, XAUUSD: 0 };
  else { effects = ccyPos(ev.ccy); if (rule.inverse) effects = neg(effects); }
  const relevance = Object.entries(effects).filter(([, v]) => v !== 0).map(([k]) => k);
  if (ev.ccy === 'USD' && !rule.oil && !relevance.includes('XAUUSD')) relevance.push('XAUUSD');
  return {
    rule: rule.id, nameFa: rule.fa.name, ccyFa: CCY_FA[ev.ccy] || ev.ccy, whyFa: rule.fa.why, ifHigherFa: rule.fa.hi, ifLowerFa: rule.fa.lo,
    en: rule.en, effects, noDirection: !!rule.noDirection, relevance,
  };
}

/* Headline topics. effects = typical direction when the headline is "risk-on/hawkish/supply-cut" style; we only say "potential". */
const TOPICS = [
  { id: 'fed', re: /\b(fed|fomc|powell|rate cut|rate hike|interest rate|treasury yields?)\b/i, fa: 'سیاست پولی / نرخ بهره', rel: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'],
    noteFa: 'خبر انقباضی (نرخ بالاتر) معمولاً به نفع دلار و علیه طلاست؛ خبر کاهش نرخ برعکس.' },
  { id: 'infl', re: /\b(inflation|cpi|pce|prices rise)\b/i, fa: 'تورم', rel: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'],
    noteFa: 'تورم بالاتر احتمال نرخ بهره‌ی بالاتر را زیاد می‌کند؛ اثر روی طلا دوطرفه است (پوشش تورم در برابر بازده بالاتر).' },
  { id: 'geo', re: /\b(war|attack|missile|strike|conflict|ceasefire|israel|iran|russia|ukraine|middle east|houthi|tension)\b/i, fa: 'ژئوپلیتیک', rel: ['XAUUSD', 'BRENT'],
    noteFa: 'تنش بیشتر معمولاً تقاضای پناهگاه امن (طلا) را بالا می‌برد و اگر عرضه‌ی انرژی را تهدید کند، نفت را هم. آتش‌بس برعکس.' },
  { id: 'sanction', re: /\bsanction|embargo\b/i, fa: 'تحریم', rel: ['BRENT', 'XAUUSD'], noteFa: 'تحریم تولیدکننده‌ی نفت معمولاً عرضه را کم و از قیمت نفت حمایت می‌کند.' },
  { id: 'opec', re: /\b(opec|output cut|production cut|oil supply|barrels)\b/i, fa: 'عرضه‌ی نفت', rel: ['BRENT'], noteFa: 'کاهش عرضه از نفت حمایت می‌کند؛ افزایش تولید فشار نزولی دارد.' },
  { id: 'china', re: /\b(china|chinese|beijing|yuan|pboc)\b/i, fa: 'چین', rel: ['BRENT', 'XAUUSD'], noteFa: 'رشد ضعیف چین تقاضای نفت را کم می‌کند؛ خرید طلا توسط بانک مرکزی چین از طلا حمایت می‌کند.' },
  { id: 'trade', re: /\b(tariffs?|trade war|trade deal)\b/i, fa: 'تعرفه / تجارت', rel: ['XAUUSD', 'USDJPY', 'BRENT'], noteFa: 'تشدید جنگ تجاری معمولاً ریسک‌گریزی و تقاضای طلا را بالا می‌برد و برای نفت منفی است.' },
  { id: 'jobs', re: /\b(jobs|payrolls|unemployment|labor market)\b/i, fa: 'بازار کار', rel: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'], noteFa: 'بازار کار قوی آمریکا معمولاً به نفع دلار و علیه طلاست.' },
  { id: 'cb', re: /\b(ecb|lagarde|boe|bailey|boj|ueda|bank of japan|bank of england)\b/i, fa: 'بانک‌های مرکزی دیگر', rel: ['EURUSD', 'GBPUSD', 'USDJPY'], noteFa: 'لحن انقباضی بانک مرکزی، ارز همان کشور را تقویت می‌کند.' },
  { id: 'gold', re: /\b(gold prices?|gold futures|spot gold|bullion|xau|gold (?:rises|rose|falls|fell|rallies|slips|hits|steady|edges|gains|drops|climbs|record|etf))\b/i, fa: 'طلا', rel: ['XAUUSD'], noteFa: 'خبر مستقیم درباره‌ی طلا.' },
  { id: 'oil', re: /\b(oil prices?|crude|brent|wti|oil futures|oil (?:rises|rose|falls|fell|slides|jumps|climbs|drops|gains|supply|exports|output|market))\b/i, fa: 'نفت', rel: ['BRENT'], noteFa: 'خبر مستقیم درباره‌ی نفت.' },
  { id: 'dollar', re: /\b(us dollar|u\.s\. dollar|dollar index|greenback|dxy|dollar (?:rises|rose|falls|fell|slips|gains|firms|weakens|strengthens|steady))\b/i, fa: 'دلار', rel: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'], noteFa: 'دلار قوی‌تر معمولاً برای طلا و EURUSD/GBPUSD منفی است.' },
];

/** Tag a headline with Persian topics and relevant assets. Returns null for headlines unrelated to the tracked markets. */
// A headline must also read like markets/economy news; this drops obituaries, recipes, local stories etc.
const MARKET = /\b(prices?|markets?|traders?|investors?|futures|stocks?|yields?|rates?|inflation|economy|economic|central bank|barrels?|ounce|forex|currenc(?:y|ies)|bonds?|supply|demand|exports?|sanctions?|opec|fed|tariffs?|recession|gdp|jobs)\b/i;

export function explainHeadline(text) {
  if (!MARKET.test(text)) return null;
  const hits = TOPICS.filter((tp) => tp.re.test(text));
  if (!hits.length) return null;
  return { topicsFa: hits.map((h) => h.fa), notesFa: hits.slice(0, 2).map((h) => h.noteFa), relevance: [...new Set(hits.flatMap((h) => h.rel))] };
}
