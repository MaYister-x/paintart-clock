# Paintart Clock

A no-build, pure HTML/CSS/JavaScript wallpaper clock backed by a curated manifest of public-domain artworks from The Metropolitan Museum of Art.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Check

```bash
npm run check
```

## Controls

- `F`: toggle fullscreen
- `-` / `+`: change clock size
- `R`: create and persist a new artwork sequence seed

The artwork changes deterministically at each local-hour boundary. The current seed and size are stored in `localStorage`.

## Data and rights

`data/artworks.json` contains only records whose Met Open Access API response reported `isPublicDomain: true` and included a high-resolution primary image. Each item preserves its museum source URL and credit line.

## GitHub Pages

Publish directly from the `main` branch and repository root; no build action is required.
