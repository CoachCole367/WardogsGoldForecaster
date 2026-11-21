import { readFile, writeFile, rename } from 'node:fs/promises';
import { updateArchive } from '../lib/archive.mjs';
import { replayHistory } from '../lib/replay.mjs';

export async function trackForecasts(data, now = new Date().toISOString()) {
  const seasons = JSON.parse(await readFile('data/seasons.json', 'utf8'));
  // A missing/corrupt archive is an error: never silently erase the learning history.
  const previous = JSON.parse(await readFile('data/forecasts.json', 'utf8'));
  const stopBefore = previous.entries[0]?.origin || data.prices.at(-1).date;
  const replay = replayHistory(data.prices, seasons, stopBefore);
  await writeFile('data/replay.json.tmp', JSON.stringify(replay) + '\n');
  await rename('data/replay.json.tmp', 'data/replay.json');
  const next = updateArchive(previous, data, seasons, now, replay);
  if (JSON.stringify(previous) !== JSON.stringify(next)) {
    await writeFile('data/forecasts.json.tmp', JSON.stringify(next, null, 2) + '\n');
    await rename('data/forecasts.json.tmp', 'data/forecasts.json');
  }
  console.log(`${next.entries.length} saved forecast(s); ${next.entries.reduce((sum, entry) => sum + entry.outcomes.length, 0)} resolved predictions`);
  console.log(`${replay.entries.length} simulated daily outlooks replayed from the first observation`);
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/track.mjs')) {
  await trackForecasts(JSON.parse(await readFile('data/prices.json', 'utf8')));
}
