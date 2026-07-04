/**
 * Canonical collection registry (design.md "1. Chosen architecture — Layer
 * 1: Collection registry"). The SINGLE source of truth resolving
 * collection-id -> Catalog schema property name (`schemaKey`) -> schema
 * definition name (`defName`) -> atlas bucket (`atlasKind`). The catalog
 * file name always equals the collection id (`catalog/${id}.json`), so no
 * separate `fileName` field is needed.
 *
 * Isomorphic — imported by BOTH client (engine.ts, descriptors) and server
 * (targets.ts, plan-save.ts, write-middleware.ts) code so nothing anywhere
 * re-derives these mappings independently (design.md Risk 1 — naming
 * drift). `actions` is deliberately NOT included — it is out of scope for
 * this cycle (needs a polymorphic/variant descriptor kind, deferred).
 */

/** Which atlas bucket (frontend/src/render/assets.ts `AtlasKind`) a collection's
 * texture panel writes to, if any. `null` means the collection has no sprite
 * data and the texture panel does not mount (`knowledge`, `research`).
 * `"player"` is not a `COLLECTIONS` entry's `atlasKind` (there is no player
 * collection) — it is included here only so items-editor's standalone
 * "Player" tab (`main.ts`, mounted OUTSIDE `mountCollectionEngine`) can
 * instantiate `createTexturePanel({ atlasKind: "player" })` and typecheck,
 * since `texture-panel-math.ts`'s `AtlasBucketKind` derives from this union
 * (atlas-editor-fold design.md "Extending the kind unions in lockstep"). */
export type AtlasKind = "terrain" | "object" | "item" | "player" | null;

export interface CollectionMeta {
  /** Matches the catalog file name (`catalog/${id}.json`) and `catalog/meta.json`'s `collections` entry. */
  id: string;
  /** The property name this collection occupies on the root `Catalog` object in `schemas/catalog.json`. */
  schemaKey: string;
  /** The `schemas/catalog.json#/definitions/${defName}` this collection's records validate against. */
  defName: string;
  atlasKind: AtlasKind;
}

export const COLLECTIONS: Record<string, CollectionMeta> = {
  terrains: { id: "terrains", schemaKey: "terrains", defName: "TerrainTypeDef", atlasKind: "terrain" },
  items: { id: "items", schemaKey: "items", defName: "ItemTypeDef", atlasKind: "item" },
  "world-objects": { id: "world-objects", schemaKey: "worldObjects", defName: "WorldObjectTypeDef", atlasKind: "object" },
  knowledge: { id: "knowledge", schemaKey: "knowledge", defName: "KnowledgeDef", atlasKind: null },
  research: { id: "research", schemaKey: "research", defName: "ResearchDef", atlasKind: null },
};

export function isKnownCollection(collectionId: string): boolean {
  return Object.prototype.hasOwnProperty.call(COLLECTIONS, collectionId);
}
