import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, ItemInstance, Position, Thought } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import {
  CELL_GAP_PX,
  CELL_SIZE_PX,
  groundItemsAt,
  hasDiscoveryThought,
  inventoryAddedMessage,
  inventoryCellsForItem,
  inventoryItemIds,
  newlyAddedToInventory,
  occupiedCellsForItem,
  renderCrouchFrame,
  renderInventoryGrid,
  renderSurfaceGrid,
  surfaceCellMessage,
  type HudHandlers,
} from "./hud";
import type { CellDescriptor } from "./drag";
import type { ScreenPoint } from "./window-manager";
import { createObservedStore } from "../state/observed";

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

/** Minimal fake `ClickEvent` — only `stopPropagation` is ever called by
 * production code against a fake-DOM click (item-context-menu WU3: mesa's
 * `renderSurfaceGrid` click listener stopPropagation's an occupied cell's
 * click). */
type FakeClickEvent = { stopPropagation: () => void };

class FakeCellElement {
  classes = new Set<string>();
  children: FakeCellElement[] = [];
  style: Record<string, string> = {};
  textContent = "";
  title = "";
  attrs: Record<string, string> = {};
  listeners = new Map<string, Array<(ev: FakeClickEvent) => void>>();
  /** Configurable per-test (item-context-menu WU3: `onTap`/the mesa click
   * listener read `cell.getBoundingClientRect()` at tap/click time) —
   * defaults to a fixed, non-zero rect so a test asserting the exact anchor
   * point doesn't accidentally pass against an all-zero default. */
  rect = { left: 10, top: 20, right: 30, bottom: 40, width: 20, height: 20 };

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

