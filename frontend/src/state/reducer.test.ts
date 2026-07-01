import { test } from "node:test";
import assert from "node:assert/strict";
import type { Event, ItemInstance, Pile, Tile, Thought, WorldObject } from "../contract";
import type { ClientSnapshot } from "./snapshot";
import { applyClientEvent } from "./reducer";

const HAND_LEFT = { x: 0, y: 0 };
const HAND_RIGHT = { x: 3, y: 0 };

function makeTile(x: number, y: number, terrain: Tile["terrain"] = "grass", walkable = true): Tile {
  return { x, y, terrain, walkable, tags: ["ground"], visibility: "visible" };
}

function makeSnapshot(overrides: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    zone: { id: "z1", width: 16, height: 12 },
    visionRadius: 5,
    tiles: [makeTile(8, 9), makeTile(8, 8)],
    objects: [],
    piles: [],
    items: [],
    player: {
      id: "p1",
      name: "Náufrago",
      position: { x: 8, y: 9 },
      energy: 100,
      maxEnergy: 100,
      health: 100,
      maxHealth: 100,
      knowledge: [],
    },
    handSlots: { left: HAND_LEFT, right: HAND_RIGHT },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "v1",
    ...overrides,
  };
}

test("PlayerMoved: updates position and marks the new area as discovered", () => {
  const s = makeSnapshot();
  applyClientEvent(s, { type: "PlayerMoved", playerId: "p1", path: [{ x: 8, y: 8 }], position: { x: 8, y: 8 } });
  assert.deepEqual(s.player.position, { x: 8, y: 8 });
  assert.ok(s.discovered.has("8,8"), "discovers the destination tile");
  assert.ok(s.discovered.has("8,9"), "discovers tiles within VISION_RADIUS of the destination");
});

test("ItemMoved: to.type=hand maps onto the player_inventory cell at handSlots.left", () => {
  const item: ItemInstance = { id: "it_1", itemTypeId: "small_stone", location: { type: "world", zoneId: "z1", x: 8, y: 9 } };
  const s = makeSnapshot({ items: [item] });

  applyClientEvent(s, { type: "ItemMoved", itemInstanceId: "it_1", to: { type: "hand", hand: "left" } });

  const moved = s.items.find((i) => i.id === "it_1")!;
  assert.deepEqual(moved.location, { type: "player_inventory", playerId: "p1", x: HAND_LEFT.x, y: HAND_LEFT.y, rotation: 0 });
});

test("ItemMoved: to.type=hand (right) uses handSlots.right, not a hardcoded coordinate", () => {
  const item: ItemInstance = { id: "it_2", itemTypeId: "dry_branch", location: { type: "world", zoneId: "z1", x: 8, y: 9 } };
  // Non-default hand slots — proves the mapping reads from snapshot.handSlots, not a constant.
  const s = makeSnapshot({ items: [item], handSlots: { left: { x: 5, y: 5 }, right: { x: 9, y: 9 } } });

  applyClientEvent(s, { type: "ItemMoved", itemInstanceId: "it_2", to: { type: "hand", hand: "right" } });

  const moved = s.items.find((i) => i.id === "it_2")!;
  assert.deepEqual(moved.location, { type: "player_inventory", playerId: "p1", x: 9, y: 9, rotation: 0 });
});

test("ItemMoved: to.type=inventory maps onto a player_inventory cell at the given x/y/rotation", () => {
  const item: ItemInstance = { id: "it_3", itemTypeId: "plant_fiber", location: { type: "world", zoneId: "z1", x: 8, y: 9 } };
  const s = makeSnapshot({ items: [item] });

  applyClientEvent(s, { type: "ItemMoved", itemInstanceId: "it_3", to: { type: "inventory", ownerId: "p1", x: 2, y: 1, rotation: 90 } });

  const moved = s.items.find((i) => i.id === "it_3")!;
  assert.deepEqual(moved.location, { type: "player_inventory", playerId: "p1", x: 2, y: 1, rotation: 90 });
});

test("PileChanged: stores a pile, and removes it once it drops below 2 members", () => {
  const s = makeSnapshot();
  const pile: Pile = { id: "pile_z1_8_9_small_stone", itemTypeId: "small_stone", zoneId: "z1", position: { x: 8, y: 9 }, itemInstanceIds: ["a", "b"] };

  applyClientEvent(s, { type: "PileChanged", pile });
  assert.equal(s.piles.length, 1, "a pile with 2 members is stored");

  applyClientEvent(s, { type: "PileChanged", pile: { ...pile, itemInstanceIds: ["a"] } });
  assert.equal(s.piles.length, 0, "a pile dropping below 2 members is removed");
});

