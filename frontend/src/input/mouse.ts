import type { Catalog, Command, ItemInstance, Position, Tile, WorldObject } from "../contract";
import { type ActionTarget } from "../actions/available";
import { buildContextMenu, type WireTargetRef } from "../actions/context-menu";
import { cameraOffset, screenToTile, type CanvasRect } from "../render/camera";
import type { Frame } from "../view/viewstate";
import type { ClientSnapshot } from "../state/snapshot";
import { chebyshev, visibilityOf } from "../state/visibility";
import { showThought } from "../hud/hud";
import type { Ui } from "../hud/ui";

type ClickResolution = {
  key: string;
  wireRef: WireTargetRef;
  preview: ActionTarget;
  observation: string;
  walkable: boolean;
  isLooseItem: boolean;
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
 * world object > loose ground item > tile. Builds both the wire `target` ref (for
 * commands) and the local `ActionTarget` preview (for `computeAvailableActions`,
 * wrapped by `actions/context-menu.ts`), plus the local-only "observation" text
 * shown on first click — zero network calls. */
function resolveClickTarget(catalog: Catalog, snapshot: ClientSnapshot, x: number, y: number): ClickResolution | null {
  const object = findObjectAt(snapshot, x, y);
  if (object) {
    const def = catalog.worldObjects.find((o) => o.id === object.objectTypeId);
    const tags = [...(def?.tags ?? []), ...(object.tags ?? [])];
    return {
      key: `wo:${object.id}`,
      wireRef: { kind: "world_object", id: object.id },
      preview: { kind: "world_object", pos: object.position, tags, object },
      observation: def?.observation ?? "No reconozco bien qué es esto.",
      walkable: false,
      isLooseItem: false,
    };
  }

  const item = findGroundItemAt(snapshot, x, y);
  if (item) {
    const def = catalog.items.find((i) => i.id === item.itemTypeId);
    return {
      key: `item:${item.id}`,
      wireRef: { kind: "item", id: item.id },
      preview: { kind: "item", pos: { x, y }, tags: def?.tags ?? [], item },
      observation: def?.observation ?? "Algo está tirado ahí.",
      walkable: false,
      isLooseItem: true,
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
      observation: def?.observation ?? "Terreno sin nada de particular.",
      walkable: tile.walkable,
      isLooseItem: false,
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

export function createInputController(deps: InputDeps): InputController {
  let selection: ClickResolution | null = null;

  async function onCanvasClick(ev: MouseEvent): Promise<void> {
    // NOTE: `ev.stopPropagation()` is deliberately NOT called at the top
    // of this handler (it used to be, unconditionally — that was the root
    // cause of "no object is interactable anymore" after several
    // interactions). Blocking it here meant EVERY canvas click, not just the
    // one about to open a menu, prevented `hud/ui.ts`'s document-level
    // outside-click listener from ever running for canvas clicks — so an
    // open inventory/context-menu window could never be dismissed by
    // clicking the map (only by ✕, which had its own bug), and windows piled
    // up over the map, eating clicks that never reached the canvas at all.
    // It's now called ONLY right before opening a NEW context menu below,
    // which is the one case that genuinely needs it (see that call site).
    const { x, y } = canvasToTile(ev, deps.canvas, deps.getFrame());
    const snapshot = deps.getSnapshot();
    const resolved = resolveClickTarget(deps.catalog, snapshot, x, y);
    if (!resolved) return;

    // Loose ground item: si está adyacente, TakeItem directo; si está lejos, camino
    // hacia su tile (filtro de adyacencia client-side, consistente con el preview
    // local — el backend igual re-valida). Bypasses selection/menu entirely,
    // unchanged from the pre-menu behavior.
    if (resolved.isLooseItem && resolved.wireRef.kind === "item") {
      selection = null;
      if (chebyshev(snapshot.player.position, resolved.preview.pos) <= 1) {
        await deps.sendCommand({ type: "TakeItem", target: { kind: "item", id: resolved.wireRef.id } });
      } else {
        const tile = findTileAt(snapshot, resolved.preview.pos.x, resolved.preview.pos.y);
        if (tile?.walkable) await deps.sendCommand({ type: "MovePlayer", to: resolved.preview.pos });
        else showThought("Eso está lejos. Tengo que acercarme primero.");
      }
      return;
    }

    const isSameSelection = selection?.key === resolved.key;
    if (!isSameSelection) {
      selection = resolved;
      showThought(resolved.observation);
      return;
    }

    // Second click on the same target: open the sectioned contextual menu
    // built by `actions/context-menu.ts` (design.md "Taxonomy" / spec
    // "Contextual Menu from Real Action Logic" / "Self Click-Target
    // Resolution"). `self` is true whenever the clicked tile IS the player's
    // own position, regardless of what `resolveClickTarget` found there.
    //
    // Defensively wrapped (fix for "no object is interactable anymore"):
    // any new/unanticipated game state on this tile (a fresh world-item
    // pile, a full inventory, an unrecognized typeId, etc.) must never throw
    // out of this handler — a thrown menu build here would leave `selection`
    // stuck and, worse, is exactly the kind of failure that could cascade
    // into an unusable map. Degrade to a thought instead.
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

    // Stops the click from bubbling to `document`, where `hud/ui.ts`'s
    // outside-click listener (`WindowManager.dismissTransient`) would
    // otherwise immediately dismiss the menu THIS SAME click is about to
    // open — mirrors the mockup's per-cell `e.stopPropagation()`. Scoped to
    // exactly this call site (see the note at the top of the handler for why
    // it must NOT be unconditional).
    ev.stopPropagation();

    deps.ui.openContextMenu(menu, { x: ev.clientX, y: ev.clientY }, (item) => {
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
