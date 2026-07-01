import type { Catalog, CommandEnvelope, CommandResult, ItemInstance, Pile, Position, Thought, Tile, WorldObject } from "../contract";

const BASE_URL = "http://localhost:3000";

/** Shape returned by backend `GameService.zoneSnapshot` (GET /zones/:zoneId). */
export type ZoneSnapshotResponse = {
  zone: { id: string; ownerPlayerId?: string; type: "personal" | "shared" | "wild" | "gremio"; width: number; height: number };
  visionRadius: number;
  tiles: Tile[];
  objects: WorldObject[];
  piles: Pile[];
  worldItems: ItemInstance[];
  catalogVersion: string;
};

/** Shape returned by backend `GameService.playerState` (GET /players/:playerId/state). */
export type PlayerStateResponse = {
  player: {
    id: string;
    name: string;
    currentZoneId: string;
    position: Position;
    stats: { health: number; maxHealth: number; energy: number; maxEnergy: number };
  };
  inventory: {
    id: string;
    ownerType: "player";
    ownerId: string;
    width: number;
    height: number;
    handSlots: { left: Position; right: Position };
  };
  items: ItemInstance[];
  knowledge: string[];
  thoughtLog: Thought[];
};

let cachedCatalog: Catalog | null = null;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/**
 * Fetches the catalog. Caches by `catalogVersion`: if the server responds with the
 * same version as the cached copy, the previously cached object reference is reused
 * instead of being replaced (frontend-client-state spec, "Catalog cache hit" scenario).
 */
export async function fetchCatalog(): Promise<Catalog> {
  const data = await getJson<Catalog>("/catalog");
  if (cachedCatalog && cachedCatalog.catalogVersion === data.catalogVersion) return cachedCatalog;
  cachedCatalog = data;
  return cachedCatalog;
}

export function fetchZone(zoneId: string): Promise<ZoneSnapshotResponse> {
  return getJson<ZoneSnapshotResponse>(`/zones/${zoneId}`);
}

export function fetchPlayerState(playerId: string): Promise<PlayerStateResponse> {
  return getJson<PlayerStateResponse>(`/players/${playerId}/state`);
}

/** No client-side prediction: the caller applies `result.events` via
 * `applyClientEvent` only after this round trip resolves. */
export async function postCommand(env: CommandEnvelope): Promise<CommandResult> {
  const res = await fetch(`${BASE_URL}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(env),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`POST /commands rejected by transport: ${res.status} ${JSON.stringify(body)}`);
  }
  return (await res.json()) as CommandResult;
}
