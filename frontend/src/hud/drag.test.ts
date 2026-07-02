import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, Command, ItemInstance } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { buildDragOutcome, createDragController, crossedThreshold, footprintValidity, type DragControllerDeps, type DropTarget } from "./drag";
import { footprintCases, type FootprintCase } from "./footprint-fixtures";

// --- crossedThreshold: pure ------------------------------------------------

test("crossedThreshold: below the threshold is not a drag", () => {
  assert.equal(crossedThreshold({ x: 0, y: 0 }, { x: 3, y: 0 }, 6), false);
});

test("crossedThreshold: exactly at the threshold is still a tap (strictly greater-than crosses)", () => {
  assert.equal(crossedThreshold({ x: 0, y: 0 }, { x: 6, y: 0 }, 6), false);
});

test("crossedThreshold: past the threshold is a drag", () => {
  assert.equal(crossedThreshold({ x: 0, y: 0 }, { x: 7, y: 0 }, 6), true);
});

test("crossedThreshold: x-only movement past the threshold", () => {
  assert.equal(crossedThreshold({ x: 0, y: 0 }, { x: 10, y: 0 }, 6), true);
});

test("crossedThreshold: y-only movement past the threshold", () => {
  assert.equal(crossedThreshold({ x: 0, y: 0 }, { x: 0, y: 10 }, 6), true);
});

test("crossedThreshold: diagonal movement uses euclidean distance, not per-axis", () => {
  // dx=4,dy=4 -> hypot ~5.66, below a 6px threshold even though each axis alone would look close
  assert.equal(crossedThreshold({ x: 0, y: 0 }, { x: 4, y: 4 }, 6), false);
  // dx=5,dy=5 -> hypot ~7.07, past the threshold
  assert.equal(crossedThreshold({ x: 0, y: 0 }, { x: 5, y: 5 }, 6), true);
});

test("crossedThreshold: uses DRAG_THRESHOLD_PX (6) as the default when no threshold is passed", () => {
  assert.equal(crossedThreshold({ x: 0, y: 0 }, { x: 3, y: 0 }), false);
  assert.equal(crossedThreshold({ x: 0, y: 0 }, { x: 10, y: 0 }), true);
});

// --- buildDragOutcome: one test per drop-resolution path (spec R6) --------

function invItem(id: string, x: number, y: number, rotation: 0 | 90 = 0, playerId = "p1"): ItemInstance {
  return { id, itemTypeId: "stick", location: { type: "player_inventory", playerId, x, y, rotation } };
}

function surfaceItem(id: string, surfaceId: string, x: number, y: number, rotation: 0 | 90 = 0): ItemInstance {
  return { id, itemTypeId: "stick", location: { type: "surface", surfaceId, x, y, rotation } };
}

test("buildDragOutcome path 1: inventory cell -> inventory cell dispatches MoveItem->inventory with the target coords and origin rotation", () => {
  const item = invItem("it1", 0, 1, 90);
  const outcome = buildDragOutcome(item, { kind: "inventory", x: 3, y: 3 }, "p1");
  assert.deepEqual(outcome, {
    kind: "command",
    command: { type: "MoveItem", itemInstanceId: "it1", to: { type: "inventory", ownerId: "p1", x: 3, y: 3, rotation: 90 } },
  });
});

test("buildDragOutcome path 2: inventory cell -> hand slot dispatches MoveItem->hand", () => {
  const item = invItem("it1", 0, 1);
  const outcome = buildDragOutcome(item, { kind: "hand", hand: "right" }, "p1");
  assert.deepEqual(outcome, { kind: "command", command: { type: "MoveItem", itemInstanceId: "it1", to: { type: "hand", hand: "right" } } });
});

test("buildDragOutcome path 3: hand slot -> inventory cell dispatches MoveItem->inventory (hand origin is a player_inventory cell)", () => {
  const item = invItem("it1", 0, 0); // equipped left-hand item lives at the left hand's player_inventory cell
  const outcome = buildDragOutcome(item, { kind: "inventory", x: 2, y: 2 }, "p1");
  assert.deepEqual(outcome, {
    kind: "command",
    command: { type: "MoveItem", itemInstanceId: "it1", to: { type: "inventory", ownerId: "p1", x: 2, y: 2, rotation: 0 } },
  });
});

