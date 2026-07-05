import type { Catalog, Command, ContextActionDef, ItemInstance, Position, Tile } from "../contract";
import { INV_H, INV_W, inventoryCellsForItem } from "../hud/hud";
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
  kind: "action" | "move" | "ui" | "mute" | "info";
  command?: Command;
  uiIntent?: "inventory" | "thoughts" | "surface" | "crouch";
  /** Only set when `uiIntent === "surface"` — the world object id `input/mouse.ts`
   * forwards to `Ui.toggleSurface`. */
  surfaceId?: string;
  /** Only set when `uiIntent === "crouch"` — the TARGET TILE POSITION
   * `input/mouse.ts` forwards to `Ui.toggleCrouch(pos)` (crouch-crafting
   * rework: the crouch lens is a PER-TILE affordance — offered on whichever
   * adjacent-or-own tile has loose ground items — not a self/player-centric
   * aggregate, superseding design.md Decision 2's flat-list presentation per
   * user playtest correction). Analogous to `surfaceId` above. */
  crouchAt?: Position;
  /** Only set when `kind === "info"` — the first-person "Examinar" thought
   * text, shown directly via `Ui.showThought` (item-context-menu change).
   * Client-only: no `Command` is ever attached to an `"info"` entry. */
  thought?: string;
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
 * "Examinar de cerca" synthesized UI item (crouch-crafting rework, per user
 * playtest correction of design.md Decision 2): offered on ANY tile — the
 * player's own tile OR an adjacent one — that has at least one loose ground
 * item, carrying the TARGET TILE POSITION so `Ui.toggleCrouch` knows which
 * tile's spatial frame to render. A UI-only affordance synthesized the same
 * way as "Recoger"/"Usar la mesa" — not a catalog action.
 */
