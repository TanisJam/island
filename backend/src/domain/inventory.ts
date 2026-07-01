import type { ItemInstance } from "../contract/events";
import type { CatalogIndex } from "./catalog";
import type { GameState, Position } from "./state";

export const INV_W = 4;
export const INV_H = 4;
export const HAND_LEFT: Position = { x: 0, y: 0 };
export const HAND_RIGHT: Position = { x: 3, y: 0 };

type InvLoc = { type: "player_inventory"; playerId: string; x: number; y: number; rotation: number };
type GridCell = { x: number; y: number; rotation: number };

export function invLoc(it: ItemInstance): InvLoc | null {
  return it.location.type === "player_inventory" ? (it.location as InvLoc) : null;
}
export const isInInventory = (it: ItemInstance): boolean => it.location.type === "player_inventory";
export const isInWorld = (it: ItemInstance): boolean => it.location.type === "world";

export const inventoryItems = (s: GameState): ItemInstance[] => s.items.filter(isInInventory);
export const worldItems = (s: GameState): ItemInstance[] => s.items.filter(isInWorld);

/** Selector de celda del inventario del jugador (grilla `player_inventory`). */
const playerCell = (it: ItemInstance): GridCell | null => {
  const loc = invLoc(it);
  return loc ? { x: loc.x, y: loc.y, rotation: loc.rotation } : null;
};

/** Celdas que ocupa un item en CUALQUIER grilla, dado un selector de celda para esa
 *  grilla (`cellOf`). Generaliza el cálculo de forma/rotación compartido por el
 *  inventario del jugador y cualquier superficie (mesa). */
export function cellsOnGrid(it: ItemInstance, index: CatalogIndex, cellOf: (it: ItemInstance) => GridCell | null): Position[] {
  const loc = cellOf(it);
  if (!loc) return [];
  const def = index.itemById.get(it.itemTypeId);
  const w0 = def?.shape.w ?? 1;
  const h0 = def?.shape.h ?? 1;
  const [w, h] = loc.rotation === 90 ? [h0, w0] : [w0, h0];
  const cells: Position[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: loc.x + dx, y: loc.y + dy });
  return cells;
}

/** Celdas que ocupa un item de inventario según su forma y rotación (B3). */
export function occupiedCells(it: ItemInstance, index: CatalogIndex): Position[] {
  return cellsOnGrid(it, index, playerCell);
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

/** Set de celdas ocupadas ("x,y") por un grupo de items en una grilla arbitraria. */
export function occupiedSetOnGrid(items: ItemInstance[], index: CatalogIndex, cellOf: (it: ItemInstance) => GridCell | null, exceptId?: string): Set<string> {
  const set = new Set<string>();
  for (const it of items) {
    if (it.id === exceptId) continue;
    for (const c of cellsOnGrid(it, index, cellOf)) set.add(`${c.x},${c.y}`);
  }
  return set;
}

function occupiedSet(s: GameState, index: CatalogIndex, exceptId?: string): Set<string> {
  return occupiedSetOnGrid(inventoryItems(s), index, playerCell, exceptId);
}

/** Verifica si una forma `w x h` en `(x,y)` entra dentro de una grilla `gw x gh` sin
 *  colisionar con `set` (celdas ya ocupadas). */
export function fitsOnGrid(set: Set<string>, x: number, y: number, w: number, h: number, gw: number, gh: number): boolean {
  if (x < 0 || y < 0 || x + w > gw || y + h > gh) return false;
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (set.has(`${x + dx},${y + dy}`)) return false;
  return true;
}

function fits(set: Set<string>, x: number, y: number, w: number, h: number): boolean {
  return fitsOnGrid(set, x, y, w, h, INV_W, INV_H);
}

/** Selector de celda para una superficie dada (grilla `surface` de un world object). */
export const surfaceCell = (surfaceId: string) => (it: ItemInstance): GridCell | null => {
  const loc = it.location;
  return loc.type === "surface" && loc.surfaceId === surfaceId ? { x: loc.x, y: loc.y, rotation: loc.rotation } : null;
};

/** Items realmente colocados en la grilla de una superficie dada. */
export const surfaceItems = (s: GameState, surfaceId: string): ItemInstance[] =>
  s.items.filter((i) => i.location.type === "surface" && i.location.surfaceId === surfaceId);

/** Determina si un item con forma `dims` (rotada según `rotation`) puede colocarse en
 *  `(x,y)` de la superficie `surfaceId` sin salirse de sus dimensiones ni solapar con
 *  otro item ya colocado (salvo `exceptId`, para permitir mover un item dentro de su
 *  propia superficie). */
export function canPlaceOnSurface(
  s: GameState,
  index: CatalogIndex,
  surfaceId: string,
  itemTypeId: string,
  x: number,
  y: number,
  rotation: number,
  dims: { width: number; height: number },
  exceptId?: string,
): boolean {
  const def = index.itemById.get(itemTypeId);
  const w0 = def?.shape.w ?? 1;
  const h0 = def?.shape.h ?? 1;
  const [w, h] = rotation === 90 ? [h0, w0] : [w0, h0];
  const set = occupiedSetOnGrid(surfaceItems(s, surfaceId), index, surfaceCell(surfaceId), exceptId);
  return fitsOnGrid(set, x, y, w, h, dims.width, dims.height);
}

/** Determina si un item con forma `itemTypeId` (rotado según `rotation`) puede
 *  colocarse en `(x,y)` del inventario del jugador sin salirse de la grilla 4x4 ni
 *  solapar con otro item ya presente (salvo `exceptId`, para permitir mover un item
 *  dentro de su propio footprint). Espejo de `canPlaceOnSurface` para la grilla del
 *  jugador. */
export function canPlaceInInventory(
  s: GameState,
  index: CatalogIndex,
  itemTypeId: string,
  x: number,
  y: number,
  rotation: number,
  exceptId?: string,
): boolean {
  const def = index.itemById.get(itemTypeId);
  const w0 = def?.shape.w ?? 1;
  const h0 = def?.shape.h ?? 1;
  const [w, h] = rotation === 90 ? [h0, w0] : [w0, h0];
  const set = occupiedSetOnGrid(inventoryItems(s), index, playerCell, exceptId);
  return fitsOnGrid(set, x, y, w, h, INV_W, INV_H);
}

/** Determina si un item con forma `itemTypeId` (SIN rotar — un equipamiento en mano
 *  siempre ancla la forma sin rotación) entra en el slot de mano `hand` sin solapar
 *  con otro item que ya ocupe alguna de sus celdas (salvo `exceptId`). Valida el
 *  footprint completo, no solo la celda ancla, porque un item 1x2 equipado en una
 *  mano ocupa dos celdas. */
export function handEquipFits(
  s: GameState,
  index: CatalogIndex,
  itemTypeId: string,
  hand: "left" | "right",
  exceptId?: string,
): boolean {
  const slot = hand === "left" ? HAND_LEFT : HAND_RIGHT;
  const def = index.itemById.get(itemTypeId);
  const w = def?.shape.w ?? 1;
  const h = def?.shape.h ?? 1;
  const set = occupiedSetOnGrid(inventoryItems(s), index, playerCell, exceptId);
  return fitsOnGrid(set, slot.x, slot.y, w, h, INV_W, INV_H);
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