test("buildDragOutcome path 4: inventory/hand cell -> mesa surface cell dispatches MoveItem->surface with origin rotation", () => {
  const item = invItem("it1", 1, 1, 90);
  const outcome = buildDragOutcome(item, { kind: "surface", surfaceId: "wo_table", x: 2, y: 2 }, "p1");
  assert.deepEqual(outcome, {
    kind: "command",
    command: { type: "MoveItem", itemInstanceId: "it1", to: { type: "surface", surfaceId: "wo_table", x: 2, y: 2, rotation: 90 } },
  });
});

test("buildDragOutcome path 5: mesa surface cell -> inventory cell dispatches MoveItem->inventory with origin rotation", () => {
  const item = surfaceItem("it1", "wo_table", 0, 0, 90);
  const outcome = buildDragOutcome(item, { kind: "inventory", x: 1, y: 1 }, "p1");
  assert.deepEqual(outcome, {
    kind: "command",
    command: { type: "MoveItem", itemInstanceId: "it1", to: { type: "inventory", ownerId: "p1", x: 1, y: 1, rotation: 90 } },
  });
});

test("buildDragOutcome path 6: inventory/hand cell -> map tile dispatches DropItem", () => {
  const item = invItem("it1", 1, 1);
  const outcome = buildDragOutcome(item, { kind: "map", x: 5, y: 6 }, "p1");
  assert.deepEqual(outcome, { kind: "command", command: { type: "DropItem", itemInstanceId: "it1", to: { x: 5, y: 6 } } });
});

test("buildDragOutcome: mesa surface cell -> map tile is BLOCKED client-side, no command sent (spec R6 exclusion)", () => {
  const item = surfaceItem("it1", "wo_table", 0, 0);
  const outcome = buildDragOutcome(item, { kind: "map", x: 5, y: 5 }, "p1");
  assert.deepEqual(outcome, { kind: "blocked", thought: "No puedo tirar esto al suelo desde la mesa. Primero lo guardo." });
});

test("buildDragOutcome: dropping an inventory item back onto its own current cell is a silent no-op", () => {
  const item = invItem("it1", 2, 2);
  assert.deepEqual(buildDragOutcome(item, { kind: "inventory", x: 2, y: 2 }, "p1"), { kind: "noop" });
});

test("buildDragOutcome: dropping a surface item back onto its own current surface cell is a silent no-op", () => {
  const item = surfaceItem("it1", "wo_table", 1, 1);
  assert.deepEqual(buildDragOutcome(item, { kind: "surface", surfaceId: "wo_table", x: 1, y: 1 }, "p1"), { kind: "noop" });
});

test("buildDragOutcome: dropping on an invalid (unresolved) target is a silent no-op", () => {
  const item = invItem("it1", 0, 1);
  assert.deepEqual(buildDragOutcome(item, { kind: "invalid" }, "p1"), { kind: "noop" });
});

// --- MANDATORY regression: rotation is forwarded unchanged, never omitted --
// (design.md risk: the reducer's ItemMoved inventory/surface branches apply
// `rotation ?? 0` — omitting `rotation` here would silently un-rotate a
// rotated item on every inventory<->inventory or inventory<->surface move.)

test("buildDragOutcome REGRESSION: a rotated inventory-origin item forwards rotation:90 explicitly on an inventory target", () => {
  const rotated = invItem("it1", 0, 0, 90);
  const outcome = buildDragOutcome(rotated, { kind: "inventory", x: 3, y: 3 }, "p1");
  assert.equal(outcome.kind, "command");
  if (outcome.kind !== "command" || outcome.command.type !== "MoveItem" || outcome.command.to.type !== "inventory") {
    assert.fail("expected a MoveItem->inventory command");
    return;
  }
  assert.equal(outcome.command.to.rotation, 90, "rotation must be forwarded, never omitted/defaulted to 0 by the client");
});

test("buildDragOutcome REGRESSION: an unrotated surface-origin item forwards rotation:0 explicitly (not undefined) on an inventory target", () => {
  const unrotated = surfaceItem("it2", "wo_table", 0, 0, 0);
  const outcome = buildDragOutcome(unrotated, { kind: "inventory", x: 1, y: 1 }, "p1");
  assert.equal(outcome.kind, "command");
  if (outcome.kind !== "command" || outcome.command.type !== "MoveItem" || outcome.command.to.type !== "inventory") {
    assert.fail("expected a MoveItem->inventory command");
    return;
  }
  assert.equal(outcome.command.to.rotation, 0, "unrotated origin still forwards an explicit rotation, not undefined");
});

