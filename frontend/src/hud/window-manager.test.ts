import { test } from "node:test";
import assert from "node:assert/strict";
import { clampToViewport, createWindowManager, isInsideButtons, shouldDismiss } from "./window-manager";

// --- pure helpers: real unit coverage, no DOM ------------------------------

test("clampToViewport: keeps a window fully inside the viewport when it would overflow the bottom-right", () => {
  const at = clampToViewport({ x: 900, y: 700 }, { w: 280, h: 320 }, { w: 1000, h: 800 });
  assert.deepEqual(at, { x: 720, y: 480 });
});

test("clampToViewport: clamps a negative position back to the top-left corner", () => {
  const at = clampToViewport({ x: -50, y: -10 }, { w: 280, h: 320 }, { w: 1000, h: 800 });
  assert.deepEqual(at, { x: 0, y: 0 });
});

test("clampToViewport: a window already fully inside the viewport is left untouched", () => {
  const at = clampToViewport({ x: 100, y: 100 }, { w: 280, h: 320 }, { w: 1000, h: 800 });
  assert.deepEqual(at, { x: 100, y: 100 });
});

test("clampToViewport: a window bigger than the viewport clamps to the top-left corner (never negative)", () => {
  const at = clampToViewport({ x: 50, y: 50 }, { w: 2000, h: 2000 }, { w: 1000, h: 800 });
  assert.deepEqual(at, { x: 0, y: 0 });
});

test("shouldDismiss: menu variant always dismisses on outside click, pinned or not", () => {
  assert.equal(shouldDismiss({ pinned: false, variant: "menu" }), true);
  assert.equal(shouldDismiss({ pinned: true, variant: "menu" }), true);
});

test("shouldDismiss: window variant only dismisses on outside click when unpinned", () => {
  assert.equal(shouldDismiss({ pinned: false, variant: "window" }), true);
  assert.equal(shouldDismiss({ pinned: true, variant: "window" }), false);
});

// --- isInsideButtons: the guard that keeps the ✕/📌 buttons from being
// swallowed by the title bar's drag pointer-capture (root cause of "the ✕
// button does nothing") ---------------------------------------------------

test("isInsideButtons: null target is not inside .btns", () => {
  assert.equal(isInsideButtons(null), false);
});

test("isInsideButtons: a target without a working closest() is treated as not inside .btns", () => {
  assert.equal(isInsideButtons({} as EventTarget), false);
});

test("isInsideButtons: true when closest('.btns') finds a match (e.g. the close/pin button)", () => {
  const target = { closest: (sel: string) => (sel === ".btns" ? {} : null) };
  assert.equal(isInsideButtons(target as unknown as EventTarget), true);
});

test("isInsideButtons: false when closest('.btns') finds nothing (e.g. the title bar itself)", () => {
  const target = { closest: () => null };
  assert.equal(isInsideButtons(target as unknown as EventTarget), false);
});

// --- WindowManager: smoke coverage only, against a minimal hand-rolled fake
// DOM (this repo's tests run under plain `node:test`, no jsdom — same pattern
// `game/game.test.ts` uses for `fakeCanvas`/`stubDocument`/`stubWindowGlobal`). ----

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

  /** Minimal class-selector `closest()` (e.g. `.btns`) — enough to exercise
   * `isInsideButtons` against this fake DOM. */
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
}

/** Fires every listener registered for `type` on `el` with `ev` — this fake
 * DOM has no real event dispatch/bubbling, so tests that need to exercise a
 * specific handler (e.g. the drag pointerdown guard) call it directly. */
function fire(el: FakeElement, type: string, ev: Record<string, unknown>): void {
  for (const cb of el.listeners.get(type) ?? []) cb(ev);
}

function withFakeDom(run: () => void): void {
  const originalDocument = (globalThis as { document?: unknown }).document;
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeElement() };
  (globalThis as { window?: unknown }).window = { innerWidth: 1024, innerHeight: 768 };
  try {
    run();
  } finally {
    (globalThis as { document?: unknown }).document = originalDocument;
    (globalThis as { window?: unknown }).window = originalWindow;
  }
}

test("createWindowManager: open/toggle/dismissTransient/close/destroy do not throw and behave against a minimal fake DOM", () => {
  withFakeDom(() => {
    const root = new FakeElement();
    const wm = createWindowManager(root as unknown as HTMLElement);

    const handle = wm.open({ id: "inventory", title: "MIS COSAS", body: new FakeElement() as unknown as HTMLElement, at: { x: 10, y: 10 } });
    assert.equal(handle.id, "inventory");
    assert.equal(handle.isPinned(), false);
    assert.equal(root.children.length, 1, "open() appends the window to root");

    const toggledOff = wm.toggle({ id: "inventory", title: "MIS COSAS", body: new FakeElement() as unknown as HTMLElement });
    assert.equal(toggledOff, null, "toggle() closes an already-open window and returns null");
    assert.equal(root.children.length, 0);

    wm.open({ id: "context-menu", title: "TILE", body: new FakeElement() as unknown as HTMLElement, variant: "menu" });
    assert.equal(root.children.length, 1);
    wm.dismissTransient(null);
    assert.equal(root.children.length, 0, "unpinned menu dismisses on outside click");

    const pinned = wm.open({ id: "pinned-window", title: "PINNED", body: new FakeElement() as unknown as HTMLElement, pinned: true });
    assert.equal(pinned.isPinned(), true);
    wm.dismissTransient(null);
    assert.equal(root.children.length, 1, "pinned window survives outside-click dismissal");

    wm.destroy();
    assert.equal(root.children.length, 0, "destroy() removes every remaining window");
  });
});

