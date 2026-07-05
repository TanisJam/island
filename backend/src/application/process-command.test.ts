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

// --- TryCombination: B1 domain + engine (classification, crafting, escalation, surface gather) ---
// Per-tile scoping (amendment #2857) is covered at the classifier level in domain/combination.test.ts.

function addOnSurface(s: GameState, itemTypeId: string, surfaceId: string, x: number, y: number, rotation = 0): ItemInstance {
  const it: ItemInstance = { id: newId("it"), itemTypeId, location: { type: "surface", surfaceId, x, y, rotation } };
  s.items.push(it);
  return it;
}

test("TryCombination (crouch, invalid target): rechaza invalid_target sin lanzar", () => {
  const s = seedState(index, template);
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "t0", command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: -1, y: -1 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "invalid_target");
});

// --- Cross-validation (method<->target.kind) + proximity guard (fresh-context review BLOCKER fix) ---

test("TryCombination (crouch): rechaza out_of_range cuando el tile examinado está lejos del jugador", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  const far = { x: p.x + 4, y: p.y }; // still inside the 16x12 zone, but chebyshev 4 > 1
  s.items.push({ id: "far1", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: far.x, y: far.y } });
  s.items.push({ id: "far2", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: far.x, y: far.y } });
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "far1", command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: far.x, y: far.y } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "out_of_range");
});

test("TryCombination: method='surface' con un target de tipo 'tile' se rechaza (no cae al fallback de proximidad)", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  s.items.push({ id: "mix1", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "mix2", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "mix1", command: { type: "TryCombination", method: "surface", target: { kind: "tile", x: p.x, y: p.y } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "invalid_target");
});

test("TryCombination: method='crouch' con un target de tipo 'world_object' se rechaza", () => {
  const s = seedState(index, template);
  withTableNear(s);
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "mix2", command: { type: "TryCombination", method: "crouch", target: { kind: "world_object", id: TABLE_ID } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.rejection?.code, "invalid_target");
});

test("TryCombination (crouch, ready): craftea, consume las 3 piezas del tile, desbloquea conocimiento y NO registra el intento (sólo cuenta fallos)", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  s.items.push({ id: "cc1", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "cc2", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "cc3", itemTypeId: "plant_fiber", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "tc1", command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: p.x, y: p.y } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.ok(!result.events.some((e) => e.type === "CombinationAttempted"), "un craft exitoso NO cuenta como intento fallido — el contador sólo trackea fallos");
  assert.ok(result.events.some((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "crude_tool"), "craftea bypassing appliesTo/requirements — el target es un tile, no una superficie");
  assert.equal(result.events.filter((e) => e.type === "ItemRemovedFromWorld").length, 3, "consume las 3 piezas del suelo");
  assert.ok(result.events.some((e) => e.type === "KnowledgeUnlocked" && e.knowledgeId === "tech_basic_binding"), "ideas recordadas: dispara los unlock_knowledge de la receta");
  assert.equal(s.combinationAttempts["dry_branch|plant_fiber|small_stone"], undefined, "el craft exitoso no incrementa el contador de intentos");
});

test("TryCombination (crouch): escalation — tras 5 intentos fallidos con la misma firma, el hint pasa a 'sharp'", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  s.items.push({ id: "e1", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "e2", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } }); // falta binder -> siempre "missing_functional_piece", nunca se consume
  const attempt = (id: string) => processCommand(ctx(s), { playerId: s.player.id, clientCommandId: id, command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: p.x, y: p.y } } });
  const thoughtText = (r: ReturnType<typeof attempt>) => r.events.find((e) => e.type === "ThoughtAdded" && "thought" in e)?.thought?.text;
  let last: ReturnType<typeof attempt> | undefined;
  for (let i = 0; i < 5; i++) last = attempt(`esc${i}`);
  assert.ok(thoughtText(last!)?.includes("algo para atar"), "antes del umbral usa el functionalHint vago");
  const sixth = attempt("esc5");
  assert.ok(thoughtText(sixth)?.includes("algo flexible y fibroso para atar"), "al 6to intento (5 previos) escala a functionalHintSharp");
  assert.ok(!thoughtText(sixth)?.includes("plant_fiber") && !thoughtText(sixth)?.includes("cloth_scrap"), "nunca nombra el item exacto");
});

test("TryCombination (surface): reúne piezas de la grilla de la superficie, no del suelo cercano", () => {
  const s = seedState(index, template);
  withTableNear(s);
  addOnSurface(s, "small_stone", TABLE_ID, 0, 0);
  addOnSurface(s, "dry_branch", TABLE_ID, 0, 1, 90);
  addOnSurface(s, "plant_fiber", TABLE_ID, 2, 0);
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "ts1", command: { type: "TryCombination", method: "surface", target: { kind: "world_object", id: TABLE_ID } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.ok(result.events.some((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "crude_tool"), "crea el output vía la mejor receta lista");
  assert.equal(result.events.filter((e) => e.type === "ItemRemovedFromWorld").length, 0, "los inputs vivían en la superficie, no deberían salir como ItemRemovedFromWorld");
});
