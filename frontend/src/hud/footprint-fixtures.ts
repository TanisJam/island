/**
 * Shared verdict-fixture table for `footprintValidity` (tasks.md T6, spec R3
 * "Preview-backend verdict parity"). Every case's `expected` verdict IS the
 * backend's rule for an identical (shape, rotation, anchor, occupancy)
 * input, documented against:
 *   - `backend/src/domain/inventory.ts:79-83`  (`fitsOnGrid`)
 *   - `backend/src/domain/inventory.ts:64-71`  (`occupiedSetOnGrid`)
 *   - `backend/src/domain/inventory.ts:149-162` (`handEquipFits`)
 *
 * This is NOT a cross-package import (design.md Decision 2: no shared-code
 * package) — backend tests already cover `fitsOnGrid`/`occupiedSetOnGrid`/
 * `handEquipFits` directly. This module's honesty mechanism is documentation:
 * each case below states, in its `name`, exactly which backend rule it
 * mirrors, so a future change to the backend rule is a prompt to re-check
 * these cases stay in sync — not a guarantee enforced by the type system.
 *
 * `drag.test.ts` (tasks.md T8b) consumes this table by building a
 * `ClientSnapshot`/`Catalog` per case and calling `footprintValidity`.
 */

export interface FootprintOccupant {
  id: string;
  itemTypeId: string;
  x: number;
  y: number;
  rotation: 0 | 90;
}

export interface FootprintDragged {
  id: string;
  itemTypeId: string;
  shape: { w: number; h: number };
}

export interface FootprintCase {
  name: string;
  /**
   * "surface": a generic `grid.width x grid.height` grid — exercises the
   * SAME `fitsOnGrid`/`occupiedSetOnGrid` replica the "inventory" target
   * branch also uses, so a surface-shaped case stands in for both.
   * "hand": the LIVE `snapshot.handSlots.left`/`right` anchor (mirrors the
   * backend's `handEquipFits`, which forces the shape UNROTATED regardless
   * of the dragged item's stored rotation).
   */
  kind: "surface" | "hand";
  /** Grid dimensions for a `"surface"` case; ignored for `"hand"` (the 4x4
   * player inventory grid — `INV_W`/`INV_H` — is implied instead). */
  grid: { width: number; height: number };
  /** Other items already placed on the same grid, participating in the
   * occupied set exactly like the backend's `occupiedSetOnGrid`. */
  occupied: FootprintOccupant[];
  /** The item under drag. */
  dragged: FootprintDragged;
  /** Anchor `footprintValidity` is asked to place `dragged` at. Ignored for
   * a `"hand"` case — the real anchor is `snapshot.handSlots[hand]`. */
  anchor: { x: number; y: number };
  /** Only meaningful for a `"hand"` case. */
  hand?: "left" | "right";
  /** Rotation applied to the dragged item AT the target (mirrors
   * `buildDragOutcome` preserving origin rotation) — forced to unrotated by
   * the "hand" branch itself regardless of this value, same as the backend. */
  rotation: 0 | 90;
  /** The dragged item's own id — its current cells never self-collide
   * (mirrors the backend's `exceptId` convention). */
  exceptId: string;
  expected: "ok" | "bad";
}

