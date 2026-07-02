import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAtlasExport, type Mapping } from "./atlas-export";

function mappings(): Mapping[] {
  return [
    { kind: "terrain", typeId: "sand", region: { x: 0, y: 0, w: 16, h: 16 } },
    { kind: "object", typeId: "tree", region: { x: 16, y: 0, w: 16, h: 32 } },
    { kind: "item", typeId: "potion", region: { x: 0, y: 32, w: 16, h: 16 } },
  ];
}

test("buildAtlasExport: matches the frozen per-kind nested schema", () => {
  const atlas = buildAtlasExport(mappings(), "tileset.png", 16);
  assert.equal(atlas.image, "tileset.png");
  assert.equal(atlas.tile, 16);
  assert.deepEqual(atlas.terrain, { sand: { x: 0, y: 0, w: 16, h: 16 } });
  assert.deepEqual(atlas.object, { tree: { x: 16, y: 0, w: 16, h: 32 } });
  assert.deepEqual(atlas.item, { potion: { x: 0, y: 32, w: 16, h: 16 } });
});

test("buildAtlasExport: no entry for a typeId that was never assigned", () => {
  const atlas = buildAtlasExport(mappings(), "tileset.png", 16);
  assert.equal(atlas.object?.["tall_grass"], undefined);
  assert.equal(atlas.player, undefined);
});

test("buildAtlasExport: an empty mapping list produces only the root image/tile keys", () => {
  const atlas = buildAtlasExport([], "tileset.png", 16);
  assert.deepEqual(atlas, { image: "tileset.png", tile: 16 });
});

test("buildAtlasExport: later mappings for the same typeId overwrite earlier ones (reassignment)", () => {
  const atlas = buildAtlasExport(
    [
      { kind: "object", typeId: "campfire", region: { x: 0, y: 0, w: 16, h: 16 } },
      { kind: "object", typeId: "campfire", region: { x: 64, y: 0, w: 16, h: 16 } },
    ],
    "tileset.png",
    16,
  );
  assert.deepEqual(atlas.object, { campfire: { x: 64, y: 0, w: 16, h: 16 } });
});

test("buildAtlasExport: numeric x/y/w/h are copied, not referenced (defensive clone)", () => {
  const region = { x: 0, y: 0, w: 16, h: 16 };
  const atlas = buildAtlasExport([{ kind: "terrain", typeId: "sand", region }], "tileset.png", 16);
  region.x = 999;
  assert.equal(atlas.terrain?.["sand"]?.x, 0);
});
