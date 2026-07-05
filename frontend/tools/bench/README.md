# WU1b measurements (animations-lighting)

Committed artifact satisfying spec "Measurable Bundle and Performance Impact"
(`sdd/animations-lighting`). Real numbers, measured on this machine on
2026-07-05 — re-run and update if the dependency or hardware changes.

## 1. Bundle-size delta (`vite build`, gzip)

Compared two builds of `frontend/`:

- **Baseline** — commit `b300a5a` (WU0, before `pixi.js` was added), built in
  an isolated `git worktree` so the current tree was never touched.
- **Current** — this tree (WU1a, `pixi.js@^8.19.0` added as a dependency).

| | Baseline (no Pixi) | Current (with Pixi) | Delta |
|---|---|---|---|
| JS raw | 51.87 kB (1 chunk) | 536.73 kB (12 chunks) | **+484.86 kB** |
| JS gzip | 17.66 kB | 161.87 kB | **+144.21 kB** |

Pixi splits itself into several chunks at build time (`WebGLRenderer`,
`WebGPURenderer`, `CanvasRenderer`, `Geometry`, `browserAll`, etc. — Pixi
internally dynamic-imports per-backend code) rather than landing as one
monolithic file, but none of that is lazy relative to page load: **the
`pixi.js` import in `game/game.ts` is a static top-level import**, so every
one of those chunks downloads for every visitor today, Canvas-default users
included — the `?renderer=pixi` flag does not currently gate the network
cost, only which renderer runs. This is a real finding, not a measurement
artifact: a follow-up (dynamic `import()` of `render/pixi/renderer.ts` behind
the flag check in `game.ts`, resolved only when `?renderer=pixi` is present)
would let Canvas-default users skip this ~144 kB gzip entirely. Not fixed in
WU1b (out of this work unit's scope) — flagged for WU7 (or earlier) as a
recommended follow-up.

Reproduce: `git worktree add <dir> b300a5a && cd <dir>/frontend && pnpm install && pnpm build`
vs `cd frontend && pnpm build`, compare the `vite build` chunk table.

## 2. Synthetic stress benchmark (`scene-stress.ts`)

Run: `node --import tsx tools/bench/scene-stress.ts`

Isolates each renderer's JS-side per-frame overhead only (see the file's
header comment for the full scope/limitations) — real GPU paint/compositing
cost is stripped from both sides (no-op Canvas 2D context sink; Pixi
`TextureProvider` returns `Texture.EMPTY`, no texture upload). Only the
tile-terrain path is exercised (WU1a's Pixi scope; `entities: []`).

Measured results (300 frames per scenario, this machine):

| Tiles | Canvas ms/frame | Pixi ms/frame | Ratio (canvas/pixi) |
|---|---|---|---|
| 400 (20×20) | 0.0449 | 0.0598 | 0.75× |
| 1,200 (40×30) | 0.1128 | 0.1209 | 0.93× |
| 4,800 (80×60) | 0.3948 | 0.4685 | 0.84× |

**Finding: in this GL-free, JS-only comparison, Pixi's retained-mode
reconciler is NOT faster than the no-op Canvas path — it's consistently
~7-33% slower.** Root cause: `scene.ts`'s `sync()` unconditionally writes
`sprite.texture = ...` every frame for every tile regardless of whether the
value actually changed, so at the JS level it currently does the same
"touch every tile every frame" work as Canvas's immediate-mode redraw, plus
Pixi `Sprite` texture-setter overhead (bounds/dirty-flag bookkeeping) that a
raw `fillRect` no-op doesn't pay. This does **not** by itself validate or
invalidate the "hundreds of entities" premise — it only shows the premise's
expected win (avoiding redundant GPU-side re-paint) can't be measured
without a real GPU, and that the current reconciler leaves an easy
optimization on the table (skip the texture write when the resolved texture
is unchanged from last frame). Recommended follow-ups, not done here:
- A real-browser rAF measurement (Canvas vs Pixi, both with real GPU
  painting) once WU3 wires actual entities — the number that actually
  answers the proposal's premise.
- Skip redundant `sprite.texture =` writes in `scene.ts::sync` when the
  same texture is already set (WU2/WU3 optimization candidate).

## 3. Emoji/text-in-Pixi spike (design.md D3)

**Decision: Plan A** — bake one `PIXI.Text` per glyph using the same font
stack `render/canvas.ts` uses for `drawEmoji`
(`"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif"`).

Evidence: a real-browser spike (headless Chromium, swiftshare GL, this
machine has `Noto Color Emoji` installed) rendered five of the project's
actual glyphs (🌳 🪨 🪓 🧍 🪙) via `PIXI.Text` side-by-side with the same
glyphs drawn on a plain 2D `fillText` reference. The screenshot showed both
renderings visually identical — full color fidelity (tree green, rock gray,
axe red/wood, player skin/clothing tones, coin gold), no monochrome/tofu
fallback. `PIXI.Text` uses an internal 2D canvas to rasterize its text
texture, which is exactly why it inherits the same color-emoji rendering
path the Canvas renderer already relies on — there was no reason to expect
otherwise, and the spike confirms it for this specific font stack. Plan B
(pre-rasterized offscreen glyph atlas) is NOT needed.

The spike itself (a throwaway `emoji-spike.html` + entry module, not
committed) is not part of this tree — only this decision + evidence record
is. `TextureProvider.forGlyph` stays a WU3-scoped stub per the tasks
artifact; this spike only de-risks that implementation's approach ahead of
time.
