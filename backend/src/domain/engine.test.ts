import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemInstance, WorldObject } from "../contract/events";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { loadZone } from "../infrastructure/zone/loader";
import { seedState } from "../bootstrap/seed";
import { executeAction, type EngineCtx } from "./engine";
import type { GameState } from "./state";

const { index } = loadCatalog();
const template = loadZone("z1");
const ctx = (state: GameState): EngineCtx => ({ state, index, rng: () => 0, now: () => 1 });
const events = (r: ReturnType<typeof executeAction>) => ("events" in r ? r.events : []);

function addInHand(s: GameState, itemTypeId: string, durability?: number): void {
  const it: ItemInstance = { id: `hand_${itemTypeId}`, itemTypeId, location: { type: "player_inventory", playerId: s.player.id, x: 0, y: 0, rotation: 0 } };
  if (durability !== undefined) it.durability = durability;
  s.items.push(it);
}
function addOnGround(s: GameState, itemTypeId: string, x: number, y: number): void {
  s.items.push({ id: `gnd_${itemTypeId}`, itemTypeId, location: { type: "world", zoneId: s.zone.id, x, y } });
}

test("arrancar ramas: da rama seca y consume energía", () => {
  const s = seedState(index, template);
  const tree = s.objects.find((o) => o.objectTypeId === "tree")!;
  s.player.position = { x: tree.position.x, y: tree.position.y + 1 };
  const evs = events(executeAction(ctx(s), "pull_branches", { kind: "world_object", id: tree.id }));
  assert.ok(evs.some((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "dry_branch"), "agrega rama");
  assert.ok(evs.some((e) => e.type === "EnergyChanged" && e.energy === 99), "consume 1 de energía");
});

test("improvisar herramienta: crea crude_tool y desbloquea técnica, consumiendo inputs", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "small_stone", p.x, p.y);
  addOnGround(s, "dry_branch", p.x, p.y);
  addOnGround(s, "plant_fiber", p.x, p.y);
  const r = executeAction(ctx(s), "improvise_crude_tool", { kind: "tile", x: p.x, y: p.y });
  const evs = events(r);
  assert.ok("events" in r, JSON.stringify(r));
  assert.ok(evs.some((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "crude_tool"), "crea herramienta");
  assert.ok(evs.some((e) => e.type === "KnowledgeUnlocked" && e.knowledgeId === "tech_basic_binding"), "desbloquea técnica");
  assert.ok(evs.filter((e) => e.type === "ItemRemovedFromWorld").length === 3, "consume los 3 inputs");
});

test("despejar jungla: cambia el tile a tierra, revela y daña el hacha", () => {
  const s = seedState(index, template);
  s.player.position = { x: 8, y: 3 };
  addInHand(s, "simple_axe", 40);
  const r = executeAction(ctx(s), "clear_jungle", { kind: "tile", x: 8, y: 2 });
  const evs = events(r);
  assert.ok("events" in r, JSON.stringify(r));
  assert.ok(evs.some((e) => e.type === "TileChanged" && e.terrain === "dirt"), "jungla -> tierra");
  assert.ok(evs.some((e) => e.type === "TilesRevealed"), "revela zona");
  assert.ok(evs.some((e) => e.type === "ToolDamaged"), "daña el hacha");
});

test("sin energía suficiente: rechaza con insufficient_energy", () => {
  const s = seedState(index, template);
  const tree = s.objects.find((o) => o.objectTypeId === "tree")!;
  s.player.position = { x: tree.position.x, y: tree.position.y + 1 };
  addInHand(s, "crude_tool", 20);
  s.player.energy = 1;
  const r = executeAction(ctx(s), "cut_tree_crude", { kind: "world_object", id: tree.id });
  assert.ok("rejection" in r && r.rejection.code === "insufficient_energy", JSON.stringify(r));
});

test("acción inexistente: rechaza con not_applicable", () => {
  const s = seedState(index, template);
  const r = executeAction(ctx(s), "no_existe", { kind: "self" });
  assert.ok("rejection" in r && r.rejection.code === "not_applicable");
});

// --- gatherCandidates conditioned "surface" scope resolution (target-declares-surfaceGrid) ---

