import {
  chooseFont,
  createSeed,
  formatClock,
  getSlotKey,
  millisecondsToNextHour,
  selectArtworkIndex,
  SIZE_STEPS,
  stepSize,
} from './lib/core.js';

const STORAGE = {
  seed: 'paintart-clock.seed.v1',
  size: 'paintart-clock.size.v1',
};

const elements = {
  app: document.querySelector('#app'),
  background: document.querySelector('#artwork-image'),
  hourMinute: document.querySelector('#hour-minute'),
  incomingMinute: document.querySelector('#hour-minute-incoming'),
  second: document.querySelector('#second'),
  clock: document.querySelector('#clock'),
  title: document.querySelector('#artwork-title'),
  byline: document.querySelector('#artwork-byline'),
  source: document.querySelector('#artwork-source'),
  font: document.querySelector('#font-name'),
  rotation: document.querySelector('#rotation-status'),
  status: document.querySelector('#status'),
  fullscreen: document.querySelector('#fullscreen-button'),
  smaller: document.querySelector('#smaller-button'),
  larger: document.querySelector('#larger-button'),
  refresh: document.querySelector('#refresh-button'),
};

const diagnostics = {
  errors: [],
  artworkId: null,
  seed: null,
  size: null,
  slot: null,
  catalogCount: 0,
};
window.__paintartDiagnostics = diagnostics;
window.addEventListener('error', (event) => diagnostics.errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection', (event) => diagnostics.errors.push(String(event.reason)));

let catalog = [];
let activeArtworkIndex = -1;
let activeSlot = '';
let activeMinute = '';
let minuteAnimationTimer;
let rotationTimer;
let imageRequest = 0;

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Private mode can reject storage. */ }
}

function getSeed() {
  let seed = safeStorageGet(STORAGE.seed);
  if (!seed) {
    seed = createSeed();
    safeStorageSet(STORAGE.seed, seed);
  }
  diagnostics.seed = seed;
  return seed;
}

function getSize() {
  const stored = safeStorageGet(STORAGE.size);
  return SIZE_STEPS.includes(stored) ? stored : 'display';
}

function setSize(size) {
  elements.app.dataset.size = size;
  diagnostics.size = size;
  safeStorageSet(STORAGE.size, size);
  const index = SIZE_STEPS.indexOf(size);
  elements.smaller.disabled = index === 0;
  elements.larger.disabled = index === SIZE_STEPS.length - 1;
  elements.status.textContent = `Clock size: ${size}`;
}

function imageUrlFor(artwork) {
  const displayPixels = window.innerWidth * Math.max(1, window.devicePixelRatio || 1);
  return displayPixels >= 1600 ? artwork.image : artwork.imageSmall;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(url);
    image.onerror = reject;
    image.src = url;
  });
}

async function resolveArtworkImage(artwork) {
  const preferred = imageUrlFor(artwork);
  try {
    return await loadImage(preferred);
  } catch (error) {
    if (preferred !== artwork.imageSmall) return loadImage(artwork.imageSmall);
    throw error;
  }
}

function updateArtworkMetadata(artwork, font) {
  elements.title.textContent = artwork.title;
  elements.byline.textContent = [artwork.artist, artwork.date].filter(Boolean).join(' · ');
  elements.source.href = artwork.sourceUrl;
  elements.source.textContent = artwork.source;
  elements.font.textContent = font.font;
  elements.clock.style.fontFamily = font.cssFamily;
  document.title = `${artwork.title} — Paintart Clock`;
}

async function showArtwork(startIndex, attempt = 0) {
  if (!catalog.length || attempt >= catalog.length) {
    elements.app.dataset.imageState = 'error';
    elements.status.textContent = 'Artwork image unavailable. Showing the ambient fallback.';
    return;
  }
  const index = (startIndex + attempt) % catalog.length;
  const artwork = catalog[index];
  const requestId = ++imageRequest;
  elements.app.dataset.imageState = 'loading';

  try {
    const resolvedUrl = await resolveArtworkImage(artwork);
    if (requestId !== imageRequest) return;
    elements.background.src = resolvedUrl;
    elements.background.alt = artwork.alt;
    elements.app.dataset.imageState = 'ready';
    activeArtworkIndex = index;
    diagnostics.artworkId = artwork.id;
    updateArtworkMetadata(artwork, chooseFont(artwork));
    elements.status.textContent = `Now showing ${artwork.title} by ${artwork.artist}`;
  } catch {
    if (requestId !== imageRequest) return;
    await showArtwork(startIndex, attempt + 1);
  }
}

