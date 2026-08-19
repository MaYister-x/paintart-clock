import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MOODS, FALLBACK_MOOD, scoreMood, chooseMood, requiredFontFamilies } from '../lib/mood.js';

const moodById = (id) => MOODS.find((mood) => mood.id === id);

test('every mood is fully specified', () => {
  const ids = new Set();
  for (const mood of MOODS) {
    assert.ok(mood.id && !ids.has(mood.id), `duplicate or missing id: ${mood.id}`);
    ids.add(mood.id);
    assert.ok(mood.label, `${mood.id}: no label`);
    assert.ok(mood.font, `${mood.id}: no font`);
    // The CSS stack must name the web font first and end in a generic family, or a
    // failed font load falls back to whatever the browser feels like.
    assert.ok(mood.cssFamily.includes(mood.font), `${mood.id}: cssFamily omits ${mood.font}`);
    assert.match(mood.cssFamily, /(serif|sans-serif|monospace)$/, `${mood.id}: no generic fallback`);
    assert.ok(mood.era || mood.cultures, `${mood.id}: neither era nor cultures`);
    assert.ok(Array.isArray(mood.keywords) && mood.keywords.length, `${mood.id}: no keywords`);
    assert.match(mood.tracking, /em$/);
  }
});

test('index.html loads exactly the families MOODS asks for', () => {
  // The font link is hand-written, so this is the test that catches a new mood whose
  // typeface was never added to the page.
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const family of requiredFontFamilies()) {
    assert.ok(html.includes(family.replace(/ /g, '+')), `index.html does not load ${family}`);
  }
  // And the subset has to cover what a clock draws, or digits render as tofu.
  assert.ok(html.includes('text=0123456789%3A'), 'font subset does not cover the digits and colon');
});

test('chooseMood is a pure function of the record', () => {
  const artwork = { title: 'Water Lilies', year: 1915, tags: ['landscape'], culture: 'French' };
  assert.equal(chooseMood(artwork).mood.id, chooseMood({ ...artwork }).mood.id);
});

test('culture outranks era, because an ink scroll is an ink scroll in any century', () => {
  // 1927 is squarely in the modernist era band, but this is a Japanese hanging scroll.
  const scroll = {
    title: 'Bamboo in Rain', year: 1927, culture: 'Japan',
    medium: 'Ink on silk', tags: ['Hanging scroll', 'Japan'],
  };
  assert.equal(chooseMood(scroll).mood.id, 'eastasian');
  assert.ok(scoreMood(moodById('eastasian'), scroll).score > scoreMood(moodById('modern'), scroll).score);
});

test('the era bands file the canonical cases correctly', () => {
  const cases = [
    [{ title: 'The Crucifixion', year: 1436, tags: ['Christ'] }, 'gilded'],
    [{ title: 'The Death of Socrates', year: 1787, tags: [] }, 'baroque'],
    [{ title: 'Prater Landscape', year: 1831, tags: ['Landscapes'] }, 'romantic'],
    [{ title: 'Water Lilies', year: 1915, tags: ['Flowers'] }, 'impression'],
    [{ title: 'Composition with Red', year: 1927, tags: ['Abstraction'] }, 'modern'],
  ];
  for (const [artwork, expected] of cases) {
    assert.equal(chooseMood(artwork).mood.id, expected, `${artwork.title} (${artwork.year})`);
  }
});

test('subject matter breaks an era tie', () => {
  // 1870 sits in both the romantic and the impressionist band, so the era vote cancels
  // and the subject decides. This is the pair of cases that proves it.
  const stormy = { title: 'Storm over the Valley', year: 1870, tags: ['Mountains'] };
  const dancers = { title: 'Frieze of Dancers', year: 1870, tags: ['Ballet'] };
  assert.equal(chooseMood(stormy).mood.id, 'romantic');
  assert.equal(chooseMood(dancers).mood.id, 'impression');
});

test('department is not evidence about the painting', () => {
  // "Modern European Painting and Sculpture" houses Monet. If the museum's filing
  // category were part of the keyword haystack, that string would vote for modernism.
  const filedUnderAbstract = { title: 'Untitled', department: 'Abstract and Contemporary Art' };
  assert.equal(scoreMood(moodById('modern'), filedUnderAbstract).score, 0);

  const monet = {
    title: 'Water Lilies (Agapanthus)', year: 1915, culture: 'France',
    department: 'Modern European Painting and Sculpture', tags: ['Flowers', 'Water'],
  };
  assert.equal(chooseMood(monet).mood.id, 'impression');
});

test('the signal hierarchy is strict: culture beats subject beats era', () => {
  // Nine baroque keywords in one title. The cap has to hold the subject vote below a
  // culture match, or a padded tag list could overrule "this painting is from Japan".
  const stuffed = {
    title: 'Portrait still life night candle vanitas fruit family lady meal',
    year: 2010, tags: [],
  };
  const subjectOnly = scoreMood(moodById('baroque'), stuffed).score;
  const cultureOnly = scoreMood(moodById('eastasian'), { title: 'Untitled', culture: 'Japan' }).score;
  const eraOnly = scoreMood(moodById('modern'), { title: 'Untitled', year: 2010 }).score;
  assert.ok(cultureOnly > subjectOnly, `culture ${cultureOnly} must beat any subject pile-up ${subjectOnly}`);
  assert.ok(subjectOnly > eraOnly, `subject ${subjectOnly} must beat era alone ${eraOnly}`);

  // The hierarchy in practice: a Japanese scroll keeps its typeface however many
  // competing subject words its title carries.
  const scroll = {
    title: 'Portrait still life night candle vanitas fruit family lady meal',
    year: 1650, culture: 'Japan', medium: 'Ink on silk',
  };
  assert.equal(chooseMood(scroll).mood.id, 'eastasian');
});

test('sparse metadata still gets a real typeface', () => {
  const bare = { title: 'Untitled', tags: [] };
  const chosen = chooseMood(bare);
  assert.equal(chosen.mood.id, FALLBACK_MOOD.id);
  assert.deepEqual(chosen.reasons, ['fallback']);
  assert.ok(chosen.mood.cssFamily, 'the fallback must still name a font stack');
});

test('scoreMood reports why, so a misfiled painting is diagnosable', () => {
  const { score, reasons } = scoreMood(moodById('eastasian'), {
    title: 'Dragon', culture: 'China', medium: 'Ink on silk', tags: ['Hanging scroll'],
  });
  assert.ok(score > 0);
  assert.ok(reasons.includes('culture'));
  assert.ok(reasons.some((reason) => reason.startsWith('subject:')));
});

test('a tie keeps the earlier mood, so the typeface never flickers', () => {
  // Two moods scoring equally must resolve the same way every single call.
  const ambiguous = { title: 'Untitled', year: 1785, tags: [] };
  const first = chooseMood(ambiguous).mood.id;
  for (let i = 0; i < 50; i += 1) assert.equal(chooseMood(ambiguous).mood.id, first);
});