// --- footprintValidity: shared verdict-fixture table (tasks.md T8b) -------
// Consumes `footprint-fixtures.ts`'s table (T6): builds a snapshot+catalog
// per case and asserts footprintValidity's verdict matches the documented
// backend rule. Includes the 3 cases migrated from the retired
// `cellOccupant` (T7) plus every other documented parity case.

const FIXTURE_CATALOG: Catalog = {
  catalogVersion: "test",
  terrains: [],
  items: [
    { id: "stone", name: "Piedra", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: [] },
    { id: "pole", name: "Palo", description: "", shape: { w: 1, h: 2 }, rotatable: true, properties: {}, tags: [] },
  ],
  worldObjects: [],
  knowledge: [],
  actions: [],
  research: [],
};

const FIXTURE_SURFACE_ID = "fixture-surface";

function fixtureDraggedItem(fixture: FootprintCase): ItemInstance {
  return fixture.kind === "hand"
    ? { id: fixture.dragged.id, itemTypeId: fixture.dragged.itemTypeId, location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: fixture.rotation } }
    : { id: fixture.dragged.id, itemTypeId: fixture.dragged.itemTypeId, location: { type: "surface", surfaceId: FIXTURE_SURFACE_ID, x: 0, y: 0, rotation: fixture.rotation } };
}

function fixtureOccupiedItems(fixture: FootprintCase): ItemInstance[] {
  return fixture.occupied.map((occ) =>
    fixture.kind === "hand"
      ? { id: occ.id, itemTypeId: occ.itemTypeId, location: { type: "player_inventory", playerId: "p1", x: occ.x, y: occ.y, rotation: occ.rotation } }
      : { id: occ.id, itemTypeId: occ.itemTypeId, location: { type: "surface", surfaceId: FIXTURE_SURFACE_ID, x: occ.x, y: occ.y, rotation: occ.rotation } },
  );
}

