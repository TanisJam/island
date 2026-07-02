import type { SchemaBundle, SchemaError } from "../shared/validate-items";
import { validateCollection } from "../shared/validate-collection";
import { bumpCatalogVersion } from "../shared/catalog-version";
import type { CollectionDescriptor, FieldKind } from "../shared/descriptors/types";

/**
 * Server-side save planning, generalized over ANY collection via a shared
 * `CollectionDescriptor` (design.md "3. Server generalization — plan-save").
 * PURE — builds the full new contents of BOTH files in memory and never
 * touches `fs`; the write-middleware is the only caller and only performs
 * the actual write once `planSaveCollection` returns `ok: true` (design.md
 * "ADR-3 — Atomic write" — nothing touched if validation fails).
 *
 * SECURITY-CRITICAL: `rawBody` is read for its `.records` field ONLY. Any
 * other field on `rawBody` (a client-supplied `path`, `file`, `target`,
 * or anything else) is NEVER read here and therefore can never influence
 * where anything is written — the write target always comes from
 * `resolveCollectionTarget(repoRoot, collectionId)` (server/targets.ts),
 * which this module does not even import. See `plan-save.test.ts` for the
 * load-bearing proof.
 *
 * The item-only `planSave`/`reconstructItem` path (and the `/__save-items`
 * route it backed) was retired in Slice 5 — `items` now runs through this
 * SAME generalized pipeline as every other collection, parameterized by
 * `shared/descriptors/items.ts::ITEMS_DESCRIPTOR`.
 */

export interface CatalogMeta {
  catalogVersion: string;
  [key: string]: unknown;
}

export interface PlanSaveError {
  ok: false;
  errors: SchemaError[];
}

// --- Generalized save planning (design.md "3. Server generalization — plan-save") ---

/**
 * Deep-clones a single field's value by `kind` so the reconstructed record
 * shares no reference with the raw input. Scalar kinds (`text`,
 * `multiline`, `number`, `boolean`, `enum`) pass through as-is — they are
 * already value types.
 */
function cloneFieldValue(kind: FieldKind, value: unknown): unknown {
  switch (kind) {
    case "tags":
      return Array.isArray(value) ? [...value] : value;
    case "numberMap":
    case "stringMap":
      return value !== null && typeof value === "object" ? { ...(value as Record<string, unknown>) } : value;
    case "shape":
      return value !== null && typeof value === "object" ? { ...(value as Record<string, unknown>) } : value;
    default:
      return value;
  }
}

/**
 * Reconstructs a record field-by-field from a descriptor rather than
 * writing the raw parsed object straight to disk (design.md Risk 4/6 —
 * "security lockstep": the ajv def-name parameterization in
 * `validate-collection.ts` and this allow-list reconstruction generalize
 * TOGETHER, never one generic while the other stays item-specific). Only
 * keys present in `descriptor.fields`
 * are ever copied; a stray/unexpected runtime key (even one
 * `additionalProperties: false` failed to catch) can never reach the
 * written file. Absent optionals are omitted, matching
 * `shared/normalize.ts`'s convention.
 */
export function reconstructRecord(descriptor: CollectionDescriptor, raw: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of descriptor.fields) {
    const value = raw[field.key];
    if (value === undefined) continue;
    record[field.key] = cloneFieldValue(field.kind, value);
  }
  return record;
}

export interface PlanSaveCollectionInput {
  descriptor: CollectionDescriptor;
  defName: string;
  currentMeta: CatalogMeta;
  schemas: SchemaBundle;
}

export interface PlanSaveCollectionOk {
  ok: true;
  dataJson: string;
  metaJson: string;
  catalogVersion: string;
  count: number;
}

export type PlanSaveCollectionResult = PlanSaveCollectionOk | PlanSaveError;

/**
 * Reads ONLY `rawBody.records` — generic over any collection's payload
 * shape (`{ records }`, not a collection-specific key like the old
 * `{ items }`).
 */
function extractRecords(rawBody: unknown): unknown[] | null {
  if (typeof rawBody !== "object" || rawBody === null) return null;
  const records = (rawBody as { records?: unknown }).records;
  return Array.isArray(records) ? records : null;
}

/**
 * Runs the validate -> normalize -> uniqueness -> bump pipeline,
 * parameterized by `descriptor`/`defName` from the shared registry.
 * PURE — never touches `fs`.
 */
export function planSaveCollection(rawBody: unknown, input: PlanSaveCollectionInput): PlanSaveCollectionResult {
  const records = extractRecords(rawBody);
  if (records === null) {
    return { ok: false, errors: [{ instancePath: "/records", message: "records must be an array" }] };
  }

  const { schemaErrors, idErrors } = validateCollection(input.schemas, input.defName, records);
  if (schemaErrors.length > 0) {
    return { ok: false, errors: schemaErrors };
  }
  if (idErrors.length > 0) {
    return { ok: false, errors: idErrors.map((message) => ({ instancePath: `/${input.descriptor.collectionId}`, message })) };
  }

  const normalizedRecords = (records as Record<string, unknown>[]).map((r) => reconstructRecord(input.descriptor, r));
  const nextVersion = bumpCatalogVersion(input.currentMeta.catalogVersion);
  const nextMeta: CatalogMeta = { ...input.currentMeta, catalogVersion: nextVersion };

  return {
    ok: true,
    dataJson: `${JSON.stringify(normalizedRecords, null, 2)}\n`,
    metaJson: `${JSON.stringify(nextMeta, null, 2)}\n`,
    catalogVersion: nextVersion,
    count: normalizedRecords.length,
  };
}