  // Only used by the multi-cell overlay (item-drag-drop, tasks.md T3), which
  // marks itself `aria-hidden="true"` — decorative, the cell's own `title`
  // stays the accessible name.
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    return this.rect;
  }

  addEventListener(type: string, cb: (ev: FakeClickEvent) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  /** Returns whether any registered `click` listener called `stopPropagation`
   * on the synthesized event — item-context-menu WU3 needs this to assert the
   * mesa's occupied/empty stopPropagation split. */
  click(): { stoppedPropagation: boolean } {
    let stoppedPropagation = false;
    const ev: FakeClickEvent = { stopPropagation: () => { stoppedPropagation = true; } };
    for (const cb of this.listeners.get("click") ?? []) cb(ev);
    return { stoppedPropagation };
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
    const ats: ScreenPoint[] = [];

    const grid = renderSurfaceGrid(surfaceCatalog, snapshot, "wo_table", { width: 3, height: 2 }, {
      onCellClick: (item, at) => {
        clicks.push(item);
        ats.push(at);
      },
    }) as unknown as FakeCellElement;

    assert.equal(grid.children.length, 6, "3x2 grid renders exactly 6 cells");
    const emptyCells = grid.children.filter((c) => !c.classes.has("filled"));
    assert.equal(emptyCells.length, 5, "only the cell at (2,1) is filled — the item on a DIFFERENT surface is not rendered here");

    const filledIndex = 1 * 3 + 2; // row-major (y*width + x) for (x:2, y:1)
    const filledCell = grid.children[filledIndex]!;
    assert.ok(filledCell.classes.has("filled"));
    assert.equal(filledCell.title, "Piedra");

    // Item-context-menu change (WU3): an occupied cell's click stops
    // propagation (so it never reaches the document outside-click dismiss
    // and closes its own just-opened menu); an empty cell's click does not
    // (so outside-click dismiss still works for empty-cell clicks).
    const filledResult = filledCell.click();
    assert.equal(filledResult.stoppedPropagation, true, "an occupied cell's click stops propagation");
    const emptyCell = grid.children[0]!;
    const emptyResult = emptyCell.click();
    assert.equal(emptyResult.stoppedPropagation, false, "an empty cell's click does NOT stop propagation");
    assert.deepEqual(clicks, [placed, undefined], "clicking reports the real occupant, or undefined for an empty cell");
    assert.deepEqual(ats, [
      { x: filledCell.rect.left, y: filledCell.rect.bottom },
      { x: emptyCell.rect.left, y: emptyCell.rect.bottom },
    ], "at is the cell's getBoundingClientRect()-derived anchor (left, bottom)");
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
    // 16 per-coordinate cells + exactly ONE spanning overlay for this single
    // multi-cell item (tasks.md T3/T8a: overlay count === multi-cell item
    // count) — the per-coordinate cell-count invariant this test guards
    // (every coordinate stays its own drop target) is asserted right below
    // via the `filled` count, unaffected by the overlay's presence.
    assert.equal(grid.children.length, 17, "grid contains 16 per-coordinate cells plus one spanning overlay for this 1x2 item");
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

test("renderInventoryGrid: an occupied cell's onTap opens the item menu at the cell's rect (bag and hand alike) — item-context-menu WU3, replaces the old onEquip/onDrop wiring", () => {
  withFakeDocument(() => {
    const bagItem = inventoryItemAt("bag1", "small_stone", 2, 2);
    const handItem = inventoryItemAt("hand1", "small_stone", 0, 0); // left hand slot
    const snapshot = fullInventorySnapshot([bagItem, handItem]);
    const opened: Array<{ item: ItemInstance; at: ScreenPoint; source: "tap" | "click" }> = [];
    const byItemId = new Map<string, { cell: FakeCellElement; descriptor: CellDescriptor }>();
    const handlers: HudHandlers = {
      onEquip: () => {},
      onDrop: () => {},
      openItemMenu: (item, at, source) => opened.push({ item, at, source }),
      bindDrag: (cell, descriptor) => {
        if (descriptor.occupant) byItemId.set(descriptor.occupant.id, { cell: cell as unknown as FakeCellElement, descriptor });
      },
    };
    renderInventoryGrid(surfaceCatalog, snapshot, handlers);

    const bag = byItemId.get("bag1")!;
    const hand = byItemId.get("hand1")!;
    bag.descriptor.onTap?.();
    hand.descriptor.onTap?.();

    assert.equal(opened.length, 2, "onEquip/onDrop are no longer called — openItemMenu is called once per tap instead");
    assert.deepEqual(opened[0], { item: bagItem, at: { x: bag.cell.rect.left, y: bag.cell.rect.bottom }, source: "tap" });
    assert.deepEqual(opened[1], { item: handItem, at: { x: hand.cell.rect.left, y: hand.cell.rect.bottom }, source: "tap" });
  });
});

// --- Multi-cell overlay rendering (item-drag-drop / diablo-inventory,
// tasks.md T8a) — ADDITIVE new tests. NOTHING above this comment was
// rewritten/migrated: the pre-existing "1x2 fills BOTH coordinates" test
// above already got its `grid.children.length` invariant corrected (16
// per-coordinate cells + 1 overlay for that single multi-cell item = 17),
// but carries NO glyph assertion to migrate — confirmed against source, per
// design.md Decision 8. -----------------------------------------------------

function overlaysOf(grid: FakeCellElement): FakeCellElement[] {
  return grid.children.filter((c) => c.classes.has("item-overlay"));
}

test("renderInventoryGrid: a single-cell item renders NO overlay and keeps its glyph on the cell (unchanged path)", () => {
  withFakeDocument(() => {
    const item = inventoryItemAt("it1", "small_stone", 2, 2);
    const snapshot = fullInventorySnapshot([item]);
    const grid = renderInventoryGrid(surfaceCatalog, snapshot, noopHandlers) as unknown as FakeCellElement;

    assert.equal(overlaysOf(grid).length, 0, "a grid holding only single-cell items has ZERO overlays");
    assert.equal(grid.children.length, 16, "no overlay appended: still exactly 16 cells");
    const cell = grid.children[2 * 4 + 2]!; // row-major (y*width + x) for (2,2)
    assert.equal(cell.textContent, "🪨", "the single-cell item keeps its glyph directly on the cell");
  });
});

test("renderInventoryGrid: a multi-cell item appends exactly ONE overlay carrying the glyph; its covered cells render glyph-empty", () => {
  withFakeDocument(() => {
    const item = inventoryItemAt("it1", "poor_wood", 1, 0); // unrotated 1x2, vertical
    const snapshot = fullInventorySnapshot([item]);
    const grid = renderInventoryGrid(surfaceCatalog, snapshot, noopHandlers) as unknown as FakeCellElement;

    const overlays = overlaysOf(grid);
    assert.equal(overlays.length, 1, "exactly one overlay for the one multi-cell item");
    assert.equal(overlays[0]?.textContent, "🪵", "the overlay carries the item's glyph");
    assert.equal(overlays[0]?.attrs["aria-hidden"], "true", "the overlay is decorative — the cell's title stays the accessible name");
    assert.equal(overlays[0]?.style.pointerEvents, "none", "pointer-events:none set INLINE, double-locking the CSS class");

    const coveredCells = [grid.children[0 * 4 + 1]!, grid.children[1 * 4 + 1]!]; // (1,0) and (1,1), row-major
    for (const cell of coveredCells) {
      assert.equal(cell.textContent, "", "the glyph moved off the covered cells onto the overlay");
      assert.ok(cell.classes.has("filled"), "covered cells still keep their 'filled' class (occupancy/drop-target semantics unchanged)");
    }
  });
});

test("renderInventoryGrid: the overlay's inline geometry is computed from CELL_SIZE_PX/CELL_GAP_PX at the item's anchor", () => {
  withFakeDocument(() => {
    const item = inventoryItemAt("it1", "poor_wood", 1, 0); // unrotated 1x2: w=1, h=2
    const snapshot = fullInventorySnapshot([item]);
    const grid = renderInventoryGrid(surfaceCatalog, snapshot, noopHandlers) as unknown as FakeCellElement;
    const overlay = overlaysOf(grid)[0]!;

    const step = CELL_SIZE_PX + CELL_GAP_PX;
    const expectedWidth = 1 * CELL_SIZE_PX; // w=1: no inner gap to add
    const expectedHeight = 2 * CELL_SIZE_PX + 1 * CELL_GAP_PX; // h=2: one inner gap

    assert.equal(overlay.style.left, `${1 * step}px`);
    assert.equal(overlay.style.top, `${0 * step}px`);
    assert.equal(overlay.style.width, `${expectedWidth}px`);
    assert.equal(overlay.style.height, `${expectedHeight}px`);
    assert.equal(overlay.style.fontSize, `${Math.round(0.58 * Math.min(expectedWidth, expectedHeight))}px`, "font-size scales toward the SMALLER footprint dimension, sourced from AssetResolver.scale");
  });
});

test("renderInventoryGrid: a ROTATED multi-cell item's overlay spans the ROTATED bounding box (vertical 1x2 -> horizontal 2x1)", () => {
  withFakeDocument(() => {
    const item = inventoryItemAt("it1", "poor_wood", 0, 0, 90); // rotated: now 2 wide, 1 tall
    const snapshot = fullInventorySnapshot([item]);
    const grid = renderInventoryGrid(surfaceCatalog, snapshot, noopHandlers) as unknown as FakeCellElement;
    const overlay = overlaysOf(grid)[0]!;

    const expectedWidth = 2 * CELL_SIZE_PX + 1 * CELL_GAP_PX;
    const expectedHeight = 1 * CELL_SIZE_PX;
    assert.equal(overlay.style.width, `${expectedWidth}px`, "rotated footprint spans horizontally, not vertically");
    assert.equal(overlay.style.height, `${expectedHeight}px`);
  });
});

test("renderSurfaceGrid: mesa parity — multi-cell items get exactly one overlay, single-cell items render unchanged", () => {
  withFakeDocument(() => {
    const single = surfaceItem("single1", "small_stone", "wo_table", 0, 0);
    const multi = surfaceItem("multi1", "poor_wood", "wo_table", 1, 0);
    const snapshot = snapshotWithItems([single, multi]);
    const grid = renderSurfaceGrid(surfaceCatalog, snapshot, "wo_table", { width: 3, height: 2 }, { onCellClick: () => {} }) as unknown as FakeCellElement;

    // crouch-crafting Slice D: >=2 placed items also appends the "Probar
    // combinación" button (`.surface-grid-try`) — accounted for in the +1 below,
    // alongside the one multi-cell overlay.
    assert.equal(grid.children.length, 3 * 2 + 1 + 1, "6 per-coordinate cells + 1 overlay for the multi-cell item + 1 'Probar combinación' button (>=2 items placed)");
    const overlays = overlaysOf(grid);
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0]?.textContent, "🪵");

    const singleCell = grid.children[0 * 3 + 0]!; // (0,0)
    assert.equal(singleCell.textContent, "🪨", "single-cell item keeps its glyph directly on the cell — no overlay");
  });
});

