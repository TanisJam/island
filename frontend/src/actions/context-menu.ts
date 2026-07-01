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
  uiIntent?: "inventory" | "thoughts";
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

const NEIGHBOR_OFFSETS: Position[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/**
 * Best-effort walkable position to approach `pos` from — `pos` itself if
 * walkable, otherwise the first walkable neighbor found (a world object's
 * own tile is very often non-walkable, e.g. a tree that `blocksMovement`).
 * Purely a client-side convenience for the "Acercarme" move item: the
 * backend still pathfinds/revalidates the actual `MovePlayer`, so a
 * best-effort miss just surfaces as a normal rejection thought, same
 * tolerance as every other client-side preview in this module.
 */
function findApproachPosition(snapshot: ClientSnapshot, pos: Position): Position | null {
  if (tileWalkableAt(snapshot, pos)) return pos;
  for (const d of NEIGHBOR_OFFSETS) {
    const candidate = { x: pos.x + d.x, y: pos.y + d.y };
    if (tileWalkableAt(snapshot, candidate)) return candidate;
  }
  return null;
}

function terrainName(catalog: Catalog, terrain: Tile["terrain"]): string {
  return catalog.terrains.find((t) => t.id === terrain)?.name ?? terrain;
}

function targetName(catalog: Catalog, target: ActionTarget): string {
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
