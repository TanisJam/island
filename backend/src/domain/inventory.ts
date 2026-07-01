import type { ItemInstance } from "../contract/events";
import type { CatalogIndex } from "./catalog";
import type { GameState, Position } from "./state";

export const INV_W = 4;
export const INV_H = 4;
export const HAND_LEFT: Position = { x: 0, y: 0 };
export const HAND_RIGHT: Position = { x: 3, y: 0 };

type InvLoc = { type: "player_inventory"; playerId: string; x: number; y: number; rotation: number };

export function invLoc(it: ItemInstance): InvLoc | null {
  return it.location.type === "player_inventory" ? (it.location as InvLoc) : null;
}
export const isInInventory = (it: ItemInstance): boolean => it.location.type === "player_inventory";
export const isInWorld = (it: ItemInstance): boolean => it.location.type === "world";

export const inventoryItems = (s: GameState): ItemInstance[] => s.items.filter(isInInventory);
export const worldItems = (s: GameState): ItemInstance[] => s.items.filter(isInWorld);

/** Celdas que ocupa un item de inventario según su forma y rotación (B3). */
export function occupiedCells(it: ItemInstance, index: CatalogIndex): Position[] {
  const loc = invLoc(it);
  if (!loc) return [];
  const def = index.itemById.get(it.itemTypeId);
  const w0 = def?.shape.w ?? 1;
  const h0 = def?.shape.h ?? 1;
  const [w, h] = loc.rotation === 90 ? [h0, w0] : [w0, h0];
  const cells: Position[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: loc.x + dx, y: loc.y + dy });
  return cells;
}

const covers = (cells: Position[], slot: Position): boolean => cells.some((c) => c.x === slot.x && c.y === slot.y);

/** Items activos: los que ocupan/tocan un slot de mano (0,0) o (3,0). */
export function handItems(s: GameState, index: CatalogIndex): { left?: ItemInstance; right?: ItemInstance; active: ItemInstance[] } {
  let left: ItemInstance | undefined;
  let right: ItemInstance | undefined;
  for (const it of inventoryItems(s)) {
    const cells = occupiedCells(it, index);
    if (covers(cells, HAND_LEFT)) left = it;
    if (covers(cells, HAND_RIGHT)) right = it;
  }
  const active = [left, right].filter((x): x is ItemInstance => !!x);
  return { left, right, active };
}

function occupiedSet(s: GameState, index: CatalogIndex, exceptId?: string): Set<string> {
  const set = new Set<string>();
  for (const it of inventoryItems(s)) {
    if (it.id === exceptId) continue;
    for (const c of occupiedCells(it, index)) set.add(`${c.x},${c.y}`);
  }
  return set;
}

function fits(set: Set<string>, x: number, y: number, w: number, h: number): boolean {
  if (x < 0 || y < 0 || x + w > INV_W || y + h > INV_H) return false;
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (set.has(`${x + dx},${y + dy}`)) return false;
  return true;
}

/** Si una forma colocada en (x,y) ocuparía un slot de mano. */
function coversHand(x: number, y: number, w: number, h: number): boolean {
  for (const slot of [HAND_LEFT, HAND_RIGHT])
    if (slot.x >= x && slot.x < x + w && slot.y >= y && slot.y < y + h) return true;
  return false;
}

/** Busca el primer hueco donde entra la forma (read-only). Devuelve la location de
 *  inventario o null si no hay espacio. Prueba rotación si el item es rotable.
 *  PREFIERE slots que NO sean de mano: el auto-acomodo (recoger / craftear) va a la
 *  mochila y deja las manos libres para equipar a propósito. Fallback: cualquier slot. */
export function findFreeInventorySlot(
  s: GameState,
  index: CatalogIndex,
  itemTypeId: string,
  playerId: string,
): InvLoc | null {
  const def = index.itemById.get(itemTypeId);
  const w = def?.shape.w ?? 1;
  const h = def?.shape.h ?? 1;
  const set = occupiedSet(s, index);
  const tries: Array<{ w: number; h: number; rot: number }> = [{ w, h, rot: 0 }];
  if (def?.rotatable && w !== h) tries.push({ w: h, h: w, rot: 90 });
  for (const avoidHands of [true, false])
    for (const t of tries)
      for (let y = 0; y < INV_H; y++)
        for (let x = 0; x < INV_W; x++)
          if (fits(set, x, y, t.w, t.h) && (!avoidHands || !coversHand(x, y, t.w, t.h)))
            return { type: "player_inventory", playerId, x, y, rotation: t.rot };
  return null;
}
