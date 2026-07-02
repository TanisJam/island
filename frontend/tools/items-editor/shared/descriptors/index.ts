import type { CollectionDescriptor } from "./types";
import { KNOWLEDGE_DESCRIPTOR } from "./knowledge";
import { RESEARCH_DESCRIPTOR } from "./research";
import { TERRAINS_DESCRIPTOR } from "./terrains";
import { WORLD_OBJECTS_DESCRIPTOR } from "./world-objects";
import { ITEMS_DESCRIPTOR } from "./items";

/**
 * `collectionId -> CollectionDescriptor` map (design.md "1. Chosen
 * architecture — Layer 2"). All 5 collections are now populated:
 * `knowledge` (Slice 1), `research` (Slice 2), `terrains` (Slice 3b),
 * `world-objects` (Slice 4), and `items` (Slice 5 — the final migration,
 * items no longer runs on a separate hand-written path).
 */
const DESCRIPTORS: Partial<Record<string, CollectionDescriptor>> = {
  knowledge: KNOWLEDGE_DESCRIPTOR,
  research: RESEARCH_DESCRIPTOR,
  terrains: TERRAINS_DESCRIPTOR,
  "world-objects": WORLD_OBJECTS_DESCRIPTOR,
  items: ITEMS_DESCRIPTOR,
};

export function getDescriptor(collectionId: string): CollectionDescriptor | null {
  return Object.prototype.hasOwnProperty.call(DESCRIPTORS, collectionId) ? (DESCRIPTORS[collectionId] ?? null) : null;
}
