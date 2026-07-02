import type { Catalog, Command, ItemInstance, Position } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { createEmojiAssets } from "../render/assets";
import { INV_H, INV_W, footprintCells, inventoryCellsForItem, occupiedCellsForItem, rotatedDims } from "./hud";

export type ScreenPoint = { x: number; y: number };

/** Movement (in CSS pixels) a pointer must travel past its `pointerdown`
 * origin before a tap on an occupied cell escalates into a drag (spec
 * "Drag gesture (click-vs-drag disambiguation)"). Deliberately its OWN
 * threshold, not reused from `WindowManager.wireDrag` — that drag starts
 * immediately on pointerdown with no threshold at all, which is correct for
 * a title bar (no competing click action) but wrong for an item cell, where
 * a plain tap must still equip/drop (design.md "Drag engine", decision 2). */
export const DRAG_THRESHOLD_PX = 6;

/** Pure: has the pointer moved far enough from `start` to count as a drag
 * rather than a tap? Euclidean distance, inclusive at the boundary (`>` not
 * `>=` — landing EXACTLY on the threshold is still a tap, matching the
 * `crossedThreshold` name: you need to go PAST it). */
export function crossedThreshold(start: ScreenPoint, cur: ScreenPoint, t: number = DRAG_THRESHOLD_PX): boolean {
  const dx = cur.x - start.x;
  const dy = cur.y - start.y;
  return Math.hypot(dx, dy) > t;
}

/** Where a drop can resolve to, independent of any DOM lookup mechanism —
 * `createDragController` below is the only thing that ever builds one of
 * these, by resolving the element under the pointer at drop time. */
export type DropTarget =
  | { kind: "inventory"; x: number; y: number }
  | { kind: "hand"; hand: "left" | "right" }
  | { kind: "surface"; surfaceId: string; x: number; y: number }
  | { kind: "map"; x: number; y: number }
  | { kind: "invalid" };

/** What a completed (or blocked, or no-op) drag gesture resolves to. Mirrors
 * the shape of every other command flow in this client: a `"command"`
 * outcome is handed to `sendCommand` and the UI updates only once the
 * response's events are ingested — never optimistically. */
export type DragOutcome =
  | { kind: "command"; command: Command }
  | { kind: "blocked"; thought: string }
  | { kind: "noop" };

/** First-person thought surfaced (no backend round trip) when a mesa-origin
 * item is dropped straight onto the map/canvas — spec R6 "Surface→world drag
 * ... is EXCLUDED. It MUST be blocked client-side before any command is
 * sent." There is no validated backend path for mesa→world, so this snaps
 * the item back and shows the thought without ever calling `sendCommand`. */
const SURFACE_TO_WORLD_BLOCKED_THOUGHT = "No puedo tirar esto al suelo desde la mesa. Primero lo guardo.";

/**
 * THE core decision of the drag engine (design.md "Drag engine — pure,
 * unit-tested surface"): given the dragged `item`, the resolved drop
 * `target`, and the `playerId` to stamp on an `inventory` destination,
 * decides which command (if any) the drop produces.
 *
 * Rotation preservation is load-bearing, not cosmetic: the reducer's
 * `ItemMoved` inventory/surface branches apply `rotation ?? 0`, so omitting
 * `rotation` here would silently un-rotate a rotated item on every
 * inventory<->inventory or inventory<->surface move. `hand` targets never
 * carry rotation — the reducer forces hand equips to `0` regardless.
 */
