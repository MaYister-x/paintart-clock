import test from 'node:test';
import assert from 'node:assert/strict';

import { SLOT_MS, hashString, slotKey, pickIndex, msUntilNextSlot, createSeed, reseedAway } from '../lib/schedule.js';

/**
 * slotKey only reads five getters, so a stub pins the zone that a real Date cannot: the
 * process TZ is fixed at startup and these cases need two different offsets.
 */
function fakeDate({ year = 2026, month = 8, day = 19, hour = 14, offsetMinutes = 540 }) {
  return {
    getFullYear: () => year,
    getMonth: () => month - 1,
    getDate: () => day,
    getHours: () => hour,
    getTimezoneOffset: () => -offsetMinutes,
  };
}

test('hashString is FNV-1a: stable, unsigned, and spreads adjacent keys', () => {
  assert.equal(hashString(''), 0x811c9dc5);
  assert.equal(hashString('a'), 0xe40c292c);
  assert.equal(hashString('foobar'), 0xbf9cf968);
  assert.equal(hashString('abc'), hashString('abc'));
  assert.ok(hashString('seed:2026-08-19-14+0900') >= 0, 'must be unsigned');

  // Adjacent hours must not walk the catalog in order or collapse onto a few indexes.
  //
  // Judged on the average over many seeds, not on one: 24 draws from 40 slots collide by
  // birthday alone, so a single unlucky seed reaching 10 distinct artworks is normal and
  // asserting a floor on one seed is a flaky test. The uniform expectation here is
  // 40*(1-(39/40)^24) = 18.2, and this hash measures 19.2 across random seeds.
  const seeds = Array.from({ length: 200 }, (_, i) => `seed-${i}`);
  const distinct = seeds.map((seed) => {
    const picks = new Set();
    for (let hour = 0; hour < 24; hour += 1) {
      picks.add(hashString(`${seed}:2026-08-19-${String(hour).padStart(2, '0')}+0900`) % 40);
    }
    return picks.size;
  });
  const mean = distinct.reduce((sum, value) => sum + value, 0) / distinct.length;
  assert.ok(mean >= 17, `mean distinct picks per day is ${mean.toFixed(1)}, uniform would be 18.2`);
  assert.ok(Math.min(...distinct), 'no seed may collapse to zero picks');
  assert.ok(Math.min(...distinct) >= 8, `worst seed collapsed to ${Math.min(...distinct)} picks`);
});

test('slotKey is one key per local hour', () => {
  assert.equal(slotKey(fakeDate({ hour: 14 })), '2026-08-19-14+0900');
  assert.equal(slotKey(fakeDate({ hour: 9 })), '2026-08-19-09+0900');
  assert.notEqual(slotKey(fakeDate({ hour: 14 })), slotKey(fakeDate({ hour: 15 })));
  // Minutes and seconds are not in the key: the artwork holds for the whole hour.
  assert.equal(slotKey(new Date(2026, 7, 19, 14, 0, 0)), slotKey(new Date(2026, 7, 19, 14, 59, 59)));
});

test('slotKey formats negative and half-hour offsets', () => {
  assert.equal(slotKey(fakeDate({ offsetMinutes: -300 })), '2026-08-19-14-0500');
  assert.equal(slotKey(fakeDate({ offsetMinutes: 330 })), '2026-08-19-14+0530');
  assert.equal(slotKey(fakeDate({ offsetMinutes: 0 })), '2026-08-19-14+0000');
  assert.equal(slotKey(fakeDate({ offsetMinutes: -570 })), '2026-08-19-14-0930');
});

test('the UTC offset keeps a DST fall-back from repeating the artwork', () => {
  // 01:00 happens twice on a fall-back night, once at -04:00 and once at -05:00. Without
  // the offset in the key both passes are the same slot and the painting holds for two
  // hours; with it they are distinct keys.
  const before = slotKey(fakeDate({ month: 11, day: 1, hour: 1, offsetMinutes: -240 }));
  const after = slotKey(fakeDate({ month: 11, day: 1, hour: 1, offsetMinutes: -300 }));
  assert.notEqual(before, after);
  assert.notEqual(pickIndex('seed', before, 40), pickIndex('seed', after, 40));
});

