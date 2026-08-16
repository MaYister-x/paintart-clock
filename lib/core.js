export const ROTATION_MS = 60 * 60 * 1000;
export const SIZE_STEPS = ['compact', 'display', 'cinematic'];

export function hashString(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function getSlotKey(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offset);
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
  ].join('-') + `${sign}${pad(Math.floor(absoluteOffset / 60))}${pad(absoluteOffset % 60)}`;
}

export function selectArtworkIndex(seed, date, artworkCount) {
  if (!Number.isInteger(artworkCount) || artworkCount < 1) {
    throw new RangeError('artworkCount must be a positive integer');
  }
  return hashString(`${seed}:${getSlotKey(date)}`) % artworkCount;
}

export function millisecondsToNextHour(date = new Date()) {
  const next = new Date(date);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return Math.max(0, next.getTime() - date.getTime());
}

export function formatClock(date = new Date(), locale) {
  const hourMinute = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return {
    hourMinute,
    second: pad(date.getSeconds()),
    accessible: new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }).format(date),
  };
}

const FONT_RULES = [
  {
    id: 'modern',
    font: 'DM Mono',
    cssFamily: "'DM Mono', ui-monospace, monospace",
    keywords: ['abstract', 'geometric', 'modern', 'architecture'],
  },
  {
    id: 'landscape',
    font: 'Cormorant Garamond',
    cssFamily: "'Cormorant Garamond', Georgia, serif",
    keywords: ['landscape', 'field', 'forest', 'tree', 'garden', 'nature', 'road'],
  },
  {
    id: 'portrait',
    font: 'Bodoni Moda',
    cssFamily: "'Bodoni Moda', Didot, serif",
    keywords: ['portrait', 'self-portrait', 'women', 'men', 'artist'],
  },
  {
    id: 'mythic',
    font: 'Cinzel',
    cssFamily: "'Cinzel', Georgia, serif",
    keywords: ['venus', 'cupid', 'mars', 'myth', 'god', 'virgin', 'madonna', 'saint', 'christ'],
  },
];

export const FONT_FAMILIES = FONT_RULES;

export function chooseFont(artwork) {
  const haystack = [
    artwork.title,
    artwork.artist,
    artwork.date,
    artwork.department,
    artwork.culture,
    ...(Array.isArray(artwork.tags) ? artwork.tags : []),
  ].filter(Boolean).join(' ').toLocaleLowerCase('en');

  let winner = FONT_RULES[FONT_RULES.length - 1];
  let bestScore = 0;
  for (const rule of FONT_RULES) {
    const score = rule.keywords.reduce(
      (total, keyword) => total + (haystack.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      winner = rule;
      bestScore = score;
    }
  }
  return winner;
}

export function stepSize(current, delta) {
  const currentIndex = Math.max(0, SIZE_STEPS.indexOf(current));
  const nextIndex = Math.min(SIZE_STEPS.length - 1, Math.max(0, currentIndex + delta));
  return SIZE_STEPS[nextIndex];
}

export function createSeed() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 0xffffffff); });
  return Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join('-');
}
