import { test } from "node:test";
import assert from "node:assert/strict";
import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { createEntityScene, createFxScene, createPlayerScene, createTileScene } from "./scene";
import type { TextureProvider } from "./textures";
import type { AssetResolver, SpriteRegion } from "../assets";
import type { Frame, RenderEntity, Visibility } from "../../view/viewstate";
import { PX, SCALE } from "../constants";

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
    forRing: () => Texture.EMPTY,
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

/** Entity-pool test frame (no tiles) — `createEntityScene.sync` never reads
 * `frame.tiles`, so it's fine to leave that empty for these tests. */
function frameWithEntities(entities: RenderEntity[]): Frame {
  return { zone: { width: 1, height: 1 }, tiles: [], entities, clockMs: 0 };
}

/** Builds a `RenderEntity` fixture with sane defaults (`visible`, tile
 * origin), overridable per test. */
function entity(overrides: Partial<RenderEntity> & Pick<RenderEntity, "id" | "kind" | "typeId">): RenderEntity {
  return { renderPos: { x: 0, y: 0 }, visibility: "visible", ...overrides };
}

/** Resolves every entity to a plain glyph fallback — enough for tests that
 * only care about pool add/remove/badge behavior, not asset resolution. */
function stubEntityAssets(): AssetResolver {
  return { resolve: () => ({ glyph: "❔", scale: 1 }) };
}

/** Sums children across the three ordered sub-containers (object/pile/item)
 * `createEntityScene` groups its pool into — the total live node count. */
function totalEntityNodes(scene: { container: Container }): number {
  return scene.container.children.reduce((sum, layer) => sum + (layer as Container).children.length, 0);
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
    forRing: () => Texture.EMPTY,
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
    forRing: () => Texture.EMPTY,
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
    forRing: () => Texture.EMPTY,
    destroy: () => {},
  };
  const scene = createTileScene({ textures, assets: stubAssets("#654321") });
  scene.sync(frameWithTiles(1, 1));

  assert.equal(regionCalls.length, 0);
});

test("createTileScene sets fog tint per tile visibility (visible/explored/unseen)", () => {
  // explored = 0x8c8c8c (WU6 fog-parity fix): the tint factor must be
  // `1 - overlayAlpha` (0.55, since canvas.ts's explored overlay is a
  // 45%-alpha black `source-over` fill), not the overlay's own alpha value.
  const expectations: Array<[Visibility, number]> = [
    ["visible", 0xffffff],
    ["explored", 0x8c8c8c],
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

// --- createEntityScene (WU3: object/item/pile entity pool) ---

test("createEntityScene creates one display node per new entity id", () => {
  const scene = createEntityScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(
    frameWithEntities([
      entity({ id: "a", kind: "object", typeId: "tree" }),
      entity({ id: "b", kind: "item", typeId: "bark" }),
    ]),
  );
  assert.equal(totalEntityNodes(scene), 2);
});

test("createEntityScene reuses pooled nodes across frames instead of duplicating them", () => {
  const scene = createEntityScene({ textures: stubTextures(), assets: stubEntityAssets() });
  const frame = frameWithEntities([entity({ id: "a", kind: "object", typeId: "tree" })]);

  scene.sync(frame);
  scene.sync(frame); // second sync, same entity: pool must be reused

  assert.equal(totalEntityNodes(scene), 1);
});

test("createEntityScene removes the display node once an id no longer appears in the frame", () => {
  const scene = createEntityScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "a", kind: "object", typeId: "tree" })]));
  assert.equal(totalEntityNodes(scene), 1);

  scene.sync(frameWithEntities([])); // "a" no longer present in the frame
  assert.equal(totalEntityNodes(scene), 0);
});

test("createEntityScene ignores player entities (WU4 scope, not WU3)", () => {
  const scene = createEntityScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "p", kind: "player", typeId: "player" })]));
  assert.equal(totalEntityNodes(scene), 0);
});

