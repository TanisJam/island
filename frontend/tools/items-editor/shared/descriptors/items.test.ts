import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ITEMS_DESCRIPTOR } from "./items";

/**
 * Descriptor<->schema drift guardrail (design.md section 5's "Guardrail
 * test"), mirroring `terrains.test.ts`/`world-objects.test.ts`. Proves the
 * descriptor's field set and required flags stay in lockstep with the REAL
 * `schemas/catalog.json#/definitions/ItemTypeDef` — the last collection to
 * gain this guardrail (Slice 5, items migration).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");

interface ItemTypeDefSchema {
  required: string[];
  properties: Record<string, unknown>;
}

function readItemTypeDef(): ItemTypeDefSchema {
  const catalogSchema = JSON.parse(readFileSync(join(repoRoot, "schemas", "catalog.json"), "utf-8")) as {
    definitions: { ItemTypeDef: ItemTypeDefSchema };
  };
  return catalogSchema.definitions.ItemTypeDef;
}

test("ITEMS_DESCRIPTOR: field keys match catalog.json#/definitions/ItemTypeDef exactly (required union properties)", () => {
  const def = readItemTypeDef();
  const schemaKeys = new Set([...def.required, ...Object.keys(def.properties)]);
  const descriptorKeys = new Set(ITEMS_DESCRIPTOR.fields.map((f) => f.key));
  assert.deepEqual([...descriptorKeys].sort(), [...schemaKeys].sort());
});

test("ITEMS_DESCRIPTOR: each field's `required` flag matches the schema's required array", () => {
  const def = readItemTypeDef();
  const required = new Set(def.required);
  for (const field of ITEMS_DESCRIPTOR.fields) {
    assert.equal(field.required, required.has(field.key), `field "${field.key}" required flag mismatch`);
  }
});

test("ITEMS_DESCRIPTOR: has exactly one `isId` field, and it is a plain text field", () => {
  const idFields = ITEMS_DESCRIPTOR.fields.filter((f) => f.isId);
  assert.equal(idFields.length, 1);
  assert.equal(idFields[0]?.key, "id");
  assert.equal(idFields[0]?.kind, "text");
});

test("ITEMS_DESCRIPTOR: `shape` is a required `shape`-kind field (always-present mode, not optionalObject)", () => {
  const shape = ITEMS_DESCRIPTOR.fields.find((f) => f.key === "shape");
  assert.equal(shape?.kind, "shape");
  assert.equal(shape?.required, true);
  assert.equal(shape?.optionalObject, undefined);
});

test("ITEMS_DESCRIPTOR: `properties` is a required `numberMap`-kind field", () => {
  const properties = ITEMS_DESCRIPTOR.fields.find((f) => f.key === "properties");
  assert.equal(properties?.kind, "numberMap");
  assert.equal(properties?.required, true);
});

test("ITEMS_DESCRIPTOR: `durability` has no `min` constraint (preserves pre-migration behavior — negative durability was never rejected)", () => {
  const durability = ITEMS_DESCRIPTOR.fields.find((f) => f.key === "durability");
  assert.equal(durability?.kind, "number");
  assert.equal(durability?.required, false);
  assert.equal(durability?.min, undefined);
});
