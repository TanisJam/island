import type { Catalog, Command, ItemInstance, Position, Tile, WorldObject } from "../contract";
import { type ActionTarget } from "../actions/available";
import { buildContextMenu, targetName, type WireTargetRef } from "../actions/context-menu";
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

export type ClickDecision = "select" | "move" | "menu";

/**
 * PURE decision behind the SELECT-FIRST click model (fix-list: "1 click
 * selects, re-click on the already-selected tile opens the menu, double
 * click moves"):
 *
 * 1. A "double" cadence on a WALKABLE tile always moves — this is the one
 *    case cadence overrides everything else, since it's the explicit "just
 *    walk there" shortcut.
 * 2. Otherwise (a genuine single, OR a "double" that landed on a
 *    non-walkable tile — nothing to walk to, so it degrades to a single
 *    rather than a failed move) — a click on the CURRENTLY SELECTED tile
 *    opens the contextual menu (this is how a re-click surfaces the menu
 *    without ever needing a menu-open delay on the first click).
 * 3. Any other click (a different tile, or no tile selected yet) just moves
 *    the selection there and asks for an inspect thought — no menu, no move.
 *
 * Exported for unit testing; `onCanvasClick` is the only caller.
 */
export function resolveClickDecision(
  cadence: ClickCadence,
  tile: Position,
  selectedTile: Position | null,
  walkable: boolean,
): ClickDecision {
  if (cadence === "double" && walkable) return "move";
  if (selectedTile !== null && tile.x === selectedTile.x && tile.y === selectedTile.y) return "menu";
  return "select";
}

/**
 * PURE first-person "inspect" thought for a freshly selected tile (fix-list:
 * "1 click selects and surfaces a brief inspect observation"). Deliberately
 * terse fixed templates by target kind, using only the catalog's `name`
 * lookup (the same one `actions/context-menu.ts`'s `targetName` already
 * uses for menu titles) — NOT the catalog's richer per-entry `observation`/
 * `observationByState` flavor text, which stays reserved for the `Observe`
 * action's own thought (kept out of scope by this fix). `resolved.preview`
 * is always `world_object` | `item` | `tile` here — `resolveClickTarget`
 * never returns a `self` `ActionTarget` — the `self` branch below only
 * exists to keep the switch exhaustive against `ActionTarget`'s full union.
 */
export function describeSelection(catalog: Catalog, resolved: ClickResolution): string {
  const preview = resolved.preview;
  switch (preview.kind) {
    case "world_object":
      return `Veo ${targetName(catalog, preview)}.`;
    case "item":
      return `Veo ${targetName(catalog, preview)} en el suelo.`;
    case "tile":
      return `${targetName(catalog, preview)}.`;
    case "self":
      return `Veo ${targetName(catalog, preview)}.`;
  }
}

export function createInputController(deps: InputDeps): InputController {
  let selection: ClickResolution | null = null;
  let lastClickTime: number | null = null;
  let lastClickTile: Position | null = null;

  /**
   * Opens the sectioned contextual menu built by `actions/context-menu.ts`
   * (design.md "Taxonomy" / spec "Contextual Menu from Real Action Logic" /
   * "Self Click-Target Resolution") for `resolved` at screen point `at`.
   * SELECT-FIRST model (supersedes the previous "always the only inspect
   * path" comment): `onCanvasClick` only calls this for the `"menu"`
   * decision — a re-click on the tile that's ALREADY selected. The first
   * click on any tile only selects it (ring + a terse `describeSelection`
   * thought, no menu); the walkable-tile move affordance ("Ir hasta acá"/"Ir
   * hasta ahí") still lives inside the menu via `buildReachableMenu` once
   * it's open, and the fast-double-click direct-move shortcut is handled
   * entirely by the `"move"` decision in `onCanvasClick` — this function
   * itself never moves the player.
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
    // menu inside this same handler (the "menu" branch below) — a plain
    // select or a double-click move never opens anything, so they let the
    // click bubble to the outside-click dismiss listener as before.
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

    // SELECT-FIRST model (fix-list supersedes the previous "single click
    // opens the menu instantly" behavior): 1 click SELECTS a tile (ring +
    // inspect thought, no menu, no move); a re-click on the ALREADY-selected
    // tile opens the menu; a fast double click on a WALKABLE tile moves
    // there instead of either. See `resolveClickDecision`'s doc for the full
    // decision table — this handler only wires that pure decision to the
    // actual side effects (move / menu / select+thought).
    const selectedTile = selection ? selection.preview.pos : null;
    const decision = resolveClickDecision(cadence, { x, y }, selectedTile, resolved.walkable);

    if (decision === "move") {
      selection = null;
      deps.ui.closeContextMenu(); // never leave a menu open after a double-click move
      await deps.sendCommand({ type: "MovePlayer", to: { x, y } });
      return;
    }

    if (decision === "menu") {
      // Re-click on the already-selected tile: open the menu right now,
      // against the snapshot captured at the top of this handler.
      ev.stopPropagation();
      openMenuFor(resolved, x, y, { x: ev.clientX, y: ev.clientY }, snapshot);
      return;
    }

    // decision === "select": first click on this tile — just move the
    // selection ring here and surface a terse inspect thought. No menu, no
    // move, no network call. Closes any menu left open from a PREVIOUS
    // selection (clicking a new tile while a menu from the old one is open
    // must not leave that stale menu on screen).
    selection = resolved;
    deps.ui.closeContextMenu();
    deps.ui.showThought(describeSelection(deps.catalog, resolved));
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
