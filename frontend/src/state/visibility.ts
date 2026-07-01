import type { Position } from "../contract";
import type { ClientSnapshot } from "./snapshot";

export type Visibility = "unseen" | "explored" | "visible";

export const tileKey = (x: number, y: number): string => `${x},${y}`;

export const euclid = (a: Position, b: Position): number => Math.hypot(a.x - b.x, a.y - b.y);

export const chebyshev = (a: Position, b: Position): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Re-derives a tile's visibility from the player's CURRENT position plus the
 * `discovered` set. Mirrors backend/src/domain/visibility.ts `visibilityOf`.
 *
 * LOAD-BEARING: the backend's per-tile `Tile.visibility` field returned by
 * `GET /zones/:id` (and by `TilesRevealed`/initial boot) is only a point-in-time
 * snapshot — it goes stale the instant the player moves, because the backend's
 * own visibility is DERIVED at read time from live player position, not stored.
 * Callers MUST call this function when rendering instead of trusting
 * `tile.visibility` directly, or the map will appear frozen after the first move.
 */
export function visibilityOf(snapshot: ClientSnapshot, pos: Position): Visibility {
  if (euclid(snapshot.player.position, pos) <= snapshot.visionRadius) return "visible";
  if (snapshot.discovered.has(tileKey(pos.x, pos.y))) return "explored";
  return "unseen";
}

/**
 * Marks every tile within the zone's vision radius of `pos` as discovered. Mirrors
 * backend `markVisibleAround`. Called whenever the player's position changes (on
 * `PlayerMoved`) so the client's `discovered` set tracks the backend's.
 */
export function markVisibleAround(snapshot: ClientSnapshot, pos: Position): void {
  const r = snapshot.visionRadius;
  const { width, height } = snapshot.zone;
  for (let y = pos.y - r; y <= pos.y + r; y++) {
    for (let x = pos.x - r; x <= pos.x + r; x++) {
      if (x >= 0 && y >= 0 && x < width && y < height && euclid(pos, { x, y }) <= r) {
        snapshot.discovered.add(tileKey(x, y));
      }
    }
  }
}
