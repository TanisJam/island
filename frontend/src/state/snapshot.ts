import type { ItemInstance, Pile, Position, Thought, Tile, WorldObject } from "../contract";
import type { PlayerStateResponse, ZoneSnapshotResponse } from "../net/api";
import { tileKey } from "./visibility";

/**
 * Unified client-side game state. Mirrors backend `GameState` (state.ts) closely
 * enough that `applyClientEvent` can reuse the same per-event logic, but it merges
 * world items and inventory items into ONE `items` array (mirroring the backend's
 * `GameState.items`) so every item event case is 1:1 instead of needing to decide
 * which of two arrays to touch.
 */
export type ClientSnapshot = {
  zone: { id: string; width: number; height: number };
  visionRadius: number; // tile radius the player can see — sourced from the backend zone snapshot, never hardcoded
  tiles: Tile[];
  objects: WorldObject[];
  piles: Pile[];
  items: ItemInstance[]; // world items (location.type === "world") + surface items (location.type === "surface") + inventory items (location.type === "player_inventory")
  player: {
    id: string;
    name: string;
    position: Position;
    energy: number;
    maxEnergy: number;
    health: number;
    maxHealth: number;
    knowledge: string[];
  };
  handSlots: { left: Position; right: Position }; // sourced from playerState.inventory.handSlots — never hardcoded
  thoughtLog: Thought[];
  discovered: Set<string>; // tile keys ("x,y") the player has ever seen — mirrors backend GameState.discovered
  catalogVersion: string;
};

/** Builds the single `ClientSnapshot` the client renders from, by merging the three
 * boot responses (`GET /catalog` is read separately and kept on its own — only its
 * `catalogVersion` is threaded through here for cache-sanity checks). */
export function buildSnapshot(zone: ZoneSnapshotResponse, player: PlayerStateResponse): ClientSnapshot {
  const discovered = new Set<string>();
  for (const t of zone.tiles) if (t.visibility !== "unseen") discovered.add(tileKey(t.x, t.y));

  return {
    zone: { id: zone.zone.id, width: zone.zone.width, height: zone.zone.height },
    visionRadius: zone.visionRadius,
    tiles: zone.tiles,
    objects: zone.objects,
    piles: zone.piles,
    items: [...zone.worldItems, ...zone.surfaceItems, ...player.items],
    player: {
      id: player.player.id,
      name: player.player.name,
      position: player.player.position,
      energy: player.player.stats.energy,
      maxEnergy: player.player.stats.maxEnergy,
      health: player.player.stats.health,
      maxHealth: player.player.stats.maxHealth,
      knowledge: player.knowledge,
    },
    handSlots: player.inventory.handSlots,
    thoughtLog: player.thoughtLog,
    discovered,
    catalogVersion: zone.catalogVersion,
  };
}
