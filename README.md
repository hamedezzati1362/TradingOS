# TradingOS

Market condition and decision-support terminal (not a signal generator).
Live site: https://hamedezzati1362.github.io/tradingos/

- `public/` — the PWA (deployed by `.github/workflows/pages.yml` on every push to `main`)
- `npm test` — time/session engine tests (DST, midnight, weekend)
- `node tests/ui.check.mjs <url> <dir>` — responsive/console/offline checks (needs Playwright)
- Architecture: `docs/ARCHITECTURE_FA.md`

Status: Phase 1–5 done. Clocks, sessions, timeline and the session factor are LIVE; market panels are DEMO until data providers are connected (Phase 6).
