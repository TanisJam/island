import type { EngineCtx } from "./engine";
import type { Event, ItemInstance, Pile } from "../contract/events";
import type { GameState, Position } from "./state";
import { MIN_PILE } from "./state";
import { applyEvent } from "./reducer";

/**
 * Piles are a purely DERIVED, visual grouping (MVP decision B4): a pile is >= MIN_PILE
 * world items of the SAME type sharing a tile. The items keep `location: "world"` — the
 * pile owns nothing and has no persistent logic of its own. The pile id is deterministic
 * in (zone, position, itemType) so a `PileChanged` event upserts cleanly as the group
 * grows, and a `PileChanged` carrying fewer than MIN_PILE members dissolves it (there is
 * no `PileRemoved` event in the contract, and none is needed).
 */
export function pileId(zoneId: string, pos: Position, itemTypeId: string): string {
  return `pile_${zoneId}_${pos.x}_${pos.y}_${itemTypeId}`;
}

/** Every pile currently implied by the world items in `state` (groups of >= MIN_PILE
 *  same-type items on one tile), keyed by deterministic pile id. */
export function derivePiles(state: GameState): Map<string, Pile> {
  const groups = new Map<string, ItemInstance[]>();
  for (const it of state.items) {
    if (it.location.type !== "world") continue;
    const key = `${it.location.x},${it.location.y},${it.itemTypeId}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(it);
    else groups.set(key, [it]);
  }
  const piles = new Map<string, Pile>();
  for (const items of groups.values()) {
    const first = items[0];
    if (items.length < MIN_PILE || !first) continue;
    const loc = first.location as { x: number; y: number };
    const position = { x: loc.x, y: loc.y };
    const { itemTypeId } = first;
    const id = pileId(state.zone.id, position, itemTypeId);
    piles.set(id, { id, itemTypeId, zoneId: state.zone.id, position, itemInstanceIds: items.map((i) => i.id) });
  }
  return piles;
}

const sameMembers = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Compares the piles a command implied before vs. after its world-item events and emits
 * a `PileChanged` for every pile that formed, grew, shrank, or dissolved. A dissolved
 * pile emits with its remaining (< MIN_PILE) members so the reducer drops it. Emitted
 * events are appended to `events` and applied to state, mirroring the engine's `emit`.
 */
export function reconcilePiles(ctx: EngineCtx, before: Map<string, Pile>, events: Event[]): void {
  const emit = (e: Event): void => {
    events.push(e);
    applyEvent(ctx.state, ctx.index, e);
  };
  const after = derivePiles(ctx.state);

  for (const [id, pile] of after) {
    const prev = before.get(id);
    if (!prev || !sameMembers(prev.itemInstanceIds, pile.itemInstanceIds)) emit({ type: "PileChanged", pile });
  }
  for (const [id, prev] of before) {
    if (after.has(id)) continue;
    const remaining = ctx.state.items
      .filter(
        (i) =>
          i.location.type === "world" &&
          i.itemTypeId === prev.itemTypeId &&
          i.location.x === prev.position.x &&
          i.location.y === prev.position.y,
      )
      .map((i) => i.id);
    emit({ type: "PileChanged", pile: { ...prev, itemInstanceIds: remaining } });
  }
}
