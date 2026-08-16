import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseFont,
  formatClock,
  getSlotKey,
  hashString,
  millisecondsToNextHour,
  selectArtworkIndex,
  stepSize,
} from '../lib/core.js';

test('hashString is deterministic and unsigned', () => {
  assert.equal(hashString('art:2026-08-16-09'), hashString('art:2026-08-16-09'));
  assert.notEqual(hashString('alpha'), hashString('beta'));
  assert.ok(hashString('paint') >= 0);
});

test('selection stays stable within an hour and remains in range', () => {
  const early = new Date('2026-08-16T09:00:00.000Z');
  const late = new Date('2026-08-16T09:59:59.999Z');
  const first = selectArtworkIndex('seed-a', early, 24);
  assert.equal(selectArtworkIndex('seed-a', late, 24), first);
  assert.ok(first >= 0 && first < 24);
});

test('different seeds provide more than one selection across a catalog', () => {
  const date = new Date('2026-08-16T09:20:00.000Z');
  const selections = new Set(
    Array.from({ length: 64 }, (_, index) => selectArtworkIndex(`seed-${index}`, date, 24)),
  );
  assert.ok(selections.size >= 16);
});

test('slot key changes at the hour boundary', () => {
  assert.notEqual(
    getSlotKey(new Date('2026-08-16T09:59:59.999Z')),
    getSlotKey(new Date('2026-08-16T10:00:00.000Z')),
  );
});

test('millisecondsToNextHour aligns rather than accumulating drift', () => {
  assert.equal(millisecondsToNextHour(new Date('2026-08-16T09:59:59.250Z')), 750);
  assert.equal(millisecondsToNextHour(new Date('2026-08-16T09:00:00.000Z')), 3_600_000);
});

test('size stepping clamps at both ends', () => {
  assert.equal(stepSize('compact', -1), 'compact');
  assert.equal(stepSize('compact', 1), 'display');
  assert.equal(stepSize('cinematic', 1), 'cinematic');
});

test('font selection follows artwork metadata', () => {
  assert.equal(chooseFont({ title: 'Wheat Fields', tags: ['Landscapes'] }).id, 'landscape');
  assert.equal(chooseFont({ title: 'Study', tags: ['Portraits', 'Women'] }).id, 'portrait');
  assert.equal(chooseFont({ title: 'Venus and Cupid', tags: [] }).id, 'mythic');
  assert.equal(chooseFont({ title: 'Untitled', tags: ['Abstract', 'Geometric'] }).id, 'modern');
});

test('clock formatting always includes two-digit seconds', () => {
  const result = formatClock(new Date('2026-08-16T09:02:03.000Z'), 'en-GB');
  assert.equal(result.second, '03');
  assert.match(result.hourMinute, /^\d{2}:\d{2}$/);
});

test('selection rejects an empty catalog', () => {
  assert.throws(() => selectArtworkIndex('seed', new Date(), 0), RangeError);
});
