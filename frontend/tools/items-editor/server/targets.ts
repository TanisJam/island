import { join } from "node:path";
import { isKnownCollection } from "../shared/collection-registry";

/**
 * Resolves the hard-coded write/read targets for the items editor
 * dev-server middleware (design.md "ADR-2 — Dev-server write-middleware,
 * hard-coded paths").
 *
 * SECURITY: `resolveCollectionTarget` accepts ONLY `repoRoot` +
 * `collectionId` (validated against the registry before use). There is no
 * parameter through which a client-supplied path could enter — redirection
 * is structurally impossible, not merely validated away. `repoRoot` itself
 * MUST be derived at compile-time from `import.meta.url` by the caller
 * (mirroring `backend/src/infrastructure/catalog/loader.ts`), never from a
 * request body/header/env.
 *
 * The item-only `resolveTargets`/`CatalogTargets` (hardcoded to
 * `catalog/items.json`) was retired in Slice 5 — `items` now resolves
 * through this SAME `resolveCollectionTarget` path as every other
 * collection.
 */
export interface CollectionTargets {
  dataPath: string;
  metaPath: string;
  commonSchema: string;
  catalogSchema: string;
}

/**
 * Generalized `resolveTargets` (design.md "3. Server generalization —
 * targets"). `collectionId` is NEVER a path — it is validated against the
 * `COLLECTIONS` registry via `isKnownCollection` (an allow-listed key, not
 * client-supplied path text) BEFORE being interpolated into a filename;
 * returns `null` for an unknown id so the caller can respond 404 without
 * ever building a path from unvalidated input.
 */
export function resolveCollectionTarget(repoRoot: string, collectionId: string): CollectionTargets | null {
  if (!isKnownCollection(collectionId)) return null;
  return {
    dataPath: join(repoRoot, "catalog", `${collectionId}.json`),
    metaPath: join(repoRoot, "catalog", "meta.json"),
    commonSchema: join(repoRoot, "schemas", "common.json"),
    catalogSchema: join(repoRoot, "schemas", "catalog.json"),
  };
}
