import type { Catalog, Command, ItemInstance, Position, Tile, WorldObject } from "../contract";
import { type ActionTarget } from "../actions/available";
import { buildContextMenu, type WireTargetRef } from "../actions/context-menu";
import { cameraOffset, screenToTile, type CanvasRect } from "../render/camera";
import type { Frame } from "../view/viewstate";
import type { ClientSnapshot } from "../state/snapshot";
import { visibilityOf } from "../state/visibility";
import { showThought } from "../hud/hud";
import type { Ui } from "../hud/ui";

type ClickResolution = {
  key: string;
  wireRef: WireTargetRef;
  preview: ActionTarget;
  walkable: boolean;
};

export type InputDeps = {
  canvas: HTMLCanvasElement;
  catalog: Catalog;
  getSnapshot: () => ClientSnapshot;
  /** Current interpolated `Frame`, sourced from the same `ViewState.frame`
   * the render loop calls (design.md "Renderer camera" / SEAM 3) — needed so
   * `canvasToTile` can derive the SAME camera offset `render/canvas.ts` just
   * drew with. */
  getFrame: () => Frame;
  sendCommand: (command: Command) => Promise<void>;
  ui: Ui;
};

export type InputController = {
  getSelection: () => ClickResolution | null;
};

function findObjectAt(snapshot: ClientSnapshot, x: number, y: number): WorldObject | undefined {
  return snapshot.objects.find((o) => o.position.x === x && o.position.y === y);
}

function findGroundItemAt(snapshot: ClientSnapshot, x: number, y: number): ItemInstance | undefined {
  return snapshot.items.find((i) => i.location.type === "world" && i.location.x === x && i.location.y === y);
}

function findTileAt(snapshot: ClientSnapshot, x: number, y: number): Tile | undefined {
  return snapshot.tiles.find((t) => t.x === x && t.y === y);
}

/** Resolves what's at tile (x,y) for the click flow, in priority order:
 * world object > loose ground item > tile. Builds both the wire `target` ref
 * (for commands) and the local `ActionTarget` preview (for
 * `computeAvailableActions`, wrapped by `actions/context-menu.ts`) — zero
 * network calls. `walkable` feeds the double-click "just walk there"
 * shortcut in `onCanvasClick`. */
function resolveClickTarget(catalog: Catalog, snapshot: ClientSnapshot, x: number, y: number): ClickResolution | null {
  const object = findObjectAt(snapshot, x, y);
  if (object) {
    const def = catalog.worldObjects.find((o) => o.id === object.objectTypeId);
    const tags = [...(def?.tags ?? []), ...(object.tags ?? [])];
    return {
      key: `wo:${object.id}`,
      wireRef: { kind: "world_object", id: object.id },
      preview: { kind: "world_object", pos: object.position, tags, object },
      walkable: false,
    };
  }

  const item = findGroundItemAt(snapshot, x, y);
  if (item) {
    const def = catalog.items.find((i) => i.id === item.itemTypeId);
    return {
      key: `item:${item.id}`,
      wireRef: { kind: "item", id: item.id },
      preview: { kind: "item", pos: { x, y }, tags: def?.tags ?? [], item },
      walkable: false,
    };
  }

  const tile = findTileAt(snapshot, x, y);
  if (tile) {
    const def = catalog.terrains.find((t) => t.id === tile.terrain);
    const tags = [...tile.tags, ...(def?.tags ?? [])];
    return {
      key: `tile:${x},${y}`,
      wireRef: { kind: "tile", x, y },
      preview: { kind: "tile", pos: { x, y }, tags, terrain: tile.terrain },
      walkable: tile.walkable,
    };
  }

  return null;
}

function canvasRectOf(canvas: HTMLCanvasElement): CanvasRect {
  const rect = canvas.getBoundingClientRect();
  return { left: rect.left, top: rect.top, cssWidth: rect.width, cssHeight: rect.height, bufferWidth: canvas.width, bufferHeight: canvas.height };
}

/** Camera-aware inverse of the draw transform. MUST derive the offset from
 * `render/camera.ts`'s `cameraOffset` — the exact function `render/canvas.ts`
 * uses to draw the current frame — never recompute it independently, or a
 * click during a movement tween could resolve to a different tile than the
 * one actually rendered under the cursor (design.md "Renderer camera" / spec
 * "Fullscreen Map with Player-Centered Camera"). */
