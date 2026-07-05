import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, ItemInstance } from "../contract";
import type { ClientSnapshot } from "./snapshot";
import { createObservedStore, isRevealed } from "./observed";

const catalog: Catalog = {
  catalogVersion: "test",
  terrains: [],
  items: [
    { id: "rama", name: "Rama", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: ["wood", "flexible"] },
    { id: "small_stone", name: "Piedra", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: ["mineral"] },
  ],
  worldObjects: [],
  knowledge: [{ id: "k_wood", name: "Sobre la madera", kind: "idea", unlockOnObserveTags: ["wood"] }],
  actions: [],
  research: [],
};

function ramaItem(id = "it1"): ItemInstance {
  return { id, itemTypeId: "rama", location: { type: "world", zoneId: "z1", x: 0, y: 0 } };
}

function snapshotWithKnowledge(knowledge: string[]): ClientSnapshot {
  return {
    zone: { id: "z1", width: 10, height: 10 },
    visionRadius: 5,
    tiles: [],
    objects: [],
    piles: [],
    items: [],
    player: { id: "p1", name: "Náufrago", position: { x: 0, y: 0 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
  };
}

test("createObservedStore: has() is false before add(), true after", () => {
  const store = createObservedStore();
  assert.equal(store.has("rama"), false);
  store.add("rama");
  assert.equal(store.has("rama"), true);
});

test("isRevealed: false when the item's type is neither observed nor covered by an unlocked knowledge", () => {
  const store = createObservedStore();
  assert.equal(isRevealed(store, catalog, snapshotWithKnowledge([]), ramaItem()), false);
});

test("isRevealed: true once the item's type is in the observed set", () => {
  const store = createObservedStore();
  store.add("rama");
  assert.equal(isRevealed(store, catalog, snapshotWithKnowledge([]), ramaItem()), true);
});

test("isRevealed: true when a knowledge whose unlockOnObserveTags intersects the item's tags is already unlocked, even with an empty observed set", () => {
  const store = createObservedStore();
  assert.equal(isRevealed(store, catalog, snapshotWithKnowledge(["k_wood"]), ramaItem()), true);
});

test("isRevealed: an unrelated unlocked knowledge does not reveal a non-matching item's properties", () => {
  const store = createObservedStore();
  const stone: ItemInstance = { id: "it2", itemTypeId: "small_stone", location: { type: "world", zoneId: "z1", x: 0, y: 0 } };
  assert.equal(isRevealed(store, catalog, snapshotWithKnowledge(["k_wood"]), stone), false);
});
