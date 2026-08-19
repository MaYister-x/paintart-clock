import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { validateCatalog, MIN_ARTWORKS, MAX_PER_ARTIST } from '../scripts/validate-catalog.mjs';
import { chooseMood } from '../lib/mood.js';
import { pickIndex } from '../lib/schedule.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../data/artworks.json', import.meta.url), 'utf8'));

const sample = () => ({
  id: 'x-1', source: 'Museum', sourceUrl: 'https://example.org/1',
  title: 'A Painting', artist: 'Someone', year: 1880,
  tags: ['Landscapes'], image: 'https://example.org/a.jpg',
  imageSmall: 'https://example.org/a-small.jpg', alt: 'A Painting by Someone.',
});

test('the shipped catalog passes its own gate', () => {
  assert.deepEqual(validateCatalog(catalog), []);
});

test('the shipped catalog is large enough to not repeat within a day', () => {
  // 24 hourly slots per day, so anything under 24 guarantees a repeat; MIN_ARTWORKS is
  // set above that with room for the odd dead image URL.
  assert.ok(catalog.length >= MIN_ARTWORKS, `${catalog.length} artworks`);
  assert.ok(catalog.length > 24, 'a day of slots would repeat');
});

test('every mood in the catalog resolves, and no single typeface dominates', () => {
  const counts = new Map();
  for (const artwork of catalog) {
    const { mood } = chooseMood(artwork);
    assert.ok(mood?.font, `${artwork.id}: no font`);
    counts.set(mood.id, (counts.get(mood.id) || 0) + 1);
  }
  // Four or more distinct typefaces, and no more than 60% on any one of them: the whole
  // point of requirement 3 is that the typeface tracks the painting.
  assert.ok(counts.size >= 4, `only ${counts.size} distinct moods: ${[...counts.keys()].join(', ')}`);
  const worst = Math.max(...counts.values());
  assert.ok(worst / catalog.length <= 0.6, `one mood covers ${Math.round(100 * worst / catalog.length)}% of the catalog`);
});

test('the catalog spans more than one museum and more than one century', () => {
  const sources = new Set(catalog.map((artwork) => artwork.source));
  assert.ok(sources.size >= 2, `single source: ${[...sources].join(', ')}`);
  const years = catalog.map((artwork) => Number(artwork.year)).filter(Number.isFinite);
  assert.ok(Math.max(...years) - Math.min(...years) > 200, 'the catalog covers less than 200 years');
});

test('every artwork is reachable from some slot', () => {
  // A record nothing can ever draw is dead weight, and would hide a modulo bug.
  const reached = new Set();
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    for (let hour = 0; hour < 24; hour += 1) {
      for (let day = 1; day <= 28; day += 1) {
        reached.add(pickIndex(seed, `2026-08-${day}-${hour}+0900`, catalog.length));
      }
    }
  }
  assert.equal(reached.size, catalog.length, `${catalog.length - reached.size} artworks are unreachable`);
});

test('validateCatalog rejects a short catalog', () => {
  const problems = validateCatalog([sample()]);
  assert.ok(problems.some((problem) => problem.includes('minimum')));
});

test('validateCatalog rejects a missing required field', () => {
  const records = Array.from({ length: MIN_ARTWORKS }, (_, i) => ({ ...sample(), id: `x-${i}`, artist: `Artist ${i}` }));
  delete records[3].imageSmall;
  records[4].alt = '   ';
  const problems = validateCatalog(records);
  assert.ok(problems.some((problem) => problem.includes('missing imageSmall')));
  assert.ok(problems.some((problem) => problem.includes('missing alt')));
});

test('validateCatalog rejects http image URLs', () => {
  // Mixed content on an https Pages site fails silently as a blank background.
  const records = Array.from({ length: MIN_ARTWORKS }, (_, i) => ({ ...sample(), id: `x-${i}`, artist: `Artist ${i}` }));
  records[0].image = 'http://example.org/a.jpg';
  assert.ok(validateCatalog(records).some((problem) => problem.includes('not https')));
});

test('validateCatalog rejects duplicate ids and repeated artist+title', () => {
  const records = Array.from({ length: MIN_ARTWORKS }, (_, i) => ({ ...sample(), id: `x-${i}`, artist: `Artist ${i}` }));
  records[1].id = 'x-0';
  records[2].artist = records[3].artist;
  records[2].title = records[3].title;
  const problems = validateCatalog(records);
  assert.ok(problems.some((problem) => problem.includes('duplicate id')));
  assert.ok(problems.some((problem) => problem.includes('duplicate artist+title')));
});

test('validateCatalog enforces the per-artist cap but exempts the unknown-artist bucket', () => {
  const records = Array.from({ length: MIN_ARTWORKS }, (_, i) => ({ ...sample(), id: `x-${i}`, artist: `Artist ${i}` }));
  for (let i = 0; i <= MAX_PER_ARTIST; i += 1) records[i].artist = 'Claude Monet';
  assert.ok(validateCatalog(records).some((problem) => problem.includes('claude monet')));

  const anonymous = Array.from({ length: MIN_ARTWORKS }, (_, i) => ({ ...sample(), id: `y-${i}`, title: `Work ${i}`, artist: 'Unknown artist' }));
  assert.deepEqual(validateCatalog(anonymous), []);
});

test('validateCatalog rejects a record no mood can read', () => {
  const records = Array.from({ length: MIN_ARTWORKS }, (_, i) => ({ ...sample(), id: `x-${i}`, artist: `Artist ${i}` }));
  delete records[5].year;
  records[5].tags = [];
  assert.ok(validateCatalog(records).some((problem) => problem.includes('mood cannot be chosen')));
});

test('validateCatalog rejects a non-array payload', () => {
  assert.deepEqual(validateCatalog({}), ['catalog is not an array']);
  assert.deepEqual(validateCatalog(null), ['catalog is not an array']);
});
