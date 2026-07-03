import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { loadZone } from "../infrastructure/zone/loader";
import { seedState } from "../bootstrap/seed";
import { processCommand } from "./process-command";
import type { EngineCtx } from "../domain/engine";
import type { GameState } from "../domain/state";
import type { WorldObject, ItemInstance } from "../contract/events";
import type { CommandEnvelope } from "../contract/commands";
import { newId } from "../domain/ids";

const { index } = loadCatalog();
const template = loadZone("z1");
const ctx = (state: GameState): EngineCtx => ({ state, index, rng: () => 0, now: () => 1 });

const TABLE_ID = "wo_table_cmd";

function withTableNear(s: GameState): void {
  const table: WorldObject = { id: TABLE_ID, objectTypeId: "rustic_table", position: { x: s.player.position.x, y: s.player.position.y + 1 }, state: {}, tags: [], visibility: "visible" };
  s.objects.push(table);
  s.inventories[TABLE_ID] = { width: 3, height: 2 };
}

function addInHand(s: GameState, itemTypeId: string): ItemInstance {
  const it: ItemInstance = { id: newId("it"), itemTypeId, location: { type: "player_inventory", playerId: s.player.id, x: 1, y: 1, rotation: 0 } };
  s.items.push(it);
  return it;
}

test("MoveItem -> surface: acepta una colocación válida y emite ItemMoved", () => {
  const s = seedState(index, template);
  withTableNear(s);
  const it = addInHand(s, "small_stone");
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "c1", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "surface", surfaceId: TABLE_ID, x: 0, y: 0, rotation: 0 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.ok(result.events.some((e) => e.type === "ItemMoved"));
});

test("MoveItem -> surface: rechaza cuando la superficie no existe (invalid_target)", () => {
  const s = seedState(index, template);
  const it = addInHand(s, "small_stone");
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "c2", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "surface", surfaceId: "no_such_surface", x: 0, y: 0, rotation: 0 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "invalid_target");
});

test("MoveItem -> surface: rechaza fuera de rango (out_of_range) cuando el jugador está lejos", () => {
  const s = seedState(index, template);
  const table: WorldObject = { id: TABLE_ID, objectTypeId: "rustic_table", position: { x: s.player.position.x + 10, y: s.player.position.y + 10 }, state: {}, tags: [], visibility: "visible" };
  s.objects.push(table);
  s.inventories[TABLE_ID] = { width: 3, height: 2 };
  const it = addInHand(s, "small_stone");
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "c3", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "surface", surfaceId: TABLE_ID, x: 0, y: 0, rotation: 0 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "out_of_range");
});

test("MoveItem -> surface: rechaza overlap/no_space cuando la celda está ocupada", () => {
  const s = seedState(index, template);
  withTableNear(s);
  s.items.push({ id: "occupant", itemTypeId: "small_stone", location: { type: "surface", surfaceId: TABLE_ID, x: 0, y: 0, rotation: 0 } });
  const it = addInHand(s, "plant_fiber");
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "c4", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "surface", surfaceId: TABLE_ID, x: 0, y: 0, rotation: 0 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "no_space");
});

// --- MoveItem -> inventory: bounds/collision validation (item-drag-drop, R1) ---

test("MoveItem -> inventory: acepta un movimiento válido y emite ItemMoved", () => {
  const s = seedState(index, template);
  const it = addInHand(s, "small_stone");
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "i1", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "inventory", ownerId: s.player.id, x: 3, y: 3, rotation: 0 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.ok(result.events.some((e) => e.type === "ItemMoved"));
});

test("MoveItem -> inventory: rechaza no_space por colisión con otro item", () => {
  const s = seedState(index, template);
  s.items.push({ id: "occupant", itemTypeId: "small_stone", location: { type: "player_inventory", playerId: s.player.id, x: 2, y: 2, rotation: 0 } });
  const it = addInHand(s, "plant_fiber");
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "i2", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "inventory", ownerId: s.player.id, x: 2, y: 2, rotation: 0 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "no_space");
  assert.equal(result.rejection?.thought?.text, "No entra ahí.");
});

test("MoveItem -> inventory: rechaza no_space fuera de los límites de la grilla 4x4", () => {
  const s = seedState(index, template);
  const it = addInHand(s, "small_stone");
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "i3", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "inventory", ownerId: s.player.id, x: 4, y: 0, rotation: 0 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "no_space");
});

test("MoveItem -> inventory: acepta el no-op de mover a la misma celda que ya ocupa", () => {
  const s = seedState(index, template);
  const it = addInHand(s, "small_stone"); // already at (1,1)
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "i4", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "inventory", ownerId: s.player.id, x: 1, y: 1, rotation: 0 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
});

// --- MoveItem -> hand: occupied-slot / self-target validation (item-drag-drop, R2) ---

test("MoveItem -> hand: acepta equipar en una mano vacía y resetea la rotación a 0", () => {
  const s = seedState(index, template);
  const it: ItemInstance = { id: newId("it"), itemTypeId: "dry_branch", location: { type: "player_inventory", playerId: s.player.id, x: 1, y: 1, rotation: 90 } };
  s.items.push(it);
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "h1", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "hand", hand: "left" } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(it.location.type, "player_inventory");
  assert.equal((it.location as { rotation: number }).rotation, 0);
});

test("MoveItem -> hand: rechaza no_space cuando la mano ya está ocupada por otro item", () => {
  const s = seedState(index, template);
  s.items.push({ id: "hand_occupant", itemTypeId: "small_stone", location: { type: "player_inventory", playerId: s.player.id, x: 0, y: 0, rotation: 0 } });
  const it = addInHand(s, "plant_fiber");
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "h2", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "hand", hand: "left" } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "no_space");
  assert.equal(result.rejection?.thought?.text, "Ya tengo algo en esa mano.");
});

test("MoveItem -> hand: acepta el no-op de re-equipar el mismo item que ya está en esa mano", () => {
  const s = seedState(index, template);
  const it: ItemInstance = { id: "hand_axe", itemTypeId: "small_stone", location: { type: "player_inventory", playerId: s.player.id, x: 0, y: 0, rotation: 0 } };
  s.items.push(it);
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "h3", command: { type: "MoveItem", itemInstanceId: it.id, to: { type: "hand", hand: "left" } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
});
