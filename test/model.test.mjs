import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { forecast, pointForecast, historicalErrors, dateAdd, validatePrices } from '../lib/model.mjs';
import { parseHistory } from '../lib/sources.mjs';
const seasons = JSON.parse(await readFile(new URL('../data/seasons.json', import.meta.url)));
const fixture = Array.from({ length: 80 }, (_, i) => ({ date: dateAdd('2026-09-10', i), price: Math.round(600000 * Math.exp(0.2 * Math.sin(i / 4))) }));

test('seven UTC forecast days, finite positive prices, nested intervals and bounded probabilities', () => {
  const a = forecast(fixture, seasons, 0.8), b = forecast(fixture, seasons, 0.95);
  assert.equal(a.rows.length, 7);
  a.rows.forEach((row, i) => {
    assert.equal(row.date, dateAdd(fixture.at(-1).date, i + 1));
    assert.ok(row.low > 0 && row.low <= row.price && row.high >= row.price);
    assert.ok(b.rows[i].low <= row.low && b.rows[i].high >= row.high);
    assert.ok(row.cheaper >= 0 && row.cheaper <= 100);
  });
});
test('calibration excludes outcomes spanning season price boundaries', () => {
  const errors = historicalErrors(fixture, seasons);
  for (const sample of errors) for (const e of sample) {
    assert.ok(!seasons.some(s => s.priceStart > e.origin && s.priceStart <= e.target));
  }
});
test('historical errors do not change when future prices change', () => {
  const cutoff = fixture[44].date;
  const modified = fixture.map(p => p.date > cutoff ? { ...p, price: p.price * 10 } : p);
  const past = rows => rows.map(sample => sample.filter(e => e.target <= cutoff));
  assert.deepEqual(past(historicalErrors(fixture, seasons)), past(historicalErrors(modified, seasons)));
});
test('constant observations produce a constant central forecast', () => {
  const flat = fixture.map(p => ({ ...p, price: 500000 }));
  assert.ok(pointForecast(flat, seasons).every(p => p.price === 500000));
});
test('reject invalid, duplicate and unordered observations', () => {
  for (const rows of [[{ date: '2026-02-30', price: 1 }], [{ date: '2026-01-01', price: -1 }], [fixture[0], fixture[0]], [fixture[1], fixture[0]]]) assert.throws(() => validatePrices(rows));
  assert.throws(() => forecast(fixture.slice(0, 12), seasons));
});
test('source parser reads daily rows but excludes converter and unrelated tables', () => {
  const html = '<table><tr><td>Fri, Nov 20</td><td class="num">$621,425</td></tr><tr><td>Thu, Nov 19</td><td>$682,500</td></tr><tr><td>10</td><td>$6,214,250</td></tr></table>';
  assert.deepEqual(parseHistory(html, 2026, 'fixture').map(p => [p.date, p.price]), [['2026-11-19', 682500], ['2026-11-20', 621425]]);
  assert.throws(() => parseHistory('<tr><td>Nov 20</td><td>$10</td></tr><tr><td>Nov 20</td><td>$20</td></tr>', 2026, 'fixture'));
  assert.equal(parseHistory('<tr><td><span>Nov 20, 2026</span><span>Nov 20</span></td><td><span>Low</span><span>$</span>621,425</td></tr>', 2026, 'fixture')[0].price, 621425);
});
test('missing observation dates do not become fabricated daily prices', () => {
  const missing = fixture.filter((_, i) => i !== 30);
  const errors = historicalErrors(missing, seasons);
  assert.ok(errors.every(sample => sample.every(e => e.target !== fixture[30].date)));
});
test('source dates roll backward across New Year, including stale December data', () => {
  const html = '<tr><td>Jan 2</td><td>$300</td></tr><tr><td>Jan 1</td><td>$200</td></tr><tr><td>Dec 31</td><td>$100</td></tr>';
  assert.deepEqual(parseHistory(html, 2027, 'fixture', '2027-01-02').map(p => p.date), ['2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(parseHistory('<tr><td>Dec 31</td><td>$100</td></tr>', 2027, 'fixture', '2027-01-02')[0].date, '2026-12-31');
});
