import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, ItemInstance, Thought } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import {
  hasDiscoveryThought,
  inventoryAddedMessage,
  inventoryItemIds,
  newlyAddedToInventory,
  occupiedCellsForItem,
  renderSurfaceGrid,
  surfaceCellMessage,
} from "./hud";

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

// --- occupiedCellsForItem / renderSurfaceGrid -----------------------------
// (crafting-surface change, R7: the surface-grid window renders REAL state.)

const surfaceCatalog: Catalog = {
  catalogVersion: "test",
  terrains: [],
  items: [
    { id: "small_stone", name: "Piedra", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: [] },
    { id: "poor_wood", name: "Palo pobre", description: "", shape: { w: 1, h: 2 }, rotatable: true, properties: {}, tags: [] },
  ],
  worldObjects: [],
  knowledge: [],
  actions: [],
  research: [],
};

function surfaceItem(id: string, itemTypeId: string, surfaceId: string, x: number, y: number, rotation: 0 | 90 = 0): ItemInstance {
  return { id, itemTypeId, location: { type: "surface", surfaceId, x, y, rotation } };
}

test("occupiedCellsForItem: an item not on any surface occupies nothing", () => {
  const item = inventoryItem("it1", "small_stone");
  assert.deepEqual(occupiedCellsForItem(item, surfaceCatalog), []);
});

test("occupiedCellsForItem: a 1x1 item occupies exactly its own cell", () => {
  const item = surfaceItem("it1", "small_stone", "wo_table", 0, 0);
  assert.deepEqual(occupiedCellsForItem(item, surfaceCatalog), [{ x: 0, y: 0 }]);
});

test("occupiedCellsForItem: an unrotated 1x2 item occupies two cells stacked vertically", () => {
  const item = surfaceItem("it1", "poor_wood", "wo_table", 1, 0);
  assert.deepEqual(occupiedCellsForItem(item, surfaceCatalog), [
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ]);
});

test("occupiedCellsForItem: rotation 90 swaps w/h, same as the backend's cellsOnGrid", () => {
  const item = surfaceItem("it1", "poor_wood", "wo_table", 1, 0, 90);
  assert.deepEqual(occupiedCellsForItem(item, surfaceCatalog), [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ]);
});

test("surfaceCellMessage: names the occupant, or reports an empty cell", () => {
  assert.equal(surfaceCellMessage(surfaceCatalog, undefined), "Esa celda está vacía.");
  assert.equal(surfaceCellMessage(surfaceCatalog, surfaceItem("it1", "small_stone", "wo_table", 0, 0)), "Ahí está Piedra.");
});

// --- renderSurfaceGrid: DOM smoke against a minimal fake DOM (this repo's
// tests run under plain node:test, no jsdom — same pattern as
// window-manager.test.ts's FakeElement). ----------------------------------

class FakeCellElement {
  classes = new Set<string>();
  children: FakeCellElement[] = [];
  style: Record<string, string> = {};
  textContent = "";
  title = "";
  listeners = new Map<string, Array<() => void>>();

  get className(): string {
    return [...this.classes].join(" ");
  }
  set className(v: string) {
    this.classes = new Set(v.split(" ").filter(Boolean));
  }

  appendChild(child: FakeCellElement): FakeCellElement {
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, cb: () => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  click(): void {
    for (const cb of this.listeners.get("click") ?? []) cb();
  }
}

function withFakeDocument(run: () => void): void {
  const original = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeCellElement() };
  try {
    run();
  } finally {
    (globalThis as { document?: unknown }).document = original;
  }
}

test("renderSurfaceGrid: renders exactly width*height cells and places the occupant glyph/name at its real coordinates", () => {
  withFakeDocument(() => {
    const placed = surfaceItem("it1", "small_stone", "wo_table", 2, 1);
    const snapshot = snapshotWithItems([placed, surfaceItem("it2", "small_stone", "wo_other_table", 0, 0)]);
    const clicks: Array<ItemInstance | undefined> = [];

    const grid = renderSurfaceGrid(surfaceCatalog, snapshot, "wo_table", { width: 3, height: 2 }, {
      onCellClick: (item) => clicks.push(item),
    }) as unknown as FakeCellElement;

    assert.equal(grid.children.length, 6, "3x2 grid renders exactly 6 cells");
    const emptyCells = grid.children.filter((c) => !c.classes.has("filled"));
    assert.equal(emptyCells.length, 5, "only the cell at (2,1) is filled — the item on a DIFFERENT surface is not rendered here");

    const filledIndex = 1 * 3 + 2; // row-major (y*width + x) for (x:2, y:1)
    const filledCell = grid.children[filledIndex]!;
    assert.ok(filledCell.classes.has("filled"));
    assert.equal(filledCell.title, "Piedra");

    filledCell.click();
    const emptyCell = grid.children[0]!;
    emptyCell.click();
    assert.deepEqual(clicks, [placed, undefined], "clicking reports the real occupant, or undefined for an empty cell");
  });
});
