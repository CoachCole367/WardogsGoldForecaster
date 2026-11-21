import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validatePrices, forecast } from '../lib/model.mjs';
import { validateArchive } from '../lib/archive.mjs';
const data = JSON.parse(await readFile('data/prices.json', 'utf8'));
const seasons = JSON.parse(await readFile('data/seasons.json', 'utf8'));
validateArchive(JSON.parse(await readFile('data/forecasts.json', 'utf8')));
validateArchive(JSON.parse(await readFile('data/replay.json', 'utf8')));
validatePrices(data.prices);
forecast(data.prices, seasons);
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });
await cp('lib', 'dist/lib', { recursive: true });
await cp('data', 'dist/data', { recursive: true });
// Pages caches assets. Version the full module graph so fresh data cannot meet old code.
const hash = createHash('sha256');
for (const folder of ['web', 'lib']) {
  for (const name of (await readdir(folder)).sort()) hash.update(await readFile(`${folder}/${name}`));
}
const release = hash.digest('hex').slice(0, 12);
for (const folder of ['dist', 'dist/lib']) {
  for (const name of await readdir(folder)) {
    if (!name.endsWith('.mjs')) continue;
    const path = `${folder}/${name}`;
    const source = await readFile(path, 'utf8');
    await writeFile(path, source.replace(/(from\s+['"])([^'"]+\.mjs)(['"])/g, `$1$2?v=${release}$3`));
  }
}
const html = await readFile('dist/index.html', 'utf8');
await writeFile('dist/index.html', html.replace('src="app.mjs"', `src="app.mjs?v=${release}"`).replace('href="styles.css"', `href="styles.css?v=${release}"`));
console.log('Built dist/ for GitHub Pages');
