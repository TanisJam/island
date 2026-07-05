import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, ItemInstance } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { createStore } from "../state/store";
import { createDomUi } from "./ui";
import type { HudHandlers } from "./hud";

/**
 * Minimal fake DOM (same pattern as `window-manager.test.ts`'s `FakeElement`/
 * `withFakeDom` — this repo's tests run under plain `node:test`, no jsdom).
 * `createDomUi()` needs a bit more than `window-manager.test.ts` alone
 * exercises: `document.body` (the default `createWindowManager()` root),
 * `document.getElementById` (called defensively by `renderHud`, always
 * guarded with `if (el)` so `null` is safe), and top-level
 * `document.addEventListener`/`removeEventListener` (the outside-click
 * dismiss listener `createDomUi()` wires at construction time).
 */
class FakeElement {
  classes = new Set<string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  style: Record<string, string> = {};
  id = "";
  textContent = "";
  title = "";
  offsetWidth = 280;
  offsetHeight = 320;
  offsetLeft = 0;
  offsetTop = 0;
  listeners = new Map<string, Array<(ev: unknown) => void>>();

  get classList(): { add: (...c: string[]) => void; toggle: (c: string, force?: boolean) => void; contains: (c: string) => boolean } {
    return {
      add: (...c: string[]) => c.forEach((x) => this.classes.add(x)),
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

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  addEventListener(type: string, cb: (ev: unknown) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }

  closest(selector: string): FakeElement | null {
    const cls = selector.replace(/^\./, "");
    let node: FakeElement | null = this;
    while (node) {
      if (node.classes.has(cls)) return node;
      node = node.parent;
    }
    return null;
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  removeChild(child: FakeElement): FakeElement {
    this.children = this.children.filter((c) => c !== child);
    child.parent = null;
    return child;
  }

  setPointerCapture(): void {}
  releasePointerCapture(): void {}

  find(predicate: (el: FakeElement) => boolean): FakeElement | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return undefined;
  }
}

/** Fires every listener registered for `type` on `el` — this fake DOM has no
 * real event dispatch/bubbling, so tests call the registered handler directly. */
function fire(el: FakeElement, type: string, ev: Record<string, unknown> = {}): void {
  for (const cb of el.listeners.get(type) ?? []) cb(ev);
}

function withFakeDom(run: (body: FakeElement) => void): void {
  const originalDocument = (globalThis as { document?: unknown }).document;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const body = new FakeElement();
  (globalThis as { document?: unknown }).document = {
    createElement: () => new FakeElement(),
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    body,
  };
  (globalThis as { window?: unknown }).window = { innerWidth: 1024, innerHeight: 768 };
  try {
    run(body);
  } finally {
    (globalThis as { document?: unknown }).document = originalDocument;
    (globalThis as { window?: unknown }).window = originalWindow;
  }
}

const catalog: Catalog = {
  catalogVersion: "test",
  terrains: [{ id: "sand", name: "Arena", walkable: true, tags: [] }],
  items: [{ id: "rama", name: "Rama", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: { firmeza: 3 }, tags: ["wood", "flexible"] }],
  worldObjects: [],
  knowledge: [],
  actions: [],
  research: [],
};

const CROUCH_POS = { x: 5, y: 5 };

function worldItemAt(id: string, itemTypeId: string, x: number, y: number): ItemInstance {
  return { id, itemTypeId, location: { type: "world", zoneId: "z1", x, y } };
}

function makeSnapshot(items: ItemInstance[]): ClientSnapshot {
  return {
    zone: { id: "z1", width: 10, height: 10 },
    visionRadius: 5,
    tiles: [{ x: CROUCH_POS.x, y: CROUCH_POS.y, terrain: "sand", walkable: true, tags: [], visibility: "visible" }],
    objects: [],
    piles: [],
    items,
    player: { id: "p1", name: "Náufrago", position: CROUCH_POS, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
  };
}

/** Locates the currently-open crouch window's rendered body (the `.crouch-frame`
 * element) inside `root` (the fake `document.body`) — mirrors the real DOM
 * shape `window-manager.ts`'s `buildElement` produces: `.win` > (`.bar-title`,
 * `.body` > the caller's body). */
function findCrouchFrame(root: FakeElement): FakeElement {
  const frame = root.find((el) => el.classes.has("crouch-frame"));
  assert.ok(frame, "the crouch window's body (.crouch-frame) is open in the fake DOM");
  return frame!;
}

test("createDomUi + toggleCrouch integration: properties revealed by clicking a glyph SURVIVE the store notification the Observe command's own response triggers (regression: info strip must not flash-and-vanish)", () => {
  withFakeDom((root) => {
    const item = worldItemAt("it1", "rama", CROUCH_POS.x, CROUCH_POS.y);
    const snapshot = makeSnapshot([item]);
    const store = createStore(snapshot);

    const observeCalls: string[] = [];
    const handlers: HudHandlers = {
      onEquip: () => {},
      onDrop: () => {},
      onObserve: (id) => observeCalls.push(id),
    };

    const ui = createDomUi();
    ui.mount(store, catalog, handlers);
    ui.toggleCrouch(CROUCH_POS);

    // Sanity: properties are hidden before any click.
    const frameBeforeClick = findCrouchFrame(root);
    const infoBefore = frameBeforeClick.find((el) => el.classes.has("crouch-frame-info"))!;
    assert.ok(!infoBefore.find((el) => el.classes.has("crouch-props")), "properties are hidden before any click");

    // Click the (only) item glyph — dispatches Observe + reveals properties
    // in the CURRENTLY open frame.
    const itemsArea = frameBeforeClick.find((el) => el.classes.has("crouch-frame-items"))!;
    const glyph = itemsArea.children[0]!;
    fire(glyph, "click");
    assert.deepEqual(observeCalls, ["it1"], "clicking dispatches Observe with the item's INSTANCE id");

    const frameRightAfterClick = findCrouchFrame(root);
    const infoRightAfterClick = frameRightAfterClick.find((el) => el.classes.has("crouch-frame-info"))!;
    assert.ok(infoRightAfterClick.find((el) => el.classes.has("crouch-props")), "properties are visible immediately after the click");

    // Simulate the Observe command's OWN async response arriving later and
    // triggering a store notification (`store.ingest` -> `notify` ->
    // `ui.ts`'s `rerender()` -> `windows.setBody` rebuilds the crouch body
    // from scratch). This is the exact sequence that used to reset the info
    // strip back to its placeholder.
    store.ingest([]);

    const frameAfterRerender = findCrouchFrame(root);
    const infoAfterRerender = frameAfterRerender.find((el) => el.classes.has("crouch-frame-info"))!;
    const propsAfterRerender = infoAfterRerender.find((el) => el.classes.has("crouch-props"));
    assert.ok(propsAfterRerender, "properties MUST still be visible after the rerender the Observe response itself triggers — they must not flash and vanish");
    assert.ok(propsAfterRerender!.textContent.includes("firmeza: 3"));
    assert.ok(propsAfterRerender!.textContent.includes("wood"));
  });
});

test("createDomUi + toggleCrouch: opening a fresh crouch window never carries over a stale selection from a previous session", () => {
  withFakeDom((root) => {
    const item = worldItemAt("it1", "rama", CROUCH_POS.x, CROUCH_POS.y);
    const snapshot = makeSnapshot([item]);
    const store = createStore(snapshot);
    const handlers: HudHandlers = { onEquip: () => {}, onDrop: () => {}, onObserve: () => {} };

    const ui = createDomUi();
    ui.mount(store, catalog, handlers);

    ui.toggleCrouch(CROUCH_POS);
    const itemsArea = findCrouchFrame(root).find((el) => el.classes.has("crouch-frame-items"))!;
    fire(itemsArea.children[0]!, "click");
    assert.ok(findCrouchFrame(root).find((el) => el.classes.has("crouch-props")), "properties visible after the click");

    ui.toggleCrouch(CROUCH_POS); // closes the window (same-id toggle)
    ui.toggleCrouch(CROUCH_POS); // reopens fresh

    const infoAfterReopen = findCrouchFrame(root).find((el) => el.classes.has("crouch-frame-info"))!;
    assert.ok(!infoAfterReopen.find((el) => el.classes.has("crouch-props")), "a freshly reopened window starts unselected, never bleeding a stale selection");
  });
});