test("ItemMoved: to.type=inventory without rotation defaults rotation to 0", () => {
  const item: ItemInstance = { id: "it_4", itemTypeId: "plant_fiber", location: { type: "world", zoneId: "z1", x: 8, y: 9 } };
  const s = makeSnapshot({ items: [item] });

  applyClientEvent(s, { type: "ItemMoved", itemInstanceId: "it_4", to: { type: "inventory", ownerId: "p1", x: 1, y: 1 } });

  const moved = s.items.find((i) => i.id === "it_4")!;
  assert.deepEqual(moved.location, { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 });
});

test("ItemMoved: to.type=world maps onto a world location (drop from inventory)", () => {
  const item: ItemInstance = {
    id: "it_5",
    itemTypeId: "crude_tool",
    location: { type: "player_inventory", playerId: "p1", x: HAND_LEFT.x, y: HAND_LEFT.y, rotation: 0 },
  };
  const s = makeSnapshot({ items: [item] });

  applyClientEvent(s, { type: "ItemMoved", itemInstanceId: "it_5", to: { type: "world", zoneId: "z1", x: 4, y: 4 } });

  const moved = s.items.find((i) => i.id === "it_5")!;
  assert.deepEqual(moved.location, { type: "world", zoneId: "z1", x: 4, y: 4 });
});

