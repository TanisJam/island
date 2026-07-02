/**
 * Pure pixel<->grid math shared by the dev tools' picking canvases
 * (originally `atlas-editor/picking.ts`; extracted so items-editor's
 * texture panel can reuse the same footprint math). No DOM here — each
 * tool's `main.ts`/controller is the only place that reads mouse events
 * and calls into this module.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Given a drag's start/end points (in *image-pixel* space — already
 * de-zoomed by the caller) and the picking grid size, returns the smallest
 * grid-aligned rectangle that contains both points. A click (start === end,
 * or a drag that never crossed a cell boundary) degenerates to a single
 * `gridSize x gridSize` cell — no special-casing needed, same formula
 * covers both (spec "Single-cell assignment" / "Multi-cell contiguous
 * footprint assignment").
 */
export function footprintFromDrag(start: Point, end: Point, gridSize: number): Footprint {
  const toCell = (v: number) => Math.floor(v / gridSize);
  const startCellX = toCell(start.x);
  const startCellY = toCell(start.y);
  const endCellX = toCell(end.x);
  const endCellY = toCell(end.y);
  const minCellX = Math.min(startCellX, endCellX);
  const minCellY = Math.min(startCellY, endCellY);
  const maxCellX = Math.max(startCellX, endCellX);
  const maxCellY = Math.max(startCellY, endCellY);
  return {
    x: minCellX * gridSize,
    y: minCellY * gridSize,
    w: (maxCellX - minCellX + 1) * gridSize,
    h: (maxCellY - minCellY + 1) * gridSize,
  };
}

/**
 * True once a pointer has moved far enough from its mousedown origin to be
 * treated as a drag rather than a click (ui-ux-pro-max `drag-threshold`).
 * Distance is measured in *screen* px (pre-de-zoom), so the threshold feels
 * consistent regardless of the current picking-canvas zoom level.
 */
export function pastDragThreshold(start: Point, current: Point, thresholdPx = 4): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy > thresholdPx * thresholdPx;
}
