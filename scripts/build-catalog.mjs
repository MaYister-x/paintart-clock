#!/usr/bin/env node
// Build data/artworks.json from open-access museum APIs.
//
// Only records the API itself flags as public domain are kept, every image URL is
// fetched before it lands in the catalog, and each record keeps the museum page URL and
// credit line so the site can attribute the work.
//
// Sources: The Met Open Access API and the Cleveland Museum of Art Open Access API.
// Both are key-free and expose an explicit rights flag (`isPublicDomain`, `CC0`).
// The Art Institute of Chicago was evaluated and dropped: its IIIF images live on
// www.artic.edu, which this build environment cannot reach, so those URLs could not be
// verified and unverified images are not shipped.
//
// Usage: node scripts/build-catalog.mjs [--out data/artworks.json]

import fs from 'node:fs';
import path from 'node:path';

const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i > -1 ? process.argv[i + 1] : 'data/artworks.json';
})();

const MET_API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const CMA_API = 'https://openaccess-api.clevelandart.org/api';

// Met department ids, so the catalog is not 40 variations on one gallery.
const MET_DEPARTMENTS = {
  european: 11,
  asian: 6,
  american: 1,
  modern: 21,
  islamic: 14,
};

// `isHighlight` keeps the big European gallery to its best-known works; the smaller
// departments need it off or they return almost nothing.
const MET_QUERIES = [
  { q: 'landscape', department: MET_DEPARTMENTS.european, highlight: true, max: 3 },
  { q: 'seascape', department: MET_DEPARTMENTS.european, highlight: true, max: 2 },
  { q: 'night', department: MET_DEPARTMENTS.european, highlight: true, max: 2 },
  { q: 'still life flowers', department: MET_DEPARTMENTS.european, highlight: true, max: 2 },
  { q: 'portrait', department: MET_DEPARTMENTS.european, highlight: true, max: 2 },
  { q: 'mythology', department: MET_DEPARTMENTS.european, highlight: true, max: 2 },
  { q: 'winter snow', department: MET_DEPARTMENTS.european, highlight: true, max: 2 },
  { q: 'garden', department: MET_DEPARTMENTS.european, highlight: true, max: 2 },
  { q: 'landscape', department: MET_DEPARTMENTS.asian, highlight: false, max: 3 },
  { q: 'birds and flowers', department: MET_DEPARTMENTS.asian, highlight: false, max: 2 },
  { q: 'mountain river', department: MET_DEPARTMENTS.asian, highlight: false, max: 2 },
  { q: 'landscape', department: MET_DEPARTMENTS.american, highlight: false, max: 3 },
  { q: 'abstract', department: MET_DEPARTMENTS.modern, highlight: false, max: 2 },
  { q: 'painting', department: MET_DEPARTMENTS.islamic, highlight: false, max: 2 },
];

// The Met's search is the flakier of the two — a query that returns three paintings on
// one run can return none on the next — so Cleveland carries the bulk and the catalog
// still clears its floor when the Met has an off day.
const CMA_QUERIES = [
  { q: 'impressionism', max: 3 },
  { q: 'landscape', max: 4 },
  { q: 'still life', max: 3 },
  { q: 'portrait', max: 3 },
  { q: 'abstract', max: 3 },
  { q: 'night', max: 2 },
  { q: 'water', max: 3 },
  { q: 'japanese screen', max: 3 },
  { q: 'chinese scroll', max: 3 },
  { q: 'flowers', max: 3 },
  { q: 'sea', max: 2 },
  { q: 'winter', max: 2 },
  { q: 'garden', max: 2 },
  { q: 'religious', max: 2 },
];

const FLOOR = 30;

const TARGET = 40;
const PER_ARTIST = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      if (attempt === tries) {
        process.stderr.write(`  ! ${url} -> ${error.message}\n`);
        return null;
      }
      await sleep(400 * attempt);
    }
  }
  return null;
}

// A HEAD is not enough: some CDNs answer HEAD from cache with a status that does not
// match what a browser <img> gets. Ask for the first kilobyte instead.
async function imageReachable(url) {
  try {
    const response = await fetch(url, { headers: { range: 'bytes=0-1023' } });
    if (response.status !== 200 && response.status !== 206) return false;
    const type = response.headers.get('content-type') || '';
    await response.arrayBuffer();
    return type.startsWith('image/');
  } catch {
    return false;
  }
}

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function altText(record) {
  const who = record.artist ? ` by ${record.artist}` : '';
  const when = record.date ? `, ${record.date}` : '';
  return `${record.title}${who}${when}. Open access image from ${record.source}.`;
}

function firstYear(text) {
  const match = String(text).match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return match ? Number(match[1]) : null;
}

const seenMet = new Set();

