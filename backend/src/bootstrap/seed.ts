import type { ItemInstance, WorldObject } from "../contract/events";
import type { ZoneTemplate } from "../contract/zone";
import type { CatalogIndex } from "../domain/catalog";
import type { GameState, RuntimeTile } from "../domain/state";
import { newId } from "../domain/ids";
import { derivePiles } from "../domain/piles";
import { rebuildInventories } from "../domain/state";
import { markVisibleAround } from "../domain/visibility";

/**
 * Compone el GameState inicial a partir de una `ZoneTemplate` (placement data
 * cargada por `loadZone`, ver `infrastructure/zone/loader.ts`). Tags/walkable de
 * cada terreno se resuelven contra el catálogo (`index.terrainById`) — nunca se
 * duplican acá, así el catálogo queda como única fuente de verdad. Spawn del
 * jugador y el ítem suelto siguen hardcodeados (fuera del template por ahora).
 */
export function seedState(index: CatalogIndex, template: ZoneTemplate, playerId = "p1", zoneId = "z1"): GameState {
  const { width, height, tiles: terrainIds, objects: placements } = template;
  if (terrainIds.length !== width * height) {
    throw new Error(`Zona '${zoneId}': tiles.length (${terrainIds.length}) !== width*height (${width * height})`);
  }

  const tiles: RuntimeTile[] = terrainIds.map((terrain, i) => {
    const def = index.terrainById.get(terrain);
    if (!def) throw new Error(`Zona '${zoneId}': terrainId desconocido '${terrain}' — no existe en el catálogo`);
    return { x: i % width, y: Math.floor(i / width), terrain, walkable: def.walkable, tags: def.tags };
  });

  const obj = (objectTypeId: string, x: number, y: number, stateOverride?: Record<string, unknown>): WorldObject => {
    const def = index.objectById.get(objectTypeId);
    return {
      id: newId("wo"),
      objectTypeId,
      position: { x, y },
      state: { ...(def?.defaultState ?? {}), ...(stateOverride ?? {}) },
      tags: [],
      visibility: "visible",
    };
  };

  // Object placements come entirely from the template now. `rustic_table` at
  // (8,8) — adjacent to the player's spawn tile (8,9) — is part of
  // `zones/zone-z1.json` so R7's "interact with a table" (crafting-surface
  // change) stays reachable end-to-end from the very first tick.
  const objects: WorldObject[] = placements.map((p) =>
    obj(p.objectTypeId, p.x, p.y, p.state as Record<string, unknown> | undefined),
  );

  const looseStone: ItemInstance = {
    id: newId("it"),
    itemTypeId: "small_stone",
    location: { type: "world", zoneId, x: 7, y: 10 },
  };

  const state: GameState = {
    zone: { id: zoneId, ownerPlayerId: playerId, type: "personal", width, height },
    tiles,
    objects,
    items: [looseStone],
    piles: [],
    player: {
      id: playerId,
      name: "Náufrago",
      zoneId,
      position: { x: 8, y: 9 },
      energy: 100,
      maxEnergy: 100,
      health: 100,
      maxHealth: 100,
      knowledge: [],
      thoughtLog: [{ id: newId("th"), text: "No reconozco esta costa.", kind: "memory", timestamp: 0 }],
    },
    discovered: new Set<string>(),
    inventories: {},
    combinationAttempts: {},
  };

  markVisibleAround(state, state.player.position);
  // Derive piles from any co-located same-type world items so the initial state is
  // consistent even if seed content ever places >= MIN_PILE such items on one tile.
  state.piles = [...derivePiles(state).values()];
  rebuildInventories(state, index);
  return state;
}