// --- "Probar combinación" on the mesa (crouch-crafting Slice D, Decision 6 —
// deferred from Slice B2) -----------------------------------------------------

function findByClass(grid: FakeCellElement, cls: string): FakeCellElement | undefined {
  return grid.children.find((c) => c.classes.has(cls));
}

test("renderSurfaceGrid: NO muestra 'Probar combinación' con menos de 2 items colocados", () => {
  withFakeDocument(() => {
    const snapshot = snapshotWithItems([surfaceItem("it1", "small_stone", "wo_table", 0, 0)]);
    const grid = renderSurfaceGrid(surfaceCatalog, snapshot, "wo_table", { width: 3, height: 2 }, { onCellClick: () => {} }) as unknown as FakeCellElement;
    assert.equal(findByClass(grid, "surface-grid-try"), undefined, "con 0 o 1 items no hay nada que combinar");
  });
});

test("renderSurfaceGrid: muestra 'Probar combinación' con >=2 items colocados y dispatchea onTryCombination al click", () => {
  withFakeDocument(() => {
    const a = surfaceItem("it1", "small_stone", "wo_table", 0, 0);
    const b = surfaceItem("it2", "poor_wood", "wo_table", 1, 0);
    const snapshot = snapshotWithItems([a, b]);
    let calls = 0;
    const grid = renderSurfaceGrid(surfaceCatalog, snapshot, "wo_table", { width: 3, height: 2 }, {
      onCellClick: () => {},
      onTryCombination: () => {
        calls += 1;
      },
    }) as unknown as FakeCellElement;

    const button = findByClass(grid, "surface-grid-try");
    assert.ok(button, "el botón aparece con >=2 items colocados en la mesa");
    button!.click();
    assert.equal(calls, 1, "clickear el botón dispatchea onTryCombination exactamente una vez");
  });
});