export function buildDragOutcome(item: ItemInstance, target: DropTarget, playerId: string): DragOutcome {
  const rotation: 0 | 90 =
    item.location.type === "player_inventory" || item.location.type === "surface" ? (item.location.rotation === 90 ? 90 : 0) : 0;

  switch (target.kind) {
    case "inventory": {
      if (item.location.type === "player_inventory" && item.location.x === target.x && item.location.y === target.y) {
        return { kind: "noop" };
      }
      return {
        kind: "command",
        command: {
          type: "MoveItem",
          itemInstanceId: item.id,
          to: { type: "inventory", ownerId: playerId, x: target.x, y: target.y, rotation },
        },
      };
    }
    case "hand": {
      return {
        kind: "command",
        command: { type: "MoveItem", itemInstanceId: item.id, to: { type: "hand", hand: target.hand } },
      };
    }
    case "surface": {
      if (
        item.location.type === "surface" &&
        item.location.surfaceId === target.surfaceId &&
        item.location.x === target.x &&
        item.location.y === target.y
      ) {
        return { kind: "noop" };
      }
      return {
        kind: "command",
        command: {
          type: "MoveItem",
          itemInstanceId: item.id,
          to: { type: "surface", surfaceId: target.surfaceId, x: target.x, y: target.y, rotation },
        },
      };
    }
    case "map": {
      // Surface->world is the one excluded path (spec R6): block, never send.
      if (item.location.type === "surface") return { kind: "blocked", thought: SURFACE_TO_WORLD_BLOCKED_THOUGHT };
      // Inventory (including hand, which lives at a player_inventory cell)
      // origin: the existing validated DropItem path.
      if (item.location.type === "player_inventory") {
        return { kind: "command", command: { type: "DropItem", itemInstanceId: item.id, to: { x: target.x, y: target.y } } };
      }
      // Any other origin (e.g. world) is out of scope for dragging — never
      // reached in practice since only inventory/hand/surface cells are
      // wired as drag sources, kept here only to stay exhaustive/defensive.
      return { kind: "noop" };
    }
    case "invalid":
      return { kind: "noop" };
  }
}

/** Verifies a `w x h` shape anchored at `(x,y)` both stays in-bounds of a
 * `gw x gh` grid AND doesn't collide with any cell in `occupied` — a
 * verbatim replica of the backend's `fitsOnGrid`
 * (`backend/src/domain/inventory.ts:79-83`), restated client-side (spec R3
 * "Preview-backend verdict parity"). */
function fitsOnGrid(occupied: Set<string>, x: number, y: number, w: number, h: number, gw: number, gh: number): boolean {
  if (x < 0 || y < 0 || x + w > gw || y + h > gh) return false;
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (occupied.has(`${x + dx},${y + dy}`)) return false;
  return true;
}

/** Cells occupied by every item in `items` (via `cellsFor`), EXCLUDING
 * `exceptId` — a verbatim replica of the backend's `occupiedSetOnGrid`
 * (`backend/src/domain/inventory.ts:64-71`). */
function occupiedSet(items: ItemInstance[], cellsFor: (item: ItemInstance) => Position[], exceptId: string): Set<string> {
  const set = new Set<string>();
  for (const it of items) {
    if (it.id === exceptId) continue;
    for (const c of cellsFor(it)) set.add(`${c.x},${c.y}`);
  }
  return set;
}

/**
 * Full-footprint drag-validity verdict (design.md Decision 3, spec R2/R3/R4)
 * — the REPLACEMENT for `cellOccupant`'s anchor-only permissive check.
 * Mirrors the backend's `fitsOnGrid`/`occupiedSetOnGrid`/`handEquipFits`
 * (`backend/src/domain/inventory.ts:79-83`, `:64-71`, `:149-162`) verbatim,
 * restated client-side so the drag preview can render a verdict without a
 * backend round trip — the backend stays the actual accept/reject authority
 * (`cellOccupant`'s docstring risk note still applies to this replacement).
 *
 * `surfaceDims` is required (and only meaningful) for a `"surface"` target:
 * `DropTarget`'s surface variant carries only `surfaceId`/`x`/`y`, never
 * dimensions, so the caller (drag.ts's `updateHighlight`, tasks.md T7) reads
 * them from the `GridContext` bound for that surface via `bindGrid` (T4) and
 * passes them through here — `footprintValidity` itself stays pure/DOM-free.
 */
