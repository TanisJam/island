import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { seedState } from "../bootstrap/seed";
import { applyEvent } from "./reducer";
import { rebuildInventories } from "./state";
import type { WorldObject } from "../contract/events";

const { index } = loadCatalog();

test("WorldObjectCreated: un world object con surfaceGrid puebla inventories", () => {
  const s = seedState(index);
  const table: WorldObject = { id: "wo_table_1", objectTypeId: "rustic_table", position: { x: 5, y: 5 }, state: {}, tags: [], visibility: "visible" };
  applyEvent(s, index, { type: "WorldObjectCreated", object: table });
  assert.deepEqual(s.inventories["wo_table_1"], { width: 3, height: 2 });
});

test("WorldObjectCreated: un world object sin surfaceGrid NO puebla inventories", () => {
  const s = seedState(index);
  const campfire: WorldObject = { id: "wo_fire_1", objectTypeId: "campfire", position: { x: 5, y: 5 }, state: { lit: false, fuel: 0 }, tags: [], visibility: "visible" };
  applyEvent(s, index, { type: "WorldObjectCreated", object: campfire });
  assert.equal(s.inventories["wo_fire_1"], undefined);
});

test("ItemMoved a surface: setea location.type='surface' con los campos correctos", () => {
  const s = seedState(index);
  const table: WorldObject = { id: "wo_table_2", objectTypeId: "rustic_table", position: { x: 5, y: 5 }, state: {}, tags: [], visibility: "visible" };
  applyEvent(s, index, { type: "WorldObjectCreated", object: table });
  const it = { id: "it_1", itemTypeId: "small_stone", location: { type: "world" as const, zoneId: s.zone.id, x: 5, y: 6 } };
  s.items.push(it);
  applyEvent(s, index, { type: "ItemMoved", itemInstanceId: "it_1", to: { type: "surface", surfaceId: "wo_table_2", x: 0, y: 0, rotation: 0 } });
  const moved = s.items.find((i) => i.id === "it_1")!;
  assert.deepEqual(moved.location, { type: "surface", surfaceId: "wo_table_2", x: 0, y: 0, rotation: 0 });
});

test("rebuildInventories: es idempotente y no duplica ni pierde registros", () => {
  const s = seedState(index);
  const table: WorldObject = { id: "wo_table_3", objectTypeId: "rustic_table", position: { x: 5, y: 5 }, state: {}, tags: [], visibility: "visible" };
  s.objects.push(table);
  rebuildInventories(s, index);
  rebuildInventories(s, index);
  assert.deepEqual(s.inventories["wo_table_3"], { width: 3, height: 2 });
  assert.equal(Object.keys(s.inventories).length, 1);
});