function crouchLensItem(pos: Position): ContextMenuItem {
  return {
    id: `ui:crouch:${pos.x},${pos.y}`,
    label: "Examinar de cerca",
    hint: "mirar de cerca lo que hay en el suelo",
    kind: "ui",
    uiIntent: "crouch",
    crouchAt: pos,
  };
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
  const selfItems: ContextMenuItem[] = [
    { id: "ui:inventory", label: "Ver mis cosas", hint: "el inventario", kind: "ui", uiIntent: "inventory" },
    { id: "ui:thoughts", label: "Ver mis pensamientos", hint: "lo que fui entendiendo", kind: "ui", uiIntent: "thoughts" },
    ...selfActions.map((a) => actionToItem(a, { kind: "self" })),
  ];
  // "Descansar" (crouch-crafting Slice E): entry point for the backend `Rest`
  // command (process-command.ts), which had no UI trigger. Dispatches straight
  // through the same `kind: "action"` path as catalog actions (input/mouse.ts).
  // Only offered when energy isn't already full — resting at max is a no-op.
  if (snapshot.player.energy < snapshot.player.maxEnergy) {
    selfItems.push({ id: "rest", label: "Descansar", hint: "recuperar energía", kind: "action", command: { type: "Rest" } });
  }
  const sections: ContextMenuSection[] = [{ title: "Yo", items: selfItems }];

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
    // Crouch lens trigger for the PLAYER'S OWN tile (crouch-crafting rework):
    // "Examinar de cerca" rides alongside "Recoger" in "En el suelo" — only
    // offered when the player's own tile actually has ground items, never as
    // a bare self-menu affordance.
    sections.push({ title: "En el suelo", items: [crouchLensItem(pos), ...floor] });
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
    const floorAdjacent = floorPickupItems(catalog, snapshot, pos);
    // Crouch lens trigger for an ADJACENT tile (crouch-crafting rework, per
    // user playtest correction): only offered when THIS tile actually has
    // loose ground items — never a bare adjacent-tile affordance.
    if (floorAdjacent.length > 0) items.push(crouchLensItem(pos));
    items.push(...floorAdjacent);
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

// ---------------------------------------------------------------------------
// Per-item context menu (item-context-menu change): a SEPARATE, parallel
// builder from `buildContextMenu` above — tapping/clicking an occupied bag,
// hand, or mesa cell opens THIS menu instead of directly equipping/dropping
// the item. `buildContextMenu`/`buildReachableMenu`/`buildSelfMenu` etc. are
// untouched (spec R9.2).
// ---------------------------------------------------------------------------

export type ItemOrigin = "bag" | "hand" | "surface";

/**
 * Frontend equivalent of the backend's hand-footprint check (`coversHand` in
 * `backend/src/domain/inventory.ts`, used by `handItems()`): true when ANY
 * cell `item` occupies in the player's inventory grid coincides with a
 * hand-slot cell sourced from `snapshot.handSlots.left`/`right` (never
 * hardcoded — same discipline `renderInventoryGrid`'s hand-slot detection
 * already follows). Reuses the existing pure `inventoryCellsForItem`
 * (hud.ts), which already returns `[]` for anything not currently in
 * `player_inventory` — so a mesa-origin item can never "cover" a hand slot.
 */
function coversHand(item: ItemInstance, catalog: Catalog, snapshot: ClientSnapshot): boolean {
  const cells = inventoryCellsForItem(item, catalog);
  const { left, right } = snapshot.handSlots;
  return cells.some((c) => (c.x === left.x && c.y === left.y) || (c.x === right.x && c.y === right.y));
}

/**
 * Derives which of the three menu-eligible origins `item` currently sits in
 * (design.md Component 1) — `null` for anything else (world/pile/container/
 * machine_slot), none of which are menu-eligible in this change.
 */
export function itemOrigin(item: ItemInstance, catalog: Catalog, snapshot: ClientSnapshot): ItemOrigin | null {
  if (item.location.type === "surface") return "surface";
  if (item.location.type === "player_inventory") return coversHand(item, catalog, snapshot) ? "hand" : "bag";
  return null;
}

/**
 * Tile donde soltar (Soltar / the old drag-off-cell "drop" behavior): el
 * primer adyacente caminable (queda visible al lado del jugador y dentro del
 * rango de crafting); si no hay, el tile propio. RELOCATED from
 * `game/game.ts` (item-context-menu change, task 1.4) so this pure
 * menu-builder can use it for Soltar too — `game.ts` now imports it from here
 * instead of holding its own private copy.
 */
export function dropTargetTile(snapshot: ClientSnapshot): Position {
  const p = snapshot.player.position;
  for (const d of ORTHOGONAL_OFFSETS) {
    const c = { x: p.x + d.x, y: p.y + d.y };
    if (snapshot.tiles.find((t) => t.x === c.x && t.y === c.y)?.walkable) return c;
  }
  return p;
}

export type InventorySlot = { x: number; y: number; rotation: 0 | 90 };

/** Set of `"x,y"` cells occupied by every inventory item EXCEPT `exceptId` —
 * mirrors the backend's `occupiedSet`/`occupiedSetOnGrid` (inventory.ts),
 * built here from `inventoryCellsForItem` instead of a second footprint
 * implementation. */
function inventoryOccupiedSet(catalog: Catalog, snapshot: ClientSnapshot, exceptId?: string): Set<string> {
  const set = new Set<string>();
  for (const it of snapshot.items) {
    if (it.id === exceptId) continue;
    for (const c of inventoryCellsForItem(it, catalog)) set.add(`${c.x},${c.y}`);
  }
  return set;
}

/** Mirrors the backend's `fitsOnGrid`/`fits` (inventory.ts) for the player's
 * fixed 4x4 grid. */
function fitsInInventory(set: Set<string>, x: number, y: number, w: number, h: number): boolean {
  if (x < 0 || y < 0 || x + w > INV_W || y + h > INV_H) return false;
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (set.has(`${x + dx},${y + dy}`)) return false;
  return true;
}

/** Mirrors the backend's private `coversHand(x, y, w, h)` (inventory.ts) —
 * unrelated to (and not to be confused with) this file's own `coversHand`
 * above, which checks a PLACED item against the hand slots, not a candidate
 * placement rectangle. */
function coversHandCell(x: number, y: number, w: number, h: number, snapshot: ClientSnapshot): boolean {
  const { left, right } = snapshot.handSlots;
  for (const slot of [left, right]) if (slot.x >= x && slot.x < x + w && slot.y >= y && slot.y < y + h) return true;
  return false;
}

/**
 * Mirrors the backend's `findFreeInventorySlot` (backend/src/domain/
 * inventory.ts) read-only: first free 4x4 grid slot for `item`'s shape,
 * trying rotation 0 then 90 when `rotatable && w !== h`, preferring
 * non-hand-slot cells over hand-slot cells, and EXCLUDING the item's own
 * currently-occupied cells (backend's `exceptId`) so re-storing an
 * already-inventoried item never collides with itself. Returns `null` when
 * no slot fits at all — Guardar is then omitted from the built menu.
 */
export function firstFreeInventorySlot(snapshot: ClientSnapshot, catalog: Catalog, item: ItemInstance): InventorySlot | null {
  const def = catalog.items.find((i) => i.id === item.itemTypeId);
  const w = def?.shape.w ?? 1;
  const h = def?.shape.h ?? 1;
  const set = inventoryOccupiedSet(catalog, snapshot, item.id);
  const tries: Array<{ w: number; h: number; rotation: 0 | 90 }> = [{ w, h, rotation: 0 }];
  if (def?.rotatable && w !== h) tries.push({ w: h, h: w, rotation: 90 });
  for (const avoidHands of [true, false]) {
    for (const t of tries) {
      for (let y = 0; y < INV_H; y++) {
        for (let x = 0; x < INV_W; x++) {
          if (fitsInInventory(set, x, y, t.w, t.h) && (!avoidHands || !coversHandCell(x, y, t.w, t.h, snapshot))) {
            return { x, y, rotation: t.rotation };
          }
        }
      }
    }
  }
  return null;
}

/** `ownerId` for a Guardar `MoveItem { to: { type: "inventory", ... } }`
 * payload: the item's own current inventory owner when already inventoried
 * (a re-stow, e.g. rotate-adjacent-slot scenarios), else the current player
 * (a hand- or mesa-origin item being stowed for the first time). */
function inventoryOwnerId(item: ItemInstance, snapshot: ClientSnapshot): string {
  return item.location.type === "player_inventory" ? item.location.playerId : snapshot.player.id;
}

/** First hand slot NOT covered by any currently-placed inventory item, or
 * `null` when both are occupied — computed LOCALLY from `snapshot.handSlots`
 * + `inventoryCellsForItem`, deliberately NOT `game.ts`'s `handsOccupied`
 * (that helper lives in the DOM-composition layer; this pure builder must
 * not depend on it, design.md Component 1). */
function firstFreeHand(snapshot: ClientSnapshot, catalog: Catalog): "left" | "right" | null {
  const isHandOccupied = (slot: Position) => snapshot.items.some((it) => inventoryCellsForItem(it, catalog).some((c) => c.x === slot.x && c.y === slot.y));
  if (!isHandOccupied(snapshot.handSlots.left)) return "left";
  if (!isHandOccupied(snapshot.handSlots.right)) return "right";
  return null;
}

/** `Equipar` — bag or mesa origin only (never hand, already equipped), and
 * only when a free hand slot exists (spec R2.3): a guaranteed-reject entry is
 * omitted entirely rather than shown, so the gate is visible BEFORE the
 * player selects it. */
function equiparEntry(item: ItemInstance, catalog: Catalog, snapshot: ClientSnapshot): ContextMenuItem | null {
  const hand = firstFreeHand(snapshot, catalog);
  if (!hand) return null;
  return { id: "equipar", label: "Equipar", kind: "action", command: { type: "MoveItem", itemInstanceId: item.id, to: { type: "hand", hand } } };
}

/** `Guardar` — hand or mesa origin only (never bag, already stored), and
 * only when a free inventory slot exists (spec R2 table): omitted entirely
 * when `firstFreeInventorySlot` returns `null` (full inventory). */
function guardarEntry(item: ItemInstance, catalog: Catalog, snapshot: ClientSnapshot): ContextMenuItem | null {
  const slot = firstFreeInventorySlot(snapshot, catalog, item);
  if (!slot) return null;
  return {
    id: "guardar",
    label: "Guardar",
    kind: "action",
    command: { type: "MoveItem", itemInstanceId: item.id, to: { type: "inventory", ownerId: inventoryOwnerId(item, snapshot), x: slot.x, y: slot.y, rotation: slot.rotation } },
  };
}

/** `Soltar` — bag or hand origin only, NEVER mesa (spec R2.4/R5.4 — the
 * backend's mesa-origin `DropItem` rejection carries no `thought` text, so
 * this is a hard client-side gate, not a runtime fallback). Uses the
 * relocated `dropTargetTile` heuristic unchanged (spec R5.1). */
function soltarEntry(item: ItemInstance, snapshot: ClientSnapshot): ContextMenuItem {
  return { id: "soltar", label: "Soltar", kind: "action", command: { type: "DropItem", itemInstanceId: item.id, to: dropTargetTile(snapshot) } };
}

/** `0 -> 90`, `90 -> 0` (spec R6.1/R6.2). Written fresh for this toggle
 * idiom — `drag.ts`'s rotation handling PRESERVES rotation across a move, it
 * is not a toggle, so it is not reused here (design.md Component 4). */
function toggledRotation(rotation: number): 0 | 90 {
  return rotation === 90 ? 0 : 90;
}

/** `Rotar` — only ever called for bag (`player_inventory`) or mesa
 * (`surface`) origins (the caller already gates on `rotatable && origin !==
 * "hand"`); returns `null` for any other location shape as a defensive
 * no-op. */
function rotarEntry(item: ItemInstance): ContextMenuItem | null {
  const loc = item.location;
  if (loc.type === "player_inventory") {
    return {
      id: "rotar",
      label: "Rotar",
      kind: "action",
      command: { type: "MoveItem", itemInstanceId: item.id, to: { type: "inventory", ownerId: loc.playerId, x: loc.x, y: loc.y, rotation: toggledRotation(loc.rotation) } },
    };
  }
  if (loc.type === "surface") {
    return {
      id: "rotar",
      label: "Rotar",
      kind: "action",
      command: { type: "MoveItem", itemInstanceId: item.id, to: { type: "surface", surfaceId: loc.surfaceId, x: loc.x, y: loc.y, rotation: toggledRotation(loc.rotation) } },
    };
  }
  return null;
}

/** `Examinar` — always present, always last (spec R4/R3.4). Client-only:
 * shows the catalog's authored `observation` text via a `kind: "info"` entry
 * (no `Command`), falling back to a generic first-person line when the
 * catalog def carries no `observation` (spec R4.2 — untestable against real
 * catalog data today, since every current item has authored text; covered by
 * a synthetic fixture). */
function examinarEntry(item: ItemInstance, catalog: Catalog): ContextMenuItem {
  const def = catalog.items.find((i) => i.id === item.itemTypeId);
  const name = def?.name ?? item.itemTypeId;
  return { id: "examinar", label: "Examinar", kind: "info", thought: def?.observation ?? `Veo ${name} de cerca.` };
}

/**
 * Property/origin-gated per-item menu (design.md Component 1, spec R2/R3).
 * Gating + ordering matrix, primary action first, Examinar always last:
 * - bag origin     -> Equipar, Rotar?, Soltar, Examinar
 * - hand origin     -> Guardar, Soltar, Examinar
 * - surface origin -> Guardar, Rotar?, Equipar, Examinar   (Soltar NEVER)
 * Any entry excluded by its gate is simply omitted, never reordered around
 * (spec R3.4). `origin === null` (not menu-eligible) defensively falls back
 * to Examinar-only, so the menu is never empty — this fallback is not
 * exercised by any wiring in this change (callers only invoke this for
 * occupied bag/hand/mesa cells) but keeps the builder total.
 */
export function buildItemMenu(item: ItemInstance, catalog: Catalog, snapshot: ClientSnapshot): ContextMenu {
  const origin = itemOrigin(item, catalog, snapshot);
  const def = catalog.items.find((i) => i.id === item.itemTypeId);
  const name = def?.name ?? item.itemTypeId;
  const items: ContextMenuItem[] = [];

  if (origin === "bag") {
    const equipar = equiparEntry(item, catalog, snapshot);
    if (equipar) items.push(equipar);
    if (def?.rotatable) {
      const rotar = rotarEntry(item);
      if (rotar) items.push(rotar);
    }
    items.push(soltarEntry(item, snapshot));
    items.push(examinarEntry(item, catalog));
  } else if (origin === "hand") {
    const guardar = guardarEntry(item, catalog, snapshot);
    if (guardar) items.push(guardar);
    items.push(soltarEntry(item, snapshot));
    items.push(examinarEntry(item, catalog));
  } else if (origin === "surface") {
    const guardar = guardarEntry(item, catalog, snapshot);
    if (guardar) items.push(guardar);
    if (def?.rotatable) {
      const rotar = rotarEntry(item);
      if (rotar) items.push(rotar);
    }
    const equipar = equiparEntry(item, catalog, snapshot);
    if (equipar) items.push(equipar);
    items.push(examinarEntry(item, catalog));
  } else {
    items.push(examinarEntry(item, catalog));
  }

  return { title: name, sections: [{ title: name, items }] };
}
