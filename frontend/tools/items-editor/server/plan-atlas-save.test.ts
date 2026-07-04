import { test } from "node:test";
import assert from "node:assert/strict";
import { planAtlasSave, type PlanAtlasSaveInput } from "./plan-atlas-save";
import type { Atlas } from "../../../src/render/assets";

/**
 * SECURITY-CRITICAL test suite (spec "Hard-coded, fresh-read write target",
 * design.md "B4/B5" + "Security-property test approach").
 *
 * `planAtlasSave` is pure and never touches `fs` — the write target is
 * decided exclusively by `server/atlas-targets.ts::resolveAtlasTarget`,
 * which this module does not even import. These tests prove that no
 * client-supplied field, however path-like, atlas-shaped, or
 * prototype-pollution-shaped, ever reaches the write plan or corrupts the
 * atlas object.
 */

const baseAtlas: Atlas = {
  image: "spring_outdoorsTileSheet..png",
  tile: 16,
  terrain: { sand: { x: 16, y: 112, w: 16, h: 16 } },
  object: { tree: { x: 0, y: 0, w: 16, h: 32 } },
  item: {
    simple_axe: { x: 32, y: 1232, w: 16, h: 16 },
    bark: { x: 48, y: 1232, w: 16, h: 16 },
  },
  player: { default: { x: 0, y: 16, w: 16, h: 16 } },
};

function input(atlas: Atlas = baseAtlas): PlanAtlasSaveInput {
  return { currentAtlas: structuredClone(atlas) };
}

// --- Patch / preserve --------------------------------------------------

test("planAtlasSave: patch sets item[typeId] and preserves every other kind/entry", () => {
  const result = planAtlasSave({ typeId: "crude_tool", kind: "item", region: { x: 64, y: 64, w: 16, h: 16 } }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const atlas = JSON.parse(result.atlasJson) as Atlas;
    assert.deepEqual(atlas.item?.crude_tool, { x: 64, y: 64, w: 16, h: 16 });
    assert.deepEqual(atlas.item?.simple_axe, baseAtlas.item?.simple_axe);
    assert.deepEqual(atlas.item?.bark, baseAtlas.item?.bark);
    assert.deepEqual(atlas.terrain, baseAtlas.terrain);
    assert.deepEqual(atlas.object, baseAtlas.object);
    assert.deepEqual(atlas.player, baseAtlas.player);
    assert.equal(atlas.image, baseAtlas.image);
    assert.equal(atlas.tile, baseAtlas.tile);
    assert.equal("version" in atlas, false);
  }
});

test("planAtlasSave: patch on a previously unmapped typeId creates the entry", () => {
  const result = planAtlasSave({ typeId: "new_item", kind: "item", region: { x: 1, y: 2, w: 16, h: 16 } }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const atlas = JSON.parse(result.atlasJson) as Atlas;
    assert.deepEqual(atlas.item?.new_item, { x: 1, y: 2, w: 16, h: 16 });
  }
});

// --- Clear ---------------------------------------------------------------

test("planAtlasSave: clear removes item[typeId], preserves the rest", () => {
  const result = planAtlasSave({ typeId: "bark", kind: "item", clear: true }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.region, null);
    const atlas = JSON.parse(result.atlasJson) as Atlas;
    assert.equal("bark" in (atlas.item ?? {}), false);
    assert.deepEqual(atlas.item?.simple_axe, baseAtlas.item?.simple_axe);
  }
});

test("planAtlasSave: clearing an absent key is a safe no-op (still ok:true)", () => {
  const result = planAtlasSave({ typeId: "never_mapped", kind: "item", clear: true }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const atlas = JSON.parse(result.atlasJson) as Atlas;
    assert.equal("never_mapped" in (atlas.item ?? {}), false);
  }
});

// --- kind (Slice 3b atlasKind generalization) -----------------------------

test("planAtlasSave: kind:\"terrain\" patches the terrain bucket, leaves item/object/player untouched", () => {
  const result = planAtlasSave({ typeId: "swamp", kind: "terrain", region: { x: 5, y: 5, w: 16, h: 16 } }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const atlas = JSON.parse(result.atlasJson) as Atlas;
    assert.deepEqual(atlas.terrain?.swamp, { x: 5, y: 5, w: 16, h: 16 });
    assert.deepEqual(atlas.terrain?.sand, baseAtlas.terrain?.sand);
    assert.deepEqual(atlas.item, baseAtlas.item);
    assert.deepEqual(atlas.object, baseAtlas.object);
  }
});

test("planAtlasSave: kind:\"object\" patches the object bucket, leaves the rest untouched", () => {
  const result = planAtlasSave({ typeId: "campfire", kind: "object", region: { x: 7, y: 7, w: 16, h: 16 } }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const atlas = JSON.parse(result.atlasJson) as Atlas;
    assert.deepEqual(atlas.object?.campfire, { x: 7, y: 7, w: 16, h: 16 });
    assert.deepEqual(atlas.object?.tree, baseAtlas.object?.tree);
    assert.deepEqual(atlas.item, baseAtlas.item);
    assert.deepEqual(atlas.terrain, baseAtlas.terrain);
  }
});

test("planAtlasSave: rejects a missing kind", () => {
  const result = planAtlasSave({ typeId: "crude_tool", region: { x: 1, y: 1, w: 16, h: 16 } }, input());
  assert.equal(result.ok, false);
});

