import { test } from "node:test";
import assert from "node:assert/strict";
import { clampToViewport, createWindowManager, shouldDismiss } from "./window-manager";

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

// --- WindowManager: smoke coverage only, against a minimal hand-rolled fake
// DOM (this repo's tests run under plain `node:test`, no jsdom — same pattern
// `game/game.test.ts` uses for `fakeCanvas`/`fakeMenuEl`/`stubDocument`). ----

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

  setPointerCapture(): void {}
  releasePointerCapture(): void {}
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
