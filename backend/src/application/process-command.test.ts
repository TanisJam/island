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

test("TryCombination: method='surface' contra un world_object que NO declara surfaceGrid (ej. un árbol) se rechaza — no cae al fallback de proximidad de gatherCandidates (fresh-context review fix)", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  const treePos = { x: p.x, y: p.y - 1 };
  const tree: WorldObject = { id: "wo_tree_nonsurface", objectTypeId: "tree", position: treePos, state: {}, tags: [], visibility: "visible" };
  s.objects.push(tree);
  // Pieces that WOULD satisfy craft_simple_axe (full quality, no fatigue, fast)
  // if the proximity fallback fired — proves the rejection happens BEFORE any
  // gathering, not merely "nothing nearby to combine".
  s.items.push({ id: "nt1", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: treePos.x, y: treePos.y } });
  s.items.push({ id: "nt2", itemTypeId: "poor_wood", location: { type: "world", zoneId: s.zone.id, x: treePos.x, y: treePos.y } });
  s.items.push({ id: "nt3", itemTypeId: "plant_fiber", location: { type: "world", zoneId: s.zone.id, x: treePos.x, y: treePos.y } });
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "nosurf1", command: { type: "TryCombination", method: "surface", target: { kind: "world_object", id: tree.id } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false, JSON.stringify(result));
  assert.equal(result.rejection?.code, "invalid_target");
  assert.equal(result.events.length, 0, "rechazado antes de gatherear/craftear — ningún evento se emite");
  assert.equal(s.items.length, 4, "small_stone del seed + los 3 items sembrados siguen intactos, nada se consumió");
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

// --- Slice C (Decision 1, engram #2854): durationMs propagated onto CommandResult ---

test("ExecuteAction: el resultado aceptado incluye durationMs de la acción resuelta (pull_branches: 500ms)", () => {
  const s = seedState(index, template);
  const tree = s.objects.find((o) => o.objectTypeId === "tree")!;
  s.player.position = { x: tree.position.x, y: tree.position.y + 1 };
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "dur1", command: { type: "ExecuteAction", actionId: "pull_branches", target: { kind: "world_object", id: tree.id } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.durationMs, 500);
});

test("ExecuteAction: una acción sin durationMs authored no incluye el campo en el resultado (57 tests preexistentes: campo opcional invisible)", () => {
  const s = seedState(index, template);
  s.player.position = { x: 0, y: 11 }; // shallow_water tile (wet_hands' appliesTo)
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "dur2", command: { type: "ExecuteAction", actionId: "wet_hands", target: { kind: "tile", x: 0, y: 11 } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.durationMs, undefined);
});

test("ExecuteAction: un rechazo (rejection) nunca incluye durationMs — el intento nunca empezó", () => {
  const s = seedState(index, template);
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "dur3", command: { type: "ExecuteAction", actionId: "no_existe", target: { kind: "self" } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, false);
  assert.equal(result.durationMs, undefined);
});

test("TryCombination (crouch, ready): el resultado incluye durationMs de la receta craftada (craft_simple_axe/improvise_crude_tool: 1200ms)", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  s.items.push({ id: "dcc1", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "dcc2", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "dcc3", itemTypeId: "plant_fiber", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "dur4", command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: p.x, y: p.y } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.durationMs, 1200);
});

test("TryCombination (crouch, no listo): un intento fallido NO incluye durationMs — sólo el craft real lo hace", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  s.items.push({ id: "dcf1", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "dcf2", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "dur5", command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: p.x, y: p.y } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.durationMs, undefined);
});

// --- Slice D (Decision 5, engram #2854): quality by method -> starting durability ---

