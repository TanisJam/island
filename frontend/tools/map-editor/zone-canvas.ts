import { lookupRegion, type Atlas, type AtlasKind } from "../../src/render/assets";
import type { ZoneTemplate } from "../../src/contract/zone";

/**
 * Canvas grid renderer for the map editor (design.md Slice 2 —
 * "zone-canvas.ts: grid render via render/assets.ts::parseAtlas/lookupRegion
 * /createSpriteAssets (real sprites, reuse not copy)"). Slice 3 adds
 * user-requested zoom: `setZoom` scales every rendered cell and `cellPx()`
 * exposes the CURRENT effective cell size in on-screen px so `main.ts` can
 * convert a click's canvas-local pixel coordinates into a tile `(x, y)` that
 * stays correct at every zoom level (no separate "de-zoom" step needed on
 * the caller's side — `main.ts` always asks this module for the live
 * `cellPx()` instead of hard-coding one).
 *
 * Deliberately its own small render loop rather than importing
 * `src/render/canvas.ts` — that module is wired to the game's `Frame`/
 * `Renderer`/camera types, none of which a static top-down editor grid
 * needs (same "no shared renderer extraction" precedent as
 * `texture-panel.ts`'s picker canvas).
 */

/** Editor-local BASE tile size in on-screen px, before zoom — independent
 * of the game's `render/canvas.ts::PX` (48px, camera-scaled). A flat
 * top-down editor grid has no camera, so it picks its own comfortable base
 * size instead of reusing the game's. */
export const TILE_PX = 16;

/** Zoom multipliers offered in the toolbar's `<select>` (mirrors
 * `texture-panel.ts::ZOOM_LEVELS`'s shape, own value set for this tool). */
export const ZOOM_LEVELS = [1, 2, 3, 4, 6] as const;

/** `2x` reproduces the exact `CELL_PX = 32` the read-only Slice 2 render
 * used, so the default view is visually unchanged by this slice. */
export const DEFAULT_ZOOM = 2;

const FALLBACK_TERRAIN_COLOR = "#444";

export interface ZoneCanvasHandle {
  render(template: ZoneTemplate, atlas: Atlas, tilesetImage: CanvasImageSource): void;
  /** Changes the zoom multiplier and, if a template was already rendered,
   * immediately redraws it at the new size. */
  setZoom(zoom: number): void;
  /** The CURRENT effective on-screen px size of one grid cell
   * (`TILE_PX * zoom`) — the single source of truth `main.ts` uses for
   * pixel-to-tile picking, so painting stays correct at every zoom level. */
  cellPx(): number;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellPx: number,
  kind: AtlasKind,
  typeId: string,
  atlas: Atlas,
  tilesetImage: CanvasImageSource,
): void {
  const dx = x * cellPx;
  const dy = y * cellPx;
  const region = lookupRegion(atlas, kind, typeId);
  if (region) {
    ctx.drawImage(tilesetImage, region.x, region.y, region.w, region.h, dx, dy, cellPx, cellPx);
    return;
  }
  // No atlas entry for this typeId (matches `createEmojiAssets`'s fallback
  // intent, spec "Non-Goals" excludes editor glyph fallback art — a flat
  // fill is enough to spot an unmapped terrain while editing). Objects with
  // no sprite simply do not draw a cell background — they stay visible only
  // as an empty gap over their terrain.
  if (kind === "terrain") {
    ctx.fillStyle = FALLBACK_TERRAIN_COLOR;
    ctx.fillRect(dx, dy, cellPx, cellPx);
  }
}

export function createZoneCanvas(canvasEl: HTMLCanvasElement): ZoneCanvasHandle {
  const ctx = canvasEl.getContext("2d");
  if (!ctx) throw new Error("zone-canvas: 2d context unavailable");
  // Re-bound to a non-null-typed const: TS control-flow narrowing from the
  // guard above does not persist into the nested closures below (the
  // captured `ctx` widens back to `CanvasRenderingContext2D | null` inside a
  // nested function), so this local re-binding carries the narrowed type in.
  const ctx2d: CanvasRenderingContext2D = ctx;

  let zoom = DEFAULT_ZOOM;
  let lastArgs: { template: ZoneTemplate; atlas: Atlas; tilesetImage: CanvasImageSource } | null = null;

  function cellPx(): number {
    return TILE_PX * zoom;
  }

  function draw(template: ZoneTemplate, atlas: Atlas, tilesetImage: CanvasImageSource): void {
    const cell = cellPx();
    canvasEl.width = template.width * cell;
    canvasEl.height = template.height * cell;
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.clearRect(0, 0, canvasEl.width, canvasEl.height);

    for (let y = 0; y < template.height; y++) {
      for (let x = 0; x < template.width; x++) {
        const terrainId = template.tiles[y * template.width + x] ?? "";
        drawCell(ctx2d, x, y, cell, "terrain", terrainId, atlas, tilesetImage);
      }
    }
    for (const object of template.objects) {
      drawCell(ctx2d, object.x, object.y, cell, "object", object.objectTypeId, atlas, tilesetImage);
    }
  }

  function render(template: ZoneTemplate, atlas: Atlas, tilesetImage: CanvasImageSource): void {
    lastArgs = { template, atlas, tilesetImage };
    draw(template, atlas, tilesetImage);
  }

  function setZoom(nextZoom: number): void {
    zoom = nextZoom;
    if (lastArgs) draw(lastArgs.template, lastArgs.atlas, lastArgs.tilesetImage);
  }

  return { render, setZoom, cellPx };
}
