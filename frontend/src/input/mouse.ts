import type { Catalog, Command, ContextActionDef, ItemInstance, Position, Tile, WorldObject } from "../contract";
import { computeAvailableActions, type ActionTarget } from "../actions/available";
import { TILE, SCALE } from "../render/canvas";
import type { ClientSnapshot } from "../state/snapshot";
import { chebyshev } from "../state/visibility";
import { showThought } from "../hud/hud";

/** Wire-shaped target ref — structurally identical to the inline `target` union on
 * `TakeItem`/`ExecuteAction`/`Observe` in contract/commands.ts (those unions aren't
 * exported as a named type, so this mirrors them by hand). */
type WireTargetRef =
  | { kind: "world_object"; id: string }
  | { kind: "tile"; x: number; y: number }
  | { kind: "item"; id: string }
  | { kind: "pile"; id: string }
  | { kind: "self" };

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
  menuEl: HTMLElement;
  catalog: Catalog;
  getSnapshot: () => ClientSnapshot;
  sendCommand: (command: Command) => Promise<void>;
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
 * commands) and the local `ActionTarget` preview (for `computeAvailableActions`),
 * plus the local-only "observation" text shown on first click — zero network calls. */
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

function canvasToTile(ev: MouseEvent, canvas: HTMLCanvasElement): Position {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (ev.clientX - rect.left) * scaleX;
  const py = (ev.clientY - rect.top) * scaleY;
  return { x: Math.floor(px / (TILE * SCALE)), y: Math.floor(py / (TILE * SCALE)) };
}

export function createInputController(deps: InputDeps): InputController {
  let selection: ClickResolution | null = null;

  function hideMenu(): void {
    deps.menuEl.style.display = "none";
    deps.menuEl.innerHTML = "";
  }

  function openMenu(actions: ContextActionDef[], wireRef: WireTargetRef, clientX: number, clientY: number): void {
    deps.menuEl.innerHTML = "";
    for (const action of actions) {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.addEventListener("click", () => {
        hideMenu();
        selection = null;
        void deps.sendCommand({ type: "ExecuteAction", actionId: action.id, target: wireRef });
      });
      deps.menuEl.appendChild(button);
    }
    deps.menuEl.style.left = `${clientX}px`;
    deps.menuEl.style.top = `${clientY}px`;
    deps.menuEl.style.display = "block";
  }

  async function onCanvasClick(ev: MouseEvent): Promise<void> {
    hideMenu();
    const { x, y } = canvasToTile(ev, deps.canvas);
    const snapshot = deps.getSnapshot();
    const resolved = resolveClickTarget(deps.catalog, snapshot, x, y);
    if (!resolved) return;

    // Loose ground item: si está adyacente, TakeItem directo; si está lejos, camino
    // hacia su tile (filtro de adyacencia client-side, consistente con el preview
    // local — el backend igual re-valida).
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

    // Second click on the same target. Resolution rule for the Move-vs-Menu overlap
    // (many walkable ground tiles also carry actions, e.g. "search_sand", per the
    // real catalog data): if the tile is somewhere else, Move wins (walking there is
    // the obvious intent); if the tile IS the player's current position, Moving is a
    // no-op so the action menu wins instead. World objects and non-walkable tiles
    // always go through the menu branch.
    const isOwnTile = resolved.preview.kind === "tile" && x === snapshot.player.position.x && y === snapshot.player.position.y;
    if (!isOwnTile && resolved.walkable) {
      selection = null;
      await deps.sendCommand({ type: "MovePlayer", to: { x, y } });
      return;
    }

    const actions = computeAvailableActions(deps.catalog, resolved.preview, snapshot);
    if (actions.length === 0) {
      showThought("No se me ocurre qué hacer ahí ahora.");
      return;
    }
    openMenu(actions, resolved.wireRef, ev.clientX, ev.clientY);
  }

  deps.canvas.addEventListener("click", (ev) => void onCanvasClick(ev));
  document.addEventListener("click", (ev) => {
    if (ev.target !== deps.canvas && !deps.menuEl.contains(ev.target as Node)) hideMenu();
  });

  return { getSelection: () => selection };
}
