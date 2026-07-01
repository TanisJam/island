import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemInstance, Tile, WorldObject } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { tileHasContent } from "./mouse";

/**
 * `tileHasContent` is the pure decision behind the click-resolution model
 * fix (fix-list: "clicking a tile that has floor items or a world object
 * moves the player directly instead of opening the contextual menu"):
 * `onCanvasClick` is otherwise DOM/canvas-heavy and only gets smoke coverage
 * by design (see window-manager.test.ts's docstring for the same pattern) —
 * this one PURE decision is what actually gets a real unit test.
 */

function makeTile(x: number, y: number, walkable = true): Tile {
  return { x, y, terrain: "grass", walkable, tags: [], visibility: "visible" };
}

function makeSnapshot(overrides: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    zone: { id: "z1", width: 16, height: 12 },
    visionRadius: 5,
    tiles: [makeTile(5, 5), makeTile(6, 5), makeTile(7, 5)],
    objects: [],
    piles: [],
    items: [],
    player: { id: "p1", name: "Náufrago", position: { x: 5, y: 5 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
    ...overrides,
  };
}

test("tileHasContent: true for the player's own tile, even with nothing else there", () => {
  const s = makeSnapshot();
  assert.equal(tileHasContent(s, { x: 5, y: 5 }), true);
});

test("tileHasContent: true when a world object sits on the tile", () => {
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 6, y: 5 }, state: {} };
  const s = makeSnapshot({ objects: [object] });
  assert.equal(tileHasContent(s, { x: 6, y: 5 }), true);
});

test("tileHasContent: true when a loose ground item sits on the tile", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "world", zoneId: "z1", x: 7, y: 5 } };
  const s = makeSnapshot({ items: [item] });
  assert.equal(tileHasContent(s, { x: 7, y: 5 }), true);
});

test("tileHasContent: false for a plain empty tile — the direct-move case", () => {
  const s = makeSnapshot();
  assert.equal(tileHasContent(s, { x: 7, y: 5 }), false);
});

test("tileHasContent: an inventory item (not on the ground) never counts as content on an unrelated tile", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
  const s = makeSnapshot({ items: [item] });
  assert.equal(tileHasContent(s, { x: 7, y: 5 }), false);
});

test("tileHasContent: a world object elsewhere does not make an unrelated empty tile count as content", () => {
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 6, y: 5 }, state: {} };
  const s = makeSnapshot({ objects: [object] });
  assert.equal(tileHasContent(s, { x: 7, y: 5 }), false);
});
