import type { GameState, Position } from "./state";
import { tileAt } from "./state";

const KEY = (x: number, y: number) => `${x},${y}`;
const NEIGHBORS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/** Blocked si el tile no es caminable o si hay un WorldObject que bloquea movimiento. */
function blocked(s: GameState, x: number, y: number, blockingObjectTiles: Set<string>): boolean {
  const tile = tileAt(s, x, y);
  if (!tile || !tile.walkable) return true;
  return blockingObjectTiles.has(KEY(x, y));
}

/** BFS sobre tiles caminables (movimiento por tile, 4 direcciones — decisión B5).
 *  Devuelve el camino SIN incluir el origen, o null si no hay ruta. */
export function findPath(
  s: GameState,
  from: Position,
  to: Position,
  blockingObjectTiles: Set<string>,
): Position[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (blocked(s, to.x, to.y, blockingObjectTiles)) return null;

  const start = KEY(from.x, from.y);
  const goal = KEY(to.x, to.y);
  const prev = new Map<string, string | null>([[start, null]]);
  const queue: Position[] = [from];

  while (queue.length) {
    const cur = queue.shift()!;
    if (KEY(cur.x, cur.y) === goal) break;
    for (const n of NEIGHBORS) {
      const nx = cur.x + n.dx;
      const ny = cur.y + n.dy;
      const key = KEY(nx, ny);
      if (prev.has(key)) continue;
      if (blocked(s, nx, ny, blockingObjectTiles)) continue;
      prev.set(key, KEY(cur.x, cur.y));
      queue.push({ x: nx, y: ny });
    }
  }

  if (!prev.has(goal)) return null;
  const path: Position[] = [];
  let node: string | null = goal;
  while (node && node !== start) {
    const [x, y] = node.split(",").map(Number);
    path.unshift({ x: x!, y: y! });
    node = prev.get(node) ?? null;
  }
  return path;
}
