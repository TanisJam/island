import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmojiAssets } from "./assets";

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
