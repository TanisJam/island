import Ajv, { type ErrorObject } from "ajv";

/**
 * Ajv wrapper for the catalog items collection (design.md "ADR-4 — Shared
 * ajv validation module"). Pure JS — runs unmodified in the browser (UX
 * gate, disables Save until valid) AND on the dev-server (authoritative
 * gate before write), because both consumers pass in the SAME schema JSON
 * (browser: synced copy under `tools/items-editor/schemas/`; server: the
 * real `schemas/*.json` on disk).
 */

export interface SchemaBundle {
  common: unknown;
  catalog: unknown;
}

export interface SchemaError {
  instancePath: string;
  message: string;
}

export interface ValidateItemsResult {
  schemaErrors: SchemaError[];
  idErrors: string[];
}

function compileItemsArrayValidator(schemas: SchemaBundle) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(schemas.common as object, "common.json");
  ajv.addSchema(schemas.catalog as object, "catalog.json");
  return ajv.compile({
    type: "array",
    items: { $ref: "catalog.json#/definitions/ItemTypeDef" },
  });
}

function findDuplicateIds(items: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id !== "string") continue;
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }
  return [...duplicates];
}

/**
 * Validates a full items array against `catalog.json#/definitions/ItemTypeDef`
 * AND checks for duplicate `id`s within the same array in a single gate
 * (design.md "runs the SAME ajv schema + JS id-uniqueness gate BEFORE any
 * write"). Returns both error lists rather than throwing so callers can
 * render/report them (field-specific messages, spec "Schema validation
 * before write").
 */
export function validateItems(schemas: SchemaBundle, items: unknown[]): ValidateItemsResult {
  const validate = compileItemsArrayValidator(schemas);
  const valid = validate(items);
  const schemaErrors: SchemaError[] = valid
    ? []
    : ((validate.errors ?? []) as ErrorObject[]).map((error) => ({
        instancePath: error.instancePath || "/",
        message: error.message ?? "invalid",
      }));
  const idErrors = findDuplicateIds(items).map((id) => `duplicate id: ${id}`);
  return { schemaErrors, idErrors };
}
