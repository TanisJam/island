import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { seedState } from "../bootstrap/seed";
import { canPlaceOnSurface, findFreeInventorySlot, handItems, occupiedCells } from "./inventory";
import type { ItemInstance, WorldObject } from "../contract/events";

const { index } = loadCatalog();

// --- Player-wrapper regression: existing behavior must be unaffected by the
// grid-agnostic extraction (cellsOnGrid/occupiedSetOnGrid/fitsOnGrid). ---

test("occupiedCells: sigue calculando celdas del inventario del jugador (regresión)", () => {
  const s = seedState(index);
  const it: ItemInstance = { id: "it_a", itemTypeId: "dry_branch", location: { type: "player_inventory", playerId: s.player.id, x: 1, y: 1, rotation: 0 } };
  const cells = occupiedCells(it, index);
  assert.deepEqual(cells, [{ x: 1, y: 1 }, { x: 1, y: 2 }]);
});

test("occupiedCells: un item en una superficie devuelve [] (no es celda de jugador)", () => {
  const s = seedState(index);
  const it: ItemInstance = { id: "it_b", itemTypeId: "dry_branch", location: { type: "surface", surfaceId: "wo_x", x: 0, y: 0, rotation: 0 } };
  assert.deepEqual(occupiedCells(it, index), []);
});

test("findFreeInventorySlot: sigue encontrando hueco libre en el inventario del jugador (regresión)", () => {
  const s = seedState(index);
  const slot = findFreeInventorySlot(s, index, "plant_fiber", s.player.id);
  assert.ok(slot && slot.type === "player_inventory");
});

test("handItems: sigue detectando items en slots de mano (regresión)", () => {
  const s = seedState(index);
  s.items.push({ id: "hand_axe", itemTypeId: "simple_axe", location: { type: "player_inventory", playerId: s.player.id, x: 0, y: 0, rotation: 0 } });
  const hands = handItems(s, index);
  assert.equal(hands.left?.id, "hand_axe");
});

// --- canPlaceOnSurface: fit / overflow / overlap / exceptId / rotation ---

const TABLE_ID = "wo_table_test";
const DIMS = { width: 3, height: 2 };

function withTable(): ReturnType<typeof seedState> {
  const s = seedState(index);
  const table: WorldObject = { id: TABLE_ID, objectTypeId: "rustic_table", position: { x: 5, y: 5 }, state: {}, tags: [], visibility: "visible" };
  s.objects.push(table);
  s.inventories[TABLE_ID] = DIMS;
  return s;
}

test("canPlaceOnSurface: un item 1x1 entra en una celda vacía dentro de la grilla", () => {
  const s = withTable();
  assert.equal(canPlaceOnSurface(s, index, TABLE_ID, "small_stone", 0, 0, 0, DIMS), true);
});

test("canPlaceOnSurface: rechaza overflow fuera de los límites de la grilla (3x2)", () => {
  const s = withTable();
  assert.equal(canPlaceOnSurface(s, index, TABLE_ID, "small_stone", 3, 0, 0, DIMS), false);
  assert.equal(canPlaceOnSurface(s, index, TABLE_ID, "dry_branch", 0, 1, 0, DIMS), false); // 1x2 vertical en y=1 se sale (h=2)
});

test("canPlaceOnSurface: rechaza overlap con un item ya colocado", () => {
  const s = withTable();
  s.items.push({ id: "it_on_table", itemTypeId: "small_stone", location: { type: "surface", surfaceId: TABLE_ID, x: 0, y: 0, rotation: 0 } });
  assert.equal(canPlaceOnSurface(s, index, TABLE_ID, "plant_fiber", 0, 0, 0, DIMS), false);
});

test("canPlaceOnSurface: permite mover un item dentro de su propia superficie via exceptId", () => {
  const s = withTable();
  s.items.push({ id: "it_move", itemTypeId: "small_stone", location: { type: "surface", surfaceId: TABLE_ID, x: 0, y: 0, rotation: 0 } });
  // Moving the SAME item to a cell it already partially occupies must not self-collide.
  assert.equal(canPlaceOnSurface(s, index, TABLE_ID, "small_stone", 0, 0, 0, DIMS, "it_move"), true);
  assert.equal(canPlaceOnSurface(s, index, TABLE_ID, "small_stone", 0, 0, 0, DIMS, "other_id"), false);
});

test("canPlaceOnSurface: honra rotación (1x2 rotado a 2x1 cambia lo que entra)", () => {
  const s = withTable();
  // dry_branch is 1x2 (w x h). At rotation 90 it becomes 2x1 and should fit at (1,1) in a 3x2 grid.
  assert.equal(canPlaceOnSurface(s, index, TABLE_ID, "dry_branch", 1, 1, 90, DIMS), true);
  // Unrotated (1x2) at (1,1) would need y in [1,2] -> out of bounds (height 2).
  assert.equal(canPlaceOnSurface(s, index, TABLE_ID, "dry_branch", 1, 1, 0, DIMS), false);
});
