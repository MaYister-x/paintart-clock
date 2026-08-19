// Paintart Clock — wiring.
//
// The three libraries under lib/ hold every decision worth testing: which artwork a seed
// and an hour resolve to, which typeface a painting asks for, and what the digits read.
// This file only moves their answers into the DOM.

import { readClock, hourMinuteSlots, changedSlots, spokenTime, msUntilNextSecond } from './lib/clock.js';
import { slotKey, pickIndex, msUntilNextSlot, createSeed, reseedAway } from './lib/schedule.js';
import { chooseMood, FALLBACK_MOOD } from './lib/mood.js';

const SEED_KEY = 'paintart.seed';
const SIZE_KEY = 'paintart.size';
const FLIP_MS = 520;
const BEAT_MS = 900;

// Named steps, not a raw multiplier: the buttons should walk a scale someone designed.
const SIZE_STEPS = [
  { id: 'quiet', scale: 0.5 },
  { id: 'small', scale: 0.7 },
  { id: 'medium', scale: 0.85 },
  { id: 'display', scale: 1 },
  { id: 'huge', scale: 1.2 },
  { id: 'wall', scale: 1.45 },
];
const DEFAULT_SIZE = SIZE_STEPS.findIndex((step) => step.id === 'display');

const el = {
  app: document.getElementById('app'),
  artwork: document.getElementById('artwork'),
  clock: document.getElementById('clock'),
  colon: document.getElementById('colon'),
  seconds: document.getElementById('seconds'),
  digits: Array.from(document.querySelectorAll('.digit')),
  title: document.getElementById('art-title'),
  meta: document.getElementById('art-meta'),
  source: document.getElementById('art-source'),
  moodName: document.getElementById('mood-name'),
  nextChange: document.getElementById('next-change'),
  status: document.getElementById('status'),
  smaller: document.getElementById('btn-smaller'),
  larger: document.getElementById('btn-larger'),
  seed: document.getElementById('btn-seed'),
  fullscreen: document.getElementById('btn-fullscreen'),
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  catalog: [],
  seed: '',
  sizeIndex: DEFAULT_SIZE,
  slot: '',
  index: -1,
  artwork: null,
  mood: FALLBACK_MOOD,
  /** Artworks whose image failed to load in this session; never picked again. */
  broken: new Set(),
  slots: ['0', '0', '0', '0'],
  minute: '',
  timers: { second: 0, slot: 0 },
  counters: { beats: 0, flips: 0, imageErrors: 0 },
  errors: [],
};

/* ---------- storage: private-mode browsers throw on access, not on write ---------- */

function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/* ---------- diagnostics ---------- */

function note(message) {
  state.errors.push(String(message));
  if (state.errors.length > 20) state.errors.shift();
}

window.addEventListener('error', (event) => note(event.message || 'error'));
window.addEventListener('unhandledrejection', (event) => note(event.reason?.message || 'rejection'));

// The browser-verification harness reads this instead of scraping the DOM, so a rename
// here is a breaking change for tools/verify-browser.mjs.
window.__paintart = {
  get ready() { return el.app.dataset.imageState === 'ready'; },
  get catalogCount() { return state.catalog.length; },
  get artworkId() { return state.artwork?.id ?? null; },
  get artworkTitle() { return state.artwork?.title ?? null; },
  get imageUrl() { return el.artwork.currentSrc || el.artwork.src; },
  get mood() { return state.mood.id; },
  get font() { return state.mood.font; },
  get seed() { return state.seed; },
  get slot() { return state.slot; },
  get size() { return SIZE_STEPS[state.sizeIndex].id; },
  get scale() { return SIZE_STEPS[state.sizeIndex].scale; },
  get digits() { return state.slots.join(''); },
  get counters() { return { ...state.counters }; },
  get errors() { return [...state.errors]; },
};

/* ---------- clock ---------- */

function setDigit(slotEl, value, animate) {
  const current = slotEl.querySelector('.digit__cur');
  const incoming = slotEl.querySelector('.digit__next');
  if (!animate) {
    slotEl.classList.remove('is-flipping');
    current.textContent = value;
    incoming.textContent = value;
    return;
  }
  incoming.textContent = value;
  slotEl.classList.remove('is-flipping');
  void slotEl.offsetWidth; // reflow, or re-adding the class does not restart the keyframes
  slotEl.classList.add('is-flipping');
  window.setTimeout(() => {
    current.textContent = value;
    slotEl.classList.remove('is-flipping');
  }, FLIP_MS);
}

