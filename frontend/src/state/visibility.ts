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
  return visibilityFrom(snapshot, snapshot.player.position, pos);
}

/**
 * Same as `visibilityOf` but takes an explicit `from` position instead of
 * always reading `snapshot.player.position`. Lets the presentation layer
 * (`view/viewstate.ts`) compute the "visible" ring from the avatar's CURRENT
 * interpolated tile while a movement tween is in flight, instead of snapping
 * to the move's destination the instant the authoritative position updates
 * (fix: "vision field must follow the moving avatar, not jump to the
 * destination"). `discovered` is still read from the authoritative snapshot —
 * only the live "visible" radius check is parameterized.
 */
export function visibilityFrom(snapshot: ClientSnapshot, from: Position, pos: Position): Visibility {
  if (euclid(from, pos) <= snapshot.visionRadius) return "visible";
  if (snapshot.discovered.has(tileKey(pos.x, pos.y))) return "explored";
  return "unseen";
}

/** Invokes `cb` for each tile key within the zone's vision radius of `pos`
 * (clamped to zone bounds, euclidean radius). Shared by the authoritative
 * discovery mirror (markVisibleAround) and the viewstate's presentation-only
 * progressive-reveal set. */
export function forEachTileInVision(snapshot: ClientSnapshot, pos: Position, cb: (key: string) => void): void {
  const r = snapshot.visionRadius;
  const { width, height } = snapshot.zone;
  for (let y = pos.y - r; y <= pos.y + r; y++) {
    for (let x = pos.x - r; x <= pos.x + r; x++) {
      if (x >= 0 && y >= 0 && x < width && y < height && euclid(pos, { x, y }) <= r) cb(tileKey(x, y));
    }
  }
}

/**
 * Marks every tile within the zone's vision radius of `pos` as discovered. Mirrors
 * backend `markVisibleAround`. Called whenever the player's position changes (on
 * `PlayerMoved`) so the client's `discovered` set tracks the backend's.
 */
export function markVisibleAround(snapshot: ClientSnapshot, pos: Position): void {
  forEachTileInVision(snapshot, pos, (k) => snapshot.discovered.add(k));
}
