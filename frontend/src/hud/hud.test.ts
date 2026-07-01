import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, ItemInstance, Thought } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import {
  hasDiscoveryThought,
  inventoryAddedMessage,
  inventoryCellsForItem,
  inventoryItemIds,
  newlyAddedToInventory,
  occupiedCellsForItem,
  renderInventoryGrid,
  renderSurfaceGrid,
  surfaceCellMessage,
  type HudHandlers,
} from "./hud";
import type { CellDescriptor } from "./drag";

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

// --- inventoryCellsForItem / renderInventoryGrid --------------------------
// (item-drag-drop change, spec R4 AMENDED rev 2: per-coordinate fill, no
// `.cell.span2` spanning — mirrors renderSurfaceGrid's model above.)

function inventoryItemAt(id: string, itemTypeId: string, x: number, y: number, rotation: 0 | 90 = 0): ItemInstance {
  return { id, itemTypeId, location: { type: "player_inventory", playerId: "p1", x, y, rotation } };
}

const HAND_SLOTS = { left: { x: 0, y: 0 }, right: { x: 3, y: 0 } };

function fullInventorySnapshot(items: ItemInstance[]): ClientSnapshot {
  return { ...snapshotWithItems(items), handSlots: HAND_SLOTS };
}

const noopHandlers: HudHandlers = { onEquip: () => {}, onDrop: () => {} };

test("inventoryCellsForItem: an item not in player_inventory occupies nothing", () => {
  const item = surfaceItem("it1", "small_stone", "wo_table", 0, 0);
  assert.deepEqual(inventoryCellsForItem(item, surfaceCatalog), []);
});

test("inventoryCellsForItem: a 1x1 item occupies exactly its own cell", () => {
  const item = inventoryItemAt("it1", "small_stone", 2, 1);
  assert.deepEqual(inventoryCellsForItem(item, surfaceCatalog), [{ x: 2, y: 1 }]);
});

test("inventoryCellsForItem: an unrotated 1x2 item occupies two cells stacked vertically", () => {
  const item = inventoryItemAt("it1", "poor_wood", 1, 0);
  assert.deepEqual(inventoryCellsForItem(item, surfaceCatalog), [
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ]);
});

test("inventoryCellsForItem: rotation 90 swaps w/h, same as occupiedCellsForItem", () => {
  const item = inventoryItemAt("it1", "poor_wood", 1, 0, 90);
  assert.deepEqual(inventoryCellsForItem(item, surfaceCatalog), [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ]);
});

test("renderInventoryGrid: an empty inventory still renders exactly 16 cells (no 'mochila vacía' branch), both hand slots dashed", () => {
  withFakeDocument(() => {
    const snapshot = fullInventorySnapshot([]);
    const grid = renderInventoryGrid(surfaceCatalog, snapshot, noopHandlers) as unknown as FakeCellElement;
    assert.equal(grid.children.length, 16, "always 16 cells, even with zero items");
    const handCells = grid.children.filter((c) => c.classes.has("hand"));
    assert.equal(handCells.length, 2, "both empty hand slots render the dashed '.hand' style");
    assert.equal(grid.children.filter((c) => c.classes.has("filled")).length, 0);
  });
});

test("renderInventoryGrid: a 1x2 item fills BOTH its coordinates as separate 'filled' cells (per-coordinate, no span2 collapsing)", () => {
  withFakeDocument(() => {
    const item = inventoryItemAt("it1", "poor_wood", 1, 0);
    const snapshot = fullInventorySnapshot([item]);
    const grid = renderInventoryGrid(surfaceCatalog, snapshot, noopHandlers) as unknown as FakeCellElement;
    assert.equal(grid.children.length, 16, "grid still contains exactly 16 cell elements");
    const filled = grid.children.filter((c) => c.classes.has("filled"));
    assert.equal(filled.length, 2, "both (1,0) and (1,1) render as their own filled cell");
  });
});

test("renderInventoryGrid: an occupied hand slot renders 'equipped', not the dashed empty-hand style", () => {
  withFakeDocument(() => {
    const item = inventoryItemAt("it1", "small_stone", 0, 0); // left hand slot
    const snapshot = fullInventorySnapshot([item]);
    const grid = renderInventoryGrid(surfaceCatalog, snapshot, noopHandlers) as unknown as FakeCellElement;
    const leftHandCell = grid.children[0]!; // (x:0, y:0) is index 0 in row-major order
    assert.ok(leftHandCell.classes.has("equipped"));
    assert.ok(leftHandCell.classes.has("filled"));
    assert.ok(!leftHandCell.classes.has("hand"), "occupied hand slot never shows the empty-hand dashed style");
  });
});

test("renderInventoryGrid: registers every cell (occupied, empty, hand) via handlers.bindDrag", () => {
  withFakeDocument(() => {
    const item = inventoryItemAt("it1", "small_stone", 2, 2);
    const snapshot = fullInventorySnapshot([item]);
    const bound: CellDescriptor[] = [];
    const handlers: HudHandlers = { ...noopHandlers, bindDrag: (_cell, descriptor) => bound.push(descriptor) };
    renderInventoryGrid(surfaceCatalog, snapshot, handlers);
    assert.equal(bound.length, 16, "every one of the 16 cells is registered as a drop target");
    const occupied = bound.find((d) => d.kind === "inventory" && d.x === 2 && d.y === 2);
    assert.ok(occupied?.occupant, "the occupied cell's descriptor carries the occupant item");
  });
});

test("renderInventoryGrid: a non-hand occupied cell's onTap calls onEquip; an occupied hand cell's onTap calls onDrop", () => {
  withFakeDocument(() => {
    const bagItem = inventoryItemAt("bag1", "small_stone", 2, 2);
    const handItem = inventoryItemAt("hand1", "small_stone", 0, 0); // left hand slot
    const snapshot = fullInventorySnapshot([bagItem, handItem]);
    const equipped: string[] = [];
    const dropped: string[] = [];
    const byItemId = new Map<string, CellDescriptor>();
    const handlers: HudHandlers = {
      onEquip: (id) => equipped.push(id),
      onDrop: (id) => dropped.push(id),
      bindDrag: (_cell, descriptor) => {
        if (descriptor.occupant) byItemId.set(descriptor.occupant.id, descriptor);
      },
    };
    renderInventoryGrid(surfaceCatalog, snapshot, handlers);

    byItemId.get("bag1")?.onTap?.();
    byItemId.get("hand1")?.onTap?.();

    assert.deepEqual(equipped, ["bag1"]);
    assert.deepEqual(dropped, ["hand1"]);
  });
});