test("createEntityScene hides (not destroys) a node while the entity is 'unseen'", () => {
  const scene = createEntityScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "a", kind: "object", typeId: "tree", visibility: "visible" })]));
  scene.sync(frameWithEntities([entity({ id: "a", kind: "object", typeId: "tree", visibility: "unseen" })]));

  assert.equal(totalEntityNodes(scene), 1, "node stays pooled while unseen, not destroyed");
  const objectLayer = scene.container.children[0] as Container;
  const root = objectLayer.children[0] as Container;
  assert.equal(root.visible, false);
});

test("createEntityScene draws a sprite region (forRegion) when the resolved visual has a .sprite", () => {
  const regionCalls: SpriteRegion[] = [];
  const glyphCalls: string[] = [];
  const regionTexture = new Texture();
  const textures: TextureProvider = {
    forColor: () => Texture.EMPTY,
    forRegion: (region) => {
      regionCalls.push(region);
      return regionTexture;
    },
    forGlyph: (glyph) => {
      glyphCalls.push(glyph);
      return Texture.EMPTY;
    },
    forRing: () => Texture.EMPTY,
    destroy: () => {},
  };
  const assets: AssetResolver = { resolve: () => ({ sprite: STUB_REGION }) };
  const scene = createEntityScene({ textures, assets });
  scene.sync(frameWithEntities([entity({ id: "a", kind: "object", typeId: "tree" })]));

  assert.deepEqual(regionCalls, [STUB_REGION]);
  assert.equal(glyphCalls.length, 0);
});

test("createEntityScene falls back to forGlyph when the resolved visual has no .sprite", () => {
  const regionCalls: SpriteRegion[] = [];
  const glyphCalls: string[] = [];
  const textures: TextureProvider = {
    forColor: () => Texture.EMPTY,
    forRegion: (region) => {
      regionCalls.push(region);
      return Texture.EMPTY;
    },
    forGlyph: (glyph) => {
      glyphCalls.push(glyph);
      return Texture.EMPTY;
    },
    forRing: () => Texture.EMPTY,
    destroy: () => {},
  };
  const assets: AssetResolver = { resolve: () => ({ glyph: "🌳", scale: 0.72 }) };
  const scene = createEntityScene({ textures, assets });
  scene.sync(frameWithEntities([entity({ id: "a", kind: "object", typeId: "tree" })]));

  assert.equal(regionCalls.length, 0);
  assert.deepEqual(glyphCalls, ["🌳"]);

  const objectLayer = scene.container.children[0] as Container;
  const root = objectLayer.children[0] as Container;
  const sprite = root.children[0] as Sprite;
  assert.equal(sprite.width, PX * 0.72);
  assert.equal(sprite.height, PX * 0.72);
  assert.deepEqual([sprite.anchor.x, sprite.anchor.y], [0.5, 0.5]);
});

test("createEntityScene sizes a sprite-region entity via the region's OWN sw/sh * SCALE, not visual.scale (regression: a tall multi-cell sprite must keep its full height, bottom-left anchored)", () => {
  const tallRegion: SpriteRegion = { image: {} as CanvasImageSource, sx: 0, sy: 0, sw: 48, sh: 96 };
  const regionTexture = new Texture();
  const textures: TextureProvider = {
    forColor: () => Texture.EMPTY,
    forRegion: () => regionTexture,
    forGlyph: () => Texture.EMPTY,
    forRing: () => Texture.EMPTY,
    destroy: () => {},
  };
  // `scale` deliberately present alongside `.sprite` — a sprite-backed visual
  // never has `.scale` in real `createSpriteAssets` output, but if a bug
  // resurfaces and this field ever gets read for the sprite path, this
  // fixture ensures the test catches it (it MUST be ignored here).
  const assets: AssetResolver = { resolve: () => ({ sprite: tallRegion, scale: 0.1 }) };
  const scene = createEntityScene({ textures, assets });
  scene.sync(frameWithEntities([entity({ id: "a", kind: "object", typeId: "tree" })]));

  const objectLayer = scene.container.children[0] as Container;
  const root = objectLayer.children[0] as Container;
  const sprite = root.children[0] as Sprite;
  assert.equal(sprite.width, tallRegion.sw * SCALE);
  assert.equal(sprite.height, tallRegion.sh * SCALE);
  assert.deepEqual([sprite.anchor.x, sprite.anchor.y], [0, 1]);
  assert.equal(sprite.x, 0);
  assert.equal(sprite.y, PX);
});

