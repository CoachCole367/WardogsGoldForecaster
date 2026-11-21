export const DAY = 86400000;
export const MODEL_VERSION = 'momentum-season-v2';
export const dateAdd = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
export const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
export function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const i = (sorted.length - 1) * p;
  return sorted[Math.floor(i)] * (1 - i % 1) + sorted[Math.ceil(i)] * (i % 1);
}
export function validatePrices(prices) {
  if (!Array.isArray(prices) || !prices.length) throw new Error('No price observations');
  for (let i = 0; i < prices.length; i++) {
    const row = prices[i];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date || !Number.isSafeInteger(row.price) || row.price <= 0) throw new Error('Invalid price observation');
    if (i && row.date <= prices[i - 1].date) throw new Error('Prices must have unique ascending dates');
  }
  return prices;
}
export function seasonFor(date, seasons) {
  return [...seasons].filter(s => s.priceStart <= date).sort((a, b) => a.priceStart.localeCompare(b.priceStart)).at(-1);
}
const sameSeason = (a, b, seasons) => seasonFor(a, seasons)?.priceStart === seasonFor(b, seasons)?.priceStart;
export function pointForecast(history, seasons, horizon = 7) {
  const last = history.at(-1);
  const current = history.filter(p => sameSeason(p.date, last.date, seasons)).slice(-14);
  const returns = history.slice(1).flatMap((p, i) => dateAdd(history[i].date, 1) === p.date && sameSeason(history[i].date, p.date, seasons) ? [{ date: p.date, value: Math.log(p.price / history[i].price) }] : []);
  const momentum = returns.filter(r => r.date > dateAdd(last.date, -5));
  const drift = momentum.length ? Math.max(-0.12, Math.min(0.12, mean(momentum.map(r => r.value)))) : 0;
  const anchor = mean(current.map(p => Math.log(p.price)));
  let logPrice = Math.log(last.price);
  return Array.from({ length: horizon }, (_, i) => {
    const date = dateAdd(last.date, i + 1);
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    const matches = returns.filter(r => new Date(r.date + 'T00:00:00Z').getUTCDay() === weekday);
    const weekdayEffect = matches.length >= 4 ? mean(matches.map(r => r.value)) * matches.length / (matches.length + 10) : 0;
    logPrice += 0.25 * drift * Math.pow(0.7, i) + 0.08 * (anchor - logPrice) + 0.2 * weekdayEffect;
    return { date, price: Math.round(Math.exp(logPrice)) };
  });
}
export function historicalErrors(prices, seasons) {
  const errors = Array.from({ length: 7 }, () => []);
  for (let i = 13; i < prices.length - 1; i++) {
    const forecast = pointForecast(prices.slice(0, i + 1), seasons);
    forecast.forEach((prediction, h) => {
      const actual = prices[i + h + 1];
      if (!actual || actual.date !== prediction.date || !sameSeason(prices[i].date, actual.date, seasons)) return;
      errors[h].push({ origin: prices[i].date, target: actual.date, error: Math.log(actual.price / prediction.price), modelError: Math.abs(actual.price - prediction.price) / actual.price, baselineError: Math.abs(actual.price - prices[i].price) / actual.price });
    });
  }
  return errors;
}
export function weightedQuantile(samples, p) {
  const sorted = [...samples].sort((a, b) => a.value - b.value);
  const threshold = samples.reduce((sum, s) => sum + s.weight, 0) * p;
  let cumulative = 0;
  for (const sample of sorted) {
    cumulative += sample.weight;
    if (cumulative >= threshold) return sample.value;
  }
  return sorted.at(-1).value;
}
export function forecast(prices, seasons, level = 0.8, recordedErrors = [], { coldStart = false } = {}) {
  validatePrices(prices);
  if (!coldStart && prices.length < 21) throw new Error('At least 21 observations are required');
  if (![0.8, 0.95].includes(level)) throw new Error('Unsupported interval');
  const errors = historicalErrors(prices, seasons);
  const last = prices.at(-1);
  const rows = pointForecast(prices, seasons).map((p, h) => {
    const unique = new Map();
    for (const e of recordedErrors.filter(e => e.horizon === h + 1 && e.target <= last.date && e.origin < last.date && e.modelVersion === MODEL_VERSION && sameSeason(e.origin, e.target, seasons))) {
      const key = `${e.origin}:${e.target}`;
      if (!unique.has(key) || e.kind !== 'replay') unique.set(key, e);
    }
    const recorded = [...unique.values()].sort((a, b) => a.origin.localeCompare(b.origin)).slice(-180);
    const live = recorded.filter(e => e.kind !== 'replay'), replay = recorded.filter(e => e.kind === 'replay');
    const residuals = errors[h].filter(e => !unique.has(`${e.origin}:${e.target}`)).map(e => e.error);
    // Discount simulated errors to half the weight of a genuinely published prediction.
    const priorWeight = Math.min(20, residuals.length);
    const samples = residuals.map(value => ({ value, weight: priorWeight / residuals.length })).concat(recorded.map(e => ({ value: e.error, weight: e.kind === 'replay' ? 0.5 : 1 })));
    const totalWeight = priorWeight + live.length + replay.length * 0.5;
    const calibration = { backtestSamples: residuals.length, liveSamples: live.length, replaySamples: replay.length, liveWeight: live.length / (totalWeight || 1), replayWeight: replay.length * 0.5 / (totalWeight || 1), biasAdjustment: 0 };
    const rawPrice = p.price;
    if (residuals.length + recorded.length < 8) return { ...p, rawPrice, low: null, high: null, cheaper: null, samples: residuals.length + recorded.length, calibration };
    const tail = (1 - level) / 2;
    const errorQuantile = q => recorded.length ? weightedQuantile(samples, q) : quantile(residuals, q);
    // Learn systematic over/underestimation without chasing a single unusually large miss.
    const evidenceWeight = live.length + replay.length * 0.5;
    const bias = recorded.length ? Math.max(-0.35, Math.min(0.35, errorQuantile(0.5))) * evidenceWeight / (evidenceWeight + 20) : 0;
    calibration.biasAdjustment = Math.exp(bias) - 1;
    const price = Math.round(rawPrice * Math.exp(bias));
    // Include the point estimate even when the empirical residual distribution is skewed.
    const low = Math.max(1, Math.floor(Math.min(price, rawPrice * Math.exp(errorQuantile(tail)))));
    const high = Math.ceil(Math.max(price, rawPrice * Math.exp(errorQuantile(1 - tail))));
    const cheaperWeight = samples.filter(s => rawPrice * Math.exp(s.value) < last.price).reduce((sum, s) => sum + s.weight, 0);
    const cheaper = recorded.length ? Math.round(100 * (1 + cheaperWeight) / (totalWeight + 2)) : Math.round(100 * (1 + residuals.filter(e => rawPrice * Math.exp(e) < last.price).length) / (residuals.length + 2));
    return { ...p, rawPrice, price, low, high, cheaper, samples: residuals.length + recorded.length, calibration };
  });
  const validation = errors.map((sample, h) => {
    let covered = 0, total = 0;
    // Only errors whose actual prices were known at the forecast origin may calibrate it.
    for (const e of sample) {
      const past = sample.filter(p => p.target <= e.origin).map(p => p.error);
      if (past.length < 10) continue;
      const tail = (1 - level) / 2;
      covered += Number(e.error >= Math.min(0, quantile(past, tail)) && e.error <= Math.max(0, quantile(past, 1 - tail)));
      total++;
    }
    return { horizon: h + 1, samples: sample.length, coverage: total ? covered / total : null, coverageSamples: total, modelMAPE: sample.length ? mean(sample.map(e => e.modelError)) : null, baselineMAPE: sample.length ? mean(sample.map(e => e.baselineError)) : null };
  });
  return { rows, validation, level };
}
