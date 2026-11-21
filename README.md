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

The raw forecast works in log prices. Each future day combines:

- 25% of the mean of the last five available daily log returns (capped at ±0.12), decaying by 0.7 per future day.
- An 8% pull toward the mean log price of up to 14 observations in the current price season.
- A small historical weekday return effect, requiring four observations and shrunk by `n / (n + 10)` with a 20% weight.

Daily returns require consecutive dates and exclude known season boundaries. There is no assumed economic mechanism or claim that player counts, bans, patch notes, or cosmetic demand causally predict prices. Those factors need reliable paired histories before being added. No future wipe is assumed; a surprise wipe can invalidate forecasts.

For every historical origin after 14 observations, forecasts are calculated using only preceding observations. Errors are recorded separately for horizons 1–7; targets spanning a known season boundary or missing a required date are excluded. Displayed ranges apply empirical signed log-error quantiles to the central estimate, including the estimate in the range. At least eight errors are required. The cheaper-price percentage counts residual-adjusted forecasts below the latest observed price, with add-one smoothing. It is an approximate model probability, not a calibrated guarantee.

An **80% prediction range** targets 80% coverage of individual daily outcomes; it is not an 80% probability of an exact prediction, nor an 80% simultaneous range for the whole week. The 95% range is especially uncertain with so little data. Forecast errors overlap in time and are not independent.

Historical coverage tests use expanding calibration, with at least ten errors whose target prices were already known at that historical origin. The dashboard reports coverage and sample counts per horizon, model mean absolute percentage error, and an unchanged-price baseline. These measurements may show the model failing to beat the baseline; the dashboard reports that result without hiding it. Parameters are heuristic and have not been validated on an independent long-term holdout.

## Learning from saved forecasts

Every refresh also updates `data/forecasts.json`, a permanent forecast ledger committed to Git. `npm run track` can run this step separately using the current observations. A successful refresh with a current UTC-day observation saves one seven-day outlook, including both interval levels, cheaper-price probabilities, issue timestamp, model version, calibration counts and historical validation. Reruns on the same UTC day reuse that outlook exactly. Missing, stale or disputed latest observations do not create a backdated guess. Older days are never backfilled as if predictions existed then.

On later refreshes, each available, undisputed actual price is attached once to the corresponding saved target. Original guesses and outcomes remain unchanged. Missing or disputed actuals stay pending until available. The first saved outlook's tomorrow guess can be scored after the next daily reading; its seven-day guess takes seven days to resolve. No live scores are claimed before these outcomes arrive.

Calibration uses signed log errors relative to the raw estimate, separately for each horizon and only for the same `MODEL_VERSION`. Both actual published guesses and the historical replay described below inform today's algorithm. Known wipe crossings and outcomes not yet observed at issue time are excluded. Each origin/target pair counts once, with live evidence preferred over replay. Matching reconstructed backtest errors are removed to avoid double counting. Up to 180 most recent recorded errors per horizon are used: each live error has weight 1 and each simulated error weight 0.5. Unmatched historical errors supply at most 20 effective observations. The dashboard shows both sample counts and influence. Weighted empirical quantiles set the ranges, and weighted below-latest outcomes set cheaper-price probabilities with add-one smoothing. Before any recorded errors exist, the original unweighted backtest calibration is retained.

The current v2 algorithm also corrects systematic price bias. It takes the median signed error, caps it at ±0.35 log units, and shrinks it by `recorded_weight / (recorded_weight + 20)` before adjusting the raw estimate. Bounds remain based on the raw error distribution, avoiding applying bias twice. Forecast CSVs include raw estimates and the learned adjustment. Improved accuracy or narrower ranges are not guaranteed. A formula change must bump `MODEL_VERSION`; previous live forecasts remain untouched but do not train the new model. A new version may save a separate outlook on the same day. Changing season configuration can exclude newly identified wipe crossings without changing live guesses.

## Walk-forward replay from day one

`lib/replay.mjs` reveals the recorded history one observation at a time, starting on the very first day. At each step it resolves only earlier predictions whose target is that revealed date, gathers only errors available by that simulated time, and then predicts the following seven days. Both observations and season context are restricted to what that step has revealed. The first day's raw guess is necessarily the only known price; confidence is left unavailable until eight eligible errors exist for that horizon.

Replay guesses stop before the first genuinely published forecast date, keeping their origins separate from live guesses. Later actual readings can still resolve pending replay targets. Replay errors immediately train new live forecasts; this is not just a historical display. `npm run track` and the daily refresh rebuild `data/replay.json` deterministically and use it before issuing the current model's live outlook. Old live predictions are never rewritten when a replay is regenerated.

`data/replay.json` is explicitly marked as simulation, with hypothetical issue times, not proof that those predictions were published then. A scorecard selector keeps simulated performance separate from published performance. Download either archive from the dashboard. The replay uses today's model design and the currently recorded historical dataset; it is not an independent holdout or proof of what the data provider exposed on those past dates. Future-perturbation and history-extension tests ensure later prices do not affect earlier simulated guesses.

The dashboard separates live scores from reconstructed historical tests. The live scorecard reports original-range coverage, mean absolute percentage price error, and Brier score for cheaper-price probabilities (mean squared probability error; 0 is best). Wipe-crossing and older-model predictions remain in the scorecard but do not train current confidence. Overlapping horizons share actual prices and are not independent trials. Export the full JSON archive from the learning section or download the current forecast CSV with its issue timestamp and calibration counts.

## Files

- `web/`: dashboard, chart, converter and CSV export.
- `lib/model.mjs`: shared forecast, validation and UTC date logic.
- `lib/archive.mjs`, `scripts/track.mjs`: immutable forecast recording, outcome scoring and live calibration.
- `lib/replay.mjs`, `data/replay.json`: day-one walk-forward simulation that trains price bias and confidence.
- `lib/sources.mjs`, `scripts/refresh.mjs`: price ingestion.
- `data/`: attributed observations and known season boundaries.
- `test/model.test.mjs`: range invariants, temporal isolation, wipe exclusion, parser and missing-data checks.
- `test/archive.test.mjs`: immutable records, rerun safety, actual-outcome scoring, stale/conflicting data handling, temporal isolation and live learning.
- `test/replay.test.mjs`: day-one cold start, future-price isolation, expanding history, real training effects, deduplication and season knowledge isolation.
- `.github/workflows/pages.yml`: automatic refresh, checks and Pages deployment.

Independent fan project; not affiliated with BULKHEAD.