function canvasToTile(ev: MouseEvent, canvas: HTMLCanvasElement, frame: Frame): Position {
  const offset = cameraOffset(frame, { width: canvas.width, height: canvas.height });
  return screenToTile({ x: ev.clientX, y: ev.clientY }, canvasRectOf(canvas), offset);
}

/** Second click must land within this many ms of the first to count as a
 * double click/tap — the usual OS/browser double-click window (250–300ms). */
const DOUBLE_CLICK_THRESHOLD_MS = 280;

export type ClickCadence = "single" | "double";

/**
 * PURE decision behind the click-cadence model (fix-list: "single click
 * inspects (opens menu), double click/tap moves"): a click is a "double"
 * only when a PRIOR click landed on the EXACT SAME tile no more than
 * `thresholdMs` ago — a fast click on a different tile is always two
 * independent singles, never a double. Deliberately dumb (no `event.detail`,
 * no `dblclick`/touch-specific listeners): both mouse double-click and touch
 * double-tap are just two `click` events close together in time, so one
 * timing+position check covers both input kinds identically. Exported for
 * unit testing; `onCanvasClick` is the only caller.
 */
export function classifyClick(
  now: number,
  lastClickTime: number | null,
  tile: Position,
  lastTile: Position | null,
  thresholdMs: number = DOUBLE_CLICK_THRESHOLD_MS,
): ClickCadence {
  if (lastClickTime === null || lastTile === null) return "single";
  if (now - lastClickTime > thresholdMs) return "single";
  if (tile.x !== lastTile.x || tile.y !== lastTile.y) return "single";
  return "double";
}

