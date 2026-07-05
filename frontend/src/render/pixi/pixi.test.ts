import { test } from "node:test";
import assert from "node:assert/strict";
import { Texture } from "pixi.js";
import { createTileScene } from "./scene";
import type { TextureProvider } from "./textures";
import type { AssetResolver, SpriteRegion } from "../assets";
import type { Frame, Visibility } from "../../view/viewstate";
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

/** Single-tile frame with an explicit `visibility`, used by the fog-tint
 * assertions below (`frameWithTiles` always hardcodes "visible"). */
function frameWithVisibility(visibility: Visibility): Frame {
  const tiles: Frame["tiles"] = [{ x: 0, y: 0, terrain: "sand", walkable: true, tags: [], visibility }];
  return { zone: { width: 1, height: 1 }, tiles, entities: [], clockMs: 0 };
}

const STUB_REGION: SpriteRegion = {
  image: {} as CanvasImageSource,
  sx: 0,
  sy: 0,
  sw: 16,
  sh: 16,
};

/** Walks the prototype chain to find the accessor descriptor for `prop` —
 * Pixi's `Sprite`/`Container` mixins define `texture`/`tint` as accessors
 * somewhere on the chain, not necessarily as an own property of the
 * instance's immediate prototype. */
function findAccessorDescriptor(instance: object, prop: string): PropertyDescriptor {
  let proto: object | null = instance;
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    if (descriptor?.get || descriptor?.set) return descriptor;
    proto = Object.getPrototypeOf(proto);
  }
  throw new Error(`No accessor descriptor found for '${prop}' on the prototype chain`);
}

/** Instruments `prop` on `instance` to count writes, delegating every get/set
 * to the real accessor found on the prototype chain (see
 * `findAccessorDescriptor`) so the sprite keeps behaving exactly as Pixi
 * intends — this only observes how many times the setter actually fires. */
function countWrites(instance: object, prop: string): { count: () => number } {
  const real = findAccessorDescriptor(instance, prop);
  let writes = 0;
  Object.defineProperty(instance, prop, {
    configurable: true,
    get(): unknown {
      return real.get?.call(this);
    },
    set(value: unknown): void {
      writes++;
      real.set?.call(this, value);
    },
  });
  return { count: () => writes };
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

test("createTileScene draws a sprite region (forRegion) when the resolved visual has a .sprite", () => {
  const regionCalls: SpriteRegion[] = [];
  const colorCalls: string[] = [];
  const regionTexture = new Texture();
  const textures: TextureProvider = {
    forColor: (hex) => {
      colorCalls.push(hex);
      return Texture.EMPTY;
    },
    forRegion: (region) => {
      regionCalls.push(region);
      return regionTexture;
    },
    forGlyph: () => Texture.EMPTY,
    destroy: () => {},
  };
  const assets: AssetResolver = { resolve: () => ({ sprite: STUB_REGION }) };
  const scene = createTileScene({ textures, assets });
  scene.sync(frameWithTiles(1, 1));

  assert.deepEqual(regionCalls, [STUB_REGION]);
  assert.equal(colorCalls.length, 0);
  assert.equal(scene.container.children[0]?.texture, regionTexture);
});

test("createTileScene falls back to forColor when the resolved visual has no .sprite", () => {
  const regionCalls: SpriteRegion[] = [];
  const textures: TextureProvider = {
    forColor: () => Texture.EMPTY,
    forRegion: (region) => {
      regionCalls.push(region);
      return Texture.EMPTY;
    },
    forGlyph: () => Texture.EMPTY,
    destroy: () => {},
  };
  const scene = createTileScene({ textures, assets: stubAssets("#654321") });
  scene.sync(frameWithTiles(1, 1));

  assert.equal(regionCalls.length, 0);
});

test("createTileScene sets fog tint per tile visibility (visible/explored/unseen)", () => {
  const expectations: Array<[Visibility, number]> = [
    ["visible", 0xffffff],
    ["explored", 0x737373],
    ["unseen", 0x000000],
  ];
  for (const [visibility, tint] of expectations) {
    const scene = createTileScene({ textures: stubTextures(), assets: stubAssets() });
    scene.sync(frameWithVisibility(visibility));
    assert.equal(scene.container.children[0]?.tint, tint, `expected tint ${tint} for visibility ${visibility}`);
  }
});

test("createTileScene skips redundant .texture/.tint writes when the frame is unchanged", () => {
  const scene = createTileScene({ textures: stubTextures(), assets: stubAssets("#abcdef") });
  const frame = frameWithVisibility("explored");

  scene.sync(frame); // first sync: pool created, texture/tint necessarily written once
  const sprite = scene.container.children[0]!;
  const textureWrites = countWrites(sprite, "texture");
  const tintWrites = countWrites(sprite, "tint");

  scene.sync(frame); // same frame again: nothing changed, both writes must be skipped

  assert.equal(textureWrites.count(), 0);
  assert.equal(tintWrites.count(), 0);
});