function fixtureSnapshot(fixture: FootprintCase): ClientSnapshot {
  return {
    zone: { id: "z1", width: 10, height: 10 },
    visionRadius: 5,
    tiles: [],
    objects: [],
    piles: [],
    items: fixtureOccupiedItems(fixture),
    player: { id: "p1", name: "Náufrago", position: { x: 0, y: 0 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 3, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
  };
}

function fixtureTarget(fixture: FootprintCase): DropTarget {
  return fixture.kind === "hand"
    ? { kind: "hand", hand: fixture.hand ?? "left" }
    : { kind: "surface", surfaceId: FIXTURE_SURFACE_ID, x: fixture.anchor.x, y: fixture.anchor.y };
}

for (const fixture of footprintCases) {
  test(`footprintValidity fixture: ${fixture.name}`, () => {
    const snapshot = fixtureSnapshot(fixture);
    const item = fixtureDraggedItem(fixture);
    const target = fixtureTarget(fixture);
    const surfaceDims = fixture.kind === "surface" ? fixture.grid : undefined;
    const verdict = footprintValidity(snapshot, FIXTURE_CATALOG, item, target, fixture.exceptId, surfaceDims);
    assert.equal(verdict, fixture.expected, fixture.name);
  });
}

// --- snapshotWith: shared fixture builder for the DOM smoke tests below ---

function snapshotWith(items: ItemInstance[]): ClientSnapshot {
  return {
    zone: { id: "z1", width: 10, height: 10 },
    visionRadius: 5,
    tiles: [],
    objects: [],
    piles: [],
    items,
    player: { id: "p1", name: "Náufrago", position: { x: 0, y: 0 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 3, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
  };
}

// --- createDragController: DOM smoke coverage only ------------------------
// (spec "Testing approach": DOM-heavy wiring gets smoke-test coverage, not
// exhaustive DOM behavior testing — same convention as window-manager.test.ts
// / hud.test.ts's FakeElement pattern.)
//
// BOUNDARY (spec R8, amended per design gate review): the hand-rolled fake
// DOM below has NO real event bubbling/dispatch. It only invokes the exact
// listener registered for a given event type via `fire()`. Do NOT add a test
// simulating synthetic click-bubbling (e.g. a below-threshold tap resolving
// through a real `el.click()` -> focus chain) against this fake DOM — that
// remains real-browser behavior outside this smoke-test convention, same as
// today's click-based equip/drop.

class FakeElement {
  classes = new Set<string>();
  style: Record<string, string> = {};
  textContent = "";
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  listeners = new Map<string, Array<(ev: Record<string, unknown>) => void>>();

  get classList(): { add: (...c: string[]) => void; remove: (...c: string[]) => void; toggle: (c: string, force?: boolean) => void; contains: (c: string) => boolean } {
    return {
      add: (...c: string[]) => c.forEach((x) => this.classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => this.classes.delete(x)),
      toggle: (c: string, force?: boolean) => {
        const on = force === undefined ? !this.classes.has(c) : force;
        if (on) this.classes.add(c);
        else this.classes.delete(c);
      },
      contains: (c: string) => this.classes.has(c),
    };
  }

  get className(): string {
    return [...this.classes].join(" ");
  }
  set className(v: string) {
    this.classes = new Set(v.split(" ").filter(Boolean));
  }

  addEventListener(type: string, cb: (ev: Record<string, unknown>) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  setPointerCapture(): void {}
  releasePointerCapture(): void {}
}

function fire(el: FakeElement, type: string, ev: Record<string, unknown>): void {
  for (const cb of el.listeners.get(type) ?? []) cb(ev);
}

/** Minimal `document`-level listener registry — the real DOM object the
 * drag controller's trailing-click suppressor talks to (`document.
 * addEventListener`/`removeEventListener`). Tracks the `capture` flag
 * per listener so tests can assert the suppressor registers capture-phase
 * (spec: must intercept before the mesa cell's own `click` listener). */
class FakeDocument {
  createElement = (): FakeElement => new FakeElement();
  body = new FakeElement();
  elementFromPoint: (x: number, y: number) => FakeElement | null;
  listeners: Array<{ type: string; cb: (ev: Record<string, unknown>) => void; capture: boolean }> = [];

  constructor(elementFromPoint: (x: number, y: number) => FakeElement | null) {
    this.elementFromPoint = elementFromPoint;
  }

  addEventListener(type: string, cb: (ev: Record<string, unknown>) => void, capture = false): void {
    this.listeners.push({ type, cb, capture });
  }

  removeEventListener(type: string, cb: (ev: Record<string, unknown>) => void): void {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.cb === cb));
  }

  /** Test-only helper — dispatches to every registered listener of `type`,
   * standing in for the fake DOM's lack of real event dispatch/bubbling. */
  dispatch(type: string, ev: Record<string, unknown>): void {
    for (const l of this.listeners.filter((x) => x.type === type)) l.cb(ev);
  }
}

/** `run` may return a Promise — when it does, the fake `document` stays
 * installed globally until it settles (required by the timeout-fallback
 * suppressor test below, which awaits the real 0ms timer while the
 * production code's `disarm()` still needs `document.removeEventListener`
 * to resolve to THIS fake, not whatever `document` is restored to). */
function withFakeDom(
  elementFromPoint: (x: number, y: number) => FakeElement | null,
  run: (body: FakeElement, doc: FakeDocument) => void | Promise<void>,
): void | Promise<void> {
  const original = (globalThis as { document?: unknown }).document;
  const fakeDocument = new FakeDocument(elementFromPoint);
  (globalThis as { document?: unknown }).document = fakeDocument;
  const restore = (): void => {
    (globalThis as { document?: unknown }).document = original;
  };
  const result = run(fakeDocument.body, fakeDocument);
  if (result && typeof result.then === "function") {
    return result.then(restore, (err) => {
      restore();
      throw err;
    });
  }
  restore();
  return undefined;
}

function invItemForDom(id: string, x: number, y: number): ItemInstance {
  return { id, itemTypeId: "stick", location: { type: "player_inventory", playerId: "p1", x, y, rotation: 0 } };
}

function makeDeps(overrides: Partial<DragControllerDeps> = {}): { deps: DragControllerDeps; sent: Command[]; thoughts: string[] } {
  const sent: Command[] = [];
  const thoughts: string[] = [];
  const deps: DragControllerDeps = {
    getSnapshot: () => snapshotWith([]),
    sendCommand: (c: Command) => {
      sent.push(c);
    },
    catalog: { catalogVersion: "test", terrains: [], items: [], worldObjects: [], knowledge: [], actions: [], research: [] },
    canvas: new FakeElement() as unknown as HTMLElement,
    resolveMapTile: () => ({ x: 0, y: 0 }),
    showThought: (t: string) => thoughts.push(t),
    ...overrides,
  };
  return { deps, sent, thoughts };
}

test("createDragController smoke: pointermove past the threshold creates a ghost element appended to document.body", () => {
  withFakeDom(
    () => null,
    (body) => {
      const item = invItemForDom("it1", 0, 0);
      const { deps } = makeDeps({ getSnapshot: () => snapshotWith([item]) });
      const controller = createDragController(deps);
      const cell = new FakeElement();
      controller.bindCell(cell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: item });

      fire(cell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      assert.equal(body.children.length, 0, "no ghost yet — still below threshold");

      fire(cell, "pointermove", { clientX: 20, clientY: 20, pointerId: 1 });
      assert.equal(body.children.length, 1, "past-threshold movement creates the ghost");
      assert.equal(body.children[0]?.classes.has("drag-ghost"), true);
    },
  );
});

test("createDragController smoke: dropping past the threshold onto a registered cell sends the resolved MoveItem payload", () => {
  let hovered: FakeElement | null = null;
  withFakeDom(
    () => hovered,
    () => {
      const item = invItemForDom("it1", 0, 0);
      const { deps, sent } = makeDeps({ getSnapshot: () => snapshotWith([item]) });
      const controller = createDragController(deps);

      const sourceCell = new FakeElement();
      const targetCell = new FakeElement();
      controller.bindCell(sourceCell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: item });
      controller.bindCell(targetCell as unknown as HTMLElement, { kind: "inventory", x: 3, y: 3 });

      fire(sourceCell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = targetCell;
      fire(sourceCell, "pointermove", { clientX: 20, clientY: 0, pointerId: 1 });
      fire(sourceCell, "pointerup", { clientX: 20, clientY: 0, pointerId: 1 });

      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0], { type: "MoveItem", itemInstanceId: "it1", to: { type: "inventory", ownerId: "p1", x: 3, y: 3, rotation: 0 } });
    },
  );
});

test("createDragController smoke: a pointerup that never crosses the threshold invokes onTap and sends no command", () => {
  withFakeDom(
    () => null,
    () => {
      const item = invItemForDom("it1", 0, 0);
      const { deps, sent } = makeDeps({ getSnapshot: () => snapshotWith([item]) });
      const controller = createDragController(deps);
      const cell = new FakeElement();
      let tapped = false;
      controller.bindCell(cell as unknown as HTMLElement, {
        kind: "inventory",
        x: 0,
        y: 0,
        occupant: item,
        onTap: () => {
          tapped = true;
        },
      });

      fire(cell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      fire(cell, "pointerup", { clientX: 1, clientY: 1, pointerId: 1 }); // 1px move — below the 6px threshold

      assert.equal(tapped, true);
      assert.equal(sent.length, 0);
    },
  );
});

test("createDragController smoke: pointercancel after crossing the threshold removes the ghost and sends no command", () => {
  withFakeDom(
    () => null,
    (body) => {
      const item = invItemForDom("it1", 0, 0);
      const { deps, sent } = makeDeps({ getSnapshot: () => snapshotWith([item]) });
      const controller = createDragController(deps);
      const cell = new FakeElement();
      controller.bindCell(cell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: item });

      fire(cell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      fire(cell, "pointermove", { clientX: 30, clientY: 30, pointerId: 1 });
      assert.equal(body.children.length, 1, "ghost created past threshold");

      fire(cell, "pointercancel", { pointerId: 1 });
      assert.equal(body.children.length, 0, "ghost removed on cancel");
      assert.equal(sent.length, 0);
    },
  );
});

test("createDragController smoke: dropping over the canvas resolves the tile via resolveMapTile and sends DropItem", () => {
  const canvas = new FakeElement();
  let hovered: FakeElement | null = null;
  let resolveMapTileCalledWith: [number, number] | null = null;
  const resolvedTile = { x: 7, y: 8 };

  withFakeDom(
    () => hovered,
    () => {
      const item = invItemForDom("it1", 0, 0);
      const { deps, sent } = makeDeps({
        getSnapshot: () => snapshotWith([item]),
        canvas: canvas as unknown as HTMLElement,
        resolveMapTile: (cx: number, cy: number) => {
          resolveMapTileCalledWith = [cx, cy];
          return resolvedTile;
        },
      });
      const controller = createDragController(deps);
      const cell = new FakeElement();
      controller.bindCell(cell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: item });

      fire(cell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = canvas;
      fire(cell, "pointermove", { clientX: 40, clientY: 40, pointerId: 1 });
      fire(cell, "pointerup", { clientX: 50, clientY: 60, pointerId: 1 });

      assert.deepEqual(resolveMapTileCalledWith, [50, 60]);
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0], { type: "DropItem", itemInstanceId: "it1", to: resolvedTile });
    },
  );
});

