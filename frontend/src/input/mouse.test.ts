import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, Command } from "../contract";
import type { ContextMenu, ContextMenuItem } from "../actions/context-menu";
import type { ClientSnapshot } from "../state/snapshot";
import type { Frame } from "../view/viewstate";
import type { ScreenPoint, Ui } from "../hud/ui";
import { classifyClick, createInputController, describeSelection, resolveClickDecision } from "./mouse";

/**
 * `classifyClick`, `resolveClickDecision` and `describeSelection` are the
 * PURE decisions behind the SELECT-FIRST click model (fix-list: "1 click
 * selects, re-click on the already-selected tile opens the menu, double
 * click moves"): `onCanvasClick` is otherwise DOM/canvas-heavy and only gets
 * smoke coverage by design (see window-manager.test.ts's docstring for the
 * same pattern) — these are the actual decisions that get real unit tests.
 */

const THRESHOLD = 280;

test("classifyClick: single when there is no prior click", () => {
  assert.equal(classifyClick(1000, null, { x: 5, y: 5 }, null, THRESHOLD), "single");
});

test("classifyClick: double when the second click lands on the same tile within the threshold", () => {
  assert.equal(classifyClick(1200, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "double");
});

test("classifyClick: double at exactly the threshold boundary (inclusive)", () => {
  assert.equal(classifyClick(1000 + THRESHOLD, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "double");
});

test("classifyClick: single when the second click arrives after the threshold", () => {
  assert.equal(classifyClick(1000 + THRESHOLD + 1, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "single");
});

test("classifyClick: single when the second click lands on a DIFFERENT tile, even if fast", () => {
  assert.equal(classifyClick(1050, 1000, { x: 6, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "single");
});

test("classifyClick: uses the default threshold when none is passed", () => {
  assert.equal(classifyClick(1100, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }), "double");
  assert.equal(classifyClick(1000 + 10_000, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }), "single");
});

// --- resolveClickDecision (SELECT-FIRST model) ---------------------------

test("resolveClickDecision: a double click on a walkable tile always moves, regardless of selection", () => {
  assert.equal(resolveClickDecision("double", { x: 5, y: 5 }, null, true), "move");
  assert.equal(resolveClickDecision("double", { x: 5, y: 5 }, { x: 5, y: 5 }, true), "move");
});

test("resolveClickDecision: a double click on a NON-walkable tile degrades to a single (never a failed move)", () => {
  // Nothing selected yet -> selects, exactly like a genuine single would.
  assert.equal(resolveClickDecision("double", { x: 5, y: 5 }, null, false), "select");
  // Already selected -> opens the menu, exactly like a genuine single would.
  assert.equal(resolveClickDecision("double", { x: 5, y: 5 }, { x: 5, y: 5 }, false), "menu");
});

test("resolveClickDecision: a single click with nothing selected yet just selects", () => {
  assert.equal(resolveClickDecision("single", { x: 5, y: 5 }, null, true), "select");
  assert.equal(resolveClickDecision("single", { x: 5, y: 5 }, null, false), "select");
});

test("resolveClickDecision: a single click on a DIFFERENT tile than the current selection moves the selection there (no menu)", () => {
  assert.equal(resolveClickDecision("single", { x: 6, y: 5 }, { x: 5, y: 5 }, true), "select");
});

test("resolveClickDecision: a single click on the ALREADY-selected tile opens the menu", () => {
  assert.equal(resolveClickDecision("single", { x: 5, y: 5 }, { x: 5, y: 5 }, true), "menu");
  assert.equal(resolveClickDecision("single", { x: 5, y: 5 }, { x: 5, y: 5 }, false), "menu");
});

// --- describeSelection (inspect thought on select) ------------------------

const catalog: Catalog = {
  catalogVersion: "test",
  terrains: [{ id: "sand", name: "Arena", walkable: true, tags: ["ground"] }],
  items: [{ id: "seed", name: "Semilla", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: [] }],
  worldObjects: [{ id: "tree", name: "Árbol", description: "", tags: ["tree"], blocksMovement: true }],
  knowledge: [],
  actions: [],
  research: [],
};

test("describeSelection: a world object reads 'Veo {nombre}.'", () => {
  const resolved = {
    key: "wo:o1",
    wireRef: { kind: "world_object" as const, id: "o1" },
    preview: {
      kind: "world_object" as const,
      pos: { x: 5, y: 5 },
      tags: ["tree"],
      object: { id: "o1", objectTypeId: "tree", position: { x: 5, y: 5 }, tags: [], state: {} },
    },
    walkable: false,
  };
  assert.equal(describeSelection(catalog, resolved), "Veo Árbol.");
});

test("describeSelection: a loose ground item reads 'Veo {nombre} en el suelo.'", () => {
  const resolved = {
    key: "item:i1",
    wireRef: { kind: "item" as const, id: "i1" },
    preview: {
      kind: "item" as const,
      pos: { x: 5, y: 5 },
      tags: [],
      item: { id: "i1", itemTypeId: "seed", location: { type: "world" as const, zoneId: "z1", x: 5, y: 5 } },
    },
    walkable: false,
  };
  assert.equal(describeSelection(catalog, resolved), "Veo Semilla en el suelo.");
});

test("describeSelection: a bare tile reads '{Terreno}.'", () => {
  const resolved = {
    key: "tile:5,5",
    wireRef: { kind: "tile" as const, x: 5, y: 5 },
    preview: { kind: "tile" as const, pos: { x: 5, y: 5 }, tags: [], terrain: "sand" as const },
    walkable: true,
  };
  assert.equal(describeSelection(catalog, resolved), "Arena.");
});

// --- uiIntent routing (crafting-surface change, tasks.md Phase 12.2) -------
// `mouse.ts`'s `openContextMenu` onSelect dispatch was restructured from a
// binary `thoughts ? toggleThoughts() : toggleInventory()` ternary into an
// explicit switch so `uiIntent === "surface"` cannot fall through into
// `toggleInventory()`. This exercises the REAL dispatch via a full click
// flow (menu built for a world_object target that has a "Usar la mesa"
// entry), not a re-implementation of the switch.

const PX = 48; // mirrors render/canvas.ts's PX (tile size in px) — kept local to avoid a presentation-layer import in an input test

function fakeCanvasRect(sizePx: number) {
  return { left: 0, top: 0, width: sizePx, height: sizePx };
}

type FakeClickEvent = { clientX: number; clientY: number; stopPropagation: () => void };

function fakeCanvas(sizePx: number, onClick: (cb: (ev: FakeClickEvent) => void) => void): HTMLCanvasElement {
  return {
    width: sizePx,
    height: sizePx,
    getBoundingClientRect: () => fakeCanvasRect(sizePx),
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      if (type === "click") onClick(cb as (ev: FakeClickEvent) => void);
    },
  } as unknown as HTMLCanvasElement;
}

function routingCatalog(): Catalog {
  return {
    catalogVersion: "test",
    terrains: [],
    items: [],
    worldObjects: [{ id: "rustic_table", name: "Mesa rústica", description: "", tags: [], blocksMovement: true, surfaceGrid: { w: 3, h: 2 } }],
    knowledge: [],
    actions: [],
    research: [],
  };
}

function routingSnapshot(): ClientSnapshot {
  return {
    zone: { id: "z1", width: 4, height: 4 },
    visionRadius: 5,
    tiles: [],
    objects: [{ id: "wo_table", objectTypeId: "rustic_table", position: { x: 2, y: 1 }, state: {} }],
    piles: [],
    items: [],
    player: { id: "p1", name: "Náufrago", position: { x: 1, y: 1 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
  };
}

/** A zone-size-matching viewport (4x4 tiles * PX) keeps `cameraOffset` at
 * exactly (0,0) regardless of player position (map fits the viewport, so
 * `clampAxis` centers it) — lets this test pick screen points that map to an
 * exact known tile without duplicating the camera's centering math. */
function routingFrame(): Frame {
  return {
    zone: { width: 4, height: 4 },
    tiles: [],
    entities: [{ id: "p1", kind: "player", typeId: "player", renderPos: { x: 1, y: 1 }, visibility: "visible" }],
    clockMs: 0,
  };
}

function screenPointForTile(x: number, y: number): FakeClickEvent {
  return { clientX: x * PX + PX / 2, clientY: y * PX + PX / 2, stopPropagation: () => {} };
}

/** Sets up a real `createInputController` wired to fakes, clicks the
 * `rustic_table` object TWICE (select, then re-click to open the menu — the
 * select-first model, see `resolveClickDecision`'s doc) and returns the
 * `onSelect` callback the controller passed to `Ui.openContextMenu` — the
 * exact dispatch under test. */
function captureMenuOnSelect(uiOverrides: Partial<Ui> = {}): (item: ContextMenuItem) => void {
  let clickHandler: ((ev: FakeClickEvent) => void) | null = null;
  const canvas = fakeCanvas(4 * PX, (cb) => (clickHandler = cb));
  let capturedOnSelect: ((item: ContextMenuItem) => void) | null = null;

  const ui: Ui = {
    mount: () => {},
    showThought: () => {},
    destroy: () => {},
    toggleInventory: () => {},
    toggleThoughts: () => {},
    toggleSurface: () => {},
    toggleCrouch: () => {},
    openContextMenu: (_menu: ContextMenu, _at: ScreenPoint, onSelect: (item: ContextMenuItem) => void) => {
      capturedOnSelect = onSelect;
    },
    closeContextMenu: () => {},
    ...uiOverrides,
  };

  createInputController({
    canvas,
    catalog: routingCatalog(),
    getSnapshot: routingSnapshot,
    getFrame: routingFrame,
    sendCommand: async (_command: Command) => {},
    ui,
  });

  const point = screenPointForTile(2, 1); // the rustic_table's tile
  clickHandler!(point); // 1st click: selects the table
  clickHandler!(point); // 2nd click (same tile): opens the menu

  assert.ok(capturedOnSelect, "the re-click opened the menu and captured its onSelect dispatch");
  return capturedOnSelect!;
}

test("uiIntent routing: 'surface' calls Ui.toggleSurface with the item's surfaceId, never toggleInventory", () => {
  const calls: string[] = [];
  const onSelect = captureMenuOnSelect({
    toggleSurface: (surfaceId: string) => calls.push(`surface:${surfaceId}`),
    toggleInventory: () => calls.push("inventory"),
    toggleThoughts: () => calls.push("thoughts"),
  });

  onSelect({ id: "ui:surface", label: "Usar la mesa", kind: "ui", uiIntent: "surface", surfaceId: "wo_table" });

  assert.deepEqual(calls, ["surface:wo_table"], "routes to toggleSurface only — a plain addition to the old ternary would have called toggleInventory instead");
});

test("uiIntent routing: 'thoughts' still calls Ui.toggleThoughts, unaffected by the surface branch", () => {
  const calls: string[] = [];
  const onSelect = captureMenuOnSelect({
    toggleSurface: (surfaceId: string) => calls.push(`surface:${surfaceId}`),
    toggleInventory: () => calls.push("inventory"),
    toggleThoughts: () => calls.push("thoughts"),
  });

  onSelect({ id: "ui:thoughts", label: "Ver mis pensamientos", kind: "ui", uiIntent: "thoughts" });

  assert.deepEqual(calls, ["thoughts"]);
});

test("uiIntent routing: 'inventory' (and the default case) still calls Ui.toggleInventory", () => {
  const calls: string[] = [];
  const onSelect = captureMenuOnSelect({
    toggleSurface: (surfaceId: string) => calls.push(`surface:${surfaceId}`),
    toggleInventory: () => calls.push("inventory"),
    toggleThoughts: () => calls.push("thoughts"),
  });

  onSelect({ id: "ui:inventory", label: "Ver mis cosas", kind: "ui", uiIntent: "inventory" });

  assert.deepEqual(calls, ["inventory"]);
});

test("uiIntent routing: 'crouch' calls Ui.toggleCrouch with the item's crouchAt tile position, never toggleInventory (crouch-crafting rework: per-tile trigger)", () => {
  const calls: Array<{ x: number; y: number }> = [];
  const onSelect = captureMenuOnSelect({
    toggleCrouch: (pos) => calls.push(pos),
    toggleInventory: () => calls.push({ x: -1, y: -1 }),
  });

  onSelect({ id: "ui:crouch:6,5", label: "Examinar de cerca", kind: "ui", uiIntent: "crouch", crouchAt: { x: 6, y: 5 } });

  assert.deepEqual(calls, [{ x: 6, y: 5 }]);
});

test("uiIntent routing: 'crouch' with no crouchAt is a defensive no-op (never falls back to toggleInventory)", () => {
  const calls: string[] = [];
  const onSelect = captureMenuOnSelect({
    toggleCrouch: () => calls.push("crouch"),
    toggleInventory: () => calls.push("inventory"),
  });

  onSelect({ id: "ui:crouch:stale", label: "Examinar de cerca", kind: "ui", uiIntent: "crouch" });

  assert.deepEqual(calls, [], "no crouchAt means no dispatch at all — defensive guard, not a misroute to toggleInventory");
});

// --- Slice C (Decision 1, engram #2854): isBusy suppresses ALL click
// dispatch, including the "select" decision, which never calls sendCommand
// at all (this is why mouse.ts needs its own isBusy check, not just
// game.ts's sendCommand). -------------------------------------------------

test("onCanvasClick: while isBusy() is true, a click is a total no-op — no thought, no selection, no menu", () => {
  let clickHandler: ((ev: FakeClickEvent) => void) | null = null;
  const canvas = fakeCanvas(4 * PX, (cb) => (clickHandler = cb));
  const thoughts: string[] = [];
  let menuOpened = false;

  const ui: Ui = {
    mount: () => {},
    showThought: (t: string) => thoughts.push(t),
    destroy: () => {},
    toggleInventory: () => {},
    toggleThoughts: () => {},
    toggleSurface: () => {},
    toggleCrouch: () => {},
    openContextMenu: () => {
      menuOpened = true;
    },
    closeContextMenu: () => {},
  };

  createInputController({
    canvas,
    catalog: routingCatalog(),
    getSnapshot: routingSnapshot,
    getFrame: routingFrame,
    sendCommand: async (_command: Command) => {},
    ui,
    isBusy: () => true,
  });

  const point = screenPointForTile(2, 1); // the rustic_table's tile — a normal click here would select it
  clickHandler!(point);

  assert.deepEqual(thoughts, [], "no inspect thought — the select decision itself never ran");
  assert.equal(menuOpened, false);
});

test("onCanvasClick: isBusy defaults to never-busy when omitted — clicks behave exactly as before Slice C", () => {
  let clickHandler: ((ev: FakeClickEvent) => void) | null = null;
  const canvas = fakeCanvas(4 * PX, (cb) => (clickHandler = cb));
  const thoughts: string[] = [];

  const ui: Ui = {
    mount: () => {},
    showThought: (t: string) => thoughts.push(t),
    destroy: () => {},
    toggleInventory: () => {},
    toggleThoughts: () => {},
    toggleSurface: () => {},
    toggleCrouch: () => {},
    openContextMenu: () => {},
    closeContextMenu: () => {},
  };

  createInputController({
    canvas,
    catalog: routingCatalog(),
    getSnapshot: routingSnapshot,
    getFrame: routingFrame,
    sendCommand: async (_command: Command) => {},
    ui,
    // isBusy intentionally omitted
  });

  const point = screenPointForTile(2, 1);
  clickHandler!(point);

  assert.equal(thoughts.length, 1, "a normal select-decision inspect thought still fires when isBusy is not provided");
});