async function collectMet() {
  const out = [];
  for (const spec of MET_QUERIES) {
    const url = `${MET_API}/search?q=${encodeURIComponent(spec.q)}`
      + '&hasImages=true&medium=Paintings'
      + `&departmentId=${spec.department}`
      + (spec.highlight ? '&isHighlight=true' : '');
    const search = await getJson(url);
    const ids = (search?.objectIDs || []).slice(0, 40);
    let kept = 0;
    for (const id of ids) {
      if (kept >= spec.max) break;
      if (seenMet.has(id)) continue;
      seenMet.add(id);
      const object = await getJson(`${MET_API}/objects/${id}`);
      if (!object?.isPublicDomain) continue;
      if (!object.primaryImage || !object.primaryImageSmall) continue;
      if (!/painting/i.test(`${object.classification} ${object.medium}`)) continue;
      const record = {
        id: `met-${object.objectID}`,
        source: 'The Metropolitan Museum of Art',
        sourceUrl: object.objectURL,
        title: clean(object.title) || 'Untitled',
        artist: clean(object.artistDisplayName) || 'Unknown artist',
        date: clean(object.objectDate),
        year: Number(object.objectBeginDate) || firstYear(object.objectDate),
        culture: clean(object.culture) || clean(object.artistNationality),
        medium: clean(object.medium),
        department: clean(object.department),
        credit: clean(object.creditLine),
        tags: [
          ...(object.tags || []).map((tag) => clean(tag.term)),
          clean(object.classification),
          clean(object.period),
          clean(object.culture),
        ].filter(Boolean),
        image: object.primaryImage,
        imageSmall: object.primaryImageSmall,
      };
      record.alt = altText(record);
      out.push(record);
      kept += 1;
      await sleep(120);
    }
    process.stderr.write(`met  d${String(spec.department).padStart(2)} ${spec.q.padEnd(20)} +${kept}/${spec.max}\n`);
  }
  return out;
}

async function collectCma() {
  const out = [];
  const seen = new Set();
  for (const spec of CMA_QUERIES) {
    const url = `${CMA_API}/artworks/?q=${encodeURIComponent(spec.q)}`
      + '&type=Painting&cc0=1&has_image=1&limit=40';
    const search = await getJson(url);
    let kept = 0;
    for (const item of search?.data || []) {
      if (kept >= spec.max) break;
      if (item.share_license_status !== 'CC0') continue;
      if (!item.images?.web?.url) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      // "Jan Gossaert (Flemish, c. 1475/78-1532)" -> "Jan Gossaert"
      const artist = clean((item.creators || [])[0]?.description || '').replace(/\s*\(.*$/, '');
      const record = {
        id: `cma-${item.id}`,
        source: 'Cleveland Museum of Art',
        sourceUrl: item.url || `https://clevelandart.org/art/${item.accession_number}`,
        title: clean(item.title) || 'Untitled',
        artist: artist || 'Unknown artist',
        date: clean(item.creation_date),
        year: firstYear(item.creation_date),
        culture: clean((item.culture || [])[0]),
        medium: clean(item.technique),
        department: clean(item.department),
        credit: clean(item.tombstone),
        tags: [
          item.type,
          item.technique,
          item.department,
          ...(item.culture || []),
          ...(item.find_spot ? [item.find_spot] : []),
        ].map(clean).filter(Boolean),
        image: item.images.print?.url || item.images.web.url,
        imageSmall: item.images.web.url,
      };
      record.alt = altText(record);
      out.push(record);
      kept += 1;
    }
    process.stderr.write(`cma  ${spec.q.padEnd(24)} +${kept}/${spec.max}\n`);
  }
  return out;
}

// Two works by the same painter in a 40-slot catalog is fine; five is a rut. Museums
// also file series under one repeated title ("Birds", "Birds"), which reads as a bug on
// a wallpaper, so identical artist+title pairs collapse to one.
function capPerArtist(records, limit) {
  const counts = new Map();
  const titles = new Set();
  return records.filter((record) => {
    const titleKey = `${record.artist}|${record.title}`.toLowerCase();
    if (titles.has(titleKey)) return false;
    titles.add(titleKey);
    const key = record.artist.toLowerCase();
    const next = (counts.get(key) || 0) + 1;
    counts.set(key, next);
    return next <= limit;
  });
}

const met = await collectMet();
const cma = await collectCma();
// Interleave so the per-artist cap and the TARGET cut do not silently drop one museum.
const merged = [];
for (let i = 0; i < Math.max(met.length, cma.length); i += 1) {
  if (met[i]) merged.push(met[i]);
  if (cma[i]) merged.push(cma[i]);
}
const collected = capPerArtist(merged, PER_ARTIST);
process.stderr.write(`\ncollected ${collected.length} (met ${met.length}, cma ${cma.length}); verifying images...\n`);

const verified = [];
for (const record of collected) {
  if (verified.length >= TARGET) break;
  if (!(await imageReachable(record.imageSmall))) {
    process.stderr.write(`  drop ${record.id} (web image unreachable)\n`);
    continue;
  }
  if (record.image !== record.imageSmall && !(await imageReachable(record.image))) {
    // A working web-size image is enough to ship; fall back instead of dropping the work.
    process.stderr.write(`  note ${record.id} (high-res unreachable, using web size for both)\n`);
    record.image = record.imageSmall;
  }
  verified.push(record);
}

if (verified.length < FLOOR) {
  process.stderr.write(`\nonly ${verified.length} artworks verified, floor is ${FLOOR} -- refusing to write\n`);
  process.exit(1);
}

verified.sort((a, b) => a.id.localeCompare(b.id));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(verified, null, 2)}\n`);
process.stderr.write(`\nwrote ${OUT}: ${verified.length} artworks\n`);
for (const record of verified) {
  process.stderr.write(`  ${record.id.padEnd(12)} ${String(record.year || '?').padEnd(5)} ${record.artist.slice(0, 26).padEnd(28)} ${record.title.slice(0, 42)}\n`);
}
