import type { Command, CommandEnvelope } from "../contract/commands";
import type { CommandResult, Event, ItemInstance, Rejection, Thought } from "../contract/events";
import type { EngineCtx, TargetRef } from "../domain/engine";
import { executeAction, resolveTarget, tryCombination } from "../domain/engine";
import { applyEvent } from "../domain/reducer";
import { findPath } from "../domain/pathfinding";
import { canPlaceInInventory, canPlaceOnSurface, findFreeInventorySlot, handEquipFits, HAND_LEFT, HAND_RIGHT } from "../domain/inventory";
import { chebyshev, REST_RECOVERY, tileAt } from "../domain/state";
import { derivePiles, reconcilePiles } from "../domain/piles";
import { newId } from "../domain/ids";

const intersects = (a: string[], b: string[]): boolean => a.some((x) => b.includes(x));

/** Procesa un comando: muta el estado vía reducer y devuelve los eventos resultantes
 *  (o un rechazo de dominio con pensamiento en primera persona). */
export function processCommand(ctx: EngineCtx, env: CommandEnvelope): CommandResult {
  const cmd = env.command as Command;
  const thought = (text: string, kind: Thought["kind"]): Thought => ({ id: newId("th"), text, kind, timestamp: ctx.now() });
  const ok = (events: Event[]): CommandResult => ({ clientCommandId: env.clientCommandId, accepted: true, events });
  const no = (rejection: Rejection): CommandResult => ({ clientCommandId: env.clientCommandId, accepted: false, events: [], rejection });

  const events: Event[] = [];
  const emit = (e: Event): void => {
    events.push(e);
    applyEvent(ctx.state, ctx.index, e);
  };

  // Piles are derived from the world-item layout. Snapshot them before the command
  // mutates state so reconcilePiles can emit PileChanged for any group that forms,
  // grows, shrinks, or dissolves as a side effect of this command.
  const before = derivePiles(ctx.state);

  const result: CommandResult = (() => {
  switch (cmd.type) {
    case "ExecuteAction": {
      const res = executeAction(ctx, cmd.actionId, cmd.target as TargetRef);
      return "rejection" in res ? no(res.rejection) : ok(res.events);
    }

    case "MovePlayer": {
      const dest = cmd.to;
      const tile = tileAt(ctx.state, dest.x, dest.y);
      if (!tile || !tile.walkable) return no({ code: "not_walkable", thought: thought("No puedo pararme ahí.", "warning") });
      const blocking = new Set<string>();
      for (const o of ctx.state.objects) {
        const def = ctx.index.objectById.get(o.objectTypeId);
        if (def?.blocksMovement) blocking.add(`${o.position.x},${o.position.y}`);
      }
      const path = findPath(ctx.state, ctx.state.player.position, dest, blocking);
      if (!path) return no({ code: "no_path", thought: thought("No puedo llegar allí desde aquí.", "warning") });
      emit({ type: "PlayerMoved", playerId: ctx.state.player.id, path, position: dest });
      return ok(events);
    }

    case "Rest": {
      const next = Math.min(ctx.state.player.maxEnergy, ctx.state.player.energy + REST_RECOVERY);
      emit({ type: "EnergyChanged", energy: next });
      emit({ type: "ThoughtAdded", thought: thought("Respiro un momento. Puedo seguir.", "observation") });
      return ok(events);
    }

    case "Observe": {
      const t = resolveTarget(ctx.state, ctx.index, cmd.target as TargetRef);
      if (!t) return no({ code: "invalid_target" });
      for (const k of ctx.index.knowledgeById.values()) {
        if (!k.unlockOnObserveTags) continue;
        if (ctx.state.player.knowledge.includes(k.id)) continue;
        if (!intersects(k.unlockOnObserveTags, t.tags)) continue;
        emit({ type: "KnowledgeUnlocked", knowledgeId: k.id });
        if (k.unlockThought) emit({ type: "ThoughtAdded", thought: thought(k.unlockThought, "idea") });
      }
      return ok(events);
    }

    case "TakeItem": {
      const ref = cmd.target as TargetRef;
      if (ref.kind !== "item") return no({ code: "invalid_target", thought: thought("Eso no lo puedo levantar así.", "warning") });
      const item = ctx.state.items.find((i) => i.id === ref.id);
      if (!item || item.location.type !== "world") return no({ code: "invalid_target" });
      if (chebyshev(ctx.state.player.position, { x: item.location.x, y: item.location.y }) > 1)
        return no({ code: "out_of_range", thought: thought("Tengo que acercarme más.", "warning") });
      const slot = findFreeInventorySlot(ctx.state, ctx.index, item.itemTypeId, ctx.state.player.id);
      if (!slot) return no({ code: "no_space", thought: thought("No tengo espacio para acomodarlo.", "system") });
      emit({ type: "ItemRemovedFromWorld", itemInstanceId: item.id });
      emit({ type: "ItemAddedToInventory", item: { ...item, location: slot } });
      return ok(events);
    }

    case "DropItem": {
      const item = ctx.state.items.find((i) => i.id === cmd.itemInstanceId);
      if (!item || item.location.type !== "player_inventory") return no({ code: "invalid_target" });
      const tile = tileAt(ctx.state, cmd.to.x, cmd.to.y);
      if (!tile || !tile.walkable) return no({ code: "not_walkable", thought: thought("Ahí no puedo dejarlo.", "warning") });
      if (chebyshev(ctx.state.player.position, cmd.to) > 1) return no({ code: "out_of_range", thought: thought("Está demasiado lejos para dejarlo ahí.", "warning") });
      const placed: ItemInstance = { ...item, location: { type: "world", zoneId: ctx.state.zone.id, x: cmd.to.x, y: cmd.to.y } };
      emit({ type: "ItemRemovedFromInventory", itemInstanceId: item.id });
      emit({ type: "ItemPlacedInWorld", item: placed, position: cmd.to });
      emit({ type: "ThoughtAdded", thought: thought("Lo dejé en el suelo.", "system") });
      return ok(events);
    }

    case "MoveItem": {
      const item = ctx.state.items.find((i) => i.id === cmd.itemInstanceId);
      if (!item) return no({ code: "invalid_target" });
      const to = cmd.to;
      if (to.type === "surface") {
        const dims = ctx.state.inventories[to.surfaceId];
        if (!dims) return no({ code: "invalid_target", thought: thought("No hay una superficie ahí para dejar esto.", "warning") });
        const surface = ctx.state.objects.find((o) => o.id === to.surfaceId);
        if (!surface || chebyshev(ctx.state.player.position, surface.position) > 1)
          return no({ code: "out_of_range", thought: thought("Tengo que acercarme a la mesa.", "warning") });
        const rotation = to.rotation ?? 0;
        const fits = canPlaceOnSurface(ctx.state, ctx.index, to.surfaceId, item.itemTypeId, to.x, to.y, rotation, dims, item.id);
        if (!fits) return no({ code: "no_space", thought: thought("No entra ahí.", "warning") });
      } else if (to.type === "inventory") {
        const rotation = to.rotation ?? 0;
        const fits = canPlaceInInventory(ctx.state, ctx.index, item.itemTypeId, to.x, to.y, rotation, item.id);
        if (!fits) return no({ code: "no_space", thought: thought("No entra ahí.", "warning") });
      } else if (to.type === "hand") {
        const fits = handEquipFits(ctx.state, ctx.index, item.itemTypeId, to.hand, item.id);
        if (!fits) return no({ code: "no_space", thought: thought("Ya tengo algo en esa mano.", "warning") });
      }
      emit({ type: "ItemMoved", itemInstanceId: item.id, to: cmd.to });
      const left = item.location.type === "player_inventory" && item.location.x === HAND_LEFT.x && item.location.y === HAND_LEFT.y ? item.id : undefined;
      const right = item.location.type === "player_inventory" && item.location.x === HAND_RIGHT.x && item.location.y === HAND_RIGHT.y ? item.id : undefined;
      if (left || right) emit({ type: "ActiveHandsChanged", ...(left ? { left } : {}), ...(right ? { right } : {}) });
      return ok(events);
    }

    case "TryCombination": {
      const res = tryCombination(ctx, cmd.target as TargetRef, cmd.method);
      return "rejection" in res ? no(res.rejection) : ok(res.events);
    }

    default:
      return no({ code: "not_applicable" });
  }
  })();

  if (result.accepted) reconcilePiles(ctx, before, result.events);
  return result;
}
