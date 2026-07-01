import type { GameState, Position } from "./state";
import { euclid, tileKey, VISION_RADIUS } from "./state";

export type Visibility = "unseen" | "explored" | "visible";

/** Visión circular simple sin línea de vista real (MVP, decisión C2). */
export function visibilityOf(s: GameState, pos: Position): Visibility {
  if (euclid(s.player.position, pos) <= VISION_RADIUS) return "visible";
  if (s.discovered.has(tileKey(pos.x, pos.y))) return "explored";
  return "unseen";
}

/** Marca como descubiertos todos los tiles dentro del radio en la posición dada. */
export function markVisibleAround(s: GameState, pos: Position): void {
  const r = VISION_RADIUS;
  for (let y = pos.y - r; y <= pos.y + r; y++)
    for (let x = pos.x - r; x <= pos.x + r; x++)
      if (x >= 0 && y >= 0 && x < s.zone.width && y < s.zone.height && euclid(pos, { x, y }) <= r)
        s.discovered.add(tileKey(x, y));
}
