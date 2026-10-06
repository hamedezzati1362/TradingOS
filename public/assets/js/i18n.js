// Bilingual UI strings. Tickers, numbers and times always stay LTR.
const STR = {
  en: {
    brand: 'TradingOS', tagline: 'Market Condition Terminal', system: 'SYSTEM', online: 'ONLINE', offline: 'OFFLINE',
    marketCondition: 'MARKET CONDITION', sessionBoard: 'SESSION BOARD', timeline: 'SESSION TIMELINE', drivers: 'MARKET DRIVERS',
    events: 'HIGH IMPACT EVENTS', dataHealth: 'DATA FABRIC', why: 'WHY?', open: 'OPEN', closed: 'CLOSED', remaining: 'remaining',
    opensIn: 'opens in', overlap: 'OVERLAP', active: 'ACTIVE SESSION', next: 'NEXT SESSION', none: 'NONE', marketClosed: 'FX MARKET CLOSED (WEEKEND)',
    favorable: 'FAVORABLE', caution: 'CAUTION', noTrade: 'NO TRADE / WAIT', demo: 'DEMO', live: 'LIVE', stale: 'STALE', cache: 'CACHE',
    notConfigured: 'NOT CONFIGURED', demoNote: 'Demo values — no market data provider connected yet (Phase 6).',
    trend: 'TREND', structure: 'STRUCTURE', momentum: 'MOMENTUM', volatility: 'VOLATILITY', regime: 'REGIME', condition: 'CONDITION',
    session: 'SESSION', liquidity: 'LIQUIDITY', news: 'NEWS RISK', spread: 'SPREAD', price: 'PRICE', calendar: 'CALENDAR', timeEngine: 'TIME ENGINE',
    provider: 'Provider', latency: 'Latency', age: 'age', now: 'NOW', home: 'HOME', markets: 'MARKETS', newsTab: 'NEWS', sessionsTab: 'SESSIONS',
    potential: 'Potential relevance', insufficient: 'INSUFFICIENT DATA', coverage: 'coverage', fallback: 'FALLBACK', unavailable: 'UNAVAILABLE', forecast: 'Forecast', previous: 'Previous', actual: 'Actual', local: 'LOCAL',
  },
  fa: {
    brand: 'TradingOS', tagline: 'ترمینال وضعیت بازار', system: 'سیستم', online: 'آنلاین', offline: 'آفلاین',
    marketCondition: 'وضعیت بازار', sessionBoard: 'سشن‌ها', timeline: 'تایم‌لاین سشن‌ها', drivers: 'محرک‌های بازار',
    events: 'رویدادهای مهم', dataHealth: 'سلامت داده', why: 'چرا؟', open: 'باز', closed: 'بسته', remaining: 'مانده',
    opensIn: 'باز می‌شود تا', overlap: 'همپوشانی', active: 'سشن فعال', next: 'سشن بعدی', none: 'هیچ', marketClosed: 'بازار فارکس بسته است (آخر هفته)',
    favorable: 'مناسب', caution: 'احتیاط', noTrade: 'معامله نکن / صبر', demo: 'نمایشی', live: 'زنده', stale: 'قدیمی', cache: 'کش',
    notConfigured: 'تنظیم نشده', demoNote: 'مقادیر نمایشی — هنوز هیچ منبع داده‌ی بازار وصل نیست (فاز ۶).',
    trend: 'روند', structure: 'ساختار', momentum: 'مومنتوم', volatility: 'نوسان', regime: 'رژیم', condition: 'وضعیت',
    session: 'سشن', liquidity: 'نقدشوندگی', news: 'ریسک خبر', spread: 'اسپرد', price: 'قیمت', calendar: 'تقویم', timeEngine: 'موتور زمان',
    provider: 'منبع', latency: 'تأخیر', age: 'عمر', now: 'اکنون', home: 'خانه', markets: 'بازارها', newsTab: 'اخبار', sessionsTab: 'سشن‌ها',
    potential: 'ارتباط احتمالی', insufficient: 'داده‌ی ناکافی', coverage: 'پوشش', fallback: 'جایگزین', unavailable: 'در دسترس نیست', forecast: 'پیش‌بینی', previous: 'قبلی', actual: 'واقعی', local: 'محلی',
  },
};
let lang = 'en';
try { const v = localStorage.getItem('tos.lang'); if (v === 'fa' || v === 'en') lang = v; } catch { /* storage blocked */ }
export const t = (k) => STR[lang][k] ?? STR.en[k] ?? k;
export const getLang = () => lang;
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('tos.lang', l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'fa' ? 'rtl' : 'ltr';
}
