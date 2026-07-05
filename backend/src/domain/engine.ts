import type { Effect, Requirement, TargetSelector } from "../contract/catalog";
import type { Event, ItemInstance, Rejection, Thought, WorldObject } from "../contract/events";
import type { CatalogIndex } from "./catalog";
import type { GameState, Position, RuntimeTile, TerrainId } from "./state";
import { chebyshev, tileAt } from "./state";
import { applyEvent } from "./reducer";
import { findFreeInventorySlot, handItems } from "./inventory";
import { newId } from "./ids";
import {
  classifyCombination,
  combinationSignature,
  describeCombinationFeedback,
  ESCALATION_THRESHOLD,
  gatherCombinationScope,
  resolveRecipeInputs,
} from "./combination";

type ThoughtKind = "observation" | "idea" | "discovery" | "warning" | "failure" | "memory" | "system";

export type TargetRef =
  | { kind: "world_object"; id: string }
  | { kind: "tile"; x: number; y: number }
  | { kind: "item"; id: string }
  | { kind: "pile"; id: string }
  | { kind: "self" };

export type EngineCtx = { state: GameState; index: CatalogIndex; rng: () => number; now: () => number };
export type EngineResult = { events: Event[] } | { rejection: Rejection };

export type RTarget =
  | { kind: "world_object"; pos: Position; tags: string[]; obj: WorldObject }
  | { kind: "tile"; pos: Position; tags: string[]; terrain: TerrainId; tile: RuntimeTile }
  | { kind: "item"; pos: Position; tags: string[]; item: ItemInstance }
  | { kind: "self"; pos: Position; tags: string[] };

// ---- helpers de rechazo / pensamiento ----
const rej = (code: Rejection["code"], thought?: Thought): EngineResult => ({ rejection: { code, ...(thought ? { thought } : {}) } });
const mkThought = (ctx: EngineCtx, text: string, kind: ThoughtKind, relatedEntityId?: string): Thought => ({
  id: newId("th"),
  text,
  kind,
  timestamp: ctx.now(),
  ...(relatedEntityId ? { relatedEntityId } : {}),
});

// ---- C1: la energía baja penaliza la probabilidad de éxito ----
function energyFactor(s: GameState): number {
  const r = s.player.maxEnergy > 0 ? s.player.energy / s.player.maxEnergy : 1;
  if (r < 0.1) return 0.4;
  if (r < 0.25) return 0.7;
  return 1;
}

function resolveTarget(s: GameState, index: CatalogIndex, ref: TargetRef): RTarget | null {
  if (ref.kind === "self") return { kind: "self", pos: s.player.position, tags: [] };
  if (ref.kind === "world_object") {
    const obj = s.objects.find((o) => o.id === ref.id);
    if (!obj) return null;
    const def = index.objectById.get(obj.objectTypeId);
    return { kind: "world_object", pos: obj.position, tags: [...(def?.tags ?? []), ...(obj.tags ?? [])], obj };
  }
  if (ref.kind === "tile") {
    const tile = tileAt(s, ref.x, ref.y);
    if (!tile) return null;
    const def = index.terrainById.get(tile.terrain);
    return { kind: "tile", pos: { x: ref.x, y: ref.y }, tags: [...tile.tags, ...(def?.tags ?? [])], terrain: tile.terrain, tile };
  }
  if (ref.kind === "item") {
    const item = s.items.find((i) => i.id === ref.id);
    if (!item || item.location.type !== "world") return null;
    const def = index.itemById.get(item.itemTypeId);
    return { kind: "item", pos: { x: item.location.x, y: item.location.y }, tags: def?.tags ?? [], item };
  }
  return null;
}

const intersects = (a: string[], b: string[]): boolean => a.some((x) => b.includes(x));

function selectorMatches(sel: TargetSelector, t: RTarget): boolean {
  if (sel.kind !== t.kind) return false;
  if (sel.kind === "world_object" || sel.kind === "item") return intersects(sel.anyTags, t.tags);
  if (sel.kind === "tile") {
    const okTerrain = !sel.anyTerrain || (t.kind === "tile" && sel.anyTerrain.includes(t.terrain));
    const okTags = !sel.anyTags || intersects(sel.anyTags, t.tags);
    return okTerrain && okTags;
  }
  return true; // self
}

