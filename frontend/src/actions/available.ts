import type { Catalog, ContextActionDef, ItemInstance, Position, Requirement, TargetSelector, Tile, WorldObject } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { chebyshev } from "../state/visibility";

/**
 * Resolved click target used for local action preview. Mirrors backend
 * domain/engine.ts `RTarget` (the shape `resolveTarget` builds before checking
 * `appliesTo`/`requirements`).
 */
export type ActionTarget =
  | { kind: "world_object"; pos: Position; tags: string[]; object: WorldObject }
  | { kind: "tile"; pos: Position; tags: string[]; terrain: Tile["terrain"] }
  | { kind: "item"; pos: Position; tags: string[]; item: ItemInstance }
  | { kind: "self"; pos: Position; tags: string[] };

const intersects = (a: string[], b: string[]): boolean => a.some((x) => b.includes(x));

function selectorMatches(selector: TargetSelector, target: ActionTarget): boolean {
  if (selector.kind !== target.kind) return false;
  if (selector.kind === "world_object" || selector.kind === "item") return intersects(selector.anyTags, target.tags);
  if (selector.kind === "tile") {
    const okTerrain = !selector.anyTerrain || (target.kind === "tile" && selector.anyTerrain.includes(target.terrain));
    const okTags = !selector.anyTags || intersects(selector.anyTags, target.tags);
    return okTerrain && okTags;
  }
  return true; // self
}

function itemMatches(catalog: Catalog, item: ItemInstance, match: { anyTags?: string[]; minProps?: Record<string, number> }): boolean {
  const def = catalog.items.find((i) => i.id === item.itemTypeId);
  if (!def) return false;
  if (match.anyTags && !intersects(match.anyTags, def.tags)) return false;
  if (match.minProps) {
    for (const [k, v] of Object.entries(match.minProps)) if ((def.properties[k] ?? 0) < v) return false;
  }
  return true;
}

function handItemAt(snapshot: ClientSnapshot, slot: Position): ItemInstance | undefined {
  return snapshot.items.find(
    (it) => it.location.type === "player_inventory" && it.location.x === slot.x && it.location.y === slot.y,
  );
}

/**
 * Checks a single requirement against `target`/`snapshot`. Mirrors backend
 * domain/engine.ts `checkRequirement`, with one intentional, documented deviation:
 * `distance` uses CHEBYSHEV here (matching the backend's ACTUAL implementation),
 * not euclidean — design.md's prose said "euclid" for this specific spot, but the
 * real backend `checkRequirement` "distance" case uses `chebyshev` (engine.ts).
 * Euclidean is correct for VISION_RADIUS/visibility (state.ts), not for action
 * distance requirements. Using the wrong metric here would only ever mean a stale
 * local preview — the backend re-validates and is the actual source of truth — but
 * mirroring the real code is what "mirror the backend" means.
 */
function checkRequirement(req: Requirement, target: ActionTarget, catalog: Catalog, snapshot: ClientSnapshot): boolean {
  const left = handItemAt(snapshot, snapshot.handSlots.left);
  const right = handItemAt(snapshot, snapshot.handSlots.right);
  const active = [left, right].filter((x): x is ItemInstance => !!x);

  switch (req.type) {
    case "distance":
      return chebyshev(snapshot.player.position, target.pos) <= req.max;
    case "energy":
      return snapshot.player.energy >= req.min;
    case "knowledge":
      return snapshot.player.knowledge.includes(req.knowledgeId);
    case "hand_empty": {
      const slots = req.slot === "any" ? [left, right] : [req.slot === "left" ? left : right];
      return slots.every((x) => !x);
    }
    case "hand": {
      const candidates = req.slot === "left" ? [left] : req.slot === "right" ? [right] : active;
      return candidates.some((it) => it && itemMatches(catalog, it, { anyTags: req.anyTags, minProps: req.minProps }));
    }
    case "target_state":
      return target.kind === "world_object" && (target.object.state as Record<string, unknown>)?.[req.key] === req.value;
    case "target_tag":
      return target.tags.includes(req.tag);
  }
}

/**
 * Pure preview of which actions the contextual menu should offer for `target`.
 * Filters `catalog.actions` by `appliesTo` then by every locally-evaluable
 * `requirement`, sorted by `priority` descending (most "advanced"/specific action
 * first — e.g. `cut_tree_axe` before `pull_branches`). The backend is the sole
 * authority and re-validates everything on `ExecuteAction`: worst case a stale or
 * over-eager preview here produces a `rejection` thought, never a free action.
 */
export function computeAvailableActions(catalog: Catalog, target: ActionTarget, snapshot: ClientSnapshot): ContextActionDef[] {
  return catalog.actions
    .filter((action) => selectorMatches(action.appliesTo, target))
    .filter((action) => action.requirements.every((req) => checkRequirement(req, target, catalog, snapshot)))
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Pista de descubrimiento: ¿hay alguna acción de crafting cuyos `inputs` se puedan
 * satisfacer con lo que el jugador tiene a mano + en el suelo adyacente (cheby <= 1)?
 * Devuelve la primera acción craftable (para nombrarla en el HUD) o null. Espeja la
 * resolución de inputs del backend (engine.ts), que junta de hands/adjacent_ground.
 */
export function findCraftable(catalog: Catalog, snapshot: ClientSnapshot): ContextActionDef | null {
  const hands = [snapshot.handSlots.left, snapshot.handSlots.right];
  const reachable = snapshot.items.filter((it) => {
    const loc = it.location;
    if (loc.type === "player_inventory") return hands.some((s) => loc.x === s.x && loc.y === s.y);
    if (loc.type === "world") return chebyshev(snapshot.player.position, { x: loc.x, y: loc.y }) <= 1;
    return false;
  });

  for (const action of catalog.actions) {
    const inputs = action.inputs ?? [];
    if (inputs.length === 0) continue;
    const used = new Set<string>();
    const satisfiable = inputs.every((inp) => {
      let need = inp.count;
      for (const it of reachable) {
        if (used.has(it.id)) continue;
        if (itemMatches(catalog, it, inp.match)) {
          used.add(it.id);
          if (--need === 0) break;
        }
      }
      return need <= 0;
    });
    if (satisfiable) return action;
  }
  return null;
}
