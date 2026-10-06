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
