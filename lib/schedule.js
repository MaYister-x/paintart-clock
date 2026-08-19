// Deterministic artwork scheduling.
//
// The artwork on screen is a pure function of (seed, time slot, catalog size). Same seed
// and same hour always resolve to the same painting, so a reload never shuffles the
// wallpaper, and a new seed reshuffles the whole sequence.

/** One artwork per local clock hour. */
export const SLOT_MS = 60 * 60 * 1000;

/** FNV-1a. Small, dependency-free, and spreads adjacent keys well. */
export function hashString(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Identifier for the current rotation slot: the viewer's local date and hour, plus their
 * UTC offset.
 *
 * The offset is part of the key on purpose. When a zone falls back off summer time the
 * same local hour occurs twice, and without the offset both passes would collapse onto
 * one slot — the artwork would silently repeat for two hours. With it, the two passes are
 * distinct keys and each gets its own painting.
 */
export function slotKey(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${pad2(Math.floor(absolute / 60))}${pad2(absolute % 60)}`;
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    pad2(date.getHours()),
  ].join('-') + offset;
}

/** Catalog index for a seed and slot. Deterministic. */
export function pickIndex(seed, key, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('count must be a positive integer');
  }
  return hashString(`${seed}:${key}`) % count;
}

/** Milliseconds until the next local hour boundary. */
export function msUntilNextSlot(date = new Date()) {
  const next = new Date(date.getTime());
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return Math.max(0, next.getTime() - date.getTime());
}

export function createSeed() {
  const bytes = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 0x100000000);
    }
  }
  return Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join('');
}

/**
 * A fresh seed that resolves to a different artwork than `currentIndex`.
 *
 * Pressing the refresh button has to visibly do something. A blind random seed lands on
 * the same painting roughly 1 in `count` times, which reads as a broken button, so keep
 * drawing until the pick moves. With a single-item catalog no such seed exists; return
 * the last candidate rather than looping forever.
 */
export function reseedAway(currentIndex, key, count, makeSeed = createSeed) {
  let seed = makeSeed();
  if (count < 2) return seed;
  for (let attempt = 0; attempt < 64 && pickIndex(seed, key, count) === currentIndex; attempt += 1) {
    seed = makeSeed();
  }
  return seed;
}
