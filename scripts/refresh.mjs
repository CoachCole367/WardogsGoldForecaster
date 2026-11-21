import { readFile, writeFile } from 'node:fs/promises';
import { parseHistory } from '../lib/sources.mjs';
import { validatePrices } from '../lib/model.mjs';
import { trackForecasts } from './track.mjs';

const sources = ['https://wardogstats.app/gold', 'https://wardogs.tools/gold'];
const now = new Date();
const today = now.toISOString().slice(0, 10);
let previous;
try { previous = JSON.parse(await readFile('data/prices.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const results = await Promise.all(sources.map(async url => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'WardogsGoldForecaster/1.0 (+https://github.com/CoachCole367/WardogsGoldForecaster)' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Both source tables list newest first. Infer year rollovers only for yearless rows.
    const prices = parseHistory(await response.text(), now.getUTCFullYear(), url, today);
    if (prices.length < 14 || prices.some(p => p.date > today)) throw new Error('Incomplete or future-dated history');
    if (previous && !prices.some(p => previous.prices.some(old => old.date === p.date && old.price === p.price))) throw new Error('Source no longer overlaps retained history; verify the date adapter');
    return { url, ok: true, prices, latest: prices.at(-1).date };
  } catch (error) { return { url, ok: false, error: error.message }; }
}));
const merged = new Map((previous?.prices || []).map(p => [p.date, p]));
const warnings = [];
for (const result of results.filter(r => r.ok)) {
  for (const row of result.prices) {
    const existing = merged.get(row.date);
    if (existing && existing.price !== row.price) {
      warnings.push(`Conflicting price for ${row.date}: retained ${existing.price}, ${result.url} reported ${row.price}`);
    } else if (!existing) merged.set(row.date, row);
  }
}
if (!results.some(r => r.ok) && !previous) throw new Error('No usable price source');
const prices = validatePrices([...merged.values()].sort((a, b) => a.date.localeCompare(b.date)));
const data = { checkedAt: now.toISOString(), sources: results.map(({ prices, ...status }) => status), warnings, prices };
await writeFile('data/prices.json', JSON.stringify(data, null, 2) + '\n');
console.log(`${prices.length} observations; latest ${prices.at(-1).date}; ${results.filter(r => r.ok).length}/${sources.length} sources available`);
if (warnings.length) console.warn(warnings.join('\n'));
await trackForecasts(data, now.toISOString());
if (!results.some(r => r.ok)) process.exitCode = 1;
