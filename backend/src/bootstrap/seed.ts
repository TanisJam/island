import type { ItemInstance, WorldObject } from "../contract/events";
import type { CatalogIndex } from "../domain/catalog";
import type { GameState, RuntimeTile, TerrainId } from "../domain/state";
import { newId } from "../domain/ids";
import { markVisibleAround } from "../domain/visibility";

const W = 16;
const H = 12;

function terrainAt(x: number, y: number): TerrainId {
  if (y === 11 && (x < 2 || x > 13)) return "shallow_water";
  if (y <= 2) return "dense_jungle";
  if (y >= 10) return "sand";
  return "grass";
}

function tagsFor(t: TerrainId): string[] {
  switch (t) {
    case "dense_jungle": return ["blocker", "progression_gate", "plant"];
    case "sand": return ["ground", "searchable"];
    case "shallow_water": return ["water", "wet", "resource"];
    case "dirt": return ["ground", "diggable"];
    case "rocky_ground": return ["ground", "hard"];
    default: return ["ground"];
  }
}

const walkable = (t: TerrainId): boolean => t !== "dense_jungle" && t !== "shallow_water";

/**
 * Mundo inicial del MVP: playa abajo, claro de pasto en el medio, muro de jungla
 * espesa arriba (el bloqueo orgánico), recursos repartidos. Mapa chico (16x12) para
 * el esqueleto; el spec sugiere 32x24.
 */
export function seedState(index: CatalogIndex, playerId = "p1", zoneId = "z1"): GameState {
  const tiles: RuntimeTile[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const terrain = terrainAt(x, y);
      tiles.push({ x, y, terrain, walkable: walkable(terrain), tags: tagsFor(terrain) });
    }
  }

  const obj = (objectTypeId: string, x: number, y: number): WorldObject => {
    const def = index.objectById.get(objectTypeId);
    return { id: newId("wo"), objectTypeId, position: { x, y }, state: { ...(def?.defaultState ?? {}) }, tags: [], visibility: "visible" };
  };

  const objects: WorldObject[] = [
    obj("tree", 3, 4),
    obj("tree", 11, 5),
    obj("tree", 6, 7),
    obj("tall_grass", 4, 6),
    obj("tall_grass", 9, 6),
    obj("tall_grass", 12, 8),
    obj("small_rock", 2, 9),
    obj("wreckage", 10, 10),
  ];

  const looseStone: ItemInstance = {
    id: newId("it"),
    itemTypeId: "small_stone",
    location: { type: "world", zoneId, x: 7, y: 10 },
  };

  const state: GameState = {
    zone: { id: zoneId, ownerPlayerId: playerId, type: "personal", width: W, height: H },
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
  };

  markVisibleAround(state, state.player.position);
  return state;
}
