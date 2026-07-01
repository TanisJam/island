/**
 * Floating-window system backing the extended `Ui` (design.md "WindowManager
 * (hud/window-manager.ts) — internal to createDomUi" + spec
 * "Floating-Window System"). DOM structure mirrors
 * docs/1-diseno/mockups/luz-de-fuego.html's `.win` / `.bar-title` / `.btns` /
 * `.body` markup so the matching CSS (style.css, added alongside this file)
 * applies unchanged once the shell wires it in (Phase 3).
 *
 * Kept split in two halves on purpose: the PURE helpers (`clampToViewport`,
 * `shouldDismiss`) are unit-tested directly with `node:test` (no DOM); the
 * DOM-heavy `createWindowManager` factory only gets smoke coverage, per
 * tasks.md 2.2.
 */

export type WindowId = string;
export type ScreenPoint = { x: number; y: number };

export interface WindowSpec {
  id: WindowId;
  title: string;
  body: HTMLElement;
  at?: ScreenPoint;
  pinned?: boolean;
  closable?: boolean;
  draggable?: boolean;
  /** "menu" = contextual-menu styling; closes on select unless pinned
   * (handled by the caller, not here) and always dismisses on outside click
   * (see `shouldDismiss`). "window" (default) = a regular pinnable panel
   * (e.g. the inventory) that only dismisses on outside click if unpinned. */
  variant?: "window" | "menu";
}

export interface WindowHandle {
  id: WindowId;
  el: HTMLElement;
  isPinned(): boolean;
  close(): void;
  focus(): void;
}

export interface WindowManager {
  open(spec: WindowSpec): WindowHandle;
  close(id: WindowId): void;
  toggle(spec: WindowSpec): WindowHandle | null;
  get(id: WindowId): WindowHandle | null;
  /** Closes every window for which `shouldDismiss` is true, skipping any
   * window that contains `exceptTarget` (e.g. the click that opened it). */
  dismissTransient(exceptTarget?: EventTarget | null): void;
  destroy(): void;
}

const FALLBACK_SIZE = { w: 280, h: 320 }; // mockup's #ctx/.win min-width/height, used before the element is measured post-insert

/** Clamps a top-left window position so a `size`-sized box stays fully
 * inside a `view`-sized viewport. Clamps both edges (not just the
 * mockup's max-only clamp) so it also behaves for windows near the
 * top/left edge or larger than the viewport itself. */
export function clampToViewport(at: ScreenPoint, size: { w: number; h: number }, view: { w: number; h: number }): ScreenPoint {
  const maxX = Math.max(0, view.w - size.w);
  const maxY = Math.max(0, view.h - size.h);
  return {
    x: Math.min(Math.max(at.x, 0), maxX),
    y: Math.min(Math.max(at.y, 0), maxY),
  };
}

/** Whether a window should close on an OUTSIDE click. Menus always do
 * (clicking elsewhere on the map should never leave a stray menu pinned to
 * the screen); regular windows only do when unpinned — pin exists precisely
 * so e.g. the inventory can stay open while the player keeps clicking the
 * map (design.md decision, deliberately stricter than the mockup's
 * pin-blocks-everything prototype behavior). */
export function shouldDismiss(win: { pinned: boolean; variant: "window" | "menu" }): boolean {
  if (win.variant === "menu") return true;
  return !win.pinned;
}

type Entry = { el: HTMLElement; pinned: boolean; variant: "window" | "menu" };

/** DOM implementation of `WindowManager`. `root` defaults to `document.body`
 * so `createDomUi()` can just call `createWindowManager()`. */