// --- Trailing-click suppressor (browser QA @ d61e98f, mem #2745) ----------
// Real Chromium fires a trailing compatibility `click` on the drag-origin
// cell right after `pointerup`, for any gesture that crossed the drag
// threshold. Mesa cells still carry a native `click` listener with an
// `occupant` captured by closure at render time (hud.ts:247) — the STALE
// trailing click fired a spurious inspect thought 4/4 real-browser repros.
// The fake DOM below has no real capture/bubble phases or event dispatch —
// it only invokes whatever this suite explicitly fires (`fire`/`dispatch`),
// so these tests verify the ARMING logic only (registered/not-registered,
// capture:true, one-shot disarm). Real-browser re-verification via the
// Playwright QA harness is still required to confirm this actually
// suppresses the compat click end-to-end.

test("trailing-click suppressor: a threshold-crossed drag end arms a capture-phase click listener on document", () => {
  let hovered: FakeElement | null = null;
  withFakeDom(
    () => hovered,
    (_body, doc) => {
      const item = invItemForDom("it1", 0, 0);
      const { deps } = makeDeps({ getSnapshot: () => snapshotWith([item]) });
      const controller = createDragController(deps);
      const sourceCell = new FakeElement();
      const targetCell = new FakeElement();
      controller.bindCell(sourceCell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: item });
      controller.bindCell(targetCell as unknown as HTMLElement, { kind: "inventory", x: 3, y: 3 });

      fire(sourceCell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = targetCell;
      fire(sourceCell, "pointermove", { clientX: 20, clientY: 0, pointerId: 1 }); // crosses the 6px threshold
      fire(sourceCell, "pointerup", { clientX: 20, clientY: 0, pointerId: 1 });

      const clickListeners = doc.listeners.filter((l) => l.type === "click");
      assert.equal(clickListeners.length, 1, "exactly one trailing-click suppressor is armed");
      assert.equal(clickListeners[0]?.capture, true, "must be capture-phase to intercept before the cell's own click listener");
    },
  );
});

