# WARDOGS Gold Forecast

A GitHub Pages dashboard for the **in-game cash cost of one WARDOGS gold bar**, with a seven-day outlook, 80% / 95% prediction ranges, estimated chance of a cheaper rate, historical validation, season context, a cash converter, and forecast CSV export.

## Run locally

Node.js 20+; no packages to install.

```sh
npm run refresh
npm test
npm run lint
npm run build
npm run dev
```

Open http://127.0.0.1:4173. Rebuild after editing source files. `dist/` is generated; edit `web/`, `lib/`, or `data/`.

## GitHub Pages

In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**. The `Refresh and deploy Pages` workflow runs on pushes to `main`, manually, and once daily at 00:20 UTC. It fetches observations, runs checks, preserves data in Git, builds the static site, and deploys Pages. No API keys or paid services are needed. Scheduled Actions can be delayed or disabled by GitHub after prolonged repository inactivity.

Expected URL: https://coachcole367.github.io/WardogsGoldForecaster/

## Data

- [Wardogstats daily history](https://wardogstats.app/gold): primary observations; credits MetaForge community readings.
- [Wardogs.tools daily history](https://wardogs.tools/gold): additional observations and cross-checks.
- [MetaForge market](https://metaforge.app/wardogs/market) and [season changes](https://metaforge.app/wardogs/changelog): reference and season context.

These are community readings, not an official external game feed. The updater parses date/price table rows, records provenance per observation, validates dates and positive integer cash prices, preserves existing observations, and reports source failures or conflicting prices. First-listed source wins when initially adding a conflicting date; subsequent discrepancies retain stored history and show a warning. Sources may share an upstream provider, so agreement does not imply independent verification. The game client remains authoritative.

`data/seasons.json` separates the update date from the first rate set after an intraday wipe. Known price seasons begin September 10, October 16, and November 13, 2026. Future season dates require a verified manual update. For source rows without years, the adapter assumes newest-first ordering, anchors the latest row to the most recent matching date, and rolls backward across New Year. Subsequent fetches must overlap a matching retained observation; a changed format or date interpretation requires adapter review.

If fetching fails, retained observations remain available. The site prominently reports stale data and keeps forecast dates anchored to the actual last observation. It never silently shifts old forecasts forward.

## Forecast method

The central forecast works in log prices. Each future day combines:

- 25% of the mean of the last five available daily log returns (capped at ±0.12), decaying by 0.7 per future day.
- An 8% pull toward the mean log price of up to 14 observations in the current price season.
- A small historical weekday return effect, requiring four observations and shrunk by `n / (n + 10)` with a 20% weight.

Daily returns require consecutive dates and exclude known season boundaries. There is no assumed economic mechanism or claim that player counts, bans, patch notes, or cosmetic demand causally predict prices. Those factors need reliable paired histories before being added. No future wipe is assumed; a surprise wipe can invalidate forecasts.

For every historical origin after 14 observations, forecasts are calculated using only preceding observations. Errors are recorded separately for horizons 1–7; targets spanning a known season boundary or missing a required date are excluded. Displayed ranges apply empirical signed log-error quantiles to the central estimate, including the estimate in the range. At least eight errors are required. The cheaper-price percentage counts historical residual-adjusted forecasts below the latest observed price, with add-one smoothing. It is an approximate model probability, not a calibrated guarantee.

An **80% prediction range** targets 80% coverage of individual daily outcomes; it is not an 80% probability of an exact prediction, nor an 80% simultaneous range for the whole week. The 95% range is especially uncertain with so little data. Forecast errors overlap in time and are not independent.

Historical coverage tests use expanding calibration, with at least ten errors whose target prices were already known at that historical origin. The dashboard reports coverage and sample counts per horizon, model mean absolute percentage error, and an unchanged-price baseline. These measurements may show the model failing to beat the baseline; the dashboard reports that result without hiding it. Parameters are heuristic and have not been validated on an independent long-term holdout.

## Files

- `web/`: dashboard, chart, converter and CSV export.
- `lib/model.mjs`: shared forecast, validation and UTC date logic.
- `lib/sources.mjs`, `scripts/refresh.mjs`: price ingestion.
- `data/`: attributed observations and known season boundaries.
- `test/model.test.mjs`: range invariants, temporal isolation, wipe exclusion, parser and missing-data checks.
- `.github/workflows/pages.yml`: automatic refresh, checks and Pages deployment.

Independent fan project; not affiliated with BULKHEAD.