function itemMatches(index: CatalogIndex, it: ItemInstance, m: { anyTags?: string[]; minProps?: Record<string, number> }): boolean {
  const def = index.itemById.get(it.itemTypeId);
  if (!def) return false;
  if (m.anyTags && !intersects(m.anyTags, def.tags)) return false;
  if (m.minProps) for (const [k, v] of Object.entries(m.minProps)) if ((def.properties[k] ?? 0) < v) return false;
  return true;
}

function checkRequirement(ctx: EngineCtx, r: Requirement, t: RTarget): Rejection | null {
  const { state: s, index } = ctx;
  const hands = handItems(s, index);
  switch (r.type) {
    case "distance":
      return chebyshev(s.player.position, t.pos) <= r.max ? null : { code: "out_of_range", thought: mkThought(ctx, "Tengo que acercarme más.", "warning") };
    case "energy":
      return s.player.energy >= r.min ? null : { code: "insufficient_energy", thought: mkThought(ctx, "Estoy demasiado cansado para hacer eso ahora.", "warning") };
    case "knowledge":
      return s.player.knowledge.includes(r.knowledgeId) ? null : { code: "missing_knowledge" };
    case "hand_empty": {
      const slots = r.slot === "any" ? [hands.left, hands.right] : [r.slot === "left" ? hands.left : hands.right];
      return slots.every((x) => !x) ? null : { code: "not_applicable" };
    }
    case "hand": {
      const candidates = r.slot === "left" ? [hands.left] : r.slot === "right" ? [hands.right] : hands.active;
      const ok = candidates.some((it) => it && itemMatches(index, it, { anyTags: r.anyTags, minProps: r.minProps }));
      return ok ? null : { code: "not_applicable" };
    }
    case "target_state":
      return t.kind === "world_object" && (t.obj.state as Record<string, unknown>)?.[r.key] === r.value ? null : { code: "not_applicable" };
    case "target_tag":
      return t.tags.includes(r.tag) ? null : { code: "not_applicable" };
  }
}

function gatherCandidates(s: GameState, index: CatalogIndex, scope: string[], t: RTarget): ItemInstance[] {
  const out: ItemInstance[] = [];
  if (scope.includes("hands")) out.push(...handItems(s, index).active);
  const world = s.items.filter((i) => i.location.type === "world");
  if (scope.includes("adjacent_ground"))
    out.push(...world.filter((i) => i.location.type === "world" && chebyshev(s.player.position, { x: i.location.x, y: i.location.y }) <= 1));
  if (scope.includes("surface")) {
    const surfaceId = t.kind === "world_object" ? t.obj.id : undefined;
    const dims = surfaceId ? s.inventories[surfaceId] : undefined;
    if (dims) out.push(...s.items.filter((i) => i.location.type === "surface" && i.location.surfaceId === surfaceId));
    else out.push(...world.filter((i) => i.location.type === "world" && chebyshev(t.pos, { x: i.location.x, y: i.location.y }) <= 1));
  }
  return out;
}

export function executeAction(ctx: EngineCtx, actionId: string, ref: TargetRef): EngineResult {
  const { state: s, index } = ctx;
  const action = index.actions.find((a) => a.id === actionId);
  if (!action) return rej("not_applicable", mkThought(ctx, "No sé cómo hacer eso.", "system"));

  const t = resolveTarget(s, index, ref);
  if (!t) return rej("invalid_target");
  if (!selectorMatches(action.appliesTo, t)) return rej("not_applicable");

  for (const r of action.requirements) {
    const fail = checkRequirement(ctx, r, t);
    if (fail) return { rejection: fail };
  }

  // resolver inputs (crafting por contexto — C4), sin reusar instancias entre inputs
  const claimed = new Set<string>();
  const resolved: Record<string, ItemInstance[]> = {};
  for (const inp of action.inputs ?? []) {
    const pool = gatherCandidates(s, index, inp.scope, t).filter((it) => !claimed.has(it.id) && itemMatches(index, it, inp.match));
    if (pool.length < inp.count) return rej("missing_inputs", mkThought(ctx, "Me falta algo para esto.", "warning"));
    const picked = pool.slice(0, inp.count);
    picked.forEach((it) => claimed.add(it.id));
    resolved[inp.name] = picked;
  }

  const events: Event[] = [];
  const emit = (e: Event): void => {
    events.push(e);
    applyEvent(s, index, e);
  };

  // tirada de éxito (con penalización por energía baja)
  const base = action.successChance ?? 1;
  const success = ctx.rng() <= base * energyFactor(s);
  if (base < 1 && !success) {
    for (const e of action.effects) if (e.type === "consume_energy") emit({ type: "EnergyChanged", energy: Math.max(0, s.player.energy - e.amount) });
    emit({ type: "ActionFailed", actionId, ...(action.thoughts?.fail ? { thought: mkThought(ctx, action.thoughts.fail, "failure") } : {}) });
    return { events };
  }

  for (const e of action.effects) applyEffect(ctx, e, t, resolved, emit);
  if (action.thoughts?.success) emit({ type: "ThoughtAdded", thought: mkThought(ctx, action.thoughts.success, "discovery") });
  return { events };
}

