import type { CollectionDescriptor } from "./types";
import { KNOWLEDGE_DESCRIPTOR } from "./knowledge";
import { RESEARCH_DESCRIPTOR } from "./research";

/**
 * `collectionId -> CollectionDescriptor` map (design.md "1. Chosen
 * architecture — Layer 2"). `knowledge` (Slice 1) and `research` (Slice 2)
 * are populated so far; the remaining 3 collections (`terrains`,
 * `world-objects`, `items`) are added by later slices (3, 4, 5) as their
 * descriptors land — a collection with a `COLLECTIONS` registry entry but
 * no descriptor here is not yet selectable through the generic engine.
 */
const DESCRIPTORS: Partial<Record<string, CollectionDescriptor>> = {
  knowledge: KNOWLEDGE_DESCRIPTOR,
  research: RESEARCH_DESCRIPTOR,
};

export function getDescriptor(collectionId: string): CollectionDescriptor | null {
  return Object.prototype.hasOwnProperty.call(DESCRIPTORS, collectionId) ? (DESCRIPTORS[collectionId] ?? null) : null;
}
