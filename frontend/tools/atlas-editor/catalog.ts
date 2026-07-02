/**
 * Groups the tool's locally-synced `catalog/*.json` (populated by
 * `sync:catalog`, spec "Catalog typeId enumeration in the mapping tool")
 * into typeId lists per `AtlasKind`. `player` has no catalog file — it is a
 * single fixed typeId, hardcoded here (design.md "Atlas JSON schema").
 * Pure — `main.ts` is the only place that actually `fetch()`es the synced
 * JSON files.
 */

export interface CatalogEntry {
  id: string;
}

export interface CatalogTypeIds {
  terrain: string[];
  object: string[];
  item: string[];
  player: string[];
}

export function catalogTypeIdsByKind(
  terrains: CatalogEntry[],
  worldObjects: CatalogEntry[],
  items: CatalogEntry[],
): CatalogTypeIds {
  return {
    terrain: terrains.map((entry) => entry.id),
    object: worldObjects.map((entry) => entry.id),
    item: items.map((entry) => entry.id),
    player: ["player"],
  };
}
