# MotionLab

A curated collection of standalone frontend animation & interaction experiments (CSS, SVG, Canvas, WebGL, and more).

## Preview Locally

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Then open `http://127.0.0.1:4173/` to browse the gallery, or open any effect directly under `effects/<slug>/`.

## Effects

| Effect | Tech | Path |
| --- | --- | --- |
| **Particle Orb** | WebGL 1 · Custom GLSL | [`effects/particle-orb/`](./effects/particle-orb/) |

## Adding a New Effect

1. Create a new folder under `effects/<effect-name>/` with a standalone `index.html` entry.
2. Add an entry to [`registry.js`](./registry.js) — it will automatically appear in the gallery.