test("TryCombination (crouch): craftea con quality 0.5 -> durability reducida (simple_axe: base 40 -> 20)", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  s.items.push({ id: "qc1", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "qc2", itemTypeId: "poor_wood", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "qc3", itemTypeId: "plant_fiber", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "qc", command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: p.x, y: p.y } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  const added = result.events.find((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "simple_axe");
  assert.ok(added, JSON.stringify(result));
  const item = (added as Extract<typeof added, { type: "ItemAddedToInventory" }>).item;
  assert.equal(item.quality, 0.5, "método crouch -> quality 0.5");
  assert.equal(item.durability, 20, "quality crouch (0.5) * base 40 = 20 — coincide con el ejemplo del diseño (engram #2854)");
});

test("TryCombination (surface): craftea con quality 1.0 -> durability completa (simple_axe: 40)", () => {
  const s = seedState(index, template);
  withTableNear(s);
  addOnSurface(s, "small_stone", TABLE_ID, 0, 0);
  addOnSurface(s, "poor_wood", TABLE_ID, 0, 1, 90);
  addOnSurface(s, "plant_fiber", TABLE_ID, 2, 0);
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "qs", command: { type: "TryCombination", method: "surface", target: { kind: "world_object", id: TABLE_ID } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  const added = result.events.find((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "simple_axe");
  assert.ok(added, JSON.stringify(result));
  const item = (added as Extract<typeof added, { type: "ItemAddedToInventory" }>).item;
  assert.equal(item.quality, 1, "método surface (mesa) -> quality 1.0");
  assert.equal(item.durability, 40, "quality mesa (1.0) * base 40 = durability completa");
});

test("TryCombination (surface, ready): la mesa craftea MÁS RÁPIDO que agachado (Decision 6 — la mesa es un upgrade, nunca un gate)", () => {
  const s = seedState(index, template);
  withTableNear(s);
  addOnSurface(s, "small_stone", TABLE_ID, 0, 0);
  addOnSurface(s, "poor_wood", TABLE_ID, 0, 1, 90);
  addOnSurface(s, "plant_fiber", TABLE_ID, 2, 0);
  const env: CommandEnvelope = { playerId: s.player.id, clientCommandId: "durf", command: { type: "TryCombination", method: "surface", target: { kind: "world_object", id: TABLE_ID } } };
  const result = processCommand(ctx(s), env);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.durationMs, Math.round(1300 * 0.6), "craft_simple_axe declara 1300ms; la mesa aplica el factor de velocidad (0.6)");
});

// --- Slice D (Decision 6, engram #2854): fatigue thought every N crouch crafts ---

function craftCrudeToolCrouchAt(s: GameState, suffix: string) {
  const p = s.player.position;
  s.items.push({ id: `fs_stone_${suffix}`, itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: `fs_branch_${suffix}`, itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: `fs_fiber_${suffix}`, itemTypeId: "plant_fiber", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  return processCommand(ctx(s), { playerId: s.player.id, clientCommandId: `fs_${suffix}`, command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: p.x, y: p.y } } });
}

test("TryCombination (crouch): cada 3er craft dispara un pensamiento de fatiga (Decision 6), sin bloquear el craft", () => {
  const s = seedState(index, template);
  const r1 = craftCrudeToolCrouchAt(s, "a");
  const r2 = craftCrudeToolCrouchAt(s, "b");
  const r3 = craftCrudeToolCrouchAt(s, "c");
  for (const r of [r1, r2, r3]) assert.equal(r.accepted, true, JSON.stringify(r));
  const fatigueIn = (r: typeof r1) => r.events.some((e) => e.type === "ThoughtAdded" && e.thought.text.includes("cansa"));
  assert.ok(!fatigueIn(r1), "1er craft: sin fatiga");
  assert.ok(!fatigueIn(r2), "2do craft: sin fatiga");
  assert.ok(fatigueIn(r3), "3er craft: dispara la fatiga (N=3)");
  assert.ok(r3.events.some((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "crude_tool"), "la fatiga NUNCA bloquea el craft — sigue disponible");
  assert.equal(s.crouchCraftCount, 3);
});

test("TryCombination (surface): los crafts en la mesa NUNCA incrementan crouchCraftCount ni disparan fatiga", () => {
  const s = seedState(index, template);
  withTableNear(s);
  for (let i = 0; i < 3; i++) {
    addOnSurface(s, "small_stone", TABLE_ID, 0, 0);
    addOnSurface(s, "dry_branch", TABLE_ID, 0, 1, 90);
    addOnSurface(s, "plant_fiber", TABLE_ID, 2, 0);
    const r = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: `srf_fatigue_${i}`, command: { type: "TryCombination", method: "surface", target: { kind: "world_object", id: TABLE_ID } } });
    assert.equal(r.accepted, true, JSON.stringify(r));
    assert.ok(!r.events.some((e) => e.type === "ThoughtAdded" && e.thought.text.includes("cansa")), `craft ${i}: la mesa nunca fatiga`);
  }
  assert.equal(s.crouchCraftCount, 0, "los crafts vía mesa jamás incrementan el contador de fatiga");
});

// --- MANDATORY (Slice D, Decision 5 criterio #6): completion guarantee ---

test("MANDATORY: hacha crouch-crafteada (durability 20) sobrevive despejar un tile de dense_jungle", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  s.items.push({ id: "ax_head", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "ax_handle", itemTypeId: "poor_wood", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "ax_binder", itemTypeId: "plant_fiber", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  const craft = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "ax1", command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: p.x, y: p.y } } });
  assert.equal(craft.accepted, true, JSON.stringify(craft));
  const axeEv = craft.events.find((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "simple_axe");
  assert.ok(axeEv, "craftea el hacha agachado");
  const axe = (axeEv as Extract<typeof axeEv, { type: "ItemAddedToInventory" }>).item;
  assert.equal(axe.durability, 20, "quality crouch (0.5) * base 40 = 20");

  const equip = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "ax2", command: { type: "MoveItem", itemInstanceId: axe.id, to: { type: "hand", hand: "left" } } });
  assert.equal(equip.accepted, true, JSON.stringify(equip));

  s.player.position = { x: 8, y: 3 };
  const clear = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "ax3", command: { type: "ExecuteAction", actionId: "clear_jungle", target: { kind: "tile", x: 8, y: 2 } } });
  assert.equal(clear.accepted, true, JSON.stringify(clear));
  assert.ok(clear.events.some((e) => e.type === "TileChanged" && e.terrain === "dirt"), "el tile despeja con margen (20 durability - 8 de daño = 12)");
  const toolDamaged = clear.events.find((e) => e.type === "ToolDamaged");
  assert.ok(toolDamaged, "la herramienta se dañó pero sobrevivió");
  assert.ok((toolDamaged as Extract<typeof toolDamaged, { type: "ToolDamaged" }>).durability >= 0);
});

