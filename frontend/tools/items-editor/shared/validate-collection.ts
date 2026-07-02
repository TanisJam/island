import Ajv, { type ErrorObject } from "ajv";
import { findDuplicateIds } from "./validate-items";

/**
 * Ajv wrapper generalized over ANY collection's `defName` (design.md "3.
 * Server generalization — validate"). Generalizes `validate-items.ts`'s
 * hardcoded `ItemTypeDef` (`validate-items.ts:33`) into a `defName`
 * parameter sourced from `shared/collection-registry.ts`. Pure JS — runs
 * unmodified in the browser (UX gate) AND on the dev-server (authoritative
 * gate before write), exactly like `validate-items.ts`.
 */

export interface SchemaBundle {
  common: unknown;
  catalog: unknown;
}

export interface SchemaError {
  instancePath: string;
  message: string;
}

export interface ValidateCollectionResult {
  schemaErrors: SchemaError[];
  idErrors: string[];
}

function compileCollectionArrayValidator(schemas: SchemaBundle, defName: string) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(schemas.common as object, "common.json");
  ajv.addSchema(schemas.catalog as object, "catalog.json");
  return ajv.compile({
    type: "array",
    items: { $ref: `catalog.json#/definitions/${defName}` },
  });
}

/**
 * Validates a full records array against `catalog.json#/definitions/${defName}`
 * AND checks for duplicate `id`s within the same array in a single gate —
 * the SAME two-part gate `validate-items.ts::validateItems` runs, now
 * parameterized off the registry instead of hardcoded to items.
 */
export function validateCollection(schemas: SchemaBundle, defName: string, records: unknown[]): ValidateCollectionResult {
  const validate = compileCollectionArrayValidator(schemas, defName);
  const valid = validate(records);
  const schemaErrors: SchemaError[] = valid
    ? []
    : ((validate.errors ?? []) as ErrorObject[]).map((error) => ({
        instancePath: error.instancePath || "/",
        message: error.message ?? "invalid",
      }));
  const idErrors = findDuplicateIds(records).map((id) => `duplicate id: ${id}`);
  return { schemaErrors, idErrors };
}
