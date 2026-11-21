import { forecast, seasonFor, dateAdd, mean } from './lib/model.mjs';
import { validateArchive, liveErrorsFrom, archiveSummary, archivedScores } from './lib/archive.mjs';
const $ = id => document.getElementById(id);
const money = n => n == null ? 'Unavailable' : '$' + Math.round(n).toLocaleString('en-US');
const compact = n => '$' + (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n / 1000) + 'k');
const pct = n => (n > 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
const fmtDate = date => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
let data, seasons, result, archive;
const percentOrPending = value => value == null ? 'Pending' : (value * 100).toFixed(1) + '%';
function renderLearning(snapshot) {
  const level = Math.round(result.level * 100);
  const summary = archiveSummary(archive, seasons, level);
  const scores = archivedScores(archive, seasons, level);
  const pending = archive.entries.reduce((sum, e) => sum + 7 - e.outcomes.length, 0);
  const calibration = result.rows[0].calibration;
  $('learning-metrics').innerHTML = `<div><strong>${archive.entries.length}</strong><span>Saved seven-day forecasts</span></div><div><strong>${scores.length}</strong><span>Daily predictions scored</span></div><div><strong>${pending}</strong><span>Waiting for actual prices</span></div><div><strong>${Math.round(calibration.liveWeight * 100)}%</strong><span>Live error weight for tomorrow</span></div>`;
  $('learning-status').textContent = snapshot ? `This outlook was saved ${new Date(snapshot.issuedAt).toLocaleString(undefined, { timeZoneName: 'short' })}. Its estimates and percentages stay unchanged. ${scores.length ? 'New outcomes will adjust the next saved outlook.' : 'No outcomes yet; learning starts as the next daily prices arrive.'}` : 'No saved outlook for the latest observation. This preview is not counted as a recorded prediction; a fresh successful daily refresh will save one.';
  $('learning-rows').innerHTML = summary.map(s => `<tr><td>Day ${s.horizon}</td><td>${s.scored}</td><td>${percentOrPending(s.coverage)}</td><td>${percentOrPending(s.error)}</td><td>${s.brier == null ? 'Pending' : s.brier.toFixed(3)}</td><td>${result.rows[s.horizon - 1].calibration.liveSamples}</td></tr>`).join('');
  $('recent-scores').innerHTML = scores.length ? [...scores].reverse().slice(0, 14).map(s => `<tr><td>${fmtDate(s.origin)}</td><td>${fmtDate(s.target)}</td><td>Day ${s.horizon}</td><td>${money(s.price)}</td><td>${money(s.actualPrice)}</td><td>${percentOrPending(s.error)}</td><td>${s.covered == null ? 'No range' : s.covered ? 'Inside' : 'Outside'}${s.eligible ? '' : ' · excluded from learning'}</td></tr>`).join('') : '<tr><td colspan="7">No resolved predictions yet. The first comparison appears after the next daily price is recorded.</td></tr>';
}
function chart() {
  const count = $('history').value;
  const history = count === 'all' ? data.prices : data.prices.slice(-Number(count));
  const last = history.at(-1);
  const points = [...history, ...result.rows];
  const width = 1100, height = 330, left = 68, right = 25, top = 30, bottom = 45;
  const start = Date.parse(history[0].date), end = Date.parse(points.at(-1).date);
  const max = Math.max(...points.map(p => p.high ?? p.price)) * 1.08;
  const x = date => left + (Date.parse(date) - start) / (end - start) * (width - left - right);
  const y = price => height - bottom - price / max * (height - top - bottom);
  const line = rows => rows.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(2)},${y(p.price).toFixed(2)}`).join(' ');
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc"><title id="chart-title">WARDOGS gold price forecast</title><desc id="chart-desc">Historical cash per gold bar in green, followed by seven forecast days in gold. A shaded band shows the ${Math.round(result.level * 100)} percent prediction range. Exact forecast values are in the table below.</desc>`;
  svg += `<rect x="${x(last.date)}" y="${top}" width="${width - right - x(last.date)}" height="${height - bottom - top}" fill="#d4b66b05"/>`;
  for (let i = 0; i <= 4; i++) {
    const price = max * i / 4;
    svg += `<line x1="${left}" x2="${width - right}" y1="${y(price)}" y2="${y(price)}" stroke="#344037" stroke-dasharray="3 5"/><text x="${left - 12}" y="${y(price) + 4}" text-anchor="end">${compact(price)}</text>`;
  }
  for (const season of seasons.filter(s => s.priceStart > history[0].date && s.priceStart <= last.date)) {
    svg += `<line x1="${x(season.priceStart)}" x2="${x(season.priceStart)}" y1="${top}" y2="${height - bottom}" stroke="#758477" stroke-dasharray="3 5"/><text x="${x(season.priceStart) + 7}" y="19">${season.name}</text>`;
  }
  const band = result.rows.filter(p => p.low != null);
  if (band.length) {
    const bandPoints = [{ date: last.date, low: last.price, high: last.price }, ...band];
    svg += `<polygon points="${bandPoints.map(p => `${x(p.date)},${y(p.high)}`).concat([...bandPoints].reverse().map(p => `${x(p.date)},${y(p.low)}`)).join(' ')}" fill="#d4b66b20"/>`;
  }
  svg += `<path d="${line(history)}" fill="none" stroke="#9cc8aa" stroke-width="2.5"/><path d="${line([last, ...result.rows])}" fill="none" stroke="#d4b66b" stroke-width="2.5" stroke-dasharray="6 5"/>`;
  for (const p of points) svg += `<circle cx="${x(p.date)}" cy="${y(p.price)}" r="${p.date > last.date ? 3 : 2}" fill="${p.date > last.date ? '#d4b66b' : '#9cc8aa'}"><title>${p.date}: ${money(p.price)}${p.low != null ? `; range ${money(p.low)} to ${money(p.high)}` : ''}</title></circle>`;
  const ticks = [...new Set([history[0].date, history[Math.floor(history.length / 3)].date, history[Math.floor(2 * history.length / 3)].date, last.date, result.rows[3].date, result.rows[6].date])];
  for (const date of ticks) svg += `<text x="${x(date)}" y="${height - 14}" text-anchor="middle">${fmtDate(date)}</text>`;
  svg += `<line x1="${x(last.date)}" x2="${x(last.date)}" y1="${top}" y2="${height - bottom}" stroke="#d4b66b" stroke-dasharray="3 4"/><text x="${x(last.date) + 8}" y="${top + 12}" style="fill:#d4b66b">FORECAST</text></svg>`;
  $('chart').innerHTML = svg;
}
function calculator() {
  const cash = Number($('cash').value);
  const last = data.prices.at(-1), end = result.rows.at(-1);
  if (!Number.isFinite(cash) || cash < 0 || cash > 1e12) {
    $('bars-now').textContent = $('bars-later').textContent = '—';
    $('cash-range').textContent = 'Enter cash from 0 to 1 trillion.';
    return;
  }
  $('bars-now').textContent = Math.floor(cash / last.price).toLocaleString('en-US');
  $('bars-later').textContent = Math.floor(cash / end.price).toLocaleString('en-US');
  $('cash-range').textContent = end.low == null ? 'Insufficient history for a range.' : `Day seven range: ${Math.floor(cash / end.high).toLocaleString('en-US')}–${Math.floor(cash / end.low).toLocaleString('en-US')} whole bars at the ${Math.round(result.level * 100)}% price interval.`;
}
function render() {
  const level = Number($('confidence').value);
  const snapshot = archive.entries.find(e => e.origin === data.prices.at(-1).date);
  result = snapshot?.forecasts[Math.round(level * 100)] || forecast(data.prices, seasons, level, liveErrorsFrom(archive, seasons, data.prices.at(-1).date));
  const last = data.prices.at(-1), previous = data.prices.at(-2), end = result.rows.at(-1);
  const season = seasonFor(last.date, seasons);
  const currentSeason = data.prices.filter(p => p.date >= season.priceStart);
  const low = Math.min(...currentSeason.map(p => p.price));
  const daily = last.price / previous.price - 1;
  $('current').textContent = money(last.price);
  $('observed').textContent = `${fmtDate(last.date)}, ${last.date.slice(0, 4)} · UTC`;
  $('daily').textContent = dateAdd(previous.date, 1) === last.date ? `${pct(daily)} since previous day` : `${pct(daily)} since previous observation`;
  $('daily').className = daily <= 0 ? 'down' : 'up';
  $('day-seven').textContent = money(end.price);
  $('week-change').textContent = `${pct(end.price / last.price - 1)} vs. latest observed price`;
  $('chance').textContent = end.cheaper == null ? 'Unavailable' : end.cheaper + '%';
  $('season-low').textContent = money(low);
  $('season-position').textContent = `${pct(last.price / low - 1)} above season low`;
  $('season').textContent = `${season.name} · price day ${Math.round((Date.parse(last.date) - Date.parse(season.priceStart)) / 86400000) + 1}`;
  const levelPercent = Math.round(result.level * 100);
  $('range-label').textContent = levelPercent + '%';
  $('range-heading').textContent = levelPercent + '% prediction range';
  $('table-note').textContent = `Ranges target ${levelPercent}% coverage; actual historical coverage is shown below. Each probability compares that day's price with ${money(last.price)}. Historical error bias can make these probabilities differ from the estimate's direction.`;
  $('forecast-rows').innerHTML = result.rows.map(p => `<tr><td><strong>${fmtDate(p.date)}</strong><span class="day-name">${new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(p.date + 'T00:00:00Z'))}</span></td><td><strong>${money(p.price)}</strong></td><td>${p.low == null ? 'Insufficient history' : `${money(p.low)} – ${money(p.high)}`}</td><td class="${p.price <= last.price ? 'down' : 'up'}">${pct(p.price / last.price - 1)}</td><td><span class="probability">${p.cheaper == null ? '—' : p.cheaper + '%'}</span></td></tr>`).join('');
  const validation = result.validation.at(-1);
  $('validation').innerHTML = `<div><strong>${validation.coverage == null ? '—' : Math.round(validation.coverage * 100) + '%'}</strong><span>Day seven backtest coverage (${levelPercent}% target)</span></div><div><strong>${validation.coverageSamples}</strong><span>Day seven backtest coverage tests</span></div><div><strong>${(validation.modelMAPE * 100).toFixed(1)}%</strong><span>Day seven backtest forecast error</span></div><div><strong>${(validation.baselineMAPE * 100).toFixed(1)}%</strong><span>Unchanged-price baseline error</span></div>`;
  let assessment = $('assessment');
  if (!assessment) { assessment = document.createElement('p'); assessment.id = 'assessment'; assessment.className = 'fine'; $('validation').after(assessment); }
  assessment.textContent = validation.modelMAPE > validation.baselineMAPE ? 'Preliminary results: this model has not beaten an unchanged-price forecast at the seven-day horizon. Treat its outlook as exploratory.' : 'Preliminary results: this model has lower historical seven-day error than the unchanged-price baseline. This does not establish future accuracy.';
  $('validation-rows').innerHTML = result.validation.map(v => `<tr><td>Day ${v.horizon}</td><td>${v.coverage == null ? 'Unavailable' : (v.coverage * 100).toFixed(1) + '%'}</td><td>${v.coverageSamples}</td><td>${(v.modelMAPE * 100).toFixed(1)}%</td><td>${(v.baselineMAPE * 100).toFixed(1)}%</td></tr>`).join('');
  const recent = data.prices.filter(p => p.date >= dateAdd(last.date, -7));
  const movement = last.price / recent[0].price - 1;
  const returns = recent.slice(1).map((p, i) => Math.abs(p.price / recent[i].price - 1));
  const signals = [
    ['Recent momentum', pct(movement), 'Change over the last available week. The model carries only a small, fading part of this movement forward.'],
    ['Daily volatility', (mean(returns) * 100).toFixed(1) + '%', 'Average absolute daily move in the last week. Historical forecast misses determine the prediction ranges.'],
    ['Weekday pattern', 'Small weight', 'Weekday returns are shrunk toward zero. Repeated Sunday holds are observations, not a guaranteed schedule.'],
    ['Season context', `${currentSeason.length} readings`, 'Recent price levels use the current price season. Historical errors that cross a known wipe are excluded.']
  ];
  $('signals').innerHTML = signals.map(([title, value, description]) => `<div class="signal"><h3>${title}</h3><span>${value}</span><p>${description}</p></div>`).join('');
  chart(); calculator(); renderLearning(snapshot);
}
function freshness() {
  const today = new Date().toISOString().slice(0, 10), last = data.prices.at(-1);
  const stale = last.date < today;
  const failed = data.sources.some(s => !s.ok), conflicts = data.warnings.length > 0;
  const messages = [];
  if (stale) messages.push(`Data is ${Math.round((Date.parse(today) - Date.parse(last.date)) / 86400000)} UTC day(s) old. Forecast dates remain anchored to ${last.date}; they are not shifted to today.`);
  else messages.push(`Latest observed rate: ${last.date} UTC. Forecast covers ${result.rows[0].date} through ${result.rows.at(-1).date}.`);
  if (failed) messages.push('One or more sources failed the latest check.');
  if (conflicts) messages.push('Sources disagree on some prices; stored observations were retained.');
  $('status').textContent = messages.join(' ');
  $('status').className = stale || failed || conflicts ? 'status warning' : 'status';
  $('freshness').textContent = `${data.prices.length} daily observations · latest ${last.date} UTC · sources checked ${new Date(data.checkedAt).toLocaleString(undefined, { timeZoneName: 'short' })}.`;
}
try {
  const responses = await Promise.all(['data/prices.json', 'data/seasons.json', 'data/forecasts.json'].map(async url => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    return response.json();
  }));
  [data, seasons, archive] = responses;
  validateArchive(archive);
  render(); freshness();
  for (const source of data.sources) {
    const li = document.createElement('li'), a = document.createElement('a'), status = document.createElement('span');
    a.href = source.url; a.textContent = new URL(source.url).hostname;
    status.textContent = source.ok ? `Last successful reading: ${source.latest}` : `Check failed: ${source.error}`;
    li.append(a, status); $('source-list').append(li);
  }
  for (const warning of data.warnings) { const li = document.createElement('li'); li.textContent = warning; $('source-list').append(li); }
  $('confidence').addEventListener('change', render);
  $('history').addEventListener('change', chart);
  $('cash').addEventListener('input', calculator);
  setInterval(freshness, 60000);
  $('download').addEventListener('click', () => {
    const snapshot = archive.entries.find(e => e.origin === data.prices.at(-1).date);
    const csv = ['origin_utc,issued_at,target_utc,estimate_cash_per_bar,lower,upper,interval_percent,chance_cheaper_percent,backtest_samples,live_samples,live_weight', ...result.rows.map(p => [data.prices.at(-1).date, snapshot?.issuedAt || '', p.date, p.price, p.low, p.high, Math.round(result.level * 100), p.cheaper, p.calibration.backtestSamples, p.calibration.liveSamples, p.calibration.liveWeight].join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `wardogs-forecast-${data.prices.at(-1).date}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
} catch (error) {
  $('status').className = 'status error';
  $('status').textContent = 'Unable to load the forecast. Please reload, or check the repository’s latest Actions run. ' + error.message;
}
