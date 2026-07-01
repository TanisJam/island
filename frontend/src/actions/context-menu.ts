import type { Catalog, Command, ContextActionDef, Position, Tile } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { chebyshev, type Visibility } from "../state/visibility";
import { computeAvailableActions, type ActionTarget } from "./available";

/**
 * Pure taxonomy + menu-builder layer ABOVE `computeAvailableActions`
 * (design.md "Taxonomy" decision + spec "Contextual Menu from Real Action
 * Logic" / "Self Click-Target Resolution" / "Graceful Degradation").
 * `computeAvailableActions` (actions/available.ts) is never modified —
 * everything here only shapes its output plus a couple of UI-only /
 * always-move/mute entries for the tiers it can't offer real actions for.
 */

export type Proximity = "self" | "adjacent" | "far-visible" | "penumbra" | "unseen";

/**
 * Wire-shaped target ref — structurally identical to the private
 * `WireTargetRef` in `input/mouse.ts` (that type isn't exported there).
 * Kept here as the canonical, exported definition so Phase 4's `mouse.ts`
 * edit can import it instead of duplicating it.
 */
export type WireTargetRef =
  | { kind: "world_object"; id: string }
  | { kind: "tile"; x: number; y: number }
  | { kind: "item"; id: string }
  | { kind: "pile"; id: string }
  | { kind: "self" };

export interface ContextMenuItem {
  id: string;
  label: string;
  hint?: string;
  kind: "action" | "move" | "ui" | "mute";
  command?: Command;
  uiIntent?: "inventory" | "thoughts" | "surface";
  /** Only set when `uiIntent === "surface"` — the world object id `input/mouse.ts`
   * forwards to `Ui.toggleSurface`. */
  surfaceId?: string;
}

export interface ContextMenuSection {
  title: string;
  dim?: boolean;
  items: ContextMenuItem[];
}

export interface ContextMenu {
  title: string;
  sections: ContextMenuSection[];
}

/**
 * Buckets a target position by CHEBYSHEV distance from the player plus its
 * visibility tier. Mirrors the backend's distance metric (see
 * actions/available.ts `checkRequirement`'s "distance" case) — matches the
 * mockup's `cheby()` helper (docs/1-diseno/mockups/luz-de-fuego.html).
 */
export function classifyProximity(snapshot: ClientSnapshot, pos: Position, visibility: Visibility): Proximity {
  const distance = chebyshev(snapshot.player.position, pos);
  if (distance === 0) return "self";
  if (distance === 1) return "adjacent";
  if (visibility === "visible") return "far-visible";
  if (visibility === "explored") return "penumbra";
  return "unseen";
}

function actionToItem(action: ContextActionDef, wireRef: WireTargetRef): ContextMenuItem {
  return {
    id: action.id,
    label: action.label,
    hint: action.thoughts?.preview,
    kind: "action",
    command: { type: "ExecuteAction", actionId: action.id, target: wireRef },
  };
}

function moveItem(id: string, label: string, hint: string, to: Position): ContextMenuItem {
  return { id, label, hint, kind: "move", command: { type: "MovePlayer", to } };
}

function tileWalkableAt(snapshot: ClientSnapshot, pos: Position): boolean {
  return snapshot.tiles.find((t) => t.x === pos.x && t.y === pos.y)?.walkable ?? false;
}

/**
 * Backend movement is 4-CONNECTED (see `backend/src/domain/pathfinding.ts`'s
 * `findPath`/`NEIGHBORS` — a plain BFS over the 4 orthogonal directions
 * only). `processCommand`'s `MovePlayer` case (`backend/src/application/process-command.ts`)
 * rejects with `no_path` ("No puedo llegar allí desde aquí.") whenever no
 * such BFS path connects the player's current tile to the requested
 * destination, and with `not_walkable` if the destination tile itself isn't
 * walkable. The backend re-pathfinds the WHOLE route itself (it isn't
 * stepwise/adjacent-only) — a far destination is fine as long as it's
 * walkable and reachable through orthogonal steps — so the frontend's only
 * job for "Acercarme" is to pick a walkable destination that's actually
 * connected to the player, and — since diagonal "adjacency" isn't a real
 * connectivity relationship for this BFS — prefer an orthogonal neighbor of
 * the target over a diagonal one whenever both are walkable.
 */