function pulse(node) {
  node.classList.remove('is-beat');
  void node.offsetWidth;
  node.classList.add('is-beat');
  window.setTimeout(() => node.classList.remove('is-beat'), BEAT_MS);
}

function paintClock(now, { animate = true } = {}) {
  const reading = readClock(now);
  const next = hourMinuteSlots(now);
  const changed = changedSlots(state.slots, next);
  const moving = animate && !reduceMotion.matches;

  for (const index of changed) setDigit(el.digits[index], next[index], moving);
  if (changed.length) state.counters.flips += 1;
  state.slots = next;

  el.seconds.textContent = reading.seconds;
  if (moving) {
    pulse(el.colon);
    pulse(el.seconds);
  }
  state.counters.beats += 1;

  // Machine-readable value every second; the spoken sentence only when the minute turns,
  // so a screen reader is not interrupted sixty times a minute.
  el.clock.dateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${reading.hourMinute}`;
  if (reading.hourMinute !== state.minute) {
    state.minute = reading.hourMinute;
    el.clock.setAttribute('aria-label', spokenTime(now));
  }
}

function tick() {
  const now = new Date();
  paintClock(now);
  if (state.slot && slotKey(now) !== state.slot) showSlot(now);
  el.nextChange.textContent = nextChangeLabel(now);
  state.timers.second = window.setTimeout(tick, msUntilNextSecond(now));
}

function nextChangeLabel(now) {
  const minutes = Math.max(1, Math.round(msUntilNextSlot(now) / 60000));
  return minutes === 1 ? 'next painting in a minute' : `next painting in ${minutes} min`;
}

/* ---------- artwork ---------- */

/**
 * The image URL to request.
 *
 * The catalog carries a web-size and a print-size URL. Museum print files run to several
 * megabytes, which is waste on a phone and necessary on a 4K panel, so pick on the real
 * pixel width rather than the CSS one.
 */
function imageUrlFor(artwork) {
  const pixels = Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1);
  return pixels > 1400 ? artwork.image : artwork.imageSmall;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => resolve(url);
    probe.onerror = () => reject(new Error(`image failed: ${url}`));
    probe.src = url;
  });
}

function describe(artwork) {
  return [artwork.artist, artwork.date, artwork.medium].filter(Boolean).join(' · ');
}

function applyMood(artwork) {
  const { mood } = chooseMood(artwork);
  state.mood = mood;
  const root = document.documentElement.style;
  root.setProperty('--clock-family', mood.cssFamily);
  root.setProperty('--clock-weight', String(mood.weight));
  root.setProperty('--clock-tracking', mood.tracking);
  el.moodName.textContent = mood.label;
  el.app.dataset.mood = mood.id;
}

function present(artwork, url) {
  state.artwork = artwork;
  el.artwork.src = url;
  el.artwork.alt = artwork.alt || artwork.title;
  el.title.textContent = artwork.title;
  el.meta.textContent = describe(artwork);
  el.source.href = artwork.sourceUrl;
  el.source.textContent = artwork.source;
  applyMood(artwork);
  el.app.dataset.imageState = 'ready';
  el.status.textContent = `${artwork.title}, ${artwork.artist}. Clock typeface: ${state.mood.font}.`;
}

/**
 * Resolve the slot to an artwork and put it on screen.
 *
 * A dead image URL must not leave the viewer on a black rectangle, so walk forward
 * through the catalog until one loads. The walk is still deterministic — same seed, same
 * hour, same starting index — it just skips what this session has proven broken.
 */
async function showSlot(now = new Date(), { announce = false } = {}) {
  const count = state.catalog.length;
  if (!count) return;
  state.slot = slotKey(now);
  const start = pickIndex(state.seed, state.slot, count);
  state.index = start;

  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    const artwork = state.catalog[index];
    if (state.broken.has(artwork.id)) continue;
    const url = imageUrlFor(artwork);
    try {
      await loadImage(url);
      state.index = index;
      present(artwork, url);
      if (announce) el.status.textContent = `New sequence. ${artwork.title}, ${artwork.artist}.`;
      return;
    } catch (error) {
      state.broken.add(artwork.id);
      state.counters.imageErrors += 1;
      note(error.message);
      // Retry the same work at web size before giving up on it: a print file can be
      // missing while the web derivative is fine.
      if (url !== artwork.imageSmall) {
        try {
          await loadImage(artwork.imageSmall);
          state.broken.delete(artwork.id);
          state.index = index;
          present(artwork, artwork.imageSmall);
          return;
        } catch { /* fall through to the next artwork */ }
      }
    }
  }

  el.app.dataset.imageState = 'failed';
  el.title.textContent = 'No artwork could be loaded';
  el.meta.textContent = 'The clock still works. Check your connection and reload.';
  note('every catalog image failed');
}

/* ---------- controls ---------- */

function applySize(index, { persist = true } = {}) {
  state.sizeIndex = Math.min(SIZE_STEPS.length - 1, Math.max(0, index));
  const step = SIZE_STEPS[state.sizeIndex];
  document.documentElement.style.setProperty('--clock-scale', String(step.scale));
  el.app.dataset.size = step.id;
  el.smaller.disabled = state.sizeIndex === 0;
  el.larger.disabled = state.sizeIndex === SIZE_STEPS.length - 1;
  if (persist) writeStored(SIZE_KEY, String(state.sizeIndex));
  el.status.textContent = `Clock size: ${step.id}.`;
}

function nudgeSize(delta) {
  applySize(state.sizeIndex + delta);
}

async function shuffleSeed() {
  const count = state.catalog.length;
  if (!count) return;
  state.seed = reseedAway(state.index, state.slot, count);
  writeStored(SEED_KEY, state.seed);
  el.seed.classList.remove('is-spinning');
  void el.seed.offsetWidth;
  el.seed.classList.add('is-spinning');
  window.setTimeout(() => el.seed.classList.remove('is-spinning'), 620);
  await showSlot(new Date(), { announce: true });
}

function fullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

async function toggleFullscreen() {
  try {
    if (fullscreenActive()) {
      await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
    } else {
      const node = document.documentElement;
      await (node.requestFullscreen?.() ?? node.webkitRequestFullscreen?.());
    }
  } catch (error) {
    // iOS Safari on iPhone has no element fullscreen at all; say so instead of nothing.
    note(error.message);
    el.status.textContent = 'This browser will not allow fullscreen. Hide the browser chrome instead.';
  }
}

function syncFullscreenButton() {
  const active = fullscreenActive();
  el.fullscreen.setAttribute('aria-pressed', String(active));
  el.fullscreen.title = active ? 'Leave fullscreen (F)' : 'Fullscreen (F)';
}

el.smaller.addEventListener('click', () => nudgeSize(-1));
el.larger.addEventListener('click', () => nudgeSize(1));
el.seed.addEventListener('click', shuffleSeed);
el.fullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreenButton);
document.addEventListener('webkitfullscreenchange', syncFullscreenButton);

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // Do not steal keys from the credit link or the buttons themselves.
  if (event.target instanceof HTMLElement && event.target.closest('a, button')) return;
  switch (event.key) {
    case 'f': case 'F': toggleFullscreen(); break;
    case 'r': case 'R': shuffleSeed(); break;
    case '+': case '=': nudgeSize(1); break;
    case '-': case '_': nudgeSize(-1); break;
    default: return;
  }
  event.preventDefault();
});

// A backgrounded tab has its timers throttled to once a minute or worse, so the display
// is stale the moment it comes back. Repaint on return rather than waiting for the tick.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = new Date();
  paintClock(now, { animate: false });
  if (state.slot && slotKey(now) !== state.slot) showSlot(now);
});

// Rotating the phone or moving to an external display can cross the print-size threshold.
window.addEventListener('resize', () => {
  if (!state.artwork) return;
  const wanted = imageUrlFor(state.artwork);
  if (wanted !== (el.artwork.getAttribute('src') || '')) {
    loadImage(wanted).then(() => { el.artwork.src = wanted; }).catch(() => {});
  }
}, { passive: true });

/* ---------- start ---------- */

async function start() {
  applySize(Number(readStored(SIZE_KEY) ?? DEFAULT_SIZE), { persist: false });
  syncFullscreenButton();

  state.seed = readStored(SEED_KEY) || createSeed();
  writeStored(SEED_KEY, state.seed);

  paintClock(new Date(), { animate: false });
  tick();

  try {
    const response = await fetch('./data/artworks.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog) || !catalog.length) throw new Error('catalog is empty');
    state.catalog = catalog;
  } catch (error) {
    note(error.message);
    el.app.dataset.imageState = 'failed';
    el.title.textContent = 'The gallery could not be loaded';
    el.meta.textContent = 'The clock still works. Reload to try again.';
    return;
  }

  await showSlot();

  // A safety net under the tick's slot check: an unthrottled tab crosses the hour on its
  // own timer, which keeps the swap punctual to the second rather than to the next tick.
  const scheduleSlot = () => {
    window.clearTimeout(state.timers.slot);
    state.timers.slot = window.setTimeout(async () => {
      await showSlot();
      scheduleSlot();
    }, msUntilNextSlot() + 250);
  };
  scheduleSlot();
}

start();
