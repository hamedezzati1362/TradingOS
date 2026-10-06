// UI checks: Test 6 (offline), 7 (390px), 8 (768px), 9 (1920px), console errors. Usage: node tests/ui.check.mjs <url> <shotDir>
import { chromium } from 'playwright';
const [url, shots] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
let failed = 0;
for (const [w, h] of [[390, 844], [768, 1024], [1920, 1080]]) {
  for (const lang of ['en', 'fa']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('response', (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
    await page.addInitScript((l) => localStorage.setItem('tos.lang', l), lang);
    await page.goto(url, { waitUntil: 'networkidle' }).catch(() => page.goto(url));
    await page.waitForTimeout(1200);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const panels = await page.evaluate(() => [...document.querySelectorAll('.pill.down')].length);
    const ok = ov <= 0 && !errs.filter((e) => !/fonts\.(googleapis|gstatic)/.test(e)).length && !panels;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${w}px ${lang}: overflow=${ov} errors=${JSON.stringify(errs)} panelErrors=${panels}`);
    await page.screenshot({ path: `${shots}/ui_${w}_${lang}.png`, fullPage: true });
    if (w === 390 && lang === 'en') {       // Test 6: offline -> clock & sessions keep ticking
      await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      const t1 = await page.textContent('.clock .time'); await page.waitForTimeout(2100); const t2 = await page.textContent('.clock .time');
      const net = await page.textContent('#net-pill'); const sess = await page.$$eval('.sess', (x) => x.length);
      const okOff = t1 !== t2 && /OFFLINE/.test(net) && sess === 4;
      if (!okOff) failed++;
      console.log(`${okOff ? 'PASS' : 'FAIL'} offline: clock ${t1}→${t2}, net="${net}", sessions=${sess}`);
    }
    await ctx.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
