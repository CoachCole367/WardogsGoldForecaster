import { validatePrices } from './model.mjs';
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plain = html => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#xA0;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
export function parseHistory(html, year, source) {
  const prices = new Map();
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => plain(m[1]));
    const dateMatch = cells[0]?.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/);
    const priceMatch = cells[1]?.match(/\$\s*([\d,]+)/);
    if (!dateMatch || !priceMatch) continue;
    const date = `${dateMatch[3] || year}-${String(months.indexOf(dateMatch[1]) + 1).padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
    const price = Number(priceMatch[1].replaceAll(',', ''));
    if (prices.has(date) && prices.get(date).price !== price) throw new Error(`Conflicting rows on ${date}`);
    prices.set(date, { date, price, source });
  }
  return validatePrices([...prices.values()].sort((a, b) => a.date.localeCompare(b.date)));
}