// --- groundItemsAt / renderCrouchFrame (crouch-crafting rework: a PER-TILE
// spatial "marco", superseding the flat-list crouch lens per user playtest
// correction of design.md Decision 2) ----------------------------------------

const crouchCatalog: Catalog = {
  ...surfaceCatalog,
  terrains: [{ id: "sand", name: "Arena", walkable: true, tags: [] }],
  items: [
    ...surfaceCatalog.items,
    { id: "rama", name: "Rama", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: { firmeza: 3 }, tags: ["wood", "flexible"] },
  ],
  knowledge: [{ id: "k_wood", name: "Sobre la madera", kind: "idea", unlockOnObserveTags: ["wood"] }],
};

const CROUCH_POS = { x: 5, y: 5 };

function worldItemAt(id: string, itemTypeId: string, x: number, y: number): ItemInstance {
  return { id, itemTypeId, location: { type: "world", zoneId: "z1", x, y } };
}

function crouchSnapshot(items: ItemInstance[], knowledge: string[] = []): ClientSnapshot {
  return {
    ...snapshotWithItems(items),
    tiles: [{ x: CROUCH_POS.x, y: CROUCH_POS.y, terrain: "sand", walkable: true, tags: [], visibility: "visible" }],
    player: { id: "p1", name: "Náufrago", position: CROUCH_POS, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge },
  };
}

test("groundItemsAt: only world items sitting EXACTLY on pos are included — not an adjacent tile's, not hand/inventory", () => {
  const here = worldItemAt("it1", "small_stone", 5, 5);
  const adjacent = worldItemAt("it2", "small_stone", 6, 5); // chebyshev 1, but a DIFFERENT tile
  const inHand = inventoryItem("it3", "small_stone");
  const snapshot = crouchSnapshot([here, adjacent, inHand]);
  assert.deepEqual(groundItemsAt(snapshot, CROUCH_POS).map((i) => i.id), ["it1"]);
});

test("renderCrouchFrame: empty tile renders an empty-state row inside the items area, no error", () => {
  withFakeDocument(() => {
    const snapshot = crouchSnapshot([]);
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, noopHandlers, createObservedStore()) as unknown as FakeCellElement;
    assert.ok(frame.classes.has("crouch-frame"));
    const itemsArea = frame.children.find((c) => c.classes.has("crouch-frame-items"))!;
    assert.equal(itemsArea.children.length, 1);
    assert.ok(itemsArea.children[0]!.classes.has("mute"));
  });
});