/** "Probar combinación" (Decision 3, engram #2854 + per-tile amendment #2857): a
 *  META action over ALL `combinable`-flagged recipes, decoupled from `executeAction`'s
 *  `appliesTo`/`requirements` gating (this is what lets a crouch craft on ANY tile,
 *  not just at the mesa). On a FAILED (non-`ready`) attempt, emits `CombinationAttempted`
 *  (feeding the escalation counter — a successful craft does NOT bump it, since the
 *  counter tracks failed attempts per spec); on `ready` it crafts by reusing `applyEffect`
 *  directly. `executeAction` itself is left untouched — this is a sibling path. */
export function tryCombination(ctx: EngineCtx, ref: TargetRef, method: "crouch" | "surface"): EngineResult {
  const { state: s, index } = ctx;

  // Cross-validate method<->target.kind BEFORE resolving/gathering anything: a
  // "crouch" attempt must target the examined tile, a "surface" attempt must target
  // the mesa world object. Without this, "surface" + a tile target would fall through
  // gatherCandidates' proximity fallback and silently defeat the per-tile invariant
  // (#2857) with no mesa and no reach check at all.
  if (method === "crouch" && ref.kind !== "tile") return rej("invalid_target");
  if (method === "surface" && ref.kind !== "world_object") return rej("invalid_target");

  const t = resolveTarget(s, index, ref);
  if (!t) return rej("invalid_target");

  // Proximity guard — every other spatial command (TakeItem, DropItem, MoveItem->surface)
  // enforces reach; TryCombination must too, or a client could combine from anywhere
  // on the map by naming an arbitrary tile/world_object id.
  if (chebyshev(s.player.position, t.pos) > 1) {
    const msg = method === "crouch" ? "Tengo que acercarme más." : "Tengo que acercarme a la mesa.";
    return rej("out_of_range", mkThought(ctx, msg, "warning"));
  }

  const pieces = gatherCombinationScope(s, index, t, method);
  const signature = combinationSignature(pieces);
  // Read the counter BEFORE this attempt's own (possible) CombinationAttempted
  // increments it, so tier selection reflects prior (not counting this) attempts.
  const priorAttempts = s.combinationAttempts[signature] ?? 0;
  const classification = classifyCombination(s, index, ref, method);

  const events: Event[] = [];
  const emit = (e: Event): void => {
    events.push(e);
    applyEvent(s, index, e);
  };

  if (classification.grade === "ready" && classification.recipe) {
    const { resolved } = resolveRecipeInputs(index, pieces, classification.recipe);
    for (const e of classification.recipe.effects) applyEffect(ctx, e, t, resolved, emit);
    if (classification.recipe.thoughts?.success) emit({ type: "ThoughtAdded", thought: mkThought(ctx, classification.recipe.thoughts.success, "discovery") });
    return { events };
  }

  emit({ type: "CombinationAttempted", signature });
  const tier = priorAttempts >= ESCALATION_THRESHOLD ? "sharp" : "vague";
  emit({ type: "ThoughtAdded", thought: mkThought(ctx, describeCombinationFeedback(classification, tier), "observation") });
  return { events };
}