test("trailing-click suppressor: a below-threshold tap does NOT arm the suppressor", () => {
  withFakeDom(
    () => null,
    (_body, doc) => {
      const item = invItemForDom("it1", 0, 0);
      const { deps } = makeDeps({ getSnapshot: () => snapshotWith([item]) });
      const controller = createDragController(deps);
      const cell = new FakeElement();
      controller.bindCell(cell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: item });

      fire(cell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      fire(cell, "pointerup", { clientX: 1, clientY: 1, pointerId: 1 }); // 1px move — below the 6px threshold

      assert.equal(doc.listeners.filter((l) => l.type === "click").length, 0, "a plain tap's own click IS the intended behavior, nothing to suppress");
    },
  );
});

test("trailing-click suppressor: fires once, stops propagation/default, then disarms itself", () => {
  let hovered: FakeElement | null = null;
  withFakeDom(
    () => hovered,
    (_body, doc) => {
      const item = invItemForDom("it1", 0, 0);
      const { deps } = makeDeps({ getSnapshot: () => snapshotWith([item]) });
      const controller = createDragController(deps);
      const sourceCell = new FakeElement();
      const targetCell = new FakeElement();
      controller.bindCell(sourceCell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: item });
      controller.bindCell(targetCell as unknown as HTMLElement, { kind: "inventory", x: 3, y: 3 });

      fire(sourceCell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = targetCell;
      fire(sourceCell, "pointermove", { clientX: 20, clientY: 0, pointerId: 1 });
      fire(sourceCell, "pointerup", { clientX: 20, clientY: 0, pointerId: 1 });

      assert.equal(doc.listeners.filter((l) => l.type === "click").length, 1);

      let stopped = false;
      let prevented = false;
      doc.dispatch("click", {
        stopPropagation: () => {
          stopped = true;
        },
        preventDefault: () => {
          prevented = true;
        },
      });

      assert.equal(stopped, true, "the trailing click's propagation is stopped");
      assert.equal(prevented, true, "the trailing click's default action is prevented");
      assert.equal(doc.listeners.filter((l) => l.type === "click").length, 0, "one-shot: disarms itself right after suppressing the trailing click");
    },
  );
});