test("createEntityScene shows and updates a pile-count badge, reconciled by id", () => {
  const scene = createEntityScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "pile1", kind: "pile", typeId: "small_stone", count: 3 })]));

  const pileLayer = scene.container.children[1] as Container; // object, PILE, item
  const root = pileLayer.children[0] as Container;
  const badge = root.children.find((child) => child instanceof Text) as Text;
  assert.ok(badge, "expected a Text badge child under the pile's node");
  assert.equal(badge.text, "×3");

  scene.sync(frameWithEntities([entity({ id: "pile1", kind: "pile", typeId: "small_stone", count: 5 })]));
  assert.equal(root.children.filter((child) => child instanceof Text).length, 1, "badge reused, not duplicated");
  assert.equal(badge.text, "×5");
});

test("createEntityScene removes the pile badge once count is no longer defined", () => {
  const scene = createEntityScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "pile1", kind: "pile", typeId: "small_stone", count: 2 })]));
  scene.sync(frameWithEntities([entity({ id: "pile1", kind: "pile", typeId: "small_stone", count: undefined })]));

  const pileLayer = scene.container.children[1] as Container;
  const root = pileLayer.children[0] as Container;
  assert.equal(root.children.filter((child) => child instanceof Text).length, 0);
});

test("createEntityScene skips redundant .texture writes when the frame is unchanged", () => {
  const regionTexture = new Texture();
  const textures: TextureProvider = {
    forColor: () => Texture.EMPTY,
    forRegion: () => regionTexture,
    forGlyph: () => Texture.EMPTY,
    forRing: () => Texture.EMPTY,
    destroy: () => {},
  };
  const assets: AssetResolver = { resolve: () => ({ sprite: STUB_REGION }) };
  const scene = createEntityScene({ textures, assets });
  const frame = frameWithEntities([entity({ id: "a", kind: "object", typeId: "tree" })]);

  scene.sync(frame); // first sync: node created, texture necessarily written once
  const objectLayer = scene.container.children[0] as Container;
  const root = objectLayer.children[0] as Container;
  const sprite = root.children[0] as Sprite;
  const textureWrites = countWrites(sprite, "texture");

  scene.sync(frame); // same frame again: texture unchanged, write must be skipped
  assert.equal(textureWrites.count(), 0);
});

// --- createPlayerScene (WU4: player halo + sprite) ---

test("createPlayerScene creates one node for the player entity, with a halo Graphics under the sprite", () => {
  const scene = createPlayerScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "p", kind: "player", typeId: "player" })]));

  assert.equal(scene.container.children.length, 1, "one player node");
  const root = scene.container.children[0] as Container;
  assert.equal(root.children.length, 2, "halo + sprite");
  assert.ok(root.children[0] instanceof Graphics, "first child is the halo Graphics");
  assert.ok(root.children[1] instanceof Sprite, "second child is the sprite");
});

test("createPlayerScene z-orders the halo behind the sprite (halo added first, sprite painted on top)", () => {
  const scene = createPlayerScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "p", kind: "player", typeId: "player" })]));

  const root = scene.container.children[0] as Container;
  const haloIndex = root.children.findIndex((child) => child instanceof Graphics);
  const spriteIndex = root.children.findIndex((child) => child instanceof Sprite);
  assert.ok(haloIndex < spriteIndex, "halo must come before the sprite in child order (paints below it)");
});