function addTable(s: GameState, x: number, y: number): string {
  const id = "wo_table_engine";
  s.objects.push({ id, objectTypeId: "rustic_table", position: { x, y }, state: {}, tags: [], visibility: "visible" });
  s.inventories[id] = { width: 3, height: 2 };
  return id;
}

function addOnSurface(s: GameState, itemTypeId: string, surfaceId: string, x: number, y: number, rotation = 0): void {
  s.items.push({ id: `srf_${itemTypeId}_${x}_${y}`, itemTypeId, location: { type: "surface", surfaceId, x, y, rotation } });
}

test("craft_simple_axe: la mesa (con grid) sólo lee items REALMENTE colocados, no items sueltos cercanos", () => {
  const s = seedState(index, template);
  const tableId = addTable(s, 8, 8);
  s.player.position = { x: 8, y: 7 };
  // head + binder available via "hands"/"adjacent_ground" (unaffected scopes), so ONLY
  // the handle's availability depends on how "surface" scope resolves.
  addInHand(s, "crude_tool"); // head
  addOnGround(s, "plant_fiber", 8, 7); // binder, next to the player (adjacent_ground)
  // handle placed loose next to the TABLE (not the player, and NOT on its grid) — must
  // NOT be picked up via "surface" scope now that the table declares a real grid.
  addOnGround(s, "poor_wood", 8, 9);
  const r = executeAction(ctx(s), "craft_simple_axe", { kind: "world_object", id: tableId });
  assert.ok("rejection" in r && r.rejection.code === "missing_inputs", JSON.stringify(r));
});

test("craft_simple_axe: loop completo — colocar head/handle/binder en la mesa y craftear consume exactamente esos", () => {
  const s = seedState(index, template);
  const tableId = addTable(s, 8, 8);
  s.player.position = { x: 8, y: 7 };
  addOnSurface(s, "crude_tool", tableId, 0, 0, 90); // head, 1x2 rotated to 2x1 -> fits (0,0)-(1,0)
  addOnSurface(s, "poor_wood", tableId, 0, 1, 90); // handle, 2x1 at (0,1)-(1,1)
  addOnSurface(s, "plant_fiber", tableId, 2, 0); // binder, 1x1 at (2,0)
  const r = executeAction(ctx(s), "craft_simple_axe", { kind: "world_object", id: tableId });
  const evs = events(r);
  assert.ok("events" in r, JSON.stringify(r));
  assert.ok(evs.some((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "simple_axe"), "crea el hacha");
  const removedIds = evs.filter((e) => e.type === "ItemRemovedFromWorld").map((e) => (e as { itemInstanceId: string }).itemInstanceId);
  assert.equal(removedIds.length, 0, "los inputs vivían en la superficie, no en 'world' — no deberían salir como ItemRemovedFromWorld");
});

test("improvise_crude_tool: target es un tile (nunca declara surfaceGrid) — el scope 'surface' cae a proximidad, sin regresión", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "small_stone", p.x, p.y);
  addOnGround(s, "dry_branch", p.x, p.y);
  addOnGround(s, "plant_fiber", p.x, p.y);
  const r = executeAction(ctx(s), "improvise_crude_tool", { kind: "tile", x: p.x, y: p.y });
  const evs = events(r);
  assert.ok("events" in r, JSON.stringify(r));
  assert.ok(evs.some((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "crude_tool"), "el fallback de proximidad para 'surface' contra un tile sigue funcionando");
});

test("light_campfire: target es una fogata sin surfaceGrid — el scope 'surface' cae a proximidad, sin regresión", () => {
  const s = seedState(index, template);
  const campfire: WorldObject = { id: "wo_fire_engine", objectTypeId: "campfire", position: { x: 9, y: 9 }, state: { lit: false, fuel: 0 }, tags: [], visibility: "visible" };
  s.objects.push(campfire);
  s.player.position = { x: 9, y: 8 };
  addInHand(s, "crude_tool", 20);
  addOnGround(s, "dry_branch", 9, 9); // fuel, loose nearby (proximity <= 1 of the campfire target)
  const r = executeAction(ctx(s), "light_campfire", { kind: "world_object", id: campfire.id });
  const evs = events(r);
  assert.ok("events" in r, JSON.stringify(r));
  assert.ok(evs.some((e) => e.type === "ItemRemovedFromWorld"), "consume el fuel encontrado por proximidad (fallback), no por grid real");
});
