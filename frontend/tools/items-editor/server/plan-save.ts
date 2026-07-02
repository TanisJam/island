import type { ItemTypeDef } from "../../../src/contract/catalog";
import { validateItems, type SchemaBundle, type SchemaError } from "../shared/validate-items";
import { bumpCatalogVersion } from "../shared/catalog-version";

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
