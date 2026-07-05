import { test } from "node:test";
import assert from "node:assert/strict";
import { Texture } from "pixi.js";
import { createTileScene } from "./scene";
import type { TextureProvider } from "./textures";
import type { AssetResolver } from "../assets";
import type { Frame } from "../../view/viewstate";
import { PX } from "../constants";

// `pixi.test.ts` runs under bare `node --test` (design.md D6 / spec "Test
// Coverage Without GPU Dependency"): NO `app.init()`, no real GL context, no
// jsdom. `createTileScene` is a pure reconciler over `Container`/`Sprite` —
// constructing those under Node works fine without a renderer (verified
// against pixi.js 8.19.0); only `Application.init()` needs a real
// canvas/GPU, and this test never touches it.

function stubTextures(): TextureProvider {
  return {
    forColor: () => Texture.EMPTY,
    forRegion: () => Texture.EMPTY,
    forGlyph: () => Texture.EMPTY,
    destroy: () => {},
  };
}

function stubAssets(color = "#123456"): AssetResolver {
  return { resolve: () => ({ color }) };
}

function frameWithTiles(width: number, height: number): Frame {
  const tiles: Frame["tiles"] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({ x, y, terrain: "sand", walkable: true, tags: [], visibility: "visible" });
    }
  }
  return { zone: { width, height }, tiles, entities: [], clockMs: 0 };
}

test("createTileScene builds one sprite per tile (tile pool = w*h)", () => {
  const scene = createTileScene({ textures: stubTextures(), assets: stubAssets() });
  scene.sync(frameWithTiles(4, 3));
  assert.equal(scene.container.children.length, 12);
});

test("createTileScene reuses pooled sprites across frames instead of duplicating them", () => {
  const scene = createTileScene({ textures: stubTextures(), assets: stubAssets() });
  const frame = frameWithTiles(4, 3);

  scene.sync(frame);
  scene.sync(frame); // second sync, same tiles: pool must be reused

  assert.equal(scene.container.children.length, 12);
});

test("createTileScene positions each tile sprite at tile-coordinate * PX", () => {
  const scene = createTileScene({ textures: stubTextures(), assets: stubAssets() });
  scene.sync(frameWithTiles(2, 2));

  const positions = scene.container.children
    .map((sprite) => ({ x: sprite.x, y: sprite.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  assert.deepEqual(positions, [
    { x: 0, y: 0 },
    { x: 0, y: PX },
    { x: PX, y: 0 },
    { x: PX, y: PX },
  ]);
});

test("createTileScene assigns a texture resolved via the injected TextureProvider/AssetResolver", () => {
  const resolvedColors: string[] = [];
  const textures: TextureProvider = {
    forColor: (hex) => {
      resolvedColors.push(hex);
      return Texture.EMPTY;
    },
    forRegion: () => Texture.EMPTY,
    forGlyph: () => Texture.EMPTY,
    destroy: () => {},
  };
  const scene = createTileScene({ textures, assets: stubAssets("#abcdef") });
  scene.sync(frameWithTiles(1, 1));

  assert.deepEqual(resolvedColors, ["#abcdef"]);
  assert.equal(scene.container.children[0]?.texture, Texture.EMPTY);
});
