import { performance } from "node:perf_hooks";
import { Texture } from "pixi.js";
import { createTileScene } from "../../src/render/pixi/scene";
import type { AssetResolver } from "../../src/render/assets";
import type { TextureProvider } from "../../src/render/pixi/textures";
import type { Frame } from "../../src/view/viewstate";

/**
 * Dev-only synthetic stress harness (SDD "animations-lighting" WU1b, spec
 * "Measurable Bundle and Performance Impact"). Originally compared Pixi's
 * retained-mode reconciler against the Canvas 2D renderer's immediate-mode
 * redraw (see `tools/bench/README.md` for that historical WU1b measurement
 * and the real-GPU sign-off recorded once Canvas and Pixi reached parity).
 * The Canvas comparison arm was dropped in WU7 when `render/canvas.ts` was
 * deleted (Pixi is now the only renderer) — this now measures Pixi's
 * JS-side per-frame reconcile cost alone, as a regression guard against
 * future `scene.ts` changes re-introducing redundant per-frame writes.
 *
 * Run with: `node --import tsx tools/bench/scene-stress.ts`
 *
 * Scope/limitations (read before trusting the numbers):
 * - GL-free by design: the scene runs against a stub `TextureProvider`
 *   returning `Texture.EMPTY` so no texture upload happens. This measures
 *   the reconciler's JS-side per-frame overhead (iteration, property writes,
 *   object lookups) — NOT actual GPU paint/compositing time, which needs a
 *   real canvas/GPU and is out of reach for a bare `node --test` process.
 * - Only the tile-terrain path is exercised (`entities: []`, `selection:
 *   null`, `busy: false`) — WU1a's original Pixi scope.
 * - "Steady state" here means the SAME tile identities frame over frame
 *   (only `clockMs` advances) — this is the common case during gameplay
 *   (tiles are static, only entities move), where Pixi's pooled-reuse
 *   design is expected to matter most.
 */

function noopAssets(): AssetResolver {
  return { resolve: () => ({ color: "#6a9a4f" }) };
}

function stubTextures(): TextureProvider {
  return {
    forColor: () => Texture.EMPTY,
    forRegion: () => Texture.EMPTY,
    forGlyph: () => Texture.EMPTY,
    forRing: () => Texture.EMPTY,
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

function runScenario(width: number, height: number): void {
  const tileCount = width * height;
  console.log(`\n=== ${width}x${height} = ${tileCount} tiles ===`);
  const frame = buildFrame(width, height);

  const scene = createTileScene({ textures: stubTextures(), assets: noopAssets() });
  timeRuns("Pixi (retained-mode reconcile)", FRAME_COUNT, () => scene.sync(frame));
}

runScenario(20, 20); // 400 tiles
runScenario(40, 30); // 1200 tiles — "hundreds" premise
runScenario(80, 60); // 4800 tiles — stress ceiling
