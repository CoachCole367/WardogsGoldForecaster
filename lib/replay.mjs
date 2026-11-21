import { forecast, MODEL_VERSION, validatePrices } from './model.mjs';
import { emptyArchive, validateArchive, liveErrorsFrom } from './archive.mjs';

export const REPLAY_VERSION = 'walk-forward-v1';
export function replayHistory(prices, seasons, stopBefore) {
  validatePrices(prices);
  const replay = { ...emptyArchive(), kind: 'walk-forward-replay', replayVersion: REPLAY_VERSION, modelVersion: MODEL_VERSION, stopBefore };
  // Reveal a single UTC observation at a time. Never pass the remaining price series to forecast().
  for (let i = 0; i < prices.length; i++) {
    const history = prices.slice(0, i + 1), day = prices[i], now = `${day.date}T00:20:00.000Z`;
    const knownSeasons = seasons.filter(s => s.priceStart <= day.date);
    for (const entry of replay.entries) {
      entry.forecasts[80].rows.forEach((row, h) => {
        if (row.date === day.date) entry.outcomes.push({ horizon: h + 1, actualPrice: day.price, observedAt: now });
      });
    }
    if (day.date >= stopBefore) continue;
    const pastErrors = liveErrorsFrom(replay, knownSeasons, day.date, now);
    const results = Object.fromEntries([80, 95].map(level => {
      const result = forecast(history, knownSeasons, level / 100, pastErrors, { coldStart: true });
      // Keep the actual guesses, not repeated copies of the same historical validation report.
      return [level, { level: level / 100, validation: [], rows: result.rows.map(({ date, price, rawPrice, low, high, cheaper }) => ({ date, price, rawPrice, low, high, cheaper })) }];
    }));
    replay.entries.push({ kind: 'replay', origin: day.date, issuedAt: now, modelVersion: MODEL_VERSION, baselinePrice: day.price, forecasts: results, outcomes: [] });
  }
  return validateArchive(replay);
}