test("createPlayerScene reuses the pooled node across frames instead of duplicating it", () => {
  const scene = createPlayerScene({ textures: stubTextures(), assets: stubEntityAssets() });
  const frame = frameWithEntities([entity({ id: "p", kind: "player", typeId: "player" })]);

  scene.sync(frame);
  scene.sync(frame); // second sync, same player: pool must be reused

  assert.equal(scene.container.children.length, 1);
});

test("createPlayerScene positions the player node at renderPos * PX", () => {
  const scene = createPlayerScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "p", kind: "player", typeId: "player", renderPos: { x: 2, y: 3 } })]));

  const root = scene.container.children[0] as Container;
  assert.equal(root.x, 2 * PX);
  assert.equal(root.y, 3 * PX);
});

test("createPlayerScene NEVER fog-culls the player — stays visible while 'unseen' (canvas.ts: player's own position was never fog-culled)", () => {
  const scene = createPlayerScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "p", kind: "player", typeId: "player", visibility: "unseen" })]));

  const root = scene.container.children[0] as Container;
  assert.equal(root.visible, true, "player must stay visible even while its tile is unseen");
});

test("createPlayerScene destroys the node once the player id no longer appears in the frame", () => {
  const scene = createPlayerScene({ textures: stubTextures(), assets: stubEntityAssets() });
  scene.sync(frameWithEntities([entity({ id: "p", kind: "player", typeId: "player" })]));
  assert.equal(scene.container.children.length, 1);

  scene.sync(frameWithEntities([]));
  assert.equal(scene.container.children.length, 0);
});

test("createPlayerScene draws a sprite region (forRegion) when the resolved visual has a .sprite, sized via the region's own sw/sh * SCALE", () => {
  const regionTexture = new Texture();
  const textures: TextureProvider = {
    forColor: () => Texture.EMPTY,
    forRegion: () => regionTexture,
    forGlyph: () => Texture.EMPTY,
    forRing: () => Texture.EMPTY,
    destroy: () => {},
  };
  const assets: AssetResolver = { resolve: () => ({ sprite: STUB_REGION }) };
  const scene = createPlayerScene({ textures, assets });
  scene.sync(frameWithEntities([entity({ id: "p", kind: "player", typeId: "player" })]));

  const root = scene.container.children[0] as Container;
  const sprite = root.children[1] as Sprite;
  assert.equal(sprite.texture, regionTexture);
  assert.equal(sprite.width, STUB_REGION.sw * SCALE);
  assert.equal(sprite.height, STUB_REGION.sh * SCALE);
  assert.deepEqual([sprite.anchor.x, sprite.anchor.y], [0, 1]);
});

test("createPlayerScene falls back to forGlyph when the resolved visual has no .sprite", () => {
  const glyphCalls: string[] = [];
  const textures: TextureProvider = {
    forColor: () => Texture.EMPTY,
    forRegion: () => Texture.EMPTY,
    forGlyph: (glyph) => {
      glyphCalls.push(glyph);
      return Texture.EMPTY;
    },
    forRing: () => Texture.EMPTY,
    destroy: () => {},
  };
  const assets: AssetResolver = { resolve: () => ({ glyph: "🧍", scale: 0.82 }) };
  const scene = createPlayerScene({ textures, assets });
  scene.sync(frameWithEntities([entity({ id: "p", kind: "player", typeId: "player" })]));

  assert.deepEqual(glyphCalls, ["🧍"]);
  const root = scene.container.children[0] as Container;
  const sprite = root.children[1] as Sprite;
  assert.equal(sprite.width, PX * 0.82);
  assert.equal(sprite.height, PX * 0.82);
  assert.deepEqual([sprite.anchor.x, sprite.anchor.y], [0.5, 0.5]);
});

// --- createFxScene (WU5: selection pulse + busy spinner) ---

