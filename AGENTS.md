# Wardogs Gold Forecaster

- Stack: buildless HTML/CSS/ES modules; Node 20+ scripts, no dependencies; GitHub Pages.
- Install: none. Dev: `npm run dev`. Refresh data: `npm run refresh`.
- Validate: `npm test`, `npm run lint`, `npm run build`.
- `web/` is the website; `lib/` contains shared forecasting and source parsing; `data/` contains attributed observations and season configuration. `dist/` is generated and ignored.
- Keep UTC dates and positive integer cash prices. Never fabricate observations or silently replace conflicting history. Exclude returns across configured price-season boundaries.
- Confidence means an empirical prediction interval, not the probability an exact price is correct. Keep historical validation free of future observations.
- Done: checks pass, source freshness and failures are visible, mobile and desktop layouts work, Pages deployment succeeds.