export function footprintValidity(
  snapshot: ClientSnapshot,
  catalog: Catalog,
  item: ItemInstance,
  target: DropTarget,
  exceptId: string,
  surfaceDims?: { width: number; height: number },
): "ok" | "bad" {
  const def = catalog.items.find((i) => i.id === item.itemTypeId);
  const shape = { w: def?.shape.w ?? 1, h: def?.shape.h ?? 1 };
  const itemRotation = item.location.type === "player_inventory" || item.location.type === "surface" ? item.location.rotation : 0;

  switch (target.kind) {
    case "inventory": {
      const { w, h } = rotatedDims(shape, itemRotation);
      const items = snapshot.items.filter((it) => it.location.type === "player_inventory");
      const occupied = occupiedSet(items, (it) => inventoryCellsForItem(it, catalog), exceptId);
      return fitsOnGrid(occupied, target.x, target.y, w, h, INV_W, INV_H) ? "ok" : "bad";
    }
    case "surface": {
      if (!surfaceDims) return "bad"; // no bound GridContext for this grid yet — defensive, never reached once T4's bindGrid wiring is live
      const { w, h } = rotatedDims(shape, itemRotation);
      const items = snapshot.items.filter((it) => it.location.type === "surface" && it.location.surfaceId === target.surfaceId);
      const occupied = occupiedSet(items, (it) => occupiedCellsForItem(it, catalog), exceptId);
      return fitsOnGrid(occupied, target.x, target.y, w, h, surfaceDims.width, surfaceDims.height) ? "ok" : "bad";
    }
    case "hand": {
      // Hand equips ALWAYS anchor the shape UNROTATED (mirrors the backend's
      // `handEquipFits`, which forces rotation 0 regardless of the item's
      // stored rotation), and the anchor is the LIVE snapshot's hand-slot
      // position — never a hardcoded coordinate (same convention
      // `cellOccupant` already uses at drag.ts:135-137).
      const slot = target.hand === "left" ? snapshot.handSlots.left : snapshot.handSlots.right;
      const items = snapshot.items.filter((it) => it.location.type === "player_inventory");
      const occupied = occupiedSet(items, (it) => inventoryCellsForItem(it, catalog), exceptId);
      return fitsOnGrid(occupied, slot.x, slot.y, shape.w, shape.h, INV_W, INV_H) ? "ok" : "bad";
    }
    case "map":
    case "invalid":
      return "ok"; // map always ok; invalid is never highlighted by the caller
  }
}

/**
 * What a drag-eligible cell (registered via `bindCell`) represents. Renderers
 * (`hud/hud.ts`) build one of these per cell, alongside an optional `onTap`
 * (the existing equip/drop/inspect click behavior) invoked when a pointer
 * sequence never crosses the drag threshold — routing tap-vs-drag through
 * ONE pointer pipeline instead of a separate `click` listener + drag
 * suppression (design.md decision 5).
 */
export type CellDescriptor =
  | { kind: "inventory"; x: number; y: number; occupant?: ItemInstance; onTap?: () => void }
  | { kind: "hand"; hand: "left" | "right"; occupant?: ItemInstance; onTap?: () => void }
  | { kind: "surface"; surfaceId: string; x: number; y: number; occupant?: ItemInstance; onTap?: () => void };

function descriptorToTarget(descriptor: CellDescriptor): DropTarget {
  switch (descriptor.kind) {
    case "inventory":
      return { kind: "inventory", x: descriptor.x, y: descriptor.y };
    case "hand":
      return { kind: "hand", hand: descriptor.hand };
    case "surface":
      return { kind: "surface", surfaceId: descriptor.surfaceId, x: descriptor.x, y: descriptor.y };
  }
}

export type DragControllerDeps = {
  getSnapshot: () => ClientSnapshot;
  sendCommand: (command: Command) => Promise<void> | void;
  catalog: Catalog;
  /** The `#game` canvas element — the one non-cell drop target
   * (map/world). Passed by identity so the controller can tell "the
   * pointer is over the canvas" apart from any other unregistered element
   * (e.g. empty page background), which must resolve `"invalid"`, never
   * `"map"` (spec R6: a container area, or anything else with no registered
   * cell, falls through to rejection, not a `map` target). */
  canvas: HTMLElement;
  /** Camera-aware inverse of the draw transform, built by the caller
   * (`game/game.ts`) from `canvasToTile` + the live `ViewState.frame()` — the
   * drag controller never touches the camera directly (design.md "Does the
   * HUD have camera access? No"). */
  resolveMapTile: (clientX: number, clientY: number) => Position;
  showThought: (text: string) => void;
};

/** Everything `footprintValidity`/`updateHighlight` needs to know about a
 * rendered grid, registered once per render by its renderer (design.md
 * Decision 3, tasks.md T4). `cells` is the SAME per-render
 * coordinate->element `Map<"x,y", HTMLElement>` the renderer builds while
 * laying out cells (hud.ts) — used to look up EVERY covered cell's element
 * during full-footprint highlight toggling (T7), not just the anchor. */
export type GridContext =
  | { kind: "inventory"; dims: { width: number; height: number }; cells: Map<string, HTMLElement> }
  | { kind: "surface"; surfaceId: string; dims: { width: number; height: number }; cells: Map<string, HTMLElement> };

