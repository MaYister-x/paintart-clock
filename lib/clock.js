// Clock formatting. Pure functions, so the render layer can diff digit slots and the
// tests can pin exact strings without touching the DOM.

export function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 24-hour reading of `date` in the viewer's own time zone. */
export function readClock(date = new Date()) {
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return {
    hours,
    minutes,
    seconds: pad2(date.getSeconds()),
    hourMinute: `${hours}:${minutes}`,
  };
}

/** The four HHMM characters, in slot order, for per-digit animation. */
export function hourMinuteSlots(date = new Date()) {
  const { hours, minutes } = readClock(date);
  return [hours[0], hours[1], minutes[0], minutes[1]];
}

/** Indexes where `next` differs from `previous`; only those slots should animate. */
export function changedSlots(previous, next) {
  const changed = [];
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] !== next[index]) changed.push(index);
  }
  return changed;
}

/** Full sentence for screen readers; `<time datetime>` carries the machine value. */
export function spokenTime(date = new Date(), locale = undefined) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Milliseconds until the next wall-clock second. Sleeping exactly 1000ms drifts, and a
 * 1000ms interval in a throttled background tab drifts badly; re-aiming at the boundary
 * every tick keeps the seconds display honest.
 */
export function msUntilNextSecond(date = new Date()) {
  return 1000 - (date.getTime() % 1000);
}
