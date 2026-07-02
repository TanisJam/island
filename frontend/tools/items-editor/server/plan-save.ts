import type { ItemTypeDef } from "../../../src/contract/catalog";
import { validateItems, type SchemaBundle, type SchemaError } from "../shared/validate-items";
import { validateCollection } from "../shared/validate-collection";
import { bumpCatalogVersion } from "../shared/catalog-version";
import type { CollectionDescriptor, FieldKind } from "../shared/descriptors/types";

/**
 * Server-side save planning (design.md "Components & Data Flow" —
 * `planSave(rawBody, { currentMeta, schemas })`: validate -> normalize ->
 * uniqueness -> bump). PURE — builds the full new contents of BOTH files
 * in memory and never touches `fs`; the write-middleware is the only
 * caller and only performs the actual write once this returns `ok: true`
 * (design.md "ADR-3 — Atomic write" — nothing touched if validation fails).
 *
 * SECURITY-CRITICAL: `rawBody` is read for its `.items` field ONLY. Any
 * other field on `rawBody` (a client-supplied `path`, `file`, `target`,
 * or anything else) is NEVER read here and therefore can never influence
 * where anything is written — the write target always comes from
 * `resolveTargets(repoRoot)` (server/targets.ts), which this module does
 * not even import. See `plan-save.test.ts` for the load-bearing proof.
 */

export interface CatalogMeta {
  catalogVersion: string;
  [key: string]: unknown;
}

export interface PlanSaveInput {
  currentMeta: CatalogMeta;
  schemas: SchemaBundle;
}

export interface PlanSaveOk {
  ok: true;
  itemsJson: string;
  metaJson: string;
  catalogVersion: string;
  count: number;
}

export interface PlanSaveError {
  ok: false;
  errors: SchemaError[];
}

export type PlanSaveResult = PlanSaveOk | PlanSaveError;

/**
 * Reads ONLY `rawBody.items`. Returns `null` if it is missing or not an
 * array — every other property on `rawBody` is ignored, by construction
 * (there is no code path anywhere in this module that reads any other key).
 */
function extractItems(rawBody: unknown): unknown[] | null {
  if (typeof rawBody !== "object" || rawBody === null) return null;
  const items = (rawBody as { items?: unknown }).items;
  return Array.isArray(items) ? items : null;
}

/**
 * Reconstructs a schema-valid item field-by-field from validated input
 * rather than writing the raw parsed object straight to disk — a stray or
 * unexpected runtime key (even one `additionalProperties: false` failed
 * to catch, e.g. via prototype tricks) can never reach the written file
 * because only these explicit fields are ever copied. Absent optionals
 * are omitted, matching `shared/normalize.ts`'s convention.
 */
function reconstructItem(raw: ItemTypeDef): ItemTypeDef {
  const item: ItemTypeDef = {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    shape: { w: raw.shape.w, h: raw.shape.h },
    rotatable: raw.rotatable,
    properties: { ...raw.properties },
    tags: [...raw.tags],
  };
  if (raw.durability !== undefined) {
    item.durability = raw.durability;
  }
  if (raw.observation !== undefined) {
    item.observation = raw.observation;
  }
  return item;
}

function duplicateIdErrors(idErrors: string[]): SchemaError[] {
  return idErrors.map((message) => ({ instancePath: "/items", message }));
}

export function planSave(rawBody: unknown, input: PlanSaveInput): PlanSaveResult {
  const items = extractItems(rawBody);
  if (items === null) {
    return { ok: false, errors: [{ instancePath: "/items", message: "items must be an array" }] };
  }

  const { schemaErrors, idErrors } = validateItems(input.schemas, items);
  if (schemaErrors.length > 0) {
    return { ok: false, errors: schemaErrors };
  }
  if (idErrors.length > 0) {
    return { ok: false, errors: duplicateIdErrors(idErrors) };
  }

  const normalizedItems = (items as ItemTypeDef[]).map(reconstructItem);
  const nextVersion = bumpCatalogVersion(input.currentMeta.catalogVersion);
  const nextMeta: CatalogMeta = { ...input.currentMeta, catalogVersion: nextVersion };

  return {
    ok: true,
    itemsJson: `${JSON.stringify(normalizedItems, null, 2)}\n`,
    metaJson: `${JSON.stringify(nextMeta, null, 2)}\n`,
    catalogVersion: nextVersion,
    count: normalizedItems.length,
  };
}

// --- Generalized save planning (design.md "3. Server generalization — plan-save") ---

/**
 * Deep-clones a single field's value by `kind` so the reconstructed record
 * shares no reference with the raw input (mirrors `reconstructItem`'s
 * per-field `{...properties}`/`[...tags]` cloning above, generalized).
 * Scalar kinds (`text`, `multiline`, `number`, `boolean`, `enum`) pass
 * through as-is — they are already value types.
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
 * writing the raw parsed object straight to disk — generalizes
 * `reconstructItem` above off ANY `CollectionDescriptor` instead of the
 * hardcoded `ItemTypeDef` shape (design.md Risk 4/6 — "security lockstep":
 * the ajv def-name parameterization in `validate-collection.ts` and this
 * allow-list reconstruction generalize TOGETHER, never one generic while
 * the other stays item-specific). Only keys present in `descriptor.fields`
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
 * Reads ONLY `rawBody.records` — the generalized equivalent of
 * `extractItems` above, generic over any collection's payload shape
 * (`{ records }` instead of `{ items }`).
 */
function extractRecords(rawBody: unknown): unknown[] | null {
  if (typeof rawBody !== "object" || rawBody === null) return null;
  const records = (rawBody as { records?: unknown }).records;
  return Array.isArray(records) ? records : null;
}

/**
 * Generalized `planSave` (design.md "3. Server generalization"). Runs the
 * SAME validate -> normalize -> uniqueness -> bump pipeline as `planSave`
 * above, parameterized by `descriptor`/`defName` from the shared registry
 * instead of hardcoded to items. PURE — never touches `fs`.
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
