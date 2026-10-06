// Builds a single self-contained HTML (inline CSS + JS) for previewing without a server.
import { readFileSync, writeFileSync } from 'node:fs';
const [out] = process.argv.slice(2);
const js = ['config.js', 'engines/time-engine.js', 'engines/session-engine.js', 'i18n.js', 'demo-data.js', 'main.js']
  .map((f) => readFileSync(`public/assets/js/${f}`, 'utf8').replace(/^import .*$/gm, '').replace(/^export (const|function|let)/gm, '$1'))
  .join('\n');
const icon = 'data:image/svg+xml,' + encodeURIComponent(readFileSync('public/assets/icons/icon.svg', 'utf8'));
let html = readFileSync('public/index.html', 'utf8')
  .replace('<link rel="stylesheet" href="assets/css/app.css">', `<style>\n${readFileSync('public/assets/css/app.css', 'utf8')}\n</style>`)
  .replace('href="assets/icons/icon.svg"', `href="${icon}"`)
  .replace('<script type="module" src="assets/js/main.js"></script>', `<script type="module">\n${js}\n</script>`);
writeFileSync(out, html);
