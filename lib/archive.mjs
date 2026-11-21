import { MODEL_VERSION, forecast, seasonFor, mean, dateAdd, validatePrices } from './model.mjs';

export const emptyArchive = () => ({ schemaVersion: 1, entries: [] });
const crossesWipe = (origin, target, seasons) => seasonFor(origin, seasons)?.priceStart !== seasonFor(target, seasons)?.priceStart;
export function validateArchive(archive) {
  if (archive?.schemaVersion !== 1 || !Array.isArray(archive.entries)) throw new Error('Unsupported forecast archive');
  const origins = new Set();
  for (const entry of archive.entries) {
    if (origins.has(entry.origin) || !entry.modelVersion || !Number.isFinite(Date.parse(entry.issuedAt)) || entry.issuedAt.slice(0, 10) !== entry.origin || !Number.isSafeInteger(entry.baselinePrice) || entry.baselinePrice <= 0) throw new Error('Invalid or duplicate archived forecast');
    origins.add(entry.origin);
    for (const level of [80, 95]) {
      const result = entry.forecasts?.[level];
      if (result?.rows?.length !== 7 || result.level !== level / 100 || !Array.isArray(result.validation)) throw new Error('Incomplete archived forecast');
      result.rows.forEach((row, i) => {
        if (row.date !== dateAdd(entry.origin, i + 1) || !Number.isSafeInteger(row.price) || row.price <= 0 || (row.low != null && !(row.low > 0 && row.low <= row.price && row.high >= row.price)) || (row.cheaper != null && !(row.cheaper >= 0 && row.cheaper <= 100))) throw new Error('Invalid archived prediction');
        if (row.price !== entry.forecasts[80].rows[i].price) throw new Error('Interval levels disagree on point estimate');
      });
    }
    const horizons = new Set();
    if (!Array.isArray(entry.outcomes)) throw new Error('Missing forecast outcomes');
    for (const outcome of entry.outcomes) {
      if (!Number.isInteger(outcome.horizon) || outcome.horizon < 1 || outcome.horizon > 7 || horizons.has(outcome.horizon) || !Number.isSafeInteger(outcome.actualPrice) || outcome.actualPrice <= 0 || !Number.isFinite(Date.parse(outcome.observedAt)) || outcome.observedAt.slice(0, 10) < dateAdd(entry.origin, outcome.horizon)) throw new Error('Invalid archived outcome');
      horizons.add(outcome.horizon);
    }
  }
  return archive;
}
export function liveErrorsFrom(archive, seasons, asOf, knownAt = `${asOf}T23:59:59.999Z`) {
  validateArchive(archive);
  return archive.entries.flatMap(entry => entry.outcomes.flatMap(outcome => {
    const row = entry.forecasts[80].rows[outcome.horizon - 1];
    if (entry.modelVersion !== MODEL_VERSION || row.date > asOf || outcome.observedAt > knownAt || entry.issuedAt >= `${row.date}T00:00:00.000Z` || crossesWipe(entry.origin, row.date, seasons)) return [];
    return [{ origin: entry.origin, target: row.date, horizon: outcome.horizon, modelVersion: entry.modelVersion, error: Math.log(outcome.actualPrice / row.price) }];
  })).sort((a, b) => a.origin.localeCompare(b.origin));
}
export function updateArchive(archive, data, seasons, now = new Date().toISOString()) {
  validateArchive(archive);
  validatePrices(data.prices);
  const next = structuredClone(archive), today = now.slice(0, 10);
  const pricesByDate = new Map(data.prices.filter(p => p.date <= today).map(p => [p.date, p]));
  const conflictingDates = new Set((data.warnings || []).flatMap(w => w.match(/\d{4}-\d{2}-\d{2}/g) || []));
  // Resolve old guesses before issuing today's guesses. Never overwrite a saved guess or outcome.
  for (const entry of next.entries) {
    for (const [i, row] of entry.forecasts[80].rows.entries()) {
      const actual = pricesByDate.get(row.date);
      if (!actual || conflictingDates.has(row.date) || row.date <= entry.origin || entry.issuedAt >= `${row.date}T00:00:00.000Z` || entry.outcomes.some(o => o.horizon === i + 1)) continue;
      entry.outcomes.push({ horizon: i + 1, actualPrice: actual.price, observedAt: now });
    }
    entry.outcomes.sort((a, b) => a.horizon - b.horizon);
  }
  const last = data.prices.at(-1);
  const fresh = last.date === today && data.sources.some(s => s.ok && s.latest === today) && !conflictingDates.has(today);
  if (fresh && !next.entries.some(e => e.origin === last.date)) {
    const live = liveErrorsFrom(next, seasons, last.date, now);
    next.entries.push({
      origin: last.date, issuedAt: now, modelVersion: MODEL_VERSION, calibrationVersion: 'archived-errors-v1', baselinePrice: last.price,
      forecasts: { 80: forecast(data.prices, seasons, 0.8, live), 95: forecast(data.prices, seasons, 0.95, live) }, outcomes: []
    });
  }
  next.entries.sort((a, b) => a.origin.localeCompare(b.origin));
  return validateArchive(next);
}
export function archivedScores(archive, seasons, level = 80) {
  return archive.entries.flatMap(entry => entry.outcomes.map(outcome => {
    const row = entry.forecasts[level].rows[outcome.horizon - 1];
    return {
      origin: entry.origin, issuedAt: entry.issuedAt, target: row.date, horizon: outcome.horizon,
      price: row.price, actualPrice: outcome.actualPrice,
      covered: row.low == null ? null : outcome.actualPrice >= row.low && outcome.actualPrice <= row.high,
      error: Math.abs(outcome.actualPrice - row.price) / outcome.actualPrice,
      brier: row.cheaper == null ? null : (row.cheaper / 100 - Number(outcome.actualPrice < entry.baselinePrice)) ** 2,
      eligible: entry.modelVersion === MODEL_VERSION && !crossesWipe(entry.origin, row.date, seasons)
    };
  })).sort((a, b) => a.target.localeCompare(b.target) || a.origin.localeCompare(b.origin));
}
export function archiveSummary(archive, seasons, level = 80) {
  const scores = archivedScores(archive, seasons, level);
  return Array.from({ length: 7 }, (_, i) => {
    const sample = scores.filter(s => s.horizon === i + 1);
    const covered = sample.filter(s => s.covered != null), probabilities = sample.filter(s => s.brier != null);
    return { horizon: i + 1, scored: sample.length, eligible: sample.filter(s => s.eligible).length,
      coverage: covered.length ? mean(covered.map(s => Number(s.covered))) : null,
      error: sample.length ? mean(sample.map(s => s.error)) : null,
      brier: probabilities.length ? mean(probabilities.map(s => s.brier)) : null
    };
  });
}