/** `createFxScene` only needs `frame.entities`/`frame.clockMs` (no tiles),
 * plus the `selection`/`busy` args `Renderer.render` receives alongside the
 * frame — mirrors `frameWithEntities` but lets `clockMs` vary per test. */
function frameForFx(clockMs: number, entities: RenderEntity[] = []): Frame {
  return { zone: { width: 1, height: 1 }, tiles: [], entities, clockMs };
}

test("createFxScene shows the selection ring when a selection is set, hidden when null", () => {
  const scene = createFxScene({ textures: stubTextures() });

  scene.sync(frameForFx(0), { x: 2, y: 3 }, false);
  const ring = scene.container.children[0] as Graphics;
  assert.equal(ring.visible, true, "ring shown while a selection is set");
  assert.equal(ring.x, 2 * PX);
  assert.equal(ring.y, 3 * PX);

  scene.sync(frameForFx(0), null, false);
  assert.equal(ring.visible, false, "ring hidden once selection is cleared");
});

test("createFxScene pulses the selection ring alpha via the formula 0.7 + 0.3*sin(clockMs/260)", () => {
  const scene = createFxScene({ textures: stubTextures() });
  const ring = scene.container.children[0] as Graphics;

  for (const clockMs of [0, 130, 260, 1000]) {
    scene.sync(frameForFx(clockMs), { x: 0, y: 0 }, false);
    const expected = 0.7 + 0.3 * Math.sin(clockMs / 260);
    assert.ok(Math.abs(ring.alpha - expected) < 1e-9, `alpha at clockMs=${clockMs}`);
  }
});

test("createFxScene freezes the selection ring to a static, fully-opaque alpha under reduced motion", () => {
  const scene = createFxScene({ textures: stubTextures(), reducedMotion: () => true });
  const ring = scene.container.children[0] as Graphics;

  scene.sync(frameForFx(130), { x: 0, y: 0 }, false);
  assert.equal(ring.alpha, 1, "reduced motion freezes the pulse to a static, fully-opaque ring");
});

test("createFxScene shows the busy spinner over the player's head only while busy is true and a player exists", () => {
  const scene = createFxScene({ textures: stubTextures() });
  const spinner = scene.container.children[1] as Sprite;
  const player = entity({ id: "p", kind: "player", typeId: "player", renderPos: { x: 4, y: 5 } });

  scene.sync(frameForFx(0, [player]), null, true);
  assert.equal(spinner.visible, true, "spinner shown while busy and a player is present");
  assert.equal(spinner.x, 4 * PX + PX / 2);
  assert.equal(spinner.y, 5 * PX - PX * 0.08);

  scene.sync(frameForFx(0, [player]), null, false);
  assert.equal(spinner.visible, false, "spinner hidden once busy goes false");

  scene.sync(frameForFx(0, []), null, true);
  assert.equal(spinner.visible, false, "spinner hidden when busy but no player entity exists in the frame");
});

test("createFxScene rotates the busy spinner per frame under normal motion via the formula (clockMs/140) % (2*PI)", () => {
  const scene = createFxScene({ textures: stubTextures() });
  const spinner = scene.container.children[1] as Sprite;
  const player = entity({ id: "p", kind: "player", typeId: "player" });

  for (const clockMs of [0, 70, 140, 1000]) {
    scene.sync(frameForFx(clockMs, [player]), null, true);
    const expected = (clockMs / 140) % (Math.PI * 2);
    assert.ok(Math.abs(spinner.rotation - expected) < 1e-9, `rotation at clockMs=${clockMs}`);
  }
});

test("createFxScene freezes the busy spinner to a fixed (non-rotating) orientation under reduced motion", () => {
  const scene = createFxScene({ textures: stubTextures(), reducedMotion: () => true });
  const spinner = scene.container.children[1] as Sprite;
  const player = entity({ id: "p", kind: "player", typeId: "player" });

  scene.sync(frameForFx(700, [player]), null, true);
  assert.equal(spinner.rotation, 0, "reduced motion freezes the spinner's rotation");
});