test("ItemMoved: to.type=surface maps onto a surface location (mirrors the backend reducer)", () => {
  const item: ItemInstance = { id: "it_7", itemTypeId: "small_stone", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeSnapshot({ items: [item] });

  applyClientEvent(s, { type: "ItemMoved", itemInstanceId: "it_7", to: { type: "surface", surfaceId: "wo_table", x: 0, y: 1, rotation: 90 } });

  const moved = s.items.find((i) => i.id === "it_7")!;
  assert.deepEqual(moved.location, { type: "surface", surfaceId: "wo_table", x: 0, y: 1, rotation: 90 });
});

test("ItemMoved: to.type=surface without rotation defaults rotation to 0", () => {
  const item: ItemInstance = { id: "it_8", itemTypeId: "small_stone", location: { type: "world", zoneId: "z1", x: 8, y: 9 } };
  const s = makeSnapshot({ items: [item] });

  applyClientEvent(s, { type: "ItemMoved", itemInstanceId: "it_8", to: { type: "surface", surfaceId: "wo_table", x: 2, y: 0 } });

  const moved = s.items.find((i) => i.id === "it_8")!;
  assert.deepEqual(moved.location, { type: "surface", surfaceId: "wo_table", x: 2, y: 0, rotation: 0 });
});

test("ItemMoved: unknown itemInstanceId is a no-op (item not found)", () => {
  const s = makeSnapshot({ items: [] });
  applyClientEvent(s, { type: "ItemMoved", itemInstanceId: "missing", to: { type: "hand", hand: "left" } });
  assert.equal(s.items.length, 0);
});

test("ItemAddedToInventory: pushes the item once, ignores duplicates", () => {
  const item: ItemInstance = { id: "it_6", itemTypeId: "small_stone", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeSnapshot();
  applyClientEvent(s, { type: "ItemAddedToInventory", item });
  applyClientEvent(s, { type: "ItemAddedToInventory", item });
  assert.equal(s.items.filter((i) => i.id === "it_6").length, 1);
});

test("ItemRemovedFromWorld / ItemRemovedFromInventory / ItemBroke: filter the item out", () => {
  const s = makeSnapshot({
    items: [
      { id: "a", itemTypeId: "x", location: { type: "world", zoneId: "z1", x: 0, y: 0 } },
      { id: "b", itemTypeId: "x", location: { type: "world", zoneId: "z1", x: 0, y: 0 } },
    ],
  });
  applyClientEvent(s, { type: "ItemRemovedFromWorld", itemInstanceId: "a" });
  assert.deepEqual(s.items.map((i) => i.id), ["b"]);
  applyClientEvent(s, { type: "ItemBroke", itemInstanceId: "b" });
  assert.deepEqual(s.items, []);
});

test("WorldObjectStateChanged: merges new state keys without dropping existing ones", () => {
  const obj: WorldObject = { id: "wo_1", objectTypeId: "campfire", position: { x: 1, y: 1 }, state: { lit: false, fuel: 0 } };
  const s = makeSnapshot({ objects: [obj] });
  applyClientEvent(s, { type: "WorldObjectStateChanged", objectId: "wo_1", state: { lit: true } });
  const updated = s.objects.find((o) => o.id === "wo_1")!;
  assert.deepEqual(updated.state, { lit: true, fuel: 0 });
});

test("WorldObjectRemoved: filters the object out", () => {
  const obj: WorldObject = { id: "wo_2", objectTypeId: "tree", position: { x: 1, y: 1 }, state: {} };
  const s = makeSnapshot({ objects: [obj] });
  applyClientEvent(s, { type: "WorldObjectRemoved", objectId: "wo_2" });
  assert.deepEqual(s.objects, []);
});

test("TileChanged: updates terrain and walkable on the matching tile", () => {
  const s = makeSnapshot({ tiles: [makeTile(2, 2, "dense_jungle", false)] });
  applyClientEvent(s, { type: "TileChanged", position: { x: 2, y: 2 }, terrain: "dirt", walkable: true });
  const tile = s.tiles.find((t) => t.x === 2 && t.y === 2)!;
  assert.equal(tile.terrain, "dirt");
  assert.equal(tile.walkable, true);
});

test("TilesRevealed: adds every tile position to discovered", () => {
  const s = makeSnapshot();
  applyClientEvent(s, {
    type: "TilesRevealed",
    tiles: [makeTile(20, 20), makeTile(21, 20)],
  });
  assert.ok(s.discovered.has("20,20"));
  assert.ok(s.discovered.has("21,20"));
});

test("EnergyChanged: sets player.energy", () => {
  const s = makeSnapshot();
  applyClientEvent(s, { type: "EnergyChanged", energy: 42 });
  assert.equal(s.player.energy, 42);
});

test("ToolDamaged: sets durability on the matching item", () => {
  const item: ItemInstance = { id: "tool_1", itemTypeId: "crude_tool", durability: 20, location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
  const s = makeSnapshot({ items: [item] });
  applyClientEvent(s, { type: "ToolDamaged", itemInstanceId: "tool_1", durability: 18 });
  assert.equal(s.items.find((i) => i.id === "tool_1")!.durability, 18);
});

test("KnowledgeUnlocked: appends once, no duplicates", () => {
  const s = makeSnapshot();
  applyClientEvent(s, { type: "KnowledgeUnlocked", knowledgeId: "idea_binding" });
  applyClientEvent(s, { type: "KnowledgeUnlocked", knowledgeId: "idea_binding" });
  assert.deepEqual(s.player.knowledge, ["idea_binding"]);
});

test("ThoughtAdded: appends to thoughtLog", () => {
  const s = makeSnapshot();
  const thought: Thought = { id: "th_1", text: "Hola", kind: "observation", timestamp: 1 };
  applyClientEvent(s, { type: "ThoughtAdded", thought });
  assert.deepEqual(s.thoughtLog, [thought]);
});

test("ActionFailed: appends thought only when present", () => {
  const s = makeSnapshot();
  applyClientEvent(s, { type: "ActionFailed", actionId: "x" });
  assert.deepEqual(s.thoughtLog, []);
  const thought: Thought = { id: "th_2", text: "Fallé", kind: "failure", timestamp: 1 };
  applyClientEvent(s, { type: "ActionFailed", actionId: "x", thought });
  assert.deepEqual(s.thoughtLog, [thought]);
});

test("PileChanged: upserts by pile id", () => {
  const pile: Pile = { id: "pile_1", itemTypeId: "small_stone", zoneId: "z1", position: { x: 1, y: 1 }, itemInstanceIds: ["a"] };
  const s = makeSnapshot({ piles: [pile] });
  const updated: Pile = { ...pile, itemInstanceIds: ["a", "b"] };
  applyClientEvent(s, { type: "PileChanged", pile: updated });
  assert.equal(s.piles.length, 1);
  assert.deepEqual(s.piles[0]!.itemInstanceIds, ["a", "b"]);
});

test("ActiveHandsChanged: no-op (derived, nothing to store)", () => {
  const s = makeSnapshot();
  const before = JSON.stringify(s, (_k, v) => (v instanceof Set ? [...v] : v));
  applyClientEvent(s, { type: "ActiveHandsChanged", left: "it_1" } as Event);
  const after = JSON.stringify(s, (_k, v) => (v instanceof Set ? [...v] : v));
  assert.equal(before, after);
});
