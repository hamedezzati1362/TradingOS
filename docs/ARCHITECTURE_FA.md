# TradingOS — معماری (نسخه‌ی ۰.۳: فاز ۱ تا ۳)

## تصمیم میزبانی (تغییر نسبت به پرامپت اولیه)
کاربر هاست ندارد و استفاده شخصی است ← به جای cPanel/PHP:
| لایه | سرویس رایگان | نقش |
|---|---|---|
| Frontend (PWA) | GitHub Pages یا Cloudflare Pages | فایل‌های استاتیک، HTTPS (برای نصب PWA روی گوشی لازم است) |
| Backend | Cloudflare Workers (رایگان، ۱۰۰ هزار درخواست در روز) | نگهداری API Key به‌صورت Secret، Failover، Cache، Cron Trigger |
| Cache/Storage | Cloudflare KV / D1 | Last-Known-Good و Journal |
| Provider اول (پیشنهادی) | EA پل روی MT5 کاربر ← POST به Worker | قیمت/اسپرد/کندل بروکر |
اصل‌های معماری بدون تغییر ماند: Provider Manager، Circuit Breaker، Validation، LKG Cache، برچسب LIVE/FALLBACK/CACHE/STALE/DEMO.

## لایه‌ها
- `public/assets/js/engines/time-engine.js` — زمان، IANA، بدون شبکه
- `public/assets/js/engines/session-engine.js` — سشن‌ها، DST، تعطیلی آخر هفته (جمعه ۱۷:۰۰ تا یکشنبه ۱۷:۰۰ نیویورک)
- `public/assets/js/config.js` — همه‌ی پارامترها (سشن‌ها، وزن‌ها، ساعت سرور = NY+7)
- `public/assets/js/main.js` — رندر؛ هر پنل در try/catch جدا (خرابی یک پنل کل داشبورد را خراب نمی‌کند)
- `public/assets/js/i18n.js` — دوزبانه EN/FA با RTL
- `public/assets/js/demo-data.js` — داده‌ی نمایشی؛ همه با برچسب DEMO

## وضعیت داده‌ها
| بخش | وضعیت |
|---|---|
| ساعت‌ها، سشن‌ها، Timeline، فاکتور Session | LIVE (محاسبه‌ی محلی) |
| قیمت، Regime، Structure، خبر، تقویم، Drivers | DEMO (فاز ۵ تا ۹) |

## تست‌ها
- `npm test` — ۱۱ تست موتور زمان/سشن (DST آمریکا/اروپا/سیدنی، نیمه‌شب، آخر هفته، ساعت سرور، تهران)
- `node tests/ui.check.mjs <url> <dir>` — ۳۹۰/۷۶۸/۱۹۲۰ پیکسل × EN/FA، Overflow، خطای Console، حالت آفلاین

## فاز ۴ — Market Condition Engine (`core/condition-engine.js`)
- ورودی: فاکتورها `{value 0..100, status, note}`؛ وزن‌ها، باندها، حداقل پوشش و Vetoها از `config.js`
- فاکتور ناموجود/STALE حذف و وزن بقیه نرمال می‌شود؛ پوشش < ۶۰٪ ← `INSUFFICIENT DATA`
- Veto: خبر مهم نزدیک (news < 20) ← `NO_TRADE` صرف‌نظر از میانگین
- وضعیت کل = بدترین وضعیت فاکتورهای استفاده‌شده (یک DEMO ← کل DEMO)
- امتیازدهنده‌ها: Session، News Risk، Volatility (پرسنتایل ATR)، Spread

## فاز ۵ — Provider Manager (`core/provider-manager.js`, `core/validators.js`)
- زنجیره‌ی اولویت ← Timeout ← Retry با Backoff ← Validation ← Provider بعدی ← LKG Cache ← STALE ← UNAVAILABLE
- Circuit Breaker: CLOSED → (۳ خطای پیاپی) OPEN → (Cooldown) HALF_OPEN → یک Probe → CLOSED/OPEN
- Health Score: نسبت موفقیت، خطاهای پیاپی، Latency
- Validation قیمت: null، منفی، Timestamp نامعتبر/آینده/قدیمی، Ask<Bid، جهش غیرعادی نسبت به آخرین داده‌ی سالم
- Validation خبر + حذف تکراری بین منابع
- لاگ‌ها کلید/توکن را ماسک می‌کنند؛ `get()` هرگز Exception نمی‌دهد و داده نمی‌سازد
- تست‌ها: `tests/reliability.test.mjs` (سناریوهای ۱ تا ۵ و ۱۲ پرامپت)، `tests/condition.test.mjs`

## فاز ۶ — داده‌ی واقعی
- `collector/collect.mjs` در GitHub Actions هر ~۱۵ دقیقه: کندل‌های M15 (۳۰۰ عدد) ← ProviderManager ← `validate.mjs` ← `market-engines.js` ← `public/data/snapshot.json`
- Providerها (`collector/providers.mjs`, `sources.config.mjs`): ۱) Twelve Data (کلید در Secret) ۲) Yahoo Finance (بدون کلید؛ طلا = GC=F آتی، برنت = BZ=F — روی کارت برچسب می‌خورد)
- LKG: Snapshot منتشرشده‌ی قبلی از خود سایت خوانده می‌شود
- فقط Provider اصلی LIVE است؛ Yahoo = FALLBACK. در UI: سن > ۲۵ دقیقه ← CACHE، > ۴۵ دقیقه ← STALE (از تصمیم حذف)
- موتورها: ATR و پرسنتایل آن، RSI، Efficiency Ratio، سوینگ فرکتالی، HH/HL/LH/LL، BOS، CHoCH، Regime، Momentum
- کارت وضعیت بازار از XAUUSD تغذیه می‌شود؛ Liquidity/News/Spread تا فاز ۷ «بدون داده» (نه DEMO)

## فاز ۷ — اخبار و تقویم اقتصادی با تفسیر فارسی
- تقویم: ۱) ForexFactory (هفته جاری + بعد، بدون کلید؛ Actual ندارد) ۲) Finnhub Calendar ← LKG
- اخبار: ۱) Finnhub News ۲) Google News RSS ← LKG؛ حذف تکراری، فیلتر «خبر بازار» برای حذف تیترهای بی‌ربط
- `core/impact-kb.js`: پایگاه دانش قاعده‌محور؛ برای هر رویداد: نوع، دلیل اهمیت، سناریوی «بالاتر/پایین‌تر از پیش‌بینی» و جهت احتمالی هر نماد
- عامل News Risk واقعی شد (رویدادهای مرتبط با هر نماد) و Veto خبر فعال است
- فیلترهای تقویم: ALL/HIGH/MEDIUM/USD/EUR/GBP/JPY/GOLD/OIL
