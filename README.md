# Paintart Clock

A digital clock on a wall of public-domain paintings. The artwork changes every hour, the
typeface changes with the painting, and the whole thing is static files served from GitHub
Pages.

**Live: https://mayister-x.github.io/paintart-clock/**

Open it fullscreen on a spare monitor, a tablet, or an old phone and it works as a
wallpaper. No build step, no dependencies at runtime, no tracking, no API calls from the
browser except the images themselves.

## How it works

```
data/artworks.json   40 public-domain paintings, pre-verified at build time
lib/schedule.js      (seed, hour) -> which painting
lib/mood.js          painting metadata -> which typeface
lib/clock.js         the time, as four animatable digit slots
app.js               moves those answers into the DOM
```

Everything interesting is a pure function, which is why the logic is tested without a
browser and the page itself stays thin.

### The painting is chosen, not shuffled

`pickIndex(seed, slotKey, count)` hashes the seed together with the current local hour and
takes the remainder. Same seed, same hour, same painting — so a reload never reshuffles
the wallpaper, and two devices holding the same seed show the same thing.

The slot key includes the viewer's UTC offset. Without it, a daylight-saving fall-back
would repeat the same local hour and the painting would silently hold for two hours.

The refresh button draws a new seed and stores it. It keeps drawing until the new seed
resolves to a *different* painting: a blind redraw lands on the same one about 1 time in
40, which reads as a broken button.

### The typeface follows the painting

`lib/mood.js` scores six moods against the artwork's own metadata and the winner supplies
the font. Three signals, ranked strictly:

| Signal | Weight | Why |
|---|---|---|
| culture | 6 | An East Asian ink painting is one whatever century it is from. |
| subject | 2 each, 2 max | Title, tags and medium. Capped at 4 so a padded tag list cannot outvote culture. |
| era | 3 | Reliable, but a century band says less about a painting than its subject. |

| Mood | Typeface |
|---|---|
| East Asian ink | Noto Serif JP |
| Gothic and Renaissance gold | Cinzel |
| Baroque and neoclassical | Bodoni Moda |
| Romantic landscape | Cormorant Garamond |
| Impressionist light | Playfair Display |
| Modernist geometry | Space Grotesk |

The museum's `department` field is deliberately excluded. It is a filing category, not a
property of the painting — "Modern European Painting and Sculpture" houses Monet, and
letting that string vote would file impressionism as modernism.

All six faces are loaded from Google Fonts subset to `0123456789:`, so the whole set costs
less than one full face and switching between paintings is instant.

## Controls

| Button | Key | What it does |
|---|---|---|
| − / + | `-` / `+` | Six clock sizes, from *quiet* to *wall*. Persists. |
| ↻ | `R` | New seed: a different painting now and a different sequence from here on. Persists. |
| ⛶ | `F` | Fullscreen. |

Both preferences live in `localStorage`. Nothing else is stored, and nothing leaves the
browser.

## Animation

Seconds pulse on the colon and the seconds counter, never on the hour and minute digits —
a pulse under a digit that is also sliding reads as a stutter. Minute changes slide only
the digits that actually changed, so `14:38 → 14:39` moves one digit and `14:59 → 15:00`
moves three.

Under `prefers-reduced-motion: reduce` the digits still change; they just stop moving.

## The catalog

`data/artworks.json` is built from two key-free open-access APIs:

- **The Metropolitan Museum of Art** — records flagged `isPublicDomain`
- **Cleveland Museum of Art** — records flagged `CC0`

Every image URL is fetched at build time before it lands in the file, so a dead link never
ships. Queries spread across departments and eras deliberately: the current catalog runs
from 740 CE to 1927 and spans East Asian, European and American work, because a catalog
built from one gallery's highlights is forty variations on the same painting.

The Art Institute of Chicago was evaluated and dropped — its IIIF image host was not
reachable from the build environment, and unverified images are not shipped.

Rebuilding is a manual step, not part of the page load:

```sh
npm run build:catalog   # re-fetch from the museum APIs
npm run check           # validate the catalog, then run the tests
```

`build-catalog.mjs` refuses to write a file with fewer than 30 verified artworks, and
`validate-catalog.mjs` gates on schema, https-only URLs, duplicate works, a two-per-artist
cap, and whether every record carries enough metadata for a mood to be chosen.

## Development

```sh
npm test                # node --test, no dependencies
npm run validate:catalog
npm run serve           # http://localhost:8080
```

There is no build step. `index.html` loads ES modules directly; what is in the repository
is what the browser runs.

## Deployment

GitHub Pages serves `main` from the repository root. Pushing to `main` publishes.
`.nojekyll` skips the Jekyll pass, since nothing here needs it.

## Attribution and licence

The code is MIT (see `LICENSE`).

The paintings are not covered by that licence and do not need to be: every work in the
catalog is public domain or CC0 as published by the holding museum. Each record keeps its
title, artist, date, credit line and a link back to the museum's own page, and the page
shows them under the clock.
