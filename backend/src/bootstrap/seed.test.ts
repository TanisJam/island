import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { loadZone } from "../infrastructure/zone/loader";
import type { ZoneTemplate } from "../contract/zone";
import type { TerrainId } from "../domain/state";
import { seedState } from "./seed";

const { index } = loadCatalog();

// --- Golden fixture: a frozen copy of the PRE-migration procedural seed logic
// that used to live in this file (deleted as part of the zone-template
// migration). This is the historical baseline used ONLY to prove the new
// template-driven `seedState` is behavior-equivalent — do NOT "fix" it to
// match the new code; it must stay byte-identical to what shipped before. ---
const OLD_W = 16;
const OLD_H = 12;

function oldTerrainAt(x: number, y: number): TerrainId {
  if (y === 11 && (x < 2 || x > 13)) return "shallow_water";
  if (y <= 2) return "dense_jungle";
  if (y >= 10) return "sand";
  return "grass";
}

function oldTagsFor(t: TerrainId): string[] {
  switch (t) {
    case "dense_jungle": return ["blocker", "progression_gate", "plant"];
    case "sand": return ["ground", "searchable"];
    case "shallow_water": return ["water", "wet", "resource"];
    case "dirt": return ["ground", "diggable"];
    case "rocky_ground": return ["ground", "hard"];
    default: return ["ground"];
  }
}

const oldWalkable = (t: TerrainId): boolean => t !== "dense_jungle" && t !== "shallow_water";

function oldTiles(): Array<{ x: number; y: number; terrain: TerrainId; walkable: boolean; tags: string[] }> {
  const tiles = [];
  for (let y = 0; y < OLD_H; y++) {
    for (let x = 0; x < OLD_W; x++) {
      const terrain = oldTerrainAt(x, y);
      tiles.push({ x, y, terrain, walkable: oldWalkable(terrain), tags: oldTagsFor(terrain) });
    }
  }
  return tiles;
}

const oldObjectPlacements: Array<{ objectTypeId: string; x: number; y: number }> = [
  { objectTypeId: "tree", x: 3, y: 4 },
  { objectTypeId: "tree", x: 11, y: 5 },
  { objectTypeId: "tree", x: 6, y: 7 },
  { objectTypeId: "tall_grass", x: 4, y: 6 },
  { objectTypeId: "tall_grass", x: 9, y: 6 },
  { objectTypeId: "tall_grass", x: 12, y: 8 },
  { objectTypeId: "small_rock", x: 2, y: 9 },
  { objectTypeId: "wreckage", x: 10, y: 10 },
  { objectTypeId: "rustic_table", x: 8, y: 8 },
];

test("seedState(template): matches the pre-migration procedural seed (tiles/objects/tags/walkable/spawn/looseStone)", () => {
  const template = loadZone("z1");
  const s = seedState(index, template, "p1", "z1");

  // --- Tiles: terrain/walkable/tags per (x,y), independent of insertion order. ---
  const expectedTiles = oldTiles();
  assert.equal(s.tiles.length, expectedTiles.length);
  for (const expected of expectedTiles) {
    const actual = s.tiles.find((t) => t.x === expected.x && t.y === expected.y);
    assert.ok(actual, `missing tile (${expected.x},${expected.y})`);
    assert.equal(actual.terrain, expected.terrain, `terrain mismatch at (${expected.x},${expected.y})`);
    assert.equal(actual.walkable, expected.walkable, `walkable mismatch at (${expected.x},${expected.y})`);
    assert.deepEqual(actual.tags, expected.tags, `tags mismatch at (${expected.x},${expected.y})`);
  }

  // --- Objects: objectTypeId/position/state, ignoring the randomly generated id. ---
  const actualObjects = s.objects.map((o) => ({ objectTypeId: o.objectTypeId, x: o.position.x, y: o.position.y, state: o.state }));
  const expectedObjects = oldObjectPlacements.map((p) => {
    const def = index.objectById.get(p.objectTypeId);
    return { objectTypeId: p.objectTypeId, x: p.x, y: p.y, state: { ...(def?.defaultState ?? {}) } };
  });
  assert.equal(actualObjects.length, expectedObjects.length);
  for (const expected of expectedObjects) {
    const actual = actualObjects.find((o) => o.objectTypeId === expected.objectTypeId && o.x === expected.x && o.y === expected.y);
    assert.ok(actual, `missing object ${expected.objectTypeId}@(${expected.x},${expected.y})`);
    assert.deepEqual(actual.state, expected.state, `state mismatch for ${expected.objectTypeId}@(${expected.x},${expected.y})`);
  }

  // --- Spawn + loose item. ---
  assert.deepEqual(s.player.position, { x: 8, y: 9 });
  const looseStone = s.items.find((i) => i.itemTypeId === "small_stone");
  assert.ok(looseStone, "expected a loose small_stone item");
  assert.deepEqual(looseStone!.location, { type: "world", zoneId: "z1", x: 7, y: 10 });

  // --- R7 crafting-surface dependency: rustic_table stays adjacent to spawn. ---
  const table = s.objects.find((o) => o.objectTypeId === "rustic_table");
  assert.ok(table, "expected a rustic_table world object");
  assert.deepEqual(table!.position, { x: 8, y: 8 });
});

// --- Fail-fast guards ---

test("seedState: throws on an unknown terrainId in the template", () => {
  const badTemplate: ZoneTemplate = { width: 1, height: 1, tiles: ["not_a_real_terrain"], objects: [] };
  assert.throws(() => seedState(index, badTemplate, "p1", "z1"));
});

test("seedState: throws when tiles.length !== width * height", () => {
  const badTemplate: ZoneTemplate = { width: 2, height: 2, tiles: ["grass", "grass", "grass"], objects: [] };
  assert.throws(() => seedState(index, badTemplate, "p1", "z1"));
});