test("planAtlasSave: kind:\"player\" patches the player bucket, leaves the rest untouched (atlas-editor-fold Slice 1)", () => {
  const result = planAtlasSave({ typeId: "player", kind: "player", region: { x: 336, y: 512, w: 16, h: 32 } }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const atlas = JSON.parse(result.atlasJson) as Atlas;
    assert.deepEqual(atlas.player?.player, { x: 336, y: 512, w: 16, h: 32 });
    assert.deepEqual(atlas.item, baseAtlas.item);
    assert.deepEqual(atlas.object, baseAtlas.object);
    assert.deepEqual(atlas.terrain, baseAtlas.terrain);
  }
});

test("planAtlasSave: rejects an arbitrary/hostile kind string", () => {
  const result = planAtlasSave({ typeId: "crude_tool", kind: "__proto__", region: { x: 1, y: 1, w: 16, h: 16 } }, input());
  assert.equal(result.ok, false);
});

// --- SECURITY A: full-atlas injection ignored -----------------------------

test("planAtlasSave: SECURITY A — a client-sent full atlas payload is completely ignored", () => {
  const hostileBody = {
    typeId: "crude_tool",
    kind: "item",
    region: { x: 1, y: 1, w: 16, h: 16 },
    atlas: { image: "EVIL.png", tile: 999, item: { simple_axe: { x: 0, y: 0, w: 1, h: 1 } } },
  };
  const result = planAtlasSave(hostileBody, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const atlas = JSON.parse(result.atlasJson) as Atlas;
    // image/tile/other entries come ONLY from currentAtlas, never the body.
    assert.equal(atlas.image, baseAtlas.image);
    assert.equal(atlas.tile, baseAtlas.tile);
    assert.deepEqual(atlas.item?.simple_axe, baseAtlas.item?.simple_axe);
  }
});

// --- SECURITY B: path/file/target fields ignored --------------------------

test("planAtlasSave: SECURITY B — hostile path/file/target fields are ignored, never leak into output", () => {
  const hostileBody = {
    typeId: "crude_tool",
    kind: "item",
    region: { x: 1, y: 1, w: 16, h: 16 },
    path: "../../etc/passwd",
    file: "/etc/passwd",
    target: "../../../root/.ssh/authorized_keys",
  };
  const result = planAtlasSave(hostileBody, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    for (const hostileValue of ["../../etc/passwd", "/etc/passwd", "../../../root/.ssh/authorized_keys"]) {
      assert.equal(result.atlasJson.includes(hostileValue), false, `leaked: ${hostileValue}`);
    }
  }
});

// --- SECURITY C: region key injection dropped ------------------------------

test("planAtlasSave: SECURITY C — extra/injected keys inside region are dropped, only x/y/w/h survive", () => {
  const hostileRegion = { x: 1, y: 2, w: 16, h: 16, evil: "payload", __proto__: { polluted: true } };
  const result = planAtlasSave({ typeId: "crude_tool", kind: "item", region: hostileRegion }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const atlas = JSON.parse(result.atlasJson) as Atlas;
    assert.deepEqual(Object.keys(atlas.item?.crude_tool ?? {}).sort(), ["h", "w", "x", "y"]);
  }
});

// --- SECURITY D: hostile typeId cannot pollute the prototype ---------------

test('planAtlasSave: SECURITY D — typeId "__proto__" is rejected, never reaches a bracket assignment', () => {
  const result = planAtlasSave({ typeId: "__proto__", region: { x: 1, y: 1, w: 16, h: 16 } }, input());
  assert.equal(result.ok, false);
  // The global Object prototype must be untouched.
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test('planAtlasSave: SECURITY D — typeId "constructor" is rejected, never reaches a bracket assignment', () => {
  const result = planAtlasSave({ typeId: "constructor", region: { x: 1, y: 1, w: 16, h: 16 } }, input());
  assert.equal(result.ok, false);
});

test('planAtlasSave: SECURITY D — typeId "__proto__" with clear:true is also rejected, not a silent no-op', () => {
  const result = planAtlasSave({ typeId: "__proto__", clear: true }, input());
  assert.equal(result.ok, false);
});

// --- Validation ------------------------------------------------------------

test("planAtlasSave: rejects a non-object body", () => {
  for (const bad of [null, "not-an-object", 42, ["array"]]) {
    const result = planAtlasSave(bad, input());
    assert.equal(result.ok, false);
  }
});

test("planAtlasSave: rejects a missing/empty typeId", () => {
  assert.equal(planAtlasSave({ region: { x: 1, y: 1, w: 16, h: 16 } }, input()).ok, false);
  assert.equal(planAtlasSave({ typeId: "", region: { x: 1, y: 1, w: 16, h: 16 } }, input()).ok, false);
});

test("planAtlasSave: rejects non-numeric/NaN/Infinity/negative region fields", () => {
  const cases = [
    { x: "1", y: 1, w: 16, h: 16 },
    { x: 1, y: 1, w: Number.NaN, h: 16 },
    { x: 1, y: 1, w: Number.POSITIVE_INFINITY, h: 16 },
    { x: -1, y: 1, w: 16, h: 16 },
    { x: 1, y: 1, w: 0, h: 16 },
    { x: 1, y: 1, w: 16, h: -5 },
  ];
  for (const region of cases) {
    const result = planAtlasSave({ typeId: "crude_tool", kind: "item", region }, input());
    assert.equal(result.ok, false, `should reject region: ${JSON.stringify(region)}`);
  }
});

test("planAtlasSave: rejects a missing region when not clearing", () => {
  const result = planAtlasSave({ typeId: "crude_tool", kind: "item" }, input());
  assert.equal(result.ok, false);
});

test("planAtlasSave: NO version field is ever invented in the output", () => {
  const result = planAtlasSave({ typeId: "crude_tool", kind: "item", region: { x: 1, y: 1, w: 16, h: 16 } }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal("version" in JSON.parse(result.atlasJson), false);
  }
});