test("renderCrouchFrame: sets the frame's background from the tile's terrain, resolved via the same AssetResolver render/canvas.ts draws from", () => {
  withFakeDocument(() => {
    const snapshot = crouchSnapshot([]);
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, noopHandlers, createObservedStore()) as unknown as FakeCellElement;
    assert.equal(frame.style.backgroundColor, "#d9c089", "sand's terrain color from render/assets.ts's createEmojiAssets()");
    const terrainLabel = frame.children.find((c) => c.classes.has("crouch-frame-terrain"));
    assert.equal(terrainLabel?.textContent, "Arena");
  });
});

test("renderCrouchFrame: lists only the framed tile's OWN items — never an adjacent tile's, hand, inventory, or surface items", () => {
  withFakeDocument(() => {
    const here = worldItemAt("it1", "small_stone", 5, 5);
    const adjacent = worldItemAt("it2", "small_stone", 6, 5);
    const inHand = inventoryItem("it3", "small_stone");
    const onSurface = surfaceItem("it4", "small_stone", "wo_table", 0, 0);
    const snapshot = crouchSnapshot([here, adjacent, inHand, onSurface]);
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, noopHandlers, createObservedStore()) as unknown as FakeCellElement;
    const itemsArea = frame.children.find((c) => c.classes.has("crouch-frame-items"))!;
    assert.equal(itemsArea.children.length, 1, "only the exact-tile item renders — everything else on other tiles/scopes is excluded");
    assert.equal(itemsArea.children[0]!.textContent, "🪨");
  });
});

test("renderCrouchFrame: groups same-itemTypeId ground items into one glyph with a '×N' count badge (mirrors the canvas renderer's pile treatment)", () => {
  withFakeDocument(() => {
    const a = worldItemAt("it1", "small_stone", 5, 5);
    const b = worldItemAt("it2", "small_stone", 5, 5);
    const c = worldItemAt("it3", "small_stone", 5, 5);
    const snapshot = crouchSnapshot([a, b, c]);
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, noopHandlers, createObservedStore()) as unknown as FakeCellElement;
    const itemsArea = frame.children.find((c) => c.classes.has("crouch-frame-items"))!;
    assert.equal(itemsArea.children.length, 1, "identical-type items are grouped into a single glyph, not 3 separate ones");
    const badge = itemsArea.children[0]!.children.find((c) => c.classes.has("crouch-frame-count"));
    assert.equal(badge?.textContent, "×3");
  });
});

test("renderCrouchFrame: properties/tags stay hidden in the info strip before any item is clicked", () => {
  withFakeDocument(() => {
    const item = worldItemAt("it1", "rama", 5, 5);
    const snapshot = crouchSnapshot([item]);
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, noopHandlers, createObservedStore()) as unknown as FakeCellElement;
    const infoStrip = frame.children.find((c) => c.classes.has("crouch-frame-info"))!;
    assert.ok(!infoStrip.children.some((c) => c.classes.has("crouch-props")), "no properties/tags shown before any click");
  });
});

test("renderCrouchFrame: clicking an item glyph dispatches handlers.onObserve with the item's INSTANCE id and names it in the info strip", () => {
  withFakeDocument(() => {
    const item = worldItemAt("it1", "rama", 5, 5);
    const snapshot = crouchSnapshot([item]);
    const observedCalls: string[] = [];
    const handlers: HudHandlers = { onEquip: () => {}, onDrop: () => {}, onObserve: (id) => observedCalls.push(id) };
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, handlers, createObservedStore()) as unknown as FakeCellElement;
    const itemsArea = frame.children.find((c) => c.classes.has("crouch-frame-items"))!;
    itemsArea.children[0]!.click();
    assert.deepEqual(observedCalls, ["it1"], "dispatches with the item INSTANCE id (it1), not the type id (rama)");

    const infoStrip = frame.children.find((c) => c.classes.has("crouch-frame-info"))!;
    const name = infoStrip.children.find((c) => c.classes.has("crouch-name"));
    assert.equal(name?.textContent, "Rama", "the info strip names the clicked/observed item");
  });
});

