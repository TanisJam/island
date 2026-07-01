import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { seedState } from "../bootstrap/seed";
import { processCommand } from "../application/process-command";
import { GameService } from "../application/game-service";
import { InMemoryGameRepository } from "../infrastructure/persistence/in-memory-repo";
import type { EngineCtx } from "./engine";
import type { GameState } from "./state";
import { derivePiles } from "./piles";

const { index } = loadCatalog();
const ctx = (state: GameState): EngineCtx => ({ state, index, rng: () => 0, now: () => 1 });

function addInInventory(s: GameState, id: string, itemTypeId: string, x: number, y: number): void {
  s.items.push({ id, itemTypeId, location: { type: "player_inventory", playerId: s.player.id, x, y, rotation: 0 } });
}
const drop = (s: GameState, itemInstanceId: string, x: number, y: number) =>
  processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "c", command: { type: "DropItem", itemInstanceId, to: { x, y } } });
const take = (s: GameState, id: string) =>
  processCommand(ctx(s), { playerId: s.player.id, clientCommandId: "c", command: { type: "TakeItem", target: { kind: "item", id } } });

test("dropping a second same-type item on a tile forms a pile", () => {
  const s = seedState(index);
  const p = s.player.position;
  addInInventory(s, "st1", "small_stone", 1, 1);
  addInInventory(s, "st2", "small_stone", 2, 1);

  const r1 = drop(s, "st1", p.x, p.y);
  assert.ok(r1.accepted);
  assert.equal(s.piles.length, 0, "one item alone is not a pile");

  const r2 = drop(s, "st2", p.x, p.y);
  assert.ok(r2.accepted);
  const pileEvt = r2.events.find((e) => e.type === "PileChanged");
  assert.ok(pileEvt && pileEvt.type === "PileChanged" && pileEvt.pile.itemInstanceIds.length === 2, "emits PileChanged with 2 members");
  assert.equal(s.piles.length, 1, "pile is stored in state");
  assert.deepEqual([...s.piles[0]!.itemInstanceIds].sort(), ["st1", "st2"]);
});

test("taking one item from a pile of two dissolves it", () => {
  const s = seedState(index);
  const p = s.player.position;
  addInInventory(s, "st1", "small_stone", 1, 1);
  addInInventory(s, "st2", "small_stone", 2, 1);
  drop(s, "st1", p.x, p.y);
  drop(s, "st2", p.x, p.y);
  assert.equal(s.piles.length, 1);

  const r = take(s, "st1");
  assert.ok(r.accepted, JSON.stringify(r));
  const pileEvt = r.events.find((e) => e.type === "PileChanged");
  assert.ok(pileEvt && pileEvt.type === "PileChanged" && pileEvt.pile.itemInstanceIds.length < 2, "emits a dissolving PileChanged");
  assert.equal(s.piles.length, 0, "pile is removed once under 2 items");
});

test("different item types on the same tile do not pile together", () => {
  const s = seedState(index);
  const p = s.player.position;
  addInInventory(s, "st", "small_stone", 1, 1);
  addInInventory(s, "br", "dry_branch", 2, 1);
  drop(s, "st", p.x, p.y);
  drop(s, "br", p.x, p.y);
  assert.equal(s.piles.length, 0, "one of each type is not a pile");
});

test("derivePiles groups same-type world items, ignoring singles and inventory", () => {
  const s = seedState(index);
  addInInventory(s, "inv", "small_stone", 1, 1); // inventory item must be ignored
  s.items.push({ id: "w1", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: 4, y: 4 } });
  s.items.push({ id: "w2", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: 4, y: 4 } });
  s.items.push({ id: "w3", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: 5, y: 5 } }); // lone item elsewhere

  const piles = derivePiles(s);
  assert.equal(piles.size, 1, "only the pair at (4,4) forms a pile");
  const pile = [...piles.values()][0]!;
  assert.deepEqual([...pile.itemInstanceIds].sort(), ["w1", "w2"]);
  assert.deepEqual(pile.position, { x: 4, y: 4 });
});

test("zoneSnapshot derives piles from pre-grouped world items with no command run", () => {
  // Regression: the served snapshot must reflect grouped items even if state was
  // constructed (seed/load) with a stale or empty `piles`, since no command ran.
  const s = seedState(index);
  s.piles = []; // force a stale piles array
  s.items.push({ id: "b1", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: 6, y: 6 } });
  s.items.push({ id: "b2", itemTypeId: "dry_branch", location: { type: "world", zoneId: s.zone.id, x: 6, y: 6 } });

  const repo = new InMemoryGameRepository();
  repo.save(s);
  const snap = new GameService(index, repo, "p1").zoneSnapshot("z1")!;

  const pile = snap.piles.find((p) => p.position.x === 6 && p.position.y === 6);
  assert.ok(pile, "served snapshot derives the pile even though no command ran");
  assert.deepEqual([...pile!.itemInstanceIds].sort(), ["b1", "b2"]);
});
