import type { CollectionDescriptor } from "./types";
import { KNOWLEDGE_DESCRIPTOR } from "./knowledge";

/**
 * `collectionId -> CollectionDescriptor` map (design.md "1. Chosen
 * architecture — Layer 2"). Only `knowledge` is populated this slice; the
 * remaining 4 collections (`research`, `terrains`, `world-objects`,
 * `items`) are added by later slices (2, 3, 4, 5) as their descriptors
 * land — a collection with a `COLLECTIONS` registry entry but no
 * descriptor here is not yet selectable through the generic engine.
 */
const DESCRIPTORS: Partial<Record<string, CollectionDescriptor>> = {
  knowledge: KNOWLEDGE_DESCRIPTOR,
};

export function getDescriptor(collectionId: string): CollectionDescriptor | null {
  return Object.prototype.hasOwnProperty.call(DESCRIPTORS, collectionId) ? (DESCRIPTORS[collectionId] ?? null) : null;
}