function scheduleArtworkRotation(date = new Date(), force = false) {
  clearTimeout(rotationTimer);
  if (!catalog.length) return;
  const slot = getSlotKey(date);
  const index = selectArtworkIndex(getSeed(), date, catalog.length);
  diagnostics.slot = slot;
  if (force || slot !== activeSlot || index !== activeArtworkIndex) {
    activeSlot = slot;
    void showArtwork(index);
  }
  const minutes = Math.max(1, Math.ceil(millisecondsToNextHour(date) / 60000));
  elements.rotation.textContent = `Next artwork in ${minutes} min`;
  rotationTimer = setTimeout(() => scheduleArtworkRotation(new Date()), Math.min(60000, millisecondsToNextHour(date) + 50));
}

function pulseSecond() {
  elements.second.classList.remove('is-heartbeat');
  void elements.second.offsetWidth;
  elements.second.classList.add('is-heartbeat');
}

function animateMinute(nextValue) {
  clearTimeout(minuteAnimationTimer);
  elements.incomingMinute.textContent = nextValue;
  elements.clock.classList.remove('is-minute-changing');
  void elements.clock.offsetWidth;
  elements.clock.classList.add('is-minute-changing');
  minuteAnimationTimer = setTimeout(() => {
    elements.hourMinute.textContent = nextValue;
    elements.clock.classList.remove('is-minute-changing');
  }, 520);
}

function tick() {
  const now = new Date();
  const formatted = formatClock(now);
  if (!activeMinute) {
    activeMinute = formatted.hourMinute;
    elements.hourMinute.textContent = formatted.hourMinute;
    elements.incomingMinute.textContent = formatted.hourMinute;
  } else if (activeMinute !== formatted.hourMinute) {
    activeMinute = formatted.hourMinute;
    animateMinute(formatted.hourMinute);
  }
  elements.second.textContent = formatted.second;
  elements.clock.dateTime = now.toISOString();
  elements.clock.setAttribute('aria-label', formatted.accessible);
  pulseSecond();
  if (getSlotKey(now) !== activeSlot) scheduleArtworkRotation(now);
  setTimeout(tick, 1010 - (Date.now() % 1000));
}

function setFullscreenState() {
  const active = Boolean(document.fullscreenElement);
  elements.fullscreen.setAttribute('aria-pressed', String(active));
  elements.fullscreen.title = active ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)';
  elements.fullscreen.querySelector('.button-label').textContent = active ? 'Exit' : 'Full';
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    elements.status.textContent = 'Fullscreen is unavailable in this browser context.';
  }
}

function changeSize(delta) {
  setSize(stepSize(elements.app.dataset.size, delta));
}

function refreshSeed() {
  const now = new Date();
  let seed = createSeed();
  let attempts = 0;
  while (
    catalog.length > 1
    && selectArtworkIndex(seed, now, catalog.length) === activeArtworkIndex
    && attempts < 8
  ) {
    seed = createSeed();
    attempts += 1;
  }
  safeStorageSet(STORAGE.seed, seed);
  diagnostics.seed = seed;
  scheduleArtworkRotation(now, true);
  elements.status.textContent = 'Artwork sequence refreshed.';
}

async function init() {
  setSize(getSize());
  try {
    const response = await fetch('./data/artworks.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    catalog = await response.json();
    if (!Array.isArray(catalog) || !catalog.length) throw new Error('Catalog is empty');
    diagnostics.catalogCount = catalog.length;
    scheduleArtworkRotation(new Date(), true);
  } catch (error) {
    diagnostics.errors.push(String(error));
    elements.app.dataset.imageState = 'error';
    elements.status.textContent = 'The artwork catalog could not be loaded.';
  }
  tick();
}

elements.fullscreen.addEventListener('click', toggleFullscreen);
elements.smaller.addEventListener('click', () => changeSize(-1));
elements.larger.addEventListener('click', () => changeSize(1));
elements.refresh.addEventListener('click', refreshSeed);
document.addEventListener('fullscreenchange', setFullscreenState);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleArtworkRotation(new Date());
});
window.addEventListener('resize', () => scheduleArtworkRotation(new Date(), false), { passive: true });
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key.toLowerCase() === 'f') void toggleFullscreen();
  if (event.key === '-' || event.key === '_') changeSize(-1);
  if (event.key === '+' || event.key === '=') changeSize(1);
  if (event.key.toLowerCase() === 'r') refreshSeed();
});

setFullscreenState();
void init();