test("trailing-click suppressor: disarms via the timeout fallback if no compat click ever arrives", async () => {
  let hovered: FakeElement | null = null;
  await withFakeDom(
    () => hovered,
    async (_body, doc) => {
      const item = invItemForDom("it1", 0, 0);
      const { deps } = makeDeps({ getSnapshot: () => snapshotWith([item]) });
      const controller = createDragController(deps);
      const sourceCell = new FakeElement();
      const targetCell = new FakeElement();
      controller.bindCell(sourceCell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: item });
      controller.bindCell(targetCell as unknown as HTMLElement, { kind: "inventory", x: 3, y: 3 });

      fire(sourceCell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = targetCell;
      fire(sourceCell, "pointermove", { clientX: 20, clientY: 0, pointerId: 1 });
      fire(sourceCell, "pointerup", { clientX: 20, clientY: 0, pointerId: 1 });

      assert.equal(doc.listeners.filter((l) => l.type === "click").length, 1, "armed right after the threshold-crossed drop");

      // No compat click ever dispatched — only the 0ms timer fallback can disarm it.
      // Wait comfortably past that timer (still while the fake document is installed).
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      assert.equal(doc.listeners.filter((l) => l.type === "click").length, 0, "timer fallback disarmed the suppressor with no click received");
    },
  );
});

// --- Full-footprint highlight + bindGrid/unbindGrid lifecycle (tasks.md T8c,
// design.md Decision 3/4) ----------------------------------------------------