const ORTHOGONAL_OFFSETS: Position[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const DIAGONAL_OFFSETS: Position[] = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/** Among `offsets` applied to `pos`, returns the walkable candidate CLOSEST
 * to `player` (chebyshev), or null if none of them are walkable. Preferring
 * the nearest-to-player candidate (instead of the first match in a fixed
 * offset order) picks the side of the target that's most likely to already
 * be on the player's own connected walkable region. */
function nearestWalkableNeighbor(snapshot: ClientSnapshot, pos: Position, offsets: Position[], player: Position): Position | null {
  let best: Position | null = null;
  let bestDistance = Infinity;
  for (const d of offsets) {
    const candidate = { x: pos.x + d.x, y: pos.y + d.y };
    if (!tileWalkableAt(snapshot, candidate)) continue;
    const distance = chebyshev(player, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Best-effort walkable position to approach `pos` FROM — always a neighbor
 * tile of `pos`, NEVER `pos` itself (fix: "'Acercarme' must land on a tile
 * ADJACENT to the object, never the object's own tile"). Previously this
 * returned `pos` directly whenever the object's own tile happened to be
 * walkable terrain (e.g. tall grass) — but a world object's tile being
 * terrain-walkable says nothing about whether the OBJECT blocks movement:
 * the backend tracks that separately as a per-tile `blockingObjectTiles` set
 * built from `WorldObjectDef.blocksMovement`
 * (`backend/src/application/process-command.ts`), which this client has no
 * visibility into. A tree/rock (`blocksMovement: true`) very often sits on
 * perfectly walkable ground (grass/sand), so the old shortcut would confidently
 * send the player to stand ON the tree and get rejected by the backend's
 * pathfinding as blocked (fix: "'Acercarme' must work for trees and rocks").
 * Always picking a neighbor sidesteps this entirely — the walkable orthogonal
 * neighbor NEAREST to the player is preferred (falling back to a diagonal
 * neighbor only if no orthogonal one is walkable), matching the backend's
 * 4-connected BFS. The backend still pathfinds/revalidates the actual
 * `MovePlayer` (see the 4-connectivity note above), so a best-effort miss
 * just surfaces as a normal rejection thought, same tolerance as every other
 * client-side preview in this module.
 */
function findApproachPosition(snapshot: ClientSnapshot, pos: Position): Position | null {
  const player = snapshot.player.position;
  return (
    nearestWalkableNeighbor(snapshot, pos, ORTHOGONAL_OFFSETS, player) ??
    nearestWalkableNeighbor(snapshot, pos, DIAGONAL_OFFSETS, player)
  );
}

function terrainName(catalog: Catalog, terrain: Tile["terrain"]): string {
  return catalog.terrains.find((t) => t.id === terrain)?.name ?? terrain;
}

/** Exported so `input/mouse.ts` can reuse the exact same name lookup for the
 * select-first "inspect" thought (fix-list select-first click model) without
 * duplicating the world_object/item/terrain name-resolution logic here. */
export function targetName(catalog: Catalog, target: ActionTarget): string {
  switch (target.kind) {
    case "world_object":
      return catalog.worldObjects.find((o) => o.id === target.object.objectTypeId)?.name ?? target.object.objectTypeId;
    case "item":
      return catalog.items.find((i) => i.id === target.item.itemTypeId)?.name ?? target.item.itemTypeId;
    case "tile":
      return terrainName(catalog, target.terrain);
    case "self":
      return "yo";
  }
}

/**
 * Client-synthesized "Recoger" (→ `TakeItem`) entries for the loose world
 * items lying on `pos`. The catalog has no `appliesTo.kind === "item"`
 * actions, so pickup is a UI-level affordance mapped to the existing
 * `TakeItem` command (same pattern as the move/ui items). Valid from the
 * player's own tile AND from an adjacent tile — the backend revalidates the
 * distance, so a best-effort miss just surfaces as a normal rejection thought.
 */
function floorPickupItems(catalog: Catalog, snapshot: ClientSnapshot, pos: Position): ContextMenuItem[] {
  return snapshot.items
    .filter((it) => it.location.type === "world" && it.location.x === pos.x && it.location.y === pos.y)
    .map((it) => ({
      id: `take:${it.id}`,
      label: "Recoger",
      hint: catalog.items.find((d) => d.id === it.itemTypeId)?.name,
      kind: "action" as const,
      command: { type: "TakeItem", target: { kind: "item", id: it.id } },
    }));
}

/**
 * "Yo" menu: UI-only entries (view inventory / view thoughts — always
 * present, they don't depend on the catalog) plus whatever
 * `computeAvailableActions` offers for a synthesized `self` target (none in
 * today's catalog — actions/available.test.ts style fixtures cover the
 * future-proofing) and for the player's own tile. "Decir algo" is
 * intentionally never added — no backend command backs it (spec "Graceful
 * Degradation": omitted entirely, not shown disabled).
 */
function buildSelfMenu(catalog: Catalog, snapshot: ClientSnapshot): ContextMenu {
  const pos = snapshot.player.position;

  const selfTarget: ActionTarget = { kind: "self", pos, tags: [] };
  const selfActions = computeAvailableActions(catalog, selfTarget, snapshot);
  const sections: ContextMenuSection[] = [
    {
      title: "Yo",
      items: [
        { id: "ui:inventory", label: "Ver mis cosas", hint: "el inventario", kind: "ui", uiIntent: "inventory" },
        { id: "ui:thoughts", label: "Ver mis pensamientos", hint: "lo que fui entendiendo", kind: "ui", uiIntent: "thoughts" },
        ...selfActions.map((a) => actionToItem(a, { kind: "self" })),
      ],
    },
  ];

  const tile = snapshot.tiles.find((t) => t.x === pos.x && t.y === pos.y);
  if (tile) {
    const def = catalog.terrains.find((t) => t.id === tile.terrain);
    const tags = [...tile.tags, ...(def?.tags ?? [])];
    const tileTarget: ActionTarget = { kind: "tile", pos, tags, terrain: tile.terrain };
    const tileActions = computeAvailableActions(catalog, tileTarget, snapshot);
    if (tileActions.length > 0) {
      sections.push({
        title: `Aquí — ${def?.name ?? tile.terrain}`,
        items: tileActions.map((a) => actionToItem(a, { kind: "tile", x: pos.x, y: pos.y })),
      });
    }
  }

  const floor = floorPickupItems(catalog, snapshot, pos);
  if (floor.length > 0) {
    sections.push({ title: "En el suelo", items: floor });
  }

  return { title: "YO", sections };
}

/** Adjacent / far-visible: real catalog actions, plus a "walk there" move
 * item when the underlying tile is walkable. Mirrors `input/mouse.ts`'s
 * existing (pre-menu) walkable check: only `tile`-kind previews can ever be
 * a move target — a world object or loose item sitting on the tile never
 * makes it walkable here, same as today's `ClickResolution.walkable`. */
function buildReachableMenu(
  catalog: Catalog,
  snapshot: ClientSnapshot,
  preview: ActionTarget,
  wireRef: WireTargetRef,
  proximity: "adjacent" | "far-visible",
): ContextMenu {
  const pos = preview.pos;
  const actions = computeAvailableActions(catalog, preview, snapshot);
  const items: ContextMenuItem[] = actions.map((a) => actionToItem(a, wireRef));

  // "Usar la mesa" (spec R7 / design.md 7d): synthesized the same way as
  // "Recoger"/"Ver mis cosas" — a UI-only affordance, not a catalog action —
  // for any world object whose TYPE declares `surfaceGrid` (a rustic_table
  // today, any future surface-bearing object automatically tomorrow).
  if (preview.kind === "world_object") {
    const def = catalog.worldObjects.find((o) => o.id === preview.object.objectTypeId);
    if (def?.surfaceGrid) {
      items.push({ id: "ui:surface", label: "Usar la mesa", kind: "ui", uiIntent: "surface", surfaceId: preview.object.id });
    }
  }

  // Adjacent loose items are pickable: the catalog has no item-kind actions, so
  // synthesize "Recoger" here too (mirrors the self-tile "En el suelo" section).
  // Without this, clicking an adjacent item opens an empty menu.
  if (proximity === "adjacent") {
    items.push(...floorPickupItems(catalog, snapshot, pos));
  }

  if (preview.kind === "tile" && tileWalkableAt(snapshot, pos)) {
    items.push(
      proximity === "far-visible"
        ? moveItem("move:far", "Ir hasta ahí", "caminar", pos)
        : moveItem("move:adjacent", "Ir hasta acá", "pisar ese lugar", pos),
    );
  } else if (proximity === "far-visible" && (preview.kind === "world_object" || preview.kind === "item")) {
    // A far-visible object/item is never itself a move destination (only
    // `tile`-kind previews are, above), but it must always offer a way to
    // get closer — otherwise a real thing the player can see has literally
    // nothing to do from here except "observe" (fix: distant objects need an
    // "Acercarme" option even when not interactable).
    const approach = findApproachPosition(snapshot, pos);
    if (approach) items.push(moveItem("move:approach", "Acercarme", "acercarme", approach));
  }

  const name = targetName(catalog, preview);
  const title = proximity === "far-visible" ? `A lo lejos — ${name}` : name;
  return { title, sections: [{ title, items }] };
}

/** Penumbra (explored but currently out of vision range): no real actions
 * offered — you can't reliably interact with something you can't clearly
 * see — just a single dim "walk closer" move item. Worst case the backend
 * rejects the move with a thought, same tolerance as every other client-side
 * preview in this codebase. */
function buildPenumbraMenu(pos: Position): ContextMenu {
  const title = "En la penumbra";
  return {
    title,
    sections: [{ title, dim: true, items: [moveItem("move:penumbra", "Ir hacia allá", "para ver mejor", pos)] }],
  };
}

/** Unseen: a single dim, non-clickable ("mute") entry. */
function buildUnseenMenu(): ContextMenu {
  const title = "No alcanzo";
  return {
    title,
    sections: [{ title, dim: true, items: [{ id: "mute:unseen", label: "No alcanzo a ver qué hay ahí.", kind: "mute" }] }],
  };
}

/**
 * Builds the sectioned contextual menu for a resolved click target.
 * `resolution.self` is an explicit override for click paths that don't have
 * a real tile under the cursor (e.g. clicking a hand slot per the mockup) —
 * when false, `self` is still derived from distance-0 via
 * `classifyProximity` (spec "Self Click-Target Resolution").
 */
export function buildContextMenu(
  catalog: Catalog,
  snapshot: ClientSnapshot,
  resolution: { preview: ActionTarget; wireRef: WireTargetRef; self: boolean },
  visibility: Visibility,
): ContextMenu {
  const { preview, wireRef, self } = resolution;
  if (self) return buildSelfMenu(catalog, snapshot);

  const proximity = classifyProximity(snapshot, preview.pos, visibility);
  if (proximity === "self") return buildSelfMenu(catalog, snapshot);
  if (proximity === "penumbra") return buildPenumbraMenu(preview.pos);
  if (proximity === "unseen") return buildUnseenMenu();
  return buildReachableMenu(catalog, snapshot, preview, wireRef, proximity);
}
