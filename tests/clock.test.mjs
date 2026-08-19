import test from 'node:test';
import assert from 'node:assert/strict';

import { pad2, readClock, hourMinuteSlots, changedSlots, spokenTime, msUntilNextSecond } from '../lib/clock.js';

// `new Date(y, m, d, …)` builds a local time, and readClock reads local time, so these
// assertions hold in every zone the CI runner or a contributor's laptop might be in.
const at = (h, m, s) => new Date(2026, 7, 19, h, m, s);

test('pad2 pads single digits and leaves two alone', () => {
  assert.equal(pad2(0), '00');
  assert.equal(pad2(7), '07');
  assert.equal(pad2(23), '23');
});

test('readClock is 24-hour, zero-padded', () => {
  assert.deepEqual(readClock(at(9, 5, 3)), {
    hours: '09', minutes: '05', seconds: '03', hourMinute: '09:05',
  });
  assert.equal(readClock(at(0, 0, 0)).hourMinute, '00:00');
  // The bug a 12-hour formatter would introduce: 13:00 rendering as 01:00.
  assert.equal(readClock(at(13, 0, 0)).hourMinute, '13:00');
  assert.equal(readClock(at(23, 59, 59)).hourMinute, '23:59');
});

test('hourMinuteSlots splits HHMM into four animatable slots', () => {
  assert.deepEqual(hourMinuteSlots(at(14, 38, 0)), ['1', '4', '3', '8']);
  assert.deepEqual(hourMinuteSlots(at(0, 0, 0)), ['0', '0', '0', '0']);
});

test('changedSlots reports only the digits that actually moved', () => {
  // 14:38 -> 14:39: one digit moves, so three digits must not animate.
  assert.deepEqual(changedSlots(['1', '4', '3', '8'], ['1', '4', '3', '9']), [3]);
  // 14:59 -> 15:00: three digits move, the leading 1 stays put.
  assert.deepEqual(changedSlots(['1', '4', '5', '9'], ['1', '5', '0', '0']), [1, 2, 3]);
  // 09:59 -> 10:00: all four.
  assert.deepEqual(changedSlots(['0', '9', '5', '9'], ['1', '0', '0', '0']), [0, 1, 2, 3]);
  assert.deepEqual(changedSlots(['1', '4', '3', '8'], ['1', '4', '3', '8']), []);
});

test('msUntilNextSecond aims at the wall-clock boundary, never at a flat 1000', () => {
  assert.equal(msUntilNextSecond(new Date(1_000_000_000_250)), 750);
  assert.equal(msUntilNextSecond(new Date(1_000_000_000_999)), 1);
  // On an exact boundary the next boundary is a full second away, and the value is never
  // 0 — a 0ms timeout would spin the event loop.
  assert.equal(msUntilNextSecond(new Date(1_000_000_000_000)), 1000);
  for (let ms = 0; ms < 1000; ms += 137) {
    const wait = msUntilNextSecond(new Date(1_700_000_000_000 + ms));
    assert.ok(wait > 0 && wait <= 1000, `${ms} -> ${wait}`);
  }
});

test('spokenTime is a full sentence, not a bare clock reading', () => {
  const spoken = spokenTime(at(14, 38, 0), 'en-US');
  assert.match(spoken, /Wednesday/);
  assert.match(spoken, /August/);
  assert.match(spoken, /2026/);
  assert.match(spoken, /14:38/);
});
