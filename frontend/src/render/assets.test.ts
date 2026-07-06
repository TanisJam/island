import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmojiAssets, createSpriteAssets, lookupRegion, parseAtlas, type Atlas } from "./assets";

test("object: campfire lit=true resolves to the fire glyph", () => {
  const assets = createEmojiAssets();
  assert.equal(assets.resolve("object", "campfire", { lit: true }).glyph, "🔥");
});

test("object: campfire lit=false (or missing state) resolves to the log glyph", () => {
  const assets = createEmojiAssets();
  assert.equal(assets.resolve("object", "campfire", { lit: false }).glyph, "🪵");
  assert.equal(assets.resolve("object", "campfire").glyph, "🪵");
});

test("object: known typeId resolves to its catalog glyph", () => {
  const assets = createEmojiAssets();
  assert.equal(assets.resolve("object", "tree").glyph, "🌳");
});

test("object: unknown typeId falls back to the unknown glyph", () => {
  const assets = createEmojiAssets();
  assert.equal(assets.resolve("object", "made_up_object_type").glyph, "❔");
});

test("item: known typeId resolves to its catalog glyph", () => {
  const assets = createEmojiAssets();
  assert.equal(assets.resolve("item", "small_stone").glyph, "🪨");
});

test("item: unknown typeId falls back to the unknown glyph", () => {
  const assets = createEmojiAssets();
  assert.equal(assets.resolve("item", "made_up_item_type").glyph, "❔");
});

test("terrain: known terrain resolves to its color; unknown falls back to the default color", () => {
  const assets = createEmojiAssets();
  assert.equal(assets.resolve("terrain", "grass").color, "#6a9a4f");
  assert.equal(assets.resolve("terrain", "lava").color, "#444");
});

test("pile and player resolve to their fixed glyphs regardless of typeId", () => {
  const assets = createEmojiAssets();
  assert.equal(assets.resolve("pile", "small_stone").glyph, "🪙");
  assert.equal(assets.resolve("player", "player").glyph, "🧍");
});

// --- parseAtlas / lookupRegion (design.md "Testability hooks") -----------

function fixtureAtlas(): Atlas {
  return {
    image: "tileset.png",
    tile: 16,
    terrain: { sand: { x: 0, y: 0, w: 16, h: 16 } },
    object: { tree: { x: 16, y: 0, w: 16, h: 32, frames: 1 } },
    item: { simple_axe: { x: 0, y: 32, w: 16, h: 16 } },
    player: { player: { x: 48, y: 0, w: 16, h: 24 } },
  };
}

test("parseAtlas: a well-formed payload round-trips unchanged", () => {
  const raw = fixtureAtlas();
  const atlas = parseAtlas(raw);
  assert.deepEqual(atlas, raw);
});

test("parseAtlas: throws on a non-object root", () => {
  assert.throws(() => parseAtlas(null));
  assert.throws(() => parseAtlas("not an atlas"));
});

test("parseAtlas: throws when 'image' or 'tile' is missing or the wrong type", () => {
  assert.throws(() => parseAtlas({ tile: 16 }));
  assert.throws(() => parseAtlas({ image: "tileset.png" }));
  assert.throws(() => parseAtlas({ image: 123, tile: 16 }));
  assert.throws(() => parseAtlas({ image: "tileset.png", tile: "16" }));
});

test("parseAtlas: throws when a per-kind key is present but not an object", () => {
  assert.throws(() => parseAtlas({ image: "tileset.png", tile: 16, terrain: "sand" }));
});

test("parseAtlas: throws when a region entry has a non-numeric x/y/w/h (batch-2 gate review fix)", () => {
  assert.throws(() => parseAtlas({ image: "tileset.png", tile: 16, terrain: { sand: { x: "0", y: 0, w: 16, h: 16 } } }));
  assert.throws(() => parseAtlas({ image: "tileset.png", tile: 16, object: { tree: { x: 0, y: 0, w: 16 } } }));
  assert.throws(() => parseAtlas({ image: "tileset.png", tile: 16, item: { potion: null } }));
});

test("lookupRegion: resolves a mapped terrain typeId (sand)", () => {
  const atlas = fixtureAtlas();
  assert.deepEqual(lookupRegion(atlas, "terrain", "sand"), { x: 0, y: 0, w: 16, h: 16 });
});

test("lookupRegion: returns null for an unmapped typeId", () => {
  const atlas = fixtureAtlas();
  assert.equal(lookupRegion(atlas, "terrain", "lava"), null);
  assert.equal(lookupRegion(atlas, "object", "unmapped_object"), null);
});

// --- createSpriteAssets (spec "createSpriteAssets implements AssetResolver unchanged") ---

const FAKE_IMAGE = {} as CanvasImageSource;