test("full-footprint highlight: hovering a multi-cell footprint's anchor toggles drop-ok on EVERY covered cell, not just the anchor; clearHighlight clears ALL of them", () => {
  let hovered: FakeElement | null = null;
  withFakeDom(
    () => hovered,
    () => {
      const draggedItem: ItemInstance = { id: "it1", itemTypeId: "pole", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
      const { deps } = makeDeps({ getSnapshot: () => snapshotWith([draggedItem]), catalog: FIXTURE_CATALOG });
      const controller = createDragController(deps);

      const sourceCell = new FakeElement();
      controller.bindCell(sourceCell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: draggedItem });

      // The footprint anchored at (2,0) for a 1x2 item covers (2,0) and (2,1).
      const anchorCell = new FakeElement();
      const secondCell = new FakeElement();
      controller.bindCell(anchorCell as unknown as HTMLElement, { kind: "inventory", x: 2, y: 0 });
      controller.bindCell(secondCell as unknown as HTMLElement, { kind: "inventory", x: 2, y: 1 });
      const cells = new Map<string, HTMLElement>([
        ["2,0", anchorCell as unknown as HTMLElement],
        ["2,1", secondCell as unknown as HTMLElement],
      ]);
      controller.bindGrid({ kind: "inventory", dims: { width: 4, height: 4 }, cells });

      fire(sourceCell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = anchorCell;
      fire(sourceCell, "pointermove", { clientX: 50, clientY: 0, pointerId: 1 }); // crosses the drag threshold

      assert.ok(anchorCell.classes.has("drop-ok"), "the anchor cell is highlighted");
      assert.ok(secondCell.classes.has("drop-ok"), "the SECOND footprint cell is ALSO highlighted, not just the anchor");

      // pointercancel (not pointerup) ends the drag via the exact same
      // `endDrag()`/`clearHighlight()` path, without arming the trailing-
      // click suppressor — irrelevant to what this test asserts.
      fire(sourceCell, "pointercancel", { pointerId: 1 });
      assert.ok(!anchorCell.classes.has("drop-ok"), "clearHighlight removed the class from the anchor cell");
      assert.ok(!secondCell.classes.has("drop-ok"), "clearHighlight removed the class from the SECOND cell too, not just the anchor");
    },
  );
});

test("full-footprint highlight: a near-edge anchor colors only the IN-BOUNDS covered cells (the rest have no DOM element to color)", () => {
  let hovered: FakeElement | null = null;
  withFakeDom(
    () => hovered,
    () => {
      const draggedItem: ItemInstance = { id: "it1", itemTypeId: "pole", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
      const { deps } = makeDeps({ getSnapshot: () => snapshotWith([draggedItem]), catalog: FIXTURE_CATALOG });
      const controller = createDragController(deps);

      const sourceCell = new FakeElement();
      controller.bindCell(sourceCell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: draggedItem });

      // Anchored at (3,3) in a 4x4 grid, a 1x2 item's footprint is (3,3) and
      // (3,4) — (3,4) is out of bounds, so the coordinate map only has an
      // element for (3,3) (mirroring what a real render would produce).
      const anchorCell = new FakeElement();
      controller.bindCell(anchorCell as unknown as HTMLElement, { kind: "inventory", x: 3, y: 3 });
      const cells = new Map<string, HTMLElement>([["3,3", anchorCell as unknown as HTMLElement]]);
      controller.bindGrid({ kind: "inventory", dims: { width: 4, height: 4 }, cells });

      fire(sourceCell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = anchorCell;
      fire(sourceCell, "pointermove", { clientX: 50, clientY: 50, pointerId: 1 });

      assert.ok(anchorCell.classes.has("drop-bad"), "in-bounds portion of an out-of-bounds footprint paints red");
      assert.ok(!anchorCell.classes.has("drop-ok"));
    },
  );
});

test("full-footprint highlight: a single-cell item still highlights correctly on its 1-cell footprint", () => {
  let hovered: FakeElement | null = null;
  withFakeDom(
    () => hovered,
    () => {
      const draggedItem: ItemInstance = { id: "it1", itemTypeId: "stone", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
      const { deps } = makeDeps({ getSnapshot: () => snapshotWith([draggedItem]), catalog: FIXTURE_CATALOG });
      const controller = createDragController(deps);

      const sourceCell = new FakeElement();
      controller.bindCell(sourceCell as unknown as HTMLElement, { kind: "inventory", x: 0, y: 0, occupant: draggedItem });

      const targetCell = new FakeElement();
      controller.bindCell(targetCell as unknown as HTMLElement, { kind: "inventory", x: 1, y: 1 });
      const cells = new Map<string, HTMLElement>([["1,1", targetCell as unknown as HTMLElement]]);
      controller.bindGrid({ kind: "inventory", dims: { width: 4, height: 4 }, cells });

      fire(sourceCell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = targetCell;
      fire(sourceCell, "pointermove", { clientX: 50, clientY: 50, pointerId: 1 });

      assert.ok(targetCell.classes.has("drop-ok"), "a 1x1 dragged item still highlights its single covered cell");
    },
  );
});

test("unbindGrid: after unbinding a surface's GridContext, a subsequent highlight lookup for that key MISSES cleanly (no throw, no class applied)", () => {
  let hovered: FakeElement | null = null;
  withFakeDom(
    () => hovered,
    () => {
      const draggedItem: ItemInstance = { id: "it1", itemTypeId: "stone", location: { type: "surface", surfaceId: "wo_x", x: 0, y: 0, rotation: 0 } };
      const { deps } = makeDeps({ getSnapshot: () => snapshotWith([draggedItem]), catalog: FIXTURE_CATALOG });
      const controller = createDragController(deps);

      const sourceCell = new FakeElement();
      controller.bindCell(sourceCell as unknown as HTMLElement, { kind: "surface", surfaceId: "wo_x", x: 0, y: 0, occupant: draggedItem });

      const targetCell = new FakeElement();
      controller.bindCell(targetCell as unknown as HTMLElement, { kind: "surface", surfaceId: "wo_x", x: 1, y: 0 });
      const cells = new Map<string, HTMLElement>([["1,0", targetCell as unknown as HTMLElement]]);
      controller.bindGrid({ kind: "surface", surfaceId: "wo_x", dims: { width: 3, height: 3 }, cells });

      fire(sourceCell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = targetCell;
      fire(sourceCell, "pointermove", { clientX: 20, clientY: 0, pointerId: 1 }); // crosses the drag threshold
      assert.ok(targetCell.classes.has("drop-ok"), "highlight applied while the GridContext is bound");
      // pointercancel ends this drag via the same endDrag() path, without
      // arming the trailing-click suppressor — irrelevant to this test.
      fire(sourceCell, "pointercancel", { pointerId: 1 });

      controller.unbindGrid("surface:wo_x");

      fire(sourceCell, "pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
      hovered = targetCell;
      assert.doesNotThrow(() => fire(sourceCell, "pointermove", { clientX: 20, clientY: 0, pointerId: 1 }));
      assert.ok(!targetCell.classes.has("drop-ok"), "no class applied — the grid Map no longer holds the key after unbindGrid");
    },
  );
});
