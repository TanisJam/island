import type { Footprint, Point } from "../shared/picking";
import type { AtlasKind } from "./shared/collection-registry";

/**
 * Pure math for the items-editor texture panel (design.md "Slice C — Texture
 * panel UI"). No DOM here — `texture-panel.ts` is the only place that reads
 * mouse events, draws canvases, or calls `fetch`. Reuses `Footprint`/`Point`
 * from `../shared/picking` (footprint/drag picking itself is already
 * covered by that module's own tests — nothing is duplicated here).
 */

/**
 * The subset of `collection-registry.ts`'s `AtlasKind` that can actually
 * back a texture panel — `null` (no atlas) never reaches this module
 * because `engine.ts` only mounts the panel when `atlasKind` is set
 * (design.md "Texture panel mounts by atlasKind", Slice 3b generalization).
 */
export type AtlasBucketKind = Exclude<AtlasKind, null>;

export interface PreviewScale {
  scale: number;
  dw: number;
  dh: number;
}

/**
 * Computes an integer nearest-neighbor scale so a `region` (the current
 * sprite's tileset crop) fits within a `maxPx` square while preserving
 * aspect ratio — used to size the current-sprite preview canvas. Degenerate
 * (non-positive) inputs fall back to scale 1 at the region's own size rather
 * than throwing (the panel must never crash on a malformed atlas entry).
 */
export function previewScale(region: { w: number; h: number }, maxPx: number): PreviewScale {
  if (region.w <= 0 || region.h <= 0 || maxPx <= 0) {
    return { scale: 1, dw: region.w, dh: region.h };
  }
  const rawScale = Math.min(maxPx / region.w, maxPx / region.h);
  const scale = Math.max(1, Math.floor(rawScale));
  return { scale, dw: region.w * scale, dh: region.h * scale };
}

export type SaveAtlasPayload =
  | { typeId: string; kind: AtlasBucketKind; region: { x: number; y: number; w: number; h: number } }
  | { typeId: string; kind: AtlasBucketKind; clear: true };

/**
 * Builds the exact `POST /__save-atlas` body (spec "Save writes only the
 * selected item's atlas entry" / "Clear an item's texture mapping"; gate
 * review note 1). `region` is reconstructed field-by-field so no stray
 * property on a `Footprint`-shaped value can ever leak into the payload —
 * the server only ever sees `{typeId, kind, region}` or `{typeId, kind,
 * clear:true}`, NEVER a full atlas, path, or file field. `kind` selects the
 * atlas bucket (`terrain`/`object`/`item`) the panel is mounted for (Slice
 * 3b atlasKind generalization) — it is NOT a path, just a bucket-key
 * selector the server allow-lists in `plan-atlas-save.ts`.
 */
export function buildSavePayload(typeId: string, kind: AtlasBucketKind, region: Footprint | null): SaveAtlasPayload {
  if (!region) return { typeId, kind, clear: true };
  const { x, y, w, h } = region;
  return { typeId, kind, region: { x, y, w, h } };
}

/**
 * Converts a client (mouse-event) point into tileset image-pixel space,
 * given the picking canvas's on-screen origin and current zoom level.
 * Mirrors atlas-editor's inline `canvasPointToImagePx`, extracted here as a
 * pure/testable function (design.md "any cell<->pixel helpers not already
 * in shared").
 */
export function imagePxFromClientPoint(client: Point, canvasOrigin: Point, zoom: number): Point {
  return { x: (client.x - canvasOrigin.x) / zoom, y: (client.y - canvasOrigin.y) / zoom };
}
