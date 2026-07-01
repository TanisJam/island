import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemInstance } from "../contract/events";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { seedState } from "../bootstrap/seed";
import { executeAction, type EngineCtx } from "./engine";
import type { GameState } from "./state";

const { index } = loadCatalog();
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
  const s = seedState(index);
  const tree = s.objects.find((o) => o.objectTypeId === "tree")!;
  s.player.position = { x: tree.position.x, y: tree.position.y + 1 };
  const evs = events(executeAction(ctx(s), "pull_branches", { kind: "world_object", id: tree.id }));
  assert.ok(evs.some((e) => e.type === "ItemAddedToInventory" && e.item.itemTypeId === "dry_branch"), "agrega rama");
  assert.ok(evs.some((e) => e.type === "EnergyChanged" && e.energy === 99), "consume 1 de energía");
});

test("improvisar herramienta: crea crude_tool y desbloquea técnica, consumiendo inputs", () => {
  const s = seedState(index);
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
  const s = seedState(index);
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
  const s = seedState(index);
  const tree = s.objects.find((o) => o.objectTypeId === "tree")!;
  s.player.position = { x: tree.position.x, y: tree.position.y + 1 };
  addInHand(s, "crude_tool", 20);
  s.player.energy = 1;
  const r = executeAction(ctx(s), "cut_tree_crude", { kind: "world_object", id: tree.id });
  assert.ok("rejection" in r && r.rejection.code === "insufficient_energy", JSON.stringify(r));
});

test("acción inexistente: rechaza con not_applicable", () => {
  const s = seedState(index);
  const r = executeAction(ctx(s), "no_existe", { kind: "self" });
  assert.ok("rejection" in r && r.rejection.code === "not_applicable");
});