test("MANDATORY: la cadena de 20 min se completa AGACHADO-SOLO — crude tool -> madera pobre -> hacha simple -> despejar un tile de jungla, SIN mesa", () => {
  const s = seedState(index, template);
  const p = s.player.position;

  // 1. Crouch-craft crude_tool on the player's spawn tile — no mesa involved.
  s.items.push({ id: "ch_stone", itemTypeId: "small_stone", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "ch_branch", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  s.items.push({ id: "ch_fiber1", itemTypeId: "plant_fiber", location: { type: "world", zoneId: s.zone.id, x: p.x, y: p.y } });
  const craftTool = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "ch1", command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: p.x, y: p.y } } });
  assert.equal(craftTool.accepted, true, JSON.stringify(craftTool));
  const toolAdded = craftTool.events.find((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "crude_tool");
  assert.ok(toolAdded, "paso 1: crafteó la herramienta rudimentaria agachado");
  const crudeTool = (toolAdded as Extract<typeof toolAdded, { type: "ItemAddedToInventory" }>).item;
  assert.equal(crudeTool.durability, 10, "quality crouch (0.5) * base 20 = 10");

  // 2. Equip it in the active hand so cut_tree_crude's `hand` requirement is met.
  const equip1 = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "ch2", command: { type: "MoveItem", itemInstanceId: crudeTool.id, to: { type: "hand", hand: "left" } } });
  assert.equal(equip1.accepted, true, JSON.stringify(equip1));

  // 3. Cut a tree with it -> madera pobre.
  const tree = s.objects.find((o) => o.objectTypeId === "tree")!;
  s.player.position = { x: tree.position.x, y: tree.position.y + 1 };
  const cut = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "ch3", command: { type: "ExecuteAction", actionId: "cut_tree_crude", target: { kind: "world_object", id: tree.id } } });
  assert.equal(cut.accepted, true, JSON.stringify(cut));
  const woodAdded = cut.events.find((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "poor_wood");
  assert.ok(woodAdded, "paso 3: obtiene madera pobre con la herramienta rudimentaria");
  const poorWood = (woodAdded as Extract<typeof woodAdded, { type: "ItemAddedToInventory" }>).item;
  assert.ok(cut.events.some((e) => e.type === "ToolDamaged"), "la herramienta (ahora dañable, fix #2853) se dañó al cortar");

  // 4. Gather crude_tool + poor_wood + a fresh plant_fiber onto ONE tile's ground
  //    (crouch method reads ONLY that tile's ground items — per-tile amendment
  //    #2857) and crouch-craft the simple_axe. Back at the original spawn tile.
  const combineAt = { x: p.x, y: p.y };
  s.items.find((i) => i.id === crudeTool.id)!.location = { type: "world", zoneId: s.zone.id, x: combineAt.x, y: combineAt.y };
  s.items.find((i) => i.id === poorWood.id)!.location = { type: "world", zoneId: s.zone.id, x: combineAt.x, y: combineAt.y };
  s.items.push({ id: "ch_fiber2", itemTypeId: "plant_fiber", location: { type: "world", zoneId: s.zone.id, x: combineAt.x, y: combineAt.y } });
  s.player.position = combineAt;

  const craftAxe = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "ch4", command: { type: "TryCombination", method: "crouch", target: { kind: "tile", x: combineAt.x, y: combineAt.y } } });
  assert.equal(craftAxe.accepted, true, JSON.stringify(craftAxe));
  const axeAdded = craftAxe.events.find((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "simple_axe");
  assert.ok(axeAdded, "paso 4: crafteó el hacha simple agachado (sin mesa)");
  const simpleAxe = (axeAdded as Extract<typeof axeAdded, { type: "ItemAddedToInventory" }>).item;
  assert.equal(simpleAxe.durability, 20, "quality crouch (0.5) * base 40 = 20 — coincide con el ejemplo del diseño");

  // 5. Equip the axe and clear one dense_jungle tile — criterio #6.
  const equip2 = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "ch5", command: { type: "MoveItem", itemInstanceId: simpleAxe.id, to: { type: "hand", hand: "left" } } });
  assert.equal(equip2.accepted, true, JSON.stringify(equip2));

  s.player.position = { x: 8, y: 3 };
  const clear = processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "ch6", command: { type: "ExecuteAction", actionId: "clear_jungle", target: { kind: "tile", x: 8, y: 2 } } });
  assert.equal(clear.accepted, true, JSON.stringify(clear));
  assert.ok(clear.events.some((e) => e.type === "TileChanged" && e.terrain === "dirt"), "paso 5: el tile de jungla se despeja — la cadena completa AGACHADO-SOLO, sin mesa");
  assert.equal(s.crouchCraftCount, 2, "2 crafts agachados en toda la cadena (crude_tool + simple_axe) — no alcanza el umbral de fatiga (N=3)");
});
