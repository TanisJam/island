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
    // Stops the click from bubbling to `document`, where `hud/ui.ts`'s
    // outside-click listener (`WindowManager.dismissTransient`) would
    // otherwise immediately dismiss the contextual menu THIS SAME click is
    // about to open — mirrors the mockup's per-cell `e.stopPropagation()`.
    ev.stopPropagation();

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
    const self = x === snapshot.player.position.x && y === snapshot.player.position.y;
    const visibility = visibilityOf(snapshot, resolved.preview.pos);
    const menu = buildContextMenu(deps.catalog, snapshot, { preview: resolved.preview, wireRef: resolved.wireRef, self }, visibility);

    const totalItems = menu.sections.reduce((n, sec) => n + sec.items.length, 0);
    if (totalItems === 0) {
      showThought("No se me ocurre qué hacer ahí ahora.");
      return;
    }

    deps.ui.openContextMenu(menu, { x: ev.clientX, y: ev.clientY }, (item) => {
      if ((item.kind === "action" || item.kind === "move") && item.command) {
        if (item.kind === "move") selection = null;
        void deps.sendCommand(item.command);
        return;
      }
      if (item.kind === "ui") {
        deps.ui.toggleInventory();
      }
      // item.kind === "mute" never reaches here — `hud/ui.ts`'s
      // `renderContextMenuBody` never wires a click listener for it.
    });
  }

  deps.canvas.addEventListener("click", (ev) => void onCanvasClick(ev));

  return { getSelection: () => selection };
}