function applyEffect(ctx: EngineCtx, e: Effect, t: RTarget, resolved: Record<string, ItemInstance[]>, emit: (e: Event) => void): void {
  const { state: s, index } = ctx;
  switch (e.type) {
    case "consume_energy":
      emit({ type: "EnergyChanged", energy: Math.max(0, s.player.energy - e.amount) });
      return;
    case "damage_active_tool": {
      const tool = handItems(s, index).active.find((it) => typeof it.durability === "number");
      if (!tool) return;
      const dur = (tool.durability ?? 0) - e.amount;
      emit({ type: "ToolDamaged", itemInstanceId: tool.id, durability: Math.max(0, dur) });
      if (dur <= 0) {
        emit({ type: "ItemBroke", itemInstanceId: tool.id });
        emit({ type: "ThoughtAdded", thought: mkThought(ctx, "La herramienta no aguantó más.", "failure") });
      }
      return;
    }
    case "add_item": {
      const n = e.amount ?? 1;
      for (let k = 0; k < n; k++) {
        if (typeof e.chance === "number" && ctx.rng() > e.chance) continue;
        const id = newId("it");
        if (e.to === "inventory") {
          const slot = findFreeInventorySlot(s, index, e.itemTypeId, s.player.id);
          if (slot) {
            emit({ type: "ItemAddedToInventory", item: { id, itemTypeId: e.itemTypeId, location: slot } });
          } else {
            emit({ type: "ItemPlacedInWorld", item: { id, itemTypeId: e.itemTypeId, location: { type: "world", zoneId: s.zone.id, x: s.player.position.x, y: s.player.position.y } }, position: s.player.position });
            emit({ type: "ThoughtAdded", thought: mkThought(ctx, "No tengo espacio para acomodar eso.", "system") });
          }
        } else {
          const pos = t.pos;
          emit({ type: "ItemPlacedInWorld", item: { id, itemTypeId: e.itemTypeId, location: { type: "world", zoneId: s.zone.id, x: pos.x, y: pos.y } }, position: pos });
        }
      }
      return;
    }
    case "consume_input": {
      for (const it of resolved[e.input] ?? []) {
        if (it.location.type === "world") emit({ type: "ItemRemovedFromWorld", itemInstanceId: it.id });
        else emit({ type: "ItemRemovedFromInventory", itemInstanceId: it.id });
      }
      return;
    }
    case "remove_target": {
      if (t.kind === "world_object") emit({ type: "WorldObjectRemoved", objectId: t.obj.id });
      else if (t.kind === "item") emit({ type: "ItemRemovedFromWorld", itemInstanceId: t.item.id });
      return;
    }
    case "change_tile": {
      const def = index.terrainById.get(e.terrain);
      emit({ type: "TileChanged", position: t.pos, terrain: e.terrain, walkable: def?.walkable ?? true });
      return;
    }
    case "reveal_around_target": {
      const tiles = [];
      for (let y = t.pos.y - e.radius; y <= t.pos.y + e.radius; y++)
        for (let x = t.pos.x - e.radius; x <= t.pos.x + e.radius; x++) {
          const tile = tileAt(s, x, y);
          if (tile) tiles.push({ x, y, terrain: tile.terrain, walkable: tile.walkable, tags: tile.tags, visibility: "visible" as const });
        }
      emit({ type: "TilesRevealed", tiles });
      return;
    }
    case "set_target_state": {
      if (t.kind === "world_object") emit({ type: "WorldObjectStateChanged", objectId: t.obj.id, state: { [e.key]: e.value } });
      return;
    }
    case "create_world_object": {
      const def = index.objectById.get(e.objectTypeId);
      const pos = e.at === "player_tile" ? s.player.position : t.pos;
      emit({
        type: "WorldObjectCreated",
        object: { id: newId("wo"), objectTypeId: e.objectTypeId, position: { x: pos.x, y: pos.y }, state: { ...(def?.defaultState ?? {}) }, tags: def?.tags ?? [], visibility: "visible" },
      });
      return;
    }
    case "unlock_knowledge": {
      if (s.player.knowledge.includes(e.knowledgeId)) return;
      emit({ type: "KnowledgeUnlocked", knowledgeId: e.knowledgeId });
      const def = index.knowledgeById.get(e.knowledgeId);
      if (def?.unlockThought) emit({ type: "ThoughtAdded", thought: mkThought(ctx, def.unlockThought, "idea") });
      return;
    }
    case "add_thought":
      emit({ type: "ThoughtAdded", thought: mkThought(ctx, e.text, e.kind) });
      return;
  }
}

// helpers exportados para otros handlers
export { resolveTarget, energyFactor, itemMatches, gatherCandidates };
