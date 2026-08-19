#!/usr/bin/env node
// Catalog gate. The build script fetches from two museum APIs whose responses change
// under us, so nothing ships until the file it produced still holds together.
//
// Importable (`validateCatalog`) so the test suite runs the same rules the CLI does.
//
// Usage: node scripts/validate-catalog.mjs [data/artworks.json]

import fs from 'node:fs';

export const MIN_ARTWORKS = 30;
export const MAX_PER_ARTIST = 2;

const REQUIRED_STRINGS = ['id', 'source', 'sourceUrl', 'title', 'artist', 'image', 'imageSmall', 'alt'];

export function validateCatalog(records) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!Array.isArray(records)) {
    return ['catalog is not an array'];
  }
  if (records.length < MIN_ARTWORKS) {
    fail(`only ${records.length} artworks, minimum is ${MIN_ARTWORKS}`);
  }

  const ids = new Set();
  const titles = new Set();
  const artistCounts = new Map();

  records.forEach((record, index) => {
    const where = `[${index}] ${record?.id ?? '(no id)'}`;
    if (!record || typeof record !== 'object') {
      fail(`${where}: not an object`);
      return;
    }

    for (const key of REQUIRED_STRINGS) {
      if (typeof record[key] !== 'string' || !record[key].trim()) {
        fail(`${where}: missing ${key}`);
      }
    }

    if (ids.has(record.id)) fail(`${where}: duplicate id`);
    ids.add(record.id);

    const titleKey = `${record.artist}|${record.title}`.toLowerCase();
    if (titles.has(titleKey)) fail(`${where}: duplicate artist+title "${record.title}"`);
    titles.add(titleKey);

    // GitHub Pages is https-only; an http image is a blocked mixed-content request, which
    // shows up as a black screen rather than as an error anyone would notice.
    for (const key of ['sourceUrl', 'image', 'imageSmall']) {
      if (typeof record[key] === 'string' && !record[key].startsWith('https://')) {
        fail(`${where}: ${key} is not https`);
      }
    }

    // Tags and year are what lib/mood.js votes on. A record with neither gets the
    // fallback typeface, which is a silent downgrade, so keep it out of the catalog.
    const hasTags = Array.isArray(record.tags) && record.tags.some((tag) => typeof tag === 'string' && tag.trim());
    const hasYear = Number.isFinite(Number(record.year));
    if (!hasTags && !hasYear) fail(`${where}: no tags and no year, mood cannot be chosen`);
    if (record.tags !== undefined && !Array.isArray(record.tags)) fail(`${where}: tags is not an array`);
    if (hasYear && (Number(record.year) < 0 || Number(record.year) > 2100)) {
      fail(`${where}: implausible year ${record.year}`);
    }

    const artist = String(record.artist || '').toLowerCase();
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
  });

  for (const [artist, count] of artistCounts) {
    // "Unknown artist" is a bucket, not a person, so the cap does not apply to it.
    if (artist === 'unknown artist') continue;
    if (count > MAX_PER_ARTIST) fail(`${artist}: ${count} works, cap is ${MAX_PER_ARTIST}`);
  }

  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] || 'data/artworks.json';
  const problems = validateCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (problems.length) {
    process.stderr.write(`${file}: ${problems.length} problem(s)\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(`${file}: ok\n`);
}