test("renderCrouchFrame: properties/tags are revealed in the info strip once the item's type is added to the observed set (the ui.ts optimistic-add wrapping)", () => {
  withFakeDocument(() => {
    const item = worldItemAt("it1", "rama", 5, 5);
    const snapshot = crouchSnapshot([item]);
    const observed = createObservedStore();
    const handlers: HudHandlers = { onEquip: () => {}, onDrop: () => {}, onObserve: () => observed.add("rama") };
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, handlers, observed) as unknown as FakeCellElement;
    const itemsArea = frame.children.find((c) => c.classes.has("crouch-frame-items"))!;
    itemsArea.children[0]!.click();

    const infoStrip = frame.children.find((c) => c.classes.has("crouch-frame-info"))!;
    const props = infoStrip.children.find((c) => c.classes.has("crouch-props"));
    assert.ok(props, "observed-set membership (updated by the click) reveals properties in the same render pass");
    assert.ok(props!.textContent.includes("firmeza: 3"));
    assert.ok(props!.textContent.includes("wood"));
  });
});

test("renderCrouchFrame: properties/tags are revealed on click when a matching knowledge is already unlocked, even with an empty observed set", () => {
  withFakeDocument(() => {
    const item = worldItemAt("it1", "rama", 5, 5);
    const snapshot = crouchSnapshot([item], ["k_wood"]); // unlockOnObserveTags: ["wood"] intersects rama's tags
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, noopHandlers, createObservedStore()) as unknown as FakeCellElement;
    const itemsArea = frame.children.find((c) => c.classes.has("crouch-frame-items"))!;
    itemsArea.children[0]!.click();
    const infoStrip = frame.children.find((c) => c.classes.has("crouch-frame-info"))!;
    assert.ok(infoStrip.children.some((c) => c.classes.has("crouch-props")), "unlocked knowledge alone reveals properties, even with an empty observed set and no onObserve handler");
  });
});

// --- "Probar combinación" button (crouch-crafting Slice B2, design.md
// Decision 3 / amendment #2857) --------------------------------------------

test("renderCrouchFrame: 'Probar combinación' is ABSENT when the tile has fewer than 2 items", () => {
  withFakeDocument(() => {
    const one = crouchSnapshot([worldItemAt("it1", "rama", 5, 5)]);
    const frameWithOne = renderCrouchFrame(crouchCatalog, one, CROUCH_POS, noopHandlers, createObservedStore()) as unknown as FakeCellElement;
    assert.ok(!frameWithOne.children.some((c) => c.classes.has("crouch-frame-try")), "1 item: no button");

    const empty = crouchSnapshot([]);
    const frameEmpty = renderCrouchFrame(crouchCatalog, empty, CROUCH_POS, noopHandlers, createObservedStore()) as unknown as FakeCellElement;
    assert.ok(!frameEmpty.children.some((c) => c.classes.has("crouch-frame-try")), "0 items: no button");
  });
});

test("renderCrouchFrame: 'Probar combinación' is PRESENT whenever the tile has >=2 items, regardless of whether they look related", () => {
  withFakeDocument(() => {
    const a = worldItemAt("it1", "small_stone", 5, 5);
    const b = worldItemAt("it2", "rama", 5, 5);
    const snapshot = crouchSnapshot([a, b]);
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, noopHandlers, createObservedStore()) as unknown as FakeCellElement;
    const button = frame.children.find((c) => c.classes.has("crouch-frame-try"));
    assert.ok(button, "2 unrelated pieces: the button is present and selectable");
    assert.equal(button!.textContent, "Probar combinación");
  });
});

test("renderCrouchFrame: clicking 'Probar combinación' dispatches handlers.onTryCombination with the EXAMINED tile's position", () => {
  withFakeDocument(() => {
    const a = worldItemAt("it1", "small_stone", 5, 5);
    const b = worldItemAt("it2", "rama", 5, 5);
    const snapshot = crouchSnapshot([a, b]);
    const calls: Position[] = [];
    const handlers: HudHandlers = { ...noopHandlers, onTryCombination: (pos) => calls.push(pos) };
    const frame = renderCrouchFrame(crouchCatalog, snapshot, CROUCH_POS, handlers, createObservedStore()) as unknown as FakeCellElement;
    const button = frame.children.find((c) => c.classes.has("crouch-frame-try"))!;
    button.click();
    assert.deepEqual(calls, [CROUCH_POS], "dispatches with the examined tile's own position, not the player's");
  });
});
