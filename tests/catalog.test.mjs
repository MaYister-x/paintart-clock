import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const catalog = JSON.parse(await fs.readFile(new URL('../data/artworks.json', import.meta.url), 'utf8'));

test('catalog has enough variety for a daily rotation', () => {
  assert.ok(catalog.length >= 24);
  assert.equal(new Set(catalog.map((artwork) => artwork.id)).size, catalog.length);
  assert.ok(new Set(catalog.map((artwork) => artwork.artist)).size >= 18);
});

test('every artwork carries public-domain provenance and renderable media', () => {
  for (const artwork of catalog) {
    assert.equal(artwork.publicDomain, true, artwork.id);
    assert.match(artwork.sourceUrl, /^https:\/\//, artwork.id);
    assert.match(artwork.image, /^https:\/\//, artwork.id);
    assert.match(artwork.imageSmall, /^https:\/\//, artwork.id);
    assert.ok(artwork.title && artwork.artist && artwork.alt, artwork.id);
    assert.ok(Array.isArray(artwork.tags), artwork.id);
  }
});
