import test from 'node:test';
import assert from 'node:assert/strict';
import { updateArchive, emptyArchive, liveErrorsFrom, archiveSummary, validateArchive } from '../lib/archive.mjs';
import { forecast, dateAdd, MODEL_VERSION, historicalErrors } from '../lib/model.mjs';

const seasons = [{ name: 'Test', priceStart: '2026-01-01' }];
const prices = Array.from({ length: 45 }, (_, i) => ({ date: dateAdd('2026-01-01', i), price: Math.round(600000 * Math.exp(0.15 * Math.sin(i))) }));
function data(rows = prices) { return { prices: rows, warnings: [], sources: [{ ok: true, latest: rows.at(-1).date }] }; }
const issued = '2026-02-14T00:20:00.000Z';
const seed = () => updateArchive(emptyArchive(), data(), seasons, issued);
function settled(actualPrice = 1600000) {
  const nextData = data([...prices, { date: '2026-02-15', price: actualPrice }]);
  return { archive: updateArchive(seed(), nextData, seasons, '2026-02-15T00:20:00.000Z'), data: nextData };
}

test('save once per observed UTC day; reruns preserve estimates and probabilities exactly', () => {
  const archive = seed(), original = structuredClone(archive.entries[0]);
  const rerun = updateArchive(archive, data(), seasons, '2026-02-14T12:00:00.000Z');
  assert.deepEqual(rerun.entries[0], original);
  assert.deepEqual(archive.entries[0], original);
  assert.equal(rerun.entries.length, 1);
  assert.equal(original.outcomes.length, 0);
});
test('next refresh scores only known targets, freezes outcomes, and learns before issuing', () => {
  const { archive, data: latest } = settled();
  assert.equal(archive.entries.length, 2);
  assert.deepEqual(archive.entries[0].forecasts, seed().entries[0].forecasts);
  assert.equal(archive.entries[0].outcomes.length, 1);
  assert.equal(archive.entries[0].outcomes[0].actualPrice, 1600000);
  assert.equal(archive.entries[1].forecasts[80].rows[0].calibration.liveSamples, 1);
  assert.equal(archive.entries[1].forecasts[80].rows[6].calibration.liveSamples, 0);
  const corrected = data(latest.prices.map(p => p.date === '2026-02-15' ? { ...p, price: 100000 } : p));
  const rerun = updateArchive(archive, corrected, seasons, '2026-02-15T12:00:00.000Z');
  assert.deepEqual(rerun, archive);
  assert.equal(archiveSummary(archive, seasons)[0].scored, 1);
  const original = archive.entries[0].forecasts[80].rows[0];
  const score = archiveSummary(archive, seasons)[0];
  assert.equal(score.coverage, Number(1600000 >= original.low && 1600000 <= original.high));
  assert.equal(score.brier, (original.cheaper / 100 - Number(1600000 < prices.at(-1).price)) ** 2);
});
test('failed, stale, future and conflicting observations never create backfilled forecasts', () => {
  assert.equal(updateArchive(emptyArchive(), data(), seasons, '2026-02-15T00:20:00.000Z').entries.length, 0);
  assert.equal(updateArchive(emptyArchive(), { ...data(), sources: [{ ok: false }] }, seasons, issued).entries.length, 0);
  assert.equal(updateArchive(emptyArchive(), { ...data(), warnings: ['Conflicting price for 2026-02-14'] }, seasons, issued).entries.length, 0);
  assert.equal(updateArchive(emptyArchive(), data(), seasons, '2026-02-13T00:20:00.000Z').entries.length, 0);
  const conflicting = data([...prices, { date: '2026-02-15', price: 100000 }]);
  conflicting.warnings = ['Conflicting price for 2026-02-15'];
  const archive = updateArchive(seed(), conflicting, seasons, '2026-02-15T00:20:00.000Z');
  assert.equal(archive.entries[0].outcomes.length, 0);
});
test('future and late-known outcomes cannot leak into past confidence', () => {
  const { archive } = settled();
  assert.equal(liveErrorsFrom(archive, seasons, '2026-02-14').length, 0);
  assert.equal(liveErrorsFrom(archive, seasons, '2026-02-15', '2026-02-15T00:10:00.000Z').length, 0);
  assert.equal(liveErrorsFrom(archive, seasons, '2026-02-15', '2026-02-15T00:20:00.000Z').length, 1);
});
test('learning adjusts estimates, ranges and probability while retaining the raw estimate', () => {
  const { archive, data: latest } = settled();
  const live = liveErrorsFrom(archive, seasons, '2026-02-15');
  const base = forecast(latest.prices, seasons, 0.8);
  const learned = forecast(latest.prices, seasons, 0.8, live);
  assert.deepEqual(base.rows.map(r => r.rawPrice), learned.rows.map(r => r.rawPrice));
  assert.notEqual(base.rows[0].price, learned.rows[0].price);
  assert.notDeepEqual([base.rows[0].low, base.rows[0].high, base.rows[0].cheaper], [learned.rows[0].low, learned.rows[0].high, learned.rows[0].cheaper]);
  assert.equal(learned.rows[0].calibration.liveWeight, 1 / 21);
  assert.equal(learned.rows[0].calibration.liveSamples, 1);
  assert.ok(learned.rows[0].cheaper >= 0 && learned.rows[0].cheaper <= 100);
  assert.equal(learned.rows[0].calibration.backtestSamples, historicalErrors(latest.prices, seasons)[0].length - 1);
  const wider = forecast(latest.prices, seasons, 0.95, live);
  assert.ok(wider.rows[0].low <= learned.rows[0].low && wider.rows[0].high >= learned.rows[0].high);
});
test('seven-day guesses resolve after seven days and repeated actuals never duplicate learning', () => {
  let archive = seed(), history = [...prices];
  for (let day = 1; day <= 7; day++) {
    const date = dateAdd(prices.at(-1).date, day);
    history.push({ date, price: 600000 + day * 10000 });
    archive = updateArchive(archive, data(history), seasons, `${date}T00:20:00.000Z`);
  }
  assert.equal(archive.entries[0].outcomes.length, 7);
  const summary = archiveSummary(archive, seasons);
  assert.equal(summary[0].scored, 7);
  assert.equal(summary[6].scored, 1);
  assert.equal(archive.entries.at(-1).forecasts[80].rows[6].calibration.liveSamples, 1);
  assert.deepEqual(updateArchive(archive, data(history), seasons, `${history.at(-1).date}T12:00:00.000Z`), archive);
});
test('wipe-crossing and other-model outcomes remain visible but cannot train this model', () => {
  const { archive } = settled();
  const changedSeasons = [...seasons, { name: 'Wipe', priceStart: '2026-02-15' }];
  assert.equal(liveErrorsFrom(archive, changedSeasons, '2026-02-15').length, 0);
  assert.equal(archiveSummary(archive, changedSeasons)[0].scored, 1);
  assert.equal(archiveSummary(archive, changedSeasons)[0].eligible, 0);
  archive.entries[0].modelVersion = MODEL_VERSION + '-old';
  assert.equal(liveErrorsFrom(archive, seasons, '2026-02-15').length, 0);
});
test('malformed or duplicate archives fail instead of resetting', () => {
  assert.throws(() => validateArchive({ schemaVersion: 2, entries: [] }));
  const archive = seed(); archive.entries.push(structuredClone(archive.entries[0]));
  assert.throws(() => validateArchive(archive));
});
test('new algorithm version can issue today without rewriting the old version', () => {
  const archive = seed(); archive.entries[0].modelVersion = 'older-version';
  const original = structuredClone(archive.entries[0]);
  const updated = updateArchive(archive, data(), seasons, '2026-02-14T12:00:00.000Z');
  assert.equal(updated.entries.length, 2);
  assert.deepEqual(updated.entries[0], original);
  assert.equal(updated.entries[1].modelVersion, MODEL_VERSION);
});