/** Stable key a `GridContext` is stored under: `"inventory"` for the single
 * player inventory grid, `"surface:"+surfaceId` for a mesa/table grid — one
 * distinct key per open surface window, so closing one mesa never clobbers
 * another's registered context (design.md Decision 3 lifecycle). */
function gridKeyOf(ctx: GridContext): string {
  return ctx.kind === "inventory" ? "inventory" : `surface:${ctx.surfaceId}`;
}

/** Which registered `GridContext` a `DropTarget` belongs to — `"hand"`
 * resolves to `"inventory"` because hand slots are rendered as ordinary
 * cells WITHIN the same 4x4 inventory grid (design.md Decision 3). `"map"`/
 * `"invalid"` have no grid context (canvas stays single-tile; invalid is
 * never highlighted). */
function gridKeyForTarget(target: DropTarget): string | null {
  switch (target.kind) {
    case "inventory":
    case "hand":
      return "inventory";
    case "surface":
      return `surface:${target.surfaceId}`;
    case "map":
    case "invalid":
      return null;
  }
}

export interface DragController {
  /** Registers `cellEl` as BOTH a potential drop target and (when
   * `descriptor.occupant` is set) a drag source. Safe to call again for a
   * freshly-created element on every re-render — stale entries for removed
   * elements are garbage-collected automatically (WeakMap-keyed). */
  bindCell(cellEl: HTMLElement, descriptor: CellDescriptor): void;
  /** Registers/replaces the `GridContext` for the grid it describes (latest
   * render wins per key) — called once per render by `renderInventoryGrid`/
   * `renderSurfaceGrid` (tasks.md T3/T4). */
  bindGrid(ctx: GridContext): void;
  /** Removes the `GridContext` stored under `gridKey`, so a subsequent
   * highlight lookup for a CLOSED window's grid misses cleanly instead of
   * holding onto detached DOM element refs indefinitely (design.md Decision 3
   * "Lifecycle / retention" fix — wired through `window-manager`'s `close()`
   * choke point, tasks.md T4). */
  unbindGrid(gridKey: string): void;
  /** Tears down any in-flight drag state (ghost, highlight). Does not remove
   * any `bindCell`-registered listeners — those die with their elements. */
  destroy(): void;
}

/**
 * DOM controller for the drag gesture (design.md "DOM controller
 * (smoke-tested)"). Owns: the ghost element's lifecycle, WeakMap-based
 * hit-testing (`elementFromPoint` + identity lookup — no `dataset`/`data-*`
 * attributes, since the hand-rolled fake-DOM test harness doesn't implement
 * them), the `.drop-ok`/`.drop-bad` highlight toggle, and the
 * pointerdown/move/up/cancel pipeline. Never mutates the store directly —
 * every accepted drop goes through the exact same `sendCommand` round trip
 * as any other action.
 */
