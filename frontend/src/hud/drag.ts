import type { Catalog, Command, ItemInstance, Position } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { createEmojiAssets } from "../render/assets";

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

/** `"ok"` (brasa highlight) or `"bad"` (rejection highlight) for a hovered
 * drop-target cell while a drag is active — spec R7 "Drop-target feedback".
 * Deliberately CHEAP and PERMISSIVE (design.md decision 7): only the anchor
 * cell's occupancy is checked, never the dragged item's full multi-cell
 * footprint — the backend stays authoritative on the actual accept/reject.
 * `map`/`invalid` targets are never occupancy-checked here (map always reads
 * `"ok"`; `invalid` targets are simply never highlighted by the caller). */
export function cellOccupant(snapshot: ClientSnapshot, target: DropTarget, exceptId: string): "ok" | "bad" {
  let occupant: ItemInstance | undefined;
  if (target.kind === "inventory") {
    occupant = snapshot.items.find((it) => it.location.type === "player_inventory" && it.location.x === target.x && it.location.y === target.y);
  } else if (target.kind === "hand") {
    const slot = target.hand === "left" ? snapshot.handSlots.left : snapshot.handSlots.right;
    occupant = snapshot.items.find((it) => it.location.type === "player_inventory" && it.location.x === slot.x && it.location.y === slot.y);
  } else if (target.kind === "surface") {
    occupant = snapshot.items.find(
      (it) => it.location.type === "surface" && it.location.surfaceId === target.surfaceId && it.location.x === target.x && it.location.y === target.y,
    );
  } else {
    return "ok"; // map / invalid: never flagged "bad" by this pure check
  }
  if (!occupant || occupant.id === exceptId) return "ok";
  return "bad";
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

export interface DragController {
  /** Registers `cellEl` as BOTH a potential drop target and (when
   * `descriptor.occupant` is set) a drag source. Safe to call again for a
   * freshly-created element on every re-render — stale entries for removed
   * elements are garbage-collected automatically (WeakMap-keyed). */
  bindCell(cellEl: HTMLElement, descriptor: CellDescriptor): void;
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

  let ghost: HTMLElement | null = null;
  let dragging = false;
  let start: ScreenPoint | null = null;
  let source: { el: HTMLElement; descriptor: CellDescriptor } | null = null;
  let highlighted: HTMLElement | null = null;

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
    highlighted?.classList.remove("drop-ok", "drop-bad");
    highlighted = null;
  }

  function updateHighlight(clientX: number, clientY: number): void {
    const el = document.elementFromPoint(clientX, clientY) as unknown as HTMLElement | null;
    if (highlighted && highlighted !== el) clearHighlight();
    if (!el || !source) return;

    const entry = registry.get(el as unknown as object);
    const isCanvas = !entry && el === deps.canvas;
    if (!entry && !isCanvas) return; // unregistered, non-canvas element: no highlight (spec R6 container/invalid rule)

    const target: DropTarget = entry ? descriptorToTarget(entry.descriptor) : { kind: "map", x: 0, y: 0 };
    const exceptId = source.descriptor.occupant?.id ?? "";
    const validity = cellOccupant(deps.getSnapshot(), target, exceptId);
    el.classList.add(validity === "ok" ? "drop-ok" : "drop-bad");
    highlighted = el;
  }

  function endDrag(): void {
    destroyGhost();
    clearHighlight();
    dragging = false;
    start = null;
    source = null;
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
        // tap behavior (equip/drop/inspect) instead (spec R5).
        const tapped = source;
        source = null;
        start = null;
        tapped.descriptor.onTap?.();
        return;
      }
      cellEl.releasePointerCapture?.(ev.pointerId);
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

  return { bindCell, destroy };
}
