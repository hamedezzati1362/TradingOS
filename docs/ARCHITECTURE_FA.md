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

## فاز ۸ (بخش اول) — سطوح کلیدی و ADR
- `keyLevels()` در `market-engines.js`: PDH/PDL/PDC و Pivot کلاسیک (R1/R2/S1/S2) بر اساس روز بروکر (۱۷:۰۰ نیویورک)، Day Open/High/Low، رنج آسیا (۰۰ تا ۰۷ UTC)، سقف/کف هفته جاری و قبل، ADR(14)
- کندل روزانه هر ۶ ساعت یک بار گرفته می‌شود (صرفه‌جویی در سهمیه API)
- کارت «سطوح کلیدی»: نردبان سطوح اطراف قیمت با فاصله به واحد ATR + درصد پرشدن ADR با توضیح فارسی

## فاز ۹ — Macro Drivers (فقط زمینه، خارج از امتیاز)
- `core/macro-engine.js`: DXY، بازده ۱۰ ساله آمریکا، VIX، نقره + نسبت طلا/نقره؛ تغییر ۱ و ۵ روزه، اثر احتمالی روی طلا، جمع‌بندی TAILWIND/HEADWIND/MIXED
- منبع: Yahoo (روزانه) ← LKG Cache. منبع دوم رایگانِ در دسترس پیدا نشد (Stooq از محیط اجرا مسدود است)؛ چون این بخش در تصمیم شرکت ندارد، این ریسک پذیرفته و مستند شد.

## تمرکز طلا و دلار + انتخاب روز
- انتخاب روز (امروز/فردا/پس‌فردا/تقویم) برای تقویم و بخش تمرکز؛ افق = داده‌ی ForexFactory (هفته جاری و، وقتی منتشر شده باشد، هفته بعد)
- بخش طلا و بخش دلار: رویدادهای آن روز به ترتیب اولویت (اهمیت × نوع خبر) با جمله‌ی فارسی «اگر بالاتر/پایین‌تر از پیش‌بینی بیاید ممکن است بالا/پایین برود»

## فاز ۱۰ — سیگنال اندیکاتورها، تایم‌فریم، نمودار
- `core/technicals.js`: ۱۱ اسیلاتور (RSI، Stochastic، CCI، ADX، AO، Momentum، MACD، Stoch RSI، Williams %R، Bull Bear Power، Ultimate) + ۱۵ میانگین (EMA/SMA 10..200، Ichimoku Base، VWMA، Hull)؛ قواعد امتیازدهی به سبک TradingView؛ برآیند = میانگین امتیاز اسیلاتورها و میانگین‌ها (STRONG SELL..STRONG BUY). RSI با داده‌ی مرجع Wilder تست شده.
- تایم‌فریم‌ها: 15m (هر اجرا)، 1H (ساعتی)، 4H (تجمیع 1H)، 1D (هر ۶ ساعت، ۲۵۰ کندل) ← فایل‌های `data/candles/{SYM}_{TF}.json`
- حجم: حجم واقعی قراردادهای آتی CME/ICE (GC=F, 6E=F, 6B=F, 6J=F, BZ=F) از Yahoo؛ اسپات طلا/فارکس حجم متمرکز ندارد.
- نمودار: TradingView Lightweight Charts 5.2.1 (Apache-2.0، داخل `assets/vendor`، بدون CDN): کندل + EMA20/50/200 + بولینگر اختیاری + حجم + RSI + MACD، زوم/پن؛ جدول کامل اندیکاتورها

## هشدارها (بله / تلگرام)
- `collector/alerts.mjs`: ۱) خبر HIGH مرتبط با طلا/دلار ۵ تا ۳۵ دقیقه قبل از انتشار ۲) هم‌جهتی برآیند طلا در 1H و 4H (صعودی قوی/نزولی قوی)، فقط هنگام تغییر
- ارسال: بله (tapi.bale.ai) ← تلگرام، با ProviderManager؛ Secrets: `BALE_BOT_TOKEN`, `BALE_CHAT_ID` (و اختیاری `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
- پیام آزمایشی: Actions ← Run workflow ← alert_test = 1
- چون اجرا هر ~۱۵ دقیقه است، هشدار خبر بین ۵ تا ۳۵ دقیقه قبل از خبر می‌رسد

## خلاصه‌ی صبح، هشدار سطح، سابقه‌ی عملکرد
- خلاصه‌ی صبح (دوشنبه تا جمعه، اولین اجرای بین ۰۸:۰۰ تا ۰۹:۳۰ تهران): قیمت، وضعیت، برآیند ۴ تایم‌فریم، سطوح، ADR، زمینه‌ی کلان، خبرهای امروز
- هشدار سطح: برخورد آخرین کندل‌های 15m طلا به PDH/PDL/سقف و کف هفته (یک بار برای هر سطح در روز)
- `core/asset-condition.js`: همان موتور امتیاز داشبورد در جمع‌آورنده
- سابقه: هر اجرا یک ردیف برای هر نماد در `records-YYYY-MM.csv` روی برنچ `history` (ماندگار، جدا از سایت)
- `collector/evaluate.mjs`: حرکت بعدی قیمت (+1h/+4h) به واحد ATR برای هر خوانش (برآیند 1H/4H و باند وضعیت) ← کارت «سابقه‌ی عملکرد»

## سقف و کف سشن‌ها
- `sessionLevels()`: برای سیدنی (★)، آسیا/توکیو (★★★)، لندن (★★★★)، نیویورک (★★★): آخرین پنجره‌ی شروع‌شده (با DST درست)، سقف/کف، و وضعیت بعد از پایان سشن: FORMING / INTACT / SWEPT (زد و برگشت) / BROKEN (بیرون ماند)
- سطوح ★۳ به بالا در نردبان سطوح کلیدی هم هستند
- هشدار بله: هنگام SWEPT یا BROKEN شدن سقف/کف آسیا، لندن، نیویورک (یک بار برای هر سطح در هر سشن)