export function createInputController(deps: InputDeps): InputController {
  let selection: ClickResolution | null = null;
  let lastClickTime: number | null = null;
  let lastClickTile: Position | null = null;
  // Holds the timer for a deferred single-click menu-open, so a qualifying
  // second click (a double) can cancel it before the menu ever appears —
  // "single click inspects, double click moves" must never flash the menu in
  // between (fix-list: "single click inspects (opens menu), double click/tap
  // moves").
  let pendingMenuTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelPendingMenu(): void {
    if (pendingMenuTimer !== null) {
      clearTimeout(pendingMenuTimer);
      pendingMenuTimer = null;
    }
  }

  /**
   * Opens the sectioned contextual menu built by `actions/context-menu.ts`
   * (design.md "Taxonomy" / spec "Contextual Menu from Real Action Logic" /
   * "Self Click-Target Resolution") for `resolved` at screen point `at`. This
   * is now the ONLY inspect path for every tile kind — the walkable-tile
   * move affordance ("Ir hasta acá"/"Ir hasta ahí") already lives inside the
   * menu via `buildReachableMenu`, so this function never moves the player
   * itself; the sole direct-move path is the double-click branch in
   * `onCanvasClick`.
   *
   * Defensively wrapped (fix for "no object is interactable anymore"): any
   * new/unanticipated game state on this tile (a fresh world-item pile, a
   * full inventory, an unrecognized typeId, etc.) must never throw out of
   * this handler — a thrown menu build here would leave `selection` stuck
   * and, worse, is exactly the kind of failure that could cascade into an
   * unusable map. Degrade to a thought instead.
   */
  function openMenuFor(resolved: ClickResolution, x: number, y: number, at: { x: number; y: number }, snapshot: ClientSnapshot): void {
    selection = resolved;
    let menu: ReturnType<typeof buildContextMenu>;
    try {
      const self = x === snapshot.player.position.x && y === snapshot.player.position.y;
      const visibility = visibilityOf(snapshot, resolved.preview.pos);
      menu = buildContextMenu(deps.catalog, snapshot, { preview: resolved.preview, wireRef: resolved.wireRef, self }, visibility);
    } catch {
      showThought("No pude entender bien qué hay ahí. Mejor intento otra cosa.");
      return;
    }

    const totalItems = menu.sections.reduce((n, sec) => n + sec.items.length, 0);
    if (totalItems === 0) {
      showThought("No se me ocurre qué hacer ahí ahora.");
      return;
    }

    deps.ui.openContextMenu(menu, at, (item) => {
      try {
        if ((item.kind === "action" || item.kind === "move") && item.command) {
          if (item.kind === "move") selection = null;
          void deps.sendCommand(item.command);
          return;
        }
        if (item.kind === "ui") {
          if (item.uiIntent === "thoughts") deps.ui.toggleThoughts();
          else deps.ui.toggleInventory();
        }
        // item.kind === "mute" never reaches here — `hud/ui.ts`'s
        // `renderContextMenuBody` never wires a click listener for it.
      } catch {
        showThought("Algo salió mal. Mejor intento otra cosa.");
      }
    });
  }

  async function onCanvasClick(ev: MouseEvent): Promise<void> {
    // NOTE: `ev.stopPropagation()` is deliberately NOT called unconditionally
    // (it used to be — that was the root cause of "no object is interactable
    // anymore" after several interactions). Blocking it here meant EVERY
    // canvas click prevented `hud/ui.ts`'s document-level outside-click
    // listener from ever running for canvas clicks — so an open
    // inventory/context-menu window could never be dismissed by clicking the
    // map. It's called ONLY right before synchronously opening a NEW context
    // menu inside this same handler (the deferred single-click open below
    // runs in its own later timer callback, well after this click event has
    // already finished bubbling, so it needs no `stopPropagation` of its own).
    const { x, y } = canvasToTile(ev, deps.canvas, deps.getFrame());
    const snapshot = deps.getSnapshot();
    const resolved = resolveClickTarget(deps.catalog, snapshot, x, y);
    if (!resolved) return;

    const now = Date.now();
    const cadence = classifyClick(now, lastClickTime, { x, y }, lastClickTile);
    // A qualifying double click "consumes" the pair: the very next click
    // right after must start its own fresh single/double sequence rather
    // than chaining onto this one (no triple-click semantics).
    lastClickTime = cadence === "double" ? null : now;
    lastClickTile = cadence === "double" ? null : { x, y };

    if (cadence === "double") {
      cancelPendingMenu();
      // Express "just walk there" shortcut (fix-list: "double click/tap on a
      // walkable tile sends MovePlayer directly, bypassing the menu"). Falls
      // back to the normal single-click menu when the tile isn't walkable —
      // there's nowhere to walk to, so inspecting is the only useful option.
      if (resolved.walkable) {
        selection = null;
        deps.ui.closeContextMenu(); // never leave a menu open after a double-click move
        await deps.sendCommand({ type: "MovePlayer", to: { x, y } });
        return;
      }
      ev.stopPropagation();
      openMenuFor(resolved, x, y, { x: ev.clientX, y: ev.clientY }, snapshot);
      return;
    }

    // Single click: defer opening the menu by the same threshold used to
    // detect a double click, so a genuine double click (handled above, on
    // the SECOND click) can cancel this before the menu ever appears.
    // Re-resolves against a FRESH snapshot when the timer actually fires,
    // rather than reusing the snapshot from the moment of the click — up to
    // `DOUBLE_CLICK_THRESHOLD_MS` may have passed, during which the world
    // (and the tile's content) could have changed.
    cancelPendingMenu();
    const at = { x: ev.clientX, y: ev.clientY };
    pendingMenuTimer = setTimeout(() => {
      pendingMenuTimer = null;
      const freshSnapshot = deps.getSnapshot();
      const freshResolved = resolveClickTarget(deps.catalog, freshSnapshot, x, y);
      if (!freshResolved) return;
      openMenuFor(freshResolved, x, y, at, freshSnapshot);
    }, DOUBLE_CLICK_THRESHOLD_MS);
  }

  // Outermost safety net (fix for "no object is interactable anymore"): a
  // browser click-event dispatch is one-shot per click regardless of
  // whether the listener throws, but an uncaught rejection here would still
  // leave `selection` in whatever half-updated state it was in, and — per
  // the fix list — nothing in this path is allowed to degrade to silence
  // instead of a thought. `onCanvasClick` already handles the specific
  // failure mode (menu building) with its own try/catch above; this catches
  // anything else (e.g. a `resolveClickTarget` lookup throwing on
  // unanticipated snapshot shape).
  deps.canvas.addEventListener("click", (ev) => {
    void onCanvasClick(ev).catch(() => showThought("Algo salió mal. Mejor intento otra cosa."));
  });

  return { getSelection: () => selection };
}
