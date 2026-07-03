import { lookupRegion, type Atlas, type AtlasKind } from "../../src/render/assets";
import type { ZoneTemplate } from "../../src/contract/zone";

/**
 * Canvas grid renderer for the map editor (design.md Slice 2 —
 * "zone-canvas.ts: grid render via render/assets.ts::parseAtlas/lookupRegion
 * /createSpriteAssets (real sprites, reuse not copy)"). READ-ONLY this
 * slice: `render()` draws the given `ZoneTemplate` tile-by-tile plus its
 * placed objects using REAL atlas sprites — no mouse wiring, no paint/place
 * interaction (Slice 3 adds that on top of `zone-model.ts`'s pure
 * mutations). Deliberately its own small render loop rather than importing
 * `src/render/canvas.ts` — that module is wired to the game's `Frame`/
 * `Renderer`/camera types, none of which a static top-down editor grid
 * needs (same "no shared renderer extraction" precedent as
 * `texture-panel.ts`'s picker canvas).
 */

/** Editor-local tile size in on-screen px — independent of the game's
 * `render/canvas.ts::PX` (48px, camera-scaled). A flat top-down editor grid
 * has no camera, so it picks its own comfortable zoom instead of reusing the
 * game's. */
export const TILE_PX = 16;
export const CANVAS_SCALE = 2;
export const CELL_PX = TILE_PX * CANVAS_SCALE;

const FALLBACK_TERRAIN_COLOR = "#444";

export interface ZoneCanvasHandle {
  render(template: ZoneTemplate, atlas: Atlas, tilesetImage: CanvasImageSource): void;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: AtlasKind,
  typeId: string,
  atlas: Atlas,
  tilesetImage: CanvasImageSource,
): void {
  const dx = x * CELL_PX;
  const dy = y * CELL_PX;
  const region = lookupRegion(atlas, kind, typeId);
  if (region) {
    ctx.drawImage(tilesetImage, region.x, region.y, region.w, region.h, dx, dy, CELL_PX, CELL_PX);
    return;
  }
  // No atlas entry for this typeId (matches `createEmojiAssets`'s fallback
  // intent, spec "Non-Goals" excludes editor glyph fallback art — a flat
  // fill is enough to spot an unmapped terrain while editing). Objects with
  // no sprite simply do not draw a cell background — they stay visible only
  // as an empty gap over their terrain, good enough for a read-only Slice 2.
  if (kind === "terrain") {
    ctx.fillStyle = FALLBACK_TERRAIN_COLOR;
    ctx.fillRect(dx, dy, CELL_PX, CELL_PX);
  }
}

export function createZoneCanvas(canvasEl: HTMLCanvasElement): ZoneCanvasHandle {
  const ctx = canvasEl.getContext("2d");
  if (!ctx) throw new Error("zone-canvas: 2d context unavailable");
  // Re-bound to a non-null-typed const: TS control-flow narrowing from the
  // guard above does not persist into the `render` closure below (the
  // captured `ctx` widens back to `CanvasRenderingContext2D | null` inside a
  // nested function), so this local re-binding carries the narrowed type in.
  const ctx2d: CanvasRenderingContext2D = ctx;

  function render(template: ZoneTemplate, atlas: Atlas, tilesetImage: CanvasImageSource): void {
    canvasEl.width = template.width * CELL_PX;
    canvasEl.height = template.height * CELL_PX;
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.clearRect(0, 0, canvasEl.width, canvasEl.height);

    for (let y = 0; y < template.height; y++) {
      for (let x = 0; x < template.width; x++) {
        const terrainId = template.tiles[y * template.width + x] ?? "";
        drawCell(ctx2d, x, y, "terrain", terrainId, atlas, tilesetImage);
      }
    }
    for (const object of template.objects) {
      drawCell(ctx2d, object.x, object.y, "object", object.objectTypeId, atlas, tilesetImage);
    }
  }

  return { render };
}