test("createSpriteAssets: mapped entity (object) resolves to a sprite region, not a glyph", () => {
  const assets = createSpriteAssets(fixtureAtlas(), FAKE_IMAGE);
  const visual = assets.resolve("object", "tree");
  assert.deepEqual(visual.sprite, { image: FAKE_IMAGE, sx: 16, sy: 0, sw: 16, sh: 32 });
  assert.equal(visual.glyph, undefined);
});

test("createSpriteAssets: mapped terrain (sand) resolves to a sprite region with .color undefined — the silent-failure risk the design flagged", () => {
  const assets = createSpriteAssets(fixtureAtlas(), FAKE_IMAGE);
  const visual = assets.resolve("terrain", "sand");
  assert.deepEqual(visual.sprite, { image: FAKE_IMAGE, sx: 0, sy: 0, sw: 16, sh: 16 });
  assert.equal(visual.color, undefined);
});

test("createSpriteAssets: unmapped entity typeId delegates to the emoji resolver — identical glyph, no sprite", () => {
  const spriteAssets = createSpriteAssets(fixtureAtlas(), FAKE_IMAGE);
  const emojiAssets = createEmojiAssets();
  const visual = spriteAssets.resolve("object", "made_up_object_type");
  assert.equal(visual.glyph, emojiAssets.resolve("object", "made_up_object_type").glyph);
  assert.equal(visual.sprite, undefined);
});

test("createSpriteAssets: unmapped terrain typeId delegates to the emoji resolver — returns .color, no sprite", () => {
  const spriteAssets = createSpriteAssets(fixtureAtlas(), FAKE_IMAGE);
  const visual = spriteAssets.resolve("terrain", "lava");
  assert.equal(visual.color, "#444");
  assert.equal(visual.sprite, undefined);
});

test("createSpriteAssets: pile always delegates to the emoji resolver — atlas has no pile kind", () => {
  const assets = createSpriteAssets(fixtureAtlas(), FAKE_IMAGE);
  assert.equal(assets.resolve("pile", "small_stone").glyph, "🪙");
});

test("createSpriteAssets: campfire state (lit/unlit) still resolves via the wrapped emoji resolver when unmapped", () => {
  const assets = createSpriteAssets(fixtureAtlas(), FAKE_IMAGE);
  assert.equal(assets.resolve("object", "campfire", { lit: true }).glyph, "🔥");
});

// --- Light seam (design.md D3 / spec "Campfire Light Emission",
// "Bioluminescent Mushroom Light Emission", "Renderer-Agnostic Light
// Descriptor Seam") ---

test("object: lit campfire resolves a warm light, unlit campfire has no light", () => {
  const assets = createEmojiAssets();
  const lit = assets.resolve("object", "campfire", { lit: true });
  assert.ok(lit.light);
  assert.equal(lit.light?.color, "#f0a24e");

  const unlit = assets.resolve("object", "campfire", { lit: false });
  assert.equal(unlit.light, undefined);
  assert.equal(assets.resolve("object", "campfire").light, undefined);
});

test("object: a glowLookup-mapped typeId (mushroom) resolves its static light regardless of state", () => {
  const glowLookup = new Map([["bioluminescent_mushroom", { radius: 2, color: "#7fe0c9", intensity: 0.55 }]]);
  const assets = createEmojiAssets(glowLookup);
  const visual = assets.resolve("object", "bioluminescent_mushroom");
  assert.deepEqual(visual.light, { radius: 2, color: "#7fe0c9", intensity: 0.55 });
});

test("object: a typeId absent from glowLookup and not campfire has no light", () => {
  const glowLookup = new Map([["bioluminescent_mushroom", { radius: 2, color: "#7fe0c9", intensity: 0.55 }]]);
  const assets = createEmojiAssets(glowLookup);
  assert.equal(assets.resolve("object", "tree").light, undefined);
});

test("createSpriteAssets: object case merges the same light regardless of sprite vs glyph fallback", () => {
  const glowLookup = new Map([["bioluminescent_mushroom", { radius: 2, color: "#7fe0c9", intensity: 0.55 }]]);
  const assets = createSpriteAssets(fixtureAtlas(), FAKE_IMAGE, glowLookup);

  // "tree" is mapped in the fixture atlas (sprite path) and carries no glow.
  assert.equal(assets.resolve("object", "tree").light, undefined);

  // "bioluminescent_mushroom" is unmapped (falls back to emoji path) but IS
  // in glowLookup — light must still resolve.
  assert.deepEqual(assets.resolve("object", "bioluminescent_mushroom").light, {
    radius: 2,
    color: "#7fe0c9",
    intensity: 0.55,
  });

  // Campfire lit, unmapped in the fixture atlas — light resolves via the
  // wrapped emoji fallback's campfire branch.
  assert.ok(assets.resolve("object", "campfire", { lit: true }).light);
});