test("createWindowManager: pointerdown on the ✕/📌 buttons never starts a drag (regression for the swallowed-click bug)", () => {
  withFakeDom(() => {
    const root = new FakeElement();
    const wm = createWindowManager(root as unknown as HTMLElement);
    const handle = wm.open({ id: "inventory", title: "MIS COSAS", body: new FakeElement() as unknown as HTMLElement });

    const el = handle.el as unknown as FakeElement;
    const barTitle = el.children[0]!;
    const btns = barTitle.children[1]!;
    const [pinButton, closeButton] = btns.children as [FakeElement, FakeElement];

    let captured = false;
    (barTitle as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {
      captured = true;
    };

    fire(barTitle, "pointerdown", { target: closeButton, clientX: 0, clientY: 0, pointerId: 1 });
    assert.equal(captured, false, "pointerdown on the close button must not start a drag / capture the pointer");

    fire(barTitle, "pointerdown", { target: pinButton, clientX: 0, clientY: 0, pointerId: 1 });
    assert.equal(captured, false, "pointerdown on the pin button must not start a drag / capture the pointer either");

    fire(barTitle, "pointerdown", { target: barTitle, clientX: 0, clientY: 0, pointerId: 1 });
    assert.equal(captured, true, "pointerdown on the bare title bar still starts a drag as before");
  });
});

test("createWindowManager: the ✕ button's own click listener still closes the window", () => {
  withFakeDom(() => {
    const root = new FakeElement();
    const wm = createWindowManager(root as unknown as HTMLElement);
    const handle = wm.open({ id: "inventory", title: "MIS COSAS", body: new FakeElement() as unknown as HTMLElement });

    const el = handle.el as unknown as FakeElement;
    const closeButton = el.children[0]!.children[1]!.children[1]!;
    fire(closeButton, "click", { stopPropagation: () => {} });

    assert.equal(root.children.length, 0, "clicking ✕ closes the window");
  });
});

test("createWindowManager: clicking anywhere inside a window raises it above other open windows", () => {
  withFakeDom(() => {
    const root = new FakeElement();
    const wm = createWindowManager(root as unknown as HTMLElement);
    const a = wm.open({ id: "a", title: "A", body: new FakeElement() as unknown as HTMLElement });
    const b = wm.open({ id: "b", title: "B", body: new FakeElement() as unknown as HTMLElement });

    const aEl = a.el as unknown as FakeElement;
    const bEl = b.el as unknown as FakeElement;
    assert.ok(Number(bEl.style.zIndex) > Number(aEl.style.zIndex), "b opened last, so it starts on top");

    fire(aEl, "click", {});
    assert.ok(Number(aEl.style.zIndex) > Number(bEl.style.zIndex), "clicking anywhere in a raises it above b");
  });
});

test("createWindowManager: setBody replaces an open window's body content in place (fixes the stale-inventory regression)", () => {
  withFakeDom(() => {
    const root = new FakeElement();
    const wm = createWindowManager(root as unknown as HTMLElement);
    const oldBody = new FakeElement();
    oldBody.textContent = "old";
    const handle = wm.open({ id: "inventory", title: "MIS COSAS", body: oldBody as unknown as HTMLElement });

    const newBody = new FakeElement();
    newBody.textContent = "new";
    wm.setBody("inventory", newBody as unknown as HTMLElement);

    const el = handle.el as unknown as FakeElement;
    const bodyWrapper = el.children[1]!;
    assert.equal(bodyWrapper.children.length, 1, "the stale body is removed, not appended alongside the new one");
    assert.equal(bodyWrapper.children[0]?.textContent, "new");

    // No-op, must not throw, when the window isn't open.
    wm.setBody("not-open", new FakeElement() as unknown as HTMLElement);
  });
});

test("createWindowManager: reopening a window after close reuses its last remembered position, ignoring a new `at`", () => {
  withFakeDom(() => {
    const root = new FakeElement();
    const wm = createWindowManager(root as unknown as HTMLElement);
    const first = wm.open({ id: "inventory", title: "MIS COSAS", body: new FakeElement() as unknown as HTMLElement, at: { x: 40, y: 50 } });
    const firstEl = first.el as unknown as FakeElement;
    const firstPos = { x: firstEl.style.left, y: firstEl.style.top };

    wm.close("inventory");
    const second = wm.open({ id: "inventory", title: "MIS COSAS", body: new FakeElement() as unknown as HTMLElement, at: { x: 900, y: 900 } });
    const secondEl = second.el as unknown as FakeElement;
    const secondPos = { x: secondEl.style.left, y: secondEl.style.top };

    assert.deepEqual(secondPos, firstPos, "reopen ignores the new `at` and reuses the remembered position");
  });
});
