import { performance } from "node:perf_hooks";
import { Texture } from "pixi.js";
import { createCanvasRenderer } from "../../src/render/canvas";
import { createTileScene } from "../../src/render/pixi/scene";
import type { AssetResolver } from "../../src/render/assets";
import type { TextureProvider } from "../../src/render/pixi/textures";
import type { Frame } from "../../src/view/viewstate";

/**
 * Dev-only synthetic stress harness (SDD "animations-lighting" WU1b, spec
 * "Measurable Bundle and Performance Impact"). Validates the proposal's
 * UNVALIDATED premise — that Pixi's retained-mode scene graph out-performs
 * Canvas 2D's immediate-mode redraw once tile/entity counts reach the
 * "hundreds" range — using a synthetic tile grid at increasing sizes.
 *
 * Run with: `node --import tsx tools/bench/scene-stress.ts`
 *
 * Scope/limitations (read before trusting the numbers):
 * - GL-free by design: both renderers run against a no-op sink (a `Proxy`
 *   standing in for `CanvasRenderingContext2D`, and the real `TextureProvider`
 *   returning `Texture.EMPTY` so no texture upload happens). This measures
 *   each renderer's JS-side per-frame overhead (iteration, property writes,
 *   object lookups) — NOT actual GPU paint/compositing time, which needs a
 *   real canvas/GPU and is out of reach for a bare `node --test` process.
 *   The premise under test (retained-mode reconcile vs immediate-mode
 *   redraw) is exactly the JS-side cost this isolates.
 * - Only the tile-terrain path is exercised (`entities: []`, `selection:
 *   null`, `busy: false`) — WU1a's Pixi scope. Entity/player/FX overhead
 *   (WU3-WU5) is not yet reconcilable and will need its own follow-up
 *   measurement once those land.
 * - "Steady state" here means the SAME tile identities frame over frame
 *   (only `clockMs` advances) — this is the common case during gameplay
 *   (tiles are static, only entities move) and is where Pixi's pooled-reuse
 *   design is expected to matter most; Canvas redraws every tile every
 *   frame regardless of whether anything changed.
 */

function noopAssets(): AssetResolver {
  return { resolve: () => ({ color: "#6a9a4f" }) };
}

function stubTextures(): TextureProvider {
  return {
    forColor: () => Texture.EMPTY,
    forRegion: () => Texture.EMPTY,
    forGlyph: () => Texture.EMPTY,
    destroy: () => {},
  };
}

function buildFrame(width: number, height: number): Frame {
  const tiles: Frame["tiles"] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({ x, y, terrain: "grass", walkable: true, tags: [], visibility: "visible" });
    }
  }
  return { zone: { width, height }, tiles, entities: [], clockMs: 0 };
}

/** Stands in for `CanvasRenderingContext2D` under bare Node: any method call
 * is a no-op, any property write is recorded then ignored, `canvas.width`/
 * `canvas.height` are pinned to a fixed viewport so `cameraOffset` gets real
 * numbers instead of `undefined`. This runs the REAL `createCanvasRenderer`
 * production code path (not a reimplementation) with paint cost stripped
 * out. */
function createNoopCanvasContext(viewport: { width: number; height: number }): CanvasRenderingContext2D {
  const canvas = { width: viewport.width, height: viewport.height };
  const store: Record<string, unknown> = { canvas };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  };
  return new Proxy(store, handler) as unknown as CanvasRenderingContext2D;
}

function timeRuns(label: string, frames: number, fn: () => void): number {
  for (let i = 0; i < 10; i++) fn(); // warm-up (JIT)
  const start = performance.now();
  for (let i = 0; i < frames; i++) fn();
  const elapsed = performance.now() - start;
  const perFrame = elapsed / frames;
  console.log(`  ${label.padEnd(38)} ${frames} frames in ${elapsed.toFixed(2)}ms -> ${perFrame.toFixed(4)}ms/frame`);
  return perFrame;
}

const FRAME_COUNT = 300;
const VIEWPORT = { width: 960, height: 720 };

function runScenario(width: number, height: number): void {
  const tileCount = width * height;
  console.log(`\n=== ${width}x${height} = ${tileCount} tiles ===`);
  const frame = buildFrame(width, height);

  const canvasRenderer = createCanvasRenderer(createNoopCanvasContext(VIEWPORT), noopAssets());
  const canvasMs = timeRuns("Canvas (immediate-mode redraw)", FRAME_COUNT, () =>
    canvasRenderer.render(frame, null, false),
  );

  const scene = createTileScene({ textures: stubTextures(), assets: noopAssets() });
  const pixiMs = timeRuns("Pixi (retained-mode reconcile)", FRAME_COUNT, () => scene.sync(frame));

  const ratio = canvasMs / pixiMs;
  console.log(`  ratio (canvas/pixi): ${ratio.toFixed(2)}x`);
}

runScenario(20, 20); // 400 tiles
runScenario(40, 30); // 1200 tiles — "hundreds" premise
runScenario(80, 60); // 4800 tiles — stress ceiling
