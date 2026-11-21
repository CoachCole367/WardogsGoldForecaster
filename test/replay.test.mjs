import test from 'node:test';
import assert from 'node:assert/strict';
import { replayHistory } from '../lib/replay.mjs';
import { liveErrorsFrom, updateArchive, emptyArchive } from '../lib/archive.mjs';
import { dateAdd, forecast, MODEL_VERSION } from '../lib/model.mjs';
const seasons = [{ priceStart: '2026-01-01', name: 'Test' }];
const prices = Array.from({ length: 40 }, (_, i) => ({ date: dateAdd('2026-01-01', i), price: Math.round(600000 * Math.exp(-0.01 * i + 0.1 * Math.sin(i))) }));
const cutoff = '2026-02-09';

test('replay starts on the first observation; early ranges remain unknown until errors exist', () => {
  const replay = replayHistory(prices, seasons, cutoff);
  assert.equal(replay.entries.length, 39);
  assert.equal(replay.entries[0].origin, prices[0].date);
  assert.equal(replay.entries[0].kind, 'replay');
  assert.equal(replay.entries[0].forecasts[80].rows[0].price, prices[0].price);
  assert.equal(replay.entries[0].forecasts[80].rows[0].low, null);
  assert.equal(replay.entries[10].forecasts[80].rows[0].low > 0, true);
});
test('altering every future price leaves every earlier replay guess identical', () => {
  const altered = prices.map((p, i) => i > 20 ? { ...p, price: p.price * 8 } : p);
  const original = replayHistory(prices, seasons, cutoff);
  const changed = replayHistory(altered, seasons, cutoff);
  assert.deepEqual(original.entries.slice(0, 21).map(e => e.forecasts), changed.entries.slice(0, 21).map(e => e.forecasts));
});
test('extending history adds outcomes without changing old replay guesses', () => {
  const short = replayHistory(prices.slice(0, 25), seasons, cutoff);
  const long = replayHistory(prices, seasons, cutoff);
  assert.deepEqual(short.entries.map(e => e.forecasts), long.entries.slice(0, 25).map(e => e.forecasts));
});
test('replay errors actually change the current algorithm and confidence; duplicates count once', () => {
  const replay = replayHistory(prices, seasons, cutoff);
  const errors = liveErrorsFrom(replay, seasons, prices.at(-1).date);
  assert.ok(errors.length > 100);
  const untrained = forecast(prices, seasons), trained = forecast(prices, seasons, 0.8, errors);
  assert.ok(trained.rows[0].calibration.replaySamples > 0);
  assert.notEqual(trained.rows[0].price, untrained.rows[0].price);
  assert.notDeepEqual([trained.rows[0].low, trained.rows[0].high, trained.rows[0].cheaper], [untrained.rows[0].low, untrained.rows[0].high, untrained.rows[0].cheaper]);
  assert.deepEqual(trained.rows, forecast(prices, seasons, 0.8, [...errors, ...errors]).rows);
  const last = prices.at(-1), data = { prices, warnings: [], sources: [{ ok: true, latest: last.date }] };
  const live = updateArchive(emptyArchive(), data, seasons, `${last.date}T00:20:00.000Z`, replay);
  assert.deepEqual(live.entries[0].forecasts[80].rows, trained.rows);
  assert.equal(live.entries[0].modelVersion, MODEL_VERSION);
});
test('future season definitions cannot alter guesses made before the season starts', () => {
  const moreSeasons = [...seasons, { priceStart: '2026-01-25', name: 'Wipe' }];
  const plain = replayHistory(prices, seasons, cutoff), aware = replayHistory(prices, moreSeasons, cutoff);
  assert.deepEqual(plain.entries.slice(0, 24).map(e => e.forecasts), aware.entries.slice(0, 24).map(e => e.forecasts));
});
