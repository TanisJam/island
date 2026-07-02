import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TERRAINS_DESCRIPTOR } from "./terrains";

/**
 * Descriptor<->schema drift guardrail (design.md section 5's "Guardrail
 * test"), mirroring `knowledge.test.ts`/`research.test.ts`. Proves the
 * descriptor's field set and required flags stay in lockstep with the REAL
 * `schemas/catalog.json` definition rather than silently drifting apart.
 * `id` has no `enum` on the schema side anymore (Slice 3a opened
 * `TerrainType` to a plain string) — there is no enum-lockstep assertion
 * to make here, unlike `research.status`/`knowledge.kind`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");

interface TerrainTypeDefSchema {
  required: string[];
  properties: Record<string, { enum?: string[] }>;
}

function readTerrainTypeDef(): TerrainTypeDefSchema {
  const catalogSchema = JSON.parse(readFileSync(join(repoRoot, "schemas", "catalog.json"), "utf-8")) as {
    definitions: { TerrainTypeDef: TerrainTypeDefSchema };
  };
  return catalogSchema.definitions.TerrainTypeDef;
}

test("TERRAINS_DESCRIPTOR: field keys match catalog.json#/definitions/TerrainTypeDef exactly (required union properties)", () => {
  const def = readTerrainTypeDef();
  const schemaKeys = new Set([...def.required, ...Object.keys(def.properties)]);
  const descriptorKeys = new Set(TERRAINS_DESCRIPTOR.fields.map((f) => f.key));
  assert.deepEqual([...descriptorKeys].sort(), [...schemaKeys].sort());
});

test("TERRAINS_DESCRIPTOR: each field's `required` flag matches the schema's required array", () => {
  const def = readTerrainTypeDef();
  const required = new Set(def.required);
  for (const field of TERRAINS_DESCRIPTOR.fields) {
    assert.equal(field.required, required.has(field.key), `field "${field.key}" required flag mismatch`);
  }
});

test("TERRAINS_DESCRIPTOR: has exactly one `isId` field, and it is a plain text field (not enum)", () => {
  const idFields = TERRAINS_DESCRIPTOR.fields.filter((f) => f.isId);
  assert.equal(idFields.length, 1);
  assert.equal(idFields[0]?.key, "id");
  assert.equal(idFields[0]?.kind, "text");
});