export function createDragController(deps: DragControllerDeps): DragController {
  const registry = new WeakMap<object, { el: HTMLElement; descriptor: CellDescriptor }>();
  const assets = createEmojiAssets();

  // Latest-registered `GridContext` per grid key (design.md Decision 3). A
  // single shared controller instance serves the inventory window AND every
  // mesa/surface window (game.ts:99), so this map can hold one entry per
  // DISTINCT surfaceId at once — `unbindGrid` (wired through window-manager
  // `close()`, tasks.md T4) is what keeps it from growing unbounded with
  // detached DOM refs for windows the player has since closed.
  const grids = new Map<string, GridContext>();

  let ghost: HTMLElement | null = null;
  let dragging = false;
  let start: ScreenPoint | null = null;
  let source: { el: HTMLElement; descriptor: CellDescriptor } | null = null;
  // Every cell element CURRENTLY carrying a `.drop-ok`/`.drop-bad` class —
  // the full projected footprint, not just the anchor (design.md Decision 3/
  // 4, spec R2 "retiring the anchor-only permissive check", tasks.md T7).
  let highlighted: HTMLElement[] = [];

  function resolveTarget(clientX: number, clientY: number): DropTarget {
    const el = document.elementFromPoint(clientX, clientY) as unknown as HTMLElement | null;
    if (!el) return { kind: "invalid" };
    const entry = registry.get(el as unknown as object);
    if (entry) return descriptorToTarget(entry.descriptor);
    if (el === deps.canvas) {
      const pos = deps.resolveMapTile(clientX, clientY);
      return { kind: "map", x: pos.x, y: pos.y };
    }
    return { kind: "invalid" };
  }

  function positionGhost(el: HTMLElement, clientX: number, clientY: number): void {
    el.style.left = `${clientX}px`;
    el.style.top = `${clientY}px`;
  }

  function createGhost(occupant: ItemInstance, clientX: number, clientY: number): void {
    const el = document.createElement("div");
    el.className = "drag-ghost";
    el.style.position = "fixed";
    el.style.pointerEvents = "none";
    el.style.zIndex = "9999";
    el.textContent = assets.resolve("item", occupant.itemTypeId).glyph ?? "";
    positionGhost(el, clientX, clientY);
    document.body.appendChild(el);
    ghost = el;
  }

  function destroyGhost(): void {
    ghost?.remove();
    ghost = null;
  }

  function clearHighlight(): void {
    for (const el of highlighted) el.classList.remove("drop-ok", "drop-bad");
    highlighted = [];
  }

  /**
   * Toggles `.drop-ok`/`.drop-bad` across the dragged item's FULL projected
   * footprint (design.md Decision 3/4, spec R2 "Footprint preview during
   * drag" — retiring the old anchor-only `cellOccupant` check). Resolves the
   * hovered element -> its `DropTarget` -> the `GridContext` bound for that
   * grid (via `bindGrid`, tasks.md T4) -> `footprintValidity`'s verdict ->
   * every covered cell's element, toggling the SAME verdict class on each
   * (a placement is accepted/rejected atomically, never per-cell). A
   * near-edge anchor colors only the covered cells that actually have a DOM
   * element in the bound grid's coordinate map — the rest are simply out of
   * bounds and have nothing to color.
   */
  function updateHighlight(clientX: number, clientY: number): void {
    clearHighlight();
    const el = document.elementFromPoint(clientX, clientY) as unknown as HTMLElement | null;
    const draggedItem = source?.descriptor.occupant;
    if (!el || !source || !draggedItem) return;

    const entry = registry.get(el as unknown as object);
    const isCanvas = !entry && el === deps.canvas;
    if (!entry && !isCanvas) return; // unregistered, non-canvas element: no highlight (spec R6 container/invalid rule)

    const target: DropTarget = entry ? descriptorToTarget(entry.descriptor) : { kind: "map", x: 0, y: 0 };
    const exceptId = draggedItem.id;
    const snapshot = deps.getSnapshot();

    if (target.kind === "map") {
      // Canvas/world stays single-tile, no footprint preview (spec "Canvas unaffected").
      const validity = footprintValidity(snapshot, deps.catalog, draggedItem, target, exceptId);
      el.classList.add(validity === "ok" ? "drop-ok" : "drop-bad");
      highlighted = [el];
      return;
    }
    if (target.kind === "invalid") return; // never highlighted

    const gridKey = gridKeyForTarget(target);
    const ctx = gridKey ? grids.get(gridKey) : undefined;
    if (!ctx) return; // no bound GridContext for this grid yet (defensive — bindGrid runs on every render)

    const def = deps.catalog.items.find((i) => i.id === draggedItem.itemTypeId);
    const shape = { w: def?.shape.w ?? 1, h: def?.shape.h ?? 1 };
    const itemRotation = draggedItem.location.type === "player_inventory" || draggedItem.location.type === "surface" ? draggedItem.location.rotation : 0;

    // Hand equips always anchor UNROTATED at the LIVE snapshot's hand-slot
    // position (mirrors `footprintValidity`'s own hand branch) — every other
    // target kind anchors at the hovered cell's coordinates with the item's
    // stored rotation.
    const anchor = target.kind === "hand" ? (target.hand === "left" ? snapshot.handSlots.left : snapshot.handSlots.right) : { x: target.x, y: target.y };
    const rotation = target.kind === "hand" ? 0 : itemRotation;

    const surfaceDims = target.kind === "surface" ? ctx.dims : undefined;
    const validity = footprintValidity(snapshot, deps.catalog, draggedItem, target, exceptId, surfaceDims);
    const cls = validity === "ok" ? "drop-ok" : "drop-bad";

    const nextHighlighted: HTMLElement[] = [];
    for (const cell of footprintCells(anchor, shape, rotation)) {
      const cellEl = ctx.cells.get(`${cell.x},${cell.y}`);
      if (!cellEl) continue; // out-of-bounds portion of the footprint: no element to color
      cellEl.classList.add(cls);
      nextHighlighted.push(cellEl);
    }
    highlighted = nextHighlighted;
  }

  function endDrag(): void {
    destroyGhost();
    clearHighlight();
    dragging = false;
    start = null;
    source = null;
  }

  /**
   * Swallows the ONE trailing compatibility `click` a browser fires on the
   * drag-ORIGIN element right after `pointerup`, for any gesture that
   * crossed the drag threshold (browser QA on d61e98f confirmed 4/4 repros:
   * a stale, closure-captured `occupant` in `hud.ts`'s mesa-cell `click`
   * listener fired a spurious inspect thought, and the same trailing click
   * could reach the document-level outside-click listener and dismiss an
   * unrelated floating window).
   *
   * Registered capture-phase on `document` so it intercepts the click
   * before it ever reaches the origin cell's own listener or bubbles to any
   * document-level listener. Disarms itself the instant it fires (one-shot)
   * — and ALSO via a 0ms timer fallback, so it can never survive to eat a
   * later, unrelated click if no compatibility click ever arrives for this
   * gesture. A 0ms timer is a macrotask: the browser's trailing click is
   * dispatched synchronously as part of the same input sequence as
   * `pointerup`, so it always runs before a freshly scheduled timer fires —
   * making the timer a pure safety net, never the normal disarm path.
   */
  function armTrailingClickSuppressor(): void {
    let timer: ReturnType<typeof setTimeout>;
    const disarm = (): void => {
      document.removeEventListener("click", suppressOnce, true);
      clearTimeout(timer);
    };
    const suppressOnce = (ev: Event): void => {
      ev.stopPropagation();
      ev.preventDefault();
      disarm();
    };
    document.addEventListener("click", suppressOnce, true);
    timer = setTimeout(disarm, 0);
  }

  function bindGrid(ctx: GridContext): void {
    grids.set(gridKeyOf(ctx), ctx);
  }

  function unbindGrid(gridKey: string): void {
    grids.delete(gridKey);
  }

  function bindCell(cellEl: HTMLElement, descriptor: CellDescriptor): void {
    registry.set(cellEl as unknown as object, { el: cellEl, descriptor });

    cellEl.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (!descriptor.occupant) return; // only an occupied cell is a drag SOURCE (it's always still a drop TARGET, registered above)
      start = { x: ev.clientX, y: ev.clientY };
      source = { el: cellEl, descriptor };
      dragging = false;
    });

    cellEl.addEventListener("pointermove", (ev: PointerEvent) => {
      if (!source || !start) return;
      if (!dragging) {
        if (!crossedThreshold(start, { x: ev.clientX, y: ev.clientY })) return;
        dragging = true;
        cellEl.setPointerCapture?.(ev.pointerId);
        createGhost(source.descriptor.occupant!, ev.clientX, ev.clientY);
      }
      if (ghost) positionGhost(ghost, ev.clientX, ev.clientY);
      updateHighlight(ev.clientX, ev.clientY);
    });

    cellEl.addEventListener("pointerup", (ev: PointerEvent) => {
      if (!source) return;
      if (!dragging) {
        // Below-threshold pointerup: never a drag, resolve as the existing
        // tap behavior (equip/drop/inspect) instead (spec R5). No trailing
        // click suppressor is armed here — a below-threshold tap's own
        // `click` IS the intended onTap/legacy behavior, not a duplicate.
        const tapped = source;
        source = null;
        start = null;
        tapped.descriptor.onTap?.();
        return;
      }
      cellEl.releasePointerCapture?.(ev.pointerId);
      armTrailingClickSuppressor();
      const occupant = source.descriptor.occupant!;
      const target = resolveTarget(ev.clientX, ev.clientY);
      const snapshot = deps.getSnapshot();
      const playerId = occupant.location.type === "player_inventory" ? occupant.location.playerId : snapshot.player.id;
      const outcome = buildDragOutcome(occupant, target, playerId);
      if (outcome.kind === "command") void deps.sendCommand(outcome.command);
      else if (outcome.kind === "blocked") deps.showThought(outcome.thought);
      // "noop" (same-cell / invalid target): silently snap back, nothing to do.
      endDrag();
    });

    cellEl.addEventListener("pointercancel", (ev: PointerEvent) => {
      if (dragging) cellEl.releasePointerCapture?.(ev.pointerId);
      endDrag();
    });
  }

  function destroy(): void {
    endDrag();
  }

  return { bindCell, bindGrid, unbindGrid, destroy };
}
