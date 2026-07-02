import type { Atlas, AtlasKind, AtlasRegion } from "../../src/render/assets";

/**
 * A single tool-side assignment: one `typeId` bound to one atlas region.
 * The tool keeps its assignment state as `Map<typeId, Mapping>` (design.md
 * "Dev tool architecture" — "1 mapping per typeId by construction"), so by
 * the time `buildAtlasExport` runs, the input is already deduplicated;
 * `kind` still travels per-mapping because the same typeId string could in
 * principle appear in more than one catalog kind.
 */
export interface Mapping {
  kind: AtlasKind;
  typeId: string;
  region: AtlasRegion;
}

/**
 * Assembles the frozen per-kind nested `atlas.json` shape (design.md "Atlas
 * JSON schema (frozen)") from the tool's in-memory mappings. Only `typeId`s
 * with an explicit mapping appear — no placeholder entries (spec "Atlas JSON
 * export with frozen per-kind nested schema"). Pure and Node-testable; the
 * only impure part (Blob + `<a download>`) lives in `main.ts`.
 */
export function buildAtlasExport(mappings: Mapping[], imageFilename: string, tile: number): Atlas {
  const atlas: Atlas = { image: imageFilename, tile };
  for (const mapping of mappings) {
    const bucket = atlas[mapping.kind] ?? (atlas[mapping.kind] = {});
    bucket[mapping.typeId] = { ...mapping.region };
  }
  return atlas;
}
