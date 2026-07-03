import type { ZoneTemplate } from "../../src/contract/zone";

/**
 * Pure mutations over an in-memory `ZoneTemplate` (design.md Slice 2 —
 * `zone-model.ts`). Not yet wired to any UI interaction — Slice 3 wires
 * click/drag paint and object place/remove; this slice only needs these as
 * pure, independently testable functions, mirroring the "pure model, dumb
 * view" split already used by `texture-panel-math.ts`. Every function
 * returns a NEW `ZoneTemplate` (no in-place mutation of the argument), so a
 * caller can diff before/after or drive undo/redo later without surprises.
 */

/**
 * Sets the terrain at `(x, y)` to `terrainId`. Throws on an out-of-bounds
 * coordinate rather than silently no-op-ing or growing the grid — a paint
 * tool that could quietly write outside the declared `width`/`height` would
 * desync from `tiles.length === width * height`, which the backend loader
 * asserts at boot (design.md "flat tiles" decision).
 */
export function paintTile(template: ZoneTemplate, x: number, y: number, terrainId: string): ZoneTemplate {
  if (x < 0 || x >= template.width || y < 0 || y >= template.height) {
    throw new Error(`paintTile: (${x},${y}) is out of bounds for a ${template.width}x${template.height} zone`);
  }
  const index = y * template.width + x;
  const tiles = template.tiles.slice();
  tiles[index] = terrainId;
  return { ...template, tiles };
}

/**
 * Appends a new object placement. `state` is optional, matching the schema
 * (`ZoneObjectPlacement.state?`) — omitted entirely (not set to `undefined`)
 * when not provided, so a caller round-tripping through `JSON.stringify`
 * never sees a stray `"state": undefined` artifact either way, but the
 * object shape stays exactly what the schema declares.
 */
export function placeObject(template: ZoneTemplate, objectTypeId: string, x: number, y: number, state?: Record<string, unknown>): ZoneTemplate {
  const placement = state !== undefined ? { objectTypeId, x, y, state } : { objectTypeId, x, y };
  return { ...template, objects: [...template.objects, placement] };
}

/**
 * Removes every object placement at `(x, y)`. A no-op (returns a template
 * with the same objects, in a new array) when nothing is placed there —
 * callers do not need to check `hasObjectAt` first.
 */
export function removeObjectAt(template: ZoneTemplate, x: number, y: number): ZoneTemplate {
  return { ...template, objects: template.objects.filter((o) => o.x !== x || o.y !== y) };
}