export function createWindowManager(root: HTMLElement = document.body): WindowManager {
  const entries = new Map<WindowId, Entry>();
  let topZ = 20; // base windows sit at z>=20 per the mockup

  function viewport(): { w: number; h: number } {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function focus(id: WindowId): void {
    const entry = entries.get(id);
    if (!entry) return;
    topZ += 1;
    entry.el.style.zIndex = String(topZ);
  }

  function close(id: WindowId): void {
    const entry = entries.get(id);
    if (!entry) return;
    entry.el.remove();
    entries.delete(id);
  }

  function wireDrag(el: HTMLElement, handleEl: HTMLElement): void {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    handleEl.addEventListener("pointerdown", (ev: PointerEvent) => {
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      originLeft = el.offsetLeft;
      originTop = el.offsetTop;
      handleEl.setPointerCapture?.(ev.pointerId);
    });
    handleEl.addEventListener("pointermove", (ev: PointerEvent) => {
      if (!dragging) return;
      const raw = { x: originLeft + (ev.clientX - startX), y: originTop + (ev.clientY - startY) };
      const size = { w: el.offsetWidth || FALLBACK_SIZE.w, h: el.offsetHeight || FALLBACK_SIZE.h };
      const clamped = clampToViewport(raw, size, viewport());
      el.style.left = `${clamped.x}px`;
      el.style.top = `${clamped.y}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    });
    const stopDrag = (ev: PointerEvent): void => {
      dragging = false;
      handleEl.releasePointerCapture?.(ev.pointerId);
    };
    handleEl.addEventListener("pointerup", stopDrag);
    handleEl.addEventListener("pointercancel", stopDrag);
  }

  function buildElement(spec: WindowSpec): { el: HTMLElement; pinButton: HTMLButtonElement } {
    const variant = spec.variant ?? "window";
    const el = document.createElement("div");
    el.id = spec.id;
    el.className = variant === "menu" ? "win menu" : "win";
    el.style.position = "fixed";

    const barTitle = document.createElement("div");
    barTitle.className = "bar-title";
    const h3 = document.createElement("h3");
    h3.textContent = spec.title;
    barTitle.appendChild(h3);

    const btns = document.createElement("div");
    btns.className = "btns";

    const pinButton = document.createElement("button");
    pinButton.className = "pin";
    pinButton.title = "fijar";
    pinButton.textContent = "📌";
    if (spec.pinned) pinButton.classList.add("pinned");
    pinButton.addEventListener("click", (ev: Event) => {
      ev.stopPropagation();
      const entry = entries.get(spec.id);
      if (!entry) return;
      entry.pinned = !entry.pinned;
      pinButton.classList.toggle("pinned", entry.pinned);
    });
    btns.appendChild(pinButton);

    if (spec.closable ?? true) {
      const closeButton = document.createElement("button");
      closeButton.className = "close";
      closeButton.title = "cerrar";
      closeButton.textContent = "✕";
      closeButton.addEventListener("click", (ev: Event) => {
        ev.stopPropagation();
        close(spec.id);
      });
      btns.appendChild(closeButton);
    }

    barTitle.appendChild(btns);
    el.appendChild(barTitle);

    const body = document.createElement("div");
    body.className = "body";
    body.appendChild(spec.body);
    el.appendChild(body);

    if (spec.draggable ?? true) wireDrag(el, barTitle);

    return { el, pinButton };
  }

  function makeHandle(id: WindowId): WindowHandle {
    const entry = entries.get(id);
    return {
      id,
      el: entry?.el ?? document.createElement("div"),
      isPinned: () => entries.get(id)?.pinned ?? false,
      close: () => close(id),
      focus: () => focus(id),
    };
  }

  function open(spec: WindowSpec): WindowHandle {
    close(spec.id); // idempotent — replace if already open, matches `toggle`'s reuse-by-id contract
    const { el } = buildElement(spec);
    const at = spec.at ?? { x: 0, y: 0 };

    const initial = clampToViewport(at, FALLBACK_SIZE, viewport());
    el.style.left = `${initial.x}px`;
    el.style.top = `${initial.y}px`;

    root.appendChild(el);
    entries.set(spec.id, { el, pinned: spec.pinned ?? false, variant: spec.variant ?? "window" });

    // Re-clamp using the now-measured size (offsetWidth/Height are 0 before
    // insertion) so windows opened near an edge never overflow the viewport.
    const measured = { w: el.offsetWidth || FALLBACK_SIZE.w, h: el.offsetHeight || FALLBACK_SIZE.h };
    const reclamped = clampToViewport(at, measured, viewport());
    el.style.left = `${reclamped.x}px`;
    el.style.top = `${reclamped.y}px`;

    focus(spec.id);
    return makeHandle(spec.id);
  }

  function toggle(spec: WindowSpec): WindowHandle | null {
    if (entries.has(spec.id)) {
      close(spec.id);
      return null;
    }
    return open(spec);
  }

  function get(id: WindowId): WindowHandle | null {
    return entries.has(id) ? makeHandle(id) : null;
  }

  function dismissTransient(exceptTarget?: EventTarget | null): void {
    for (const [id, entry] of [...entries.entries()]) {
      if (exceptTarget && entry.el.contains(exceptTarget as Node)) continue;
      if (shouldDismiss({ pinned: entry.pinned, variant: entry.variant })) close(id);
    }
  }

  function destroy(): void {
    for (const id of [...entries.keys()]) close(id);
  }

  return { open, close, toggle, get, dismissTransient, destroy };
}
