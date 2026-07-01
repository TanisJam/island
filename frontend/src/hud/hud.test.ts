import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, ItemInstance, Thought } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { hasDiscoveryThought, inventoryAddedMessage, inventoryItemIds, newlyAddedToInventory } from "./hud";

/**
 * `hud.ts` is otherwise DOM-heavy and only gets smoke coverage by design
 * (see window-manager.test.ts's docstring) — `hasDiscoveryThought` is the one
 * PURE decision extracted out of it (whether a batch of newly-appended
 * `thoughtLog` entries should trigger `flashDiscovery()`), so it gets a real
 * unit test.
 */

function thought(kind: Thought["kind"], text = "x"): Thought {
  return { id: `th_${kind}`, text, kind, timestamp: 0 };
}

test("hasDiscoveryThought: false for an empty batch", () => {
  assert.equal(hasDiscoveryThought([]), false);
});

test("hasDiscoveryThought: false when no thought in the batch is kind 'discovery'", () => {
  assert.equal(hasDiscoveryThought([thought("observation"), thought("warning"), thought("idea")]), false);
});

test("hasDiscoveryThought: true when at least one thought in the batch is kind 'discovery'", () => {
  assert.equal(hasDiscoveryThought([thought("observation"), thought("discovery")]), true);
});

// --- inventoryItemIds / newlyAddedToInventory / inventoryAddedMessage -----
// (fix-list: "No feedback when an item is added to the inventory" — the
// pure detection + message-building logic behind hud/ui.ts's mount().)

const catalog: Catalog = {
  catalogVersion: "test",
  terrains: [],
  items: [
    { id: "seed", name: "Semilla", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: [] },
    { id: "stick", name: "Palo", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: [] },
  ],
  worldObjects: [],
  knowledge: [],
  actions: [],
  research: [],
};

function inventoryItem(id: string, itemTypeId: string, x = 0, y = 0): ItemInstance {
  return { id, itemTypeId, location: { type: "player_inventory", playerId: "p1", x, y, rotation: 0 } };
}

function worldItem(id: string, itemTypeId: string): ItemInstance {
  return { id, itemTypeId, location: { type: "world", zoneId: "z1", x: 3, y: 3 } };
}

function snapshotWithItems(items: ItemInstance[]): ClientSnapshot {
  return {
    zone: { id: "z1", width: 10, height: 10 },
    visionRadius: 5,
    tiles: [],
    objects: [],
    piles: [],
    items,
    player: { id: "p1", name: "Náufrago", position: { x: 0, y: 0 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
  };
}

test("inventoryItemIds: only includes items whose location.type is player_inventory", () => {
  const snapshot = snapshotWithItems([inventoryItem("it1", "seed"), worldItem("it2", "stick")]);
  assert.deepEqual(inventoryItemIds(snapshot), new Set(["it1"]));
});

test("newlyAddedToInventory: empty when nothing new entered the inventory", () => {
  const snapshot = snapshotWithItems([inventoryItem("it1", "seed")]);
  const previous = new Set(["it1"]);
  assert.deepEqual(newlyAddedToInventory(previous, snapshot), []);
});

test("newlyAddedToInventory: returns items present in inventory now but not in previousIds", () => {
  const snapshot = snapshotWithItems([inventoryItem("it1", "seed"), inventoryItem("it2", "stick")]);
  const previous = new Set(["it1"]); // it2 just arrived
  const added = newlyAddedToInventory(previous, snapshot);
  assert.deepEqual(added.map((i) => i.id), ["it2"]);
});

test("newlyAddedToInventory: a world item is never reported as newly added, even if its id is unknown", () => {
  const snapshot = snapshotWithItems([worldItem("it3", "seed")]);
  assert.deepEqual(newlyAddedToInventory(new Set(), snapshot), []);
});

test("inventoryAddedMessage: single item produces one line naming it", () => {
  const msg = inventoryAddedMessage(catalog, [inventoryItem("it1", "seed")]);
  assert.equal(msg, "Guardé Semilla en la mochila.");
});

test("inventoryAddedMessage: multiple items join with 'y', still a single line", () => {
  const msg = inventoryAddedMessage(catalog, [inventoryItem("it1", "seed"), inventoryItem("it2", "stick")]);
  assert.equal(msg, "Guardé Semilla y Palo en la mochila.");
});
