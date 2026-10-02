# Sirocco

A one-shot desert study in the browser: transverse sand dunes, a low sun, wind-blown grains, and heat haze. The camera flies a slow path across the erg. Nothing here calls a paid API or loads a texture from the network. The dunes, sky, dust, and grade are all generated on the GPU.

Inspired by the sand study in [this clip](https://x.com/ItsmeAjayKV/status/2100338442794340470).

## Look

- Asymmetric dunes. A long windward slope, a crest, and a steep slip face, warped so the ridges curve instead of repeating like a sine wave.
- The sun sits low in the west and only the faces turned toward it take the full light. Crests throw ray-marched shadows across the next trough.
- Grains stream with the wind and ride just above the sand. Saltation stays low. A thinner veil hangs higher.
- Heat haze bends the horizon, with a little color fringing. Bloom and a short god-ray pass sit on the sun.
- The default camera is a loop of low glides and one higher reveal. Drag to look around, scroll to move in and out, double-click (or press `C`) to rejoin the path.

Wind comes from about 248°, toward the slip faces.

## Run

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Controls

| Input | Action |
| --- | --- |
| Drag | Free look |
| Scroll / pinch | Dolly |
| Double-click or `C` | Toggle cinematic path |
| `H` | Hide the interface |
| `M` | Wind audio (synthesized, off by default) |
| Hour, Wind, Haze | Time of day, gust strength, mirage |

Hour is the whole lever for the light. Late afternoon (around 17:40) is the intended frame. Midday is harder and cooler. The audio button stays muted until you ask for it.

Add `?t=30` to open partway through the flyover (seconds).

## Stack

Vite, TypeScript, and Three.js. The page is a static build, so Vercel serves `dist` with no server code.