export const footprintCases: FootprintCase[] = [
  {
    name: "1x1 into an empty grid fits (mirrors fitsOnGrid: empty occupied set, in-bounds)",
    kind: "surface",
    grid: { width: 4, height: 4 },
    occupied: [],
    dragged: { id: "drag1", itemTypeId: "stone", shape: { w: 1, h: 1 } },
    anchor: { x: 0, y: 0 },
    rotation: 0,
    exceptId: "drag1",
    expected: "ok",
  },
  {
    name: "1x1 onto a cell occupied by a DIFFERENT item is bad (mirrors occupiedSetOnGrid collision)",
    kind: "surface",
    grid: { width: 4, height: 4 },
    occupied: [{ id: "other1", itemTypeId: "stone", x: 1, y: 1, rotation: 0 }],
    dragged: { id: "drag1", itemTypeId: "stone", shape: { w: 1, h: 1 } },
    anchor: { x: 1, y: 1 },
    rotation: 0,
    exceptId: "drag1",
    expected: "bad",
  },
  {
    name: "unrotated 1x2 fits vertically inside the grid (mirrors fitsOnGrid bounds check)",
    kind: "surface",
    grid: { width: 4, height: 4 },
    occupied: [],
    dragged: { id: "drag1", itemTypeId: "pole", shape: { w: 1, h: 2 } },
    anchor: { x: 0, y: 0 },
    rotation: 0,
    exceptId: "drag1",
    expected: "ok",
  },
  {
    name: "unrotated 1x2 overflows the bottom edge (mirrors fitsOnGrid: y+h > gh)",
    kind: "surface",
    grid: { width: 4, height: 4 },
    occupied: [],
    dragged: { id: "drag1", itemTypeId: "pole", shape: { w: 1, h: 2 } },
    anchor: { x: 0, y: 3 },
    rotation: 0,
    exceptId: "drag1",
    expected: "bad",
  },
  {
    name: "rotated 1x2 (now 2x1) fits horizontally inside the grid (mirrors the rotation w/h swap)",
    kind: "surface",
    grid: { width: 4, height: 4 },
    occupied: [],
    dragged: { id: "drag1", itemTypeId: "pole", shape: { w: 1, h: 2 } },
    anchor: { x: 2, y: 0 },
    rotation: 90,
    exceptId: "drag1",
    expected: "ok",
  },
  {
    name: "rotated 1x2 (now 2x1) overflows the right edge (mirrors fitsOnGrid: x+w > gw, post-rotation)",
    kind: "surface",
    grid: { width: 4, height: 4 },
    occupied: [],
    dragged: { id: "drag1", itemTypeId: "pole", shape: { w: 1, h: 2 } },
    anchor: { x: 3, y: 0 },
    rotation: 90,
    exceptId: "drag1",
    expected: "bad",
  },
  {
    name: "dragging an item onto its OWN current cells is ok (mirrors occupiedSetOnGrid's exceptId self-exclusion)",
    kind: "surface",
    grid: { width: 4, height: 4 },
    occupied: [{ id: "drag1", itemTypeId: "pole", x: 1, y: 1, rotation: 0 }],
    dragged: { id: "drag1", itemTypeId: "pole", shape: { w: 1, h: 2 } },
    anchor: { x: 1, y: 1 },
    rotation: 0,
    exceptId: "drag1",
    expected: "ok",
  },
  {
    name:
      "collision with a DIFFERENT multi-cell item's NON-anchor cell is bad " +
      "(the exact case the old anchor-only cellOccupant missed — its 1x2 " +
      "neighbor's second cell (2,1) is occupied, not its anchor (2,0))",
    kind: "surface",
    grid: { width: 4, height: 4 },
    occupied: [{ id: "other1", itemTypeId: "pole", x: 2, y: 0, rotation: 0 }],
    dragged: { id: "drag1", itemTypeId: "stone", shape: { w: 1, h: 1 } },
    anchor: { x: 2, y: 1 },
    rotation: 0,
    exceptId: "drag1",
    expected: "bad",
  },
  {
    name:
      "hand-slot equip reads its anchor from the LIVE snapshot.handSlots, never a hardcoded coordinate " +
      "(mirrors handEquipFits: unrotated shape, hand-slot anchor)",
    kind: "hand",
    grid: { width: 4, height: 4 }, // unused for a hand target
    occupied: [],
    dragged: { id: "drag1", itemTypeId: "stone", shape: { w: 1, h: 1 } },
    anchor: { x: 0, y: 0 }, // unused — the real anchor is snapshot.handSlots.left
    hand: "left",
    rotation: 0,
    exceptId: "drag1",
    expected: "ok",
  },
];