test('pickIndex is deterministic and in range', () => {
  assert.equal(pickIndex('abc', '2026-08-19-14+0900', 40), pickIndex('abc', '2026-08-19-14+0900', 40));
  assert.notEqual(pickIndex('abc', '2026-08-19-14+0900', 40), pickIndex('xyz', '2026-08-19-14+0900', 40));
  for (const count of [1, 2, 7, 40, 100]) {
    for (let hour = 0; hour < 24; hour += 1) {
      const index = pickIndex('seed', `2026-08-19-${hour}`, count);
      assert.ok(Number.isInteger(index) && index >= 0 && index < count, `${count}/${hour} -> ${index}`);
    }
  }
});

test('pickIndex refuses a count it cannot divide by', () => {
  assert.throws(() => pickIndex('s', 'k', 0), RangeError);
  assert.throws(() => pickIndex('s', 'k', -3), RangeError);
  assert.throws(() => pickIndex('s', 'k', 2.5), RangeError);
});

test('a fixed seed covers most of the catalog over a day', () => {
  const seen = new Set();
  for (let day = 1; day <= 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      seen.add(pickIndex('fixed-seed', `2026-08-0${day}-${hour}+0900`, 40));
    }
  }
  // 168 draws from 40 slots: a working hash reaches nearly all of them. A broken one
  // (say, a hash that ignores the hour) would reach one.
  assert.ok(seen.size >= 34, `a week of slots only reached ${seen.size}/40 artworks`);
});

test('msUntilNextSlot lands on the hour boundary', () => {
  assert.equal(msUntilNextSlot(new Date(2026, 7, 19, 14, 0, 0, 0)), SLOT_MS);
  assert.equal(msUntilNextSlot(new Date(2026, 7, 19, 14, 59, 59, 0)), 1000);
  assert.equal(msUntilNextSlot(new Date(2026, 7, 19, 14, 30, 0, 0)), SLOT_MS / 2);
  // Crossing midnight must not go negative.
  assert.ok(msUntilNextSlot(new Date(2026, 7, 19, 23, 30, 0, 0)) > 0);
});

test('createSeed returns 32 hex characters and does not repeat', () => {
  const seed = createSeed();
  assert.match(seed, /^[0-9a-f]{32}$/);
  const seeds = new Set(Array.from({ length: 200 }, createSeed));
  assert.equal(seeds.size, 200);
});

test('reseedAway always moves the artwork', () => {
  // Pressing refresh and getting the same painting reads as a broken button, so the new
  // seed has to resolve somewhere else. Checked against every starting index.
  for (let current = 0; current < 40; current += 1) {
    const seed = reseedAway(current, '2026-08-19-14+0900', 40);
    assert.notEqual(pickIndex(seed, '2026-08-19-14+0900', 40), current);
  }
});

test('reseedAway keeps drawing while the seed source keeps returning the same pick', () => {
  const key = '2026-08-19-14+0900';
  const stuck = pickIndex('seed-1', key, 8);
  let calls = 0;
  // The first three draws all resolve to the index we are trying to leave.
  const makeSeed = () => {
    calls += 1;
    return calls <= 3 ? 'seed-1' : 'seed-2';
  };
  const seed = reseedAway(stuck, key, 8, makeSeed);
  assert.equal(calls, 4);
  assert.notEqual(pickIndex(seed, key, 8), stuck);
});

test('reseedAway terminates on a single-artwork catalog', () => {
  // No seed can move away from the only artwork, so this must return rather than spin.
  const seed = reseedAway(0, 'k', 1);
  assert.match(seed, /^[0-9a-f]{32}$/);
  assert.equal(pickIndex(seed, 'k', 1), 0);
});
