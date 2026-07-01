import type {
  Catalog,
  ContextActionDef,
  ItemTypeDef,
  WorldObjectTypeDef,
  KnowledgeDef,
  TerrainTypeDef,
} from "../contract/catalog";

/** Índice en memoria del catálogo para lookups O(1). Es dominio puro: lo construye
 *  el loader de infraestructura a partir del `Catalog` ya validado. */
export type CatalogIndex = {
  raw: Catalog;
  actions: ContextActionDef[];
  itemById: Map<string, ItemTypeDef>;
  objectById: Map<string, WorldObjectTypeDef>;
  terrainById: Map<string, TerrainTypeDef>;
  knowledgeById: Map<string, KnowledgeDef>;
};

export function buildIndex(raw: Catalog): CatalogIndex {
  return {
    raw,
    actions: raw.actions,
    itemById: new Map(raw.items.map((i) => [i.id, i])),
    objectById: new Map(raw.worldObjects.map((o) => [o.id, o])),
    terrainById: new Map(raw.terrains.map((t) => [t.id, t])),
    knowledgeById: new Map(raw.knowledge.map((k) => [k.id, k])),
  };
}
