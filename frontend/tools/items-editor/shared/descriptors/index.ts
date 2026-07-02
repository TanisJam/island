import type { CollectionDescriptor } from "./types";
import { KNOWLEDGE_DESCRIPTOR } from "./knowledge";
import { RESEARCH_DESCRIPTOR } from "./research";
import { TERRAINS_DESCRIPTOR } from "./terrains";
import { WORLD_OBJECTS_DESCRIPTOR } from "./world-objects";

/**
 * `collectionId -> CollectionDescriptor` map (design.md "1. Chosen
 * architecture — Layer 2"). `knowledge` (Slice 1), `research` (Slice 2),
 * `terrains` (Slice 3b), and `world-objects` (Slice 4) are populated so
 * far; the remaining collection (`items`) is added by Slice 5 as its
 * descriptor lands — a collection with a `COLLECTIONS` registry entry but
 * no descriptor here is not yet selectable through the generic engine.
 */
const DESCRIPTORS: Partial<Record<string, CollectionDescriptor>> = {
  knowledge: KNOWLEDGE_DESCRIPTOR,
  research: RESEARCH_DESCRIPTOR,
  terrains: TERRAINS_DESCRIPTOR,
  "world-objects": WORLD_OBJECTS_DESCRIPTOR,
};

export function getDescriptor(collectionId: string): CollectionDescriptor | null {
  return Object.prototype.hasOwnProperty.call(DESCRIPTORS, collectionId) ? (DESCRIPTORS[collectionId] ?? null) : null;
}
