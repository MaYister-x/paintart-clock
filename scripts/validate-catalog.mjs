import fs from 'node:fs/promises';

const path = new URL('../data/artworks.json', import.meta.url);
const catalog = JSON.parse(await fs.readFile(path, 'utf8'));
const required = ['id', 'source', 'sourceUrl', 'title', 'artist', 'image', 'imageSmall', 'alt', 'publicDomain'];
const errors = [];

for (const [index, artwork] of catalog.entries()) {
  for (const key of required) {
    if (artwork[key] === undefined || artwork[key] === '') errors.push(`[${index}] missing ${key}`);
  }
  if (artwork.publicDomain !== true) errors.push(`[${index}] ${artwork.id} is not confirmed public domain`);
  for (const key of ['sourceUrl', 'image', 'imageSmall']) {
    try { new URL(artwork[key]); } catch { errors.push(`[${index}] invalid ${key}`); }
  }
}

if (new Set(catalog.map((artwork) => artwork.id)).size !== catalog.length) errors.push('duplicate artwork id');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Catalog valid: ${catalog.length} public-domain artworks.`);
}
