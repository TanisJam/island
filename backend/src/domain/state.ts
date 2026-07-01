import type { ItemInstance, Pile, Thought, WorldObject } from "../contract/events";

export type TerrainId = "sand" | "grass" | "shallow_water" | "dense_jungle" | "dirt" | "rocky_ground";
export type Position = { x: number; y: number };

export type RuntimeTile = {
  x: number;
  y: number;
  terrain: TerrainId;
  walkable: boolean;
  tags: string[];
};

export type RuntimePlayer = {
  id: string;
  name: string;
  zoneId: string;
  position: Position;
  energy: number;
  maxEnergy: number;
  health: number;
  maxHealth: number;
  knowledge: string[];
  thoughtLog: Thought[];
};

export type RuntimeZone = {
  id: string;
  ownerPlayerId?: string;
  type: "personal" | "shared" | "wild" | "gremio";
  width: number;
  height: number;
};

/** Estado de juego en runtime. Una `ItemInstance` vive en inventario o mundo según
 *  su `location.type` (`player_inventory` | `world`). */
export type GameState = {
  zone: RuntimeZone;
  tiles: RuntimeTile[]; // índice = y * width + x
  objects: WorldObject[];
  items: ItemInstance[];
  piles: Pile[];
  player: RuntimePlayer;
  discovered: Set<string>; // tiles explorados, clave "x,y"
};

export const VISION_RADIUS = 5;
export const REST_RECOVERY = 30;
/** Minimum number of same-type world items on a tile to form a pile (visual grouping). */
export const MIN_PILE = 2;

export const tileKey = (x: number, y: number): string => `${x},${y}`;

export function tileAt(s: GameState, x: number, y: number): RuntimeTile | undefined {
  if (x < 0 || y < 0 || x >= s.zone.width || y >= s.zone.height) return undefined;
  return s.tiles[y * s.zone.width + x];
}

export const chebyshev = (a: Position, b: Position): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export const euclid = (a: Position, b: Position): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
