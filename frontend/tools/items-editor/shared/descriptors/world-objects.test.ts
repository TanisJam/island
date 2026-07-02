import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORLD_OBJECTS_DESCRIPTOR } from "./world-objects";

/**
 * Descriptor<->schema drift guardrail (design.md section 5's "Guardrail
 * test"), mirroring `knowledge.test.ts`/`research.test.ts`/`terrains.test.ts`.
 * Proves the descriptor's field set and required flags stay in lockstep
 * with the REAL `schemas/catalog.json` definition rather than silently
 * drifting apart.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");

interface WorldObjectTypeDefSchema {
  required: string[];
  properties: Record<string, { enum?: string[] }>;
}

function readWorldObjectTypeDef(): WorldObjectTypeDefSchema {
  const catalogSchema = JSON.parse(readFileSync(join(repoRoot, "schemas", "catalog.json"), "utf-8")) as {
    definitions: { WorldObjectTypeDef: WorldObjectTypeDefSchema };
  };
  return catalogSchema.definitions.WorldObjectTypeDef;
}

test("WORLD_OBJECTS_DESCRIPTOR: field keys match catalog.json#/definitions/WorldObjectTypeDef exactly (required union properties)", () => {
  const def = readWorldObjectTypeDef();
  const schemaKeys = new Set([...def.required, ...Object.keys(def.properties)]);
  const descriptorKeys = new Set(WORLD_OBJECTS_DESCRIPTOR.fields.map((f) => f.key));
  assert.deepEqual([...descriptorKeys].sort(), [...schemaKeys].sort());
});

test("WORLD_OBJECTS_DESCRIPTOR: each field's `required` flag matches the schema's required array", () => {
  const def = readWorldObjectTypeDef();
  const required = new Set(def.required);
  for (const field of WORLD_OBJECTS_DESCRIPTOR.fields) {
    assert.equal(field.required, required.has(field.key), `field "${field.key}" required flag mismatch`);
  }
});

test("WORLD_OBJECTS_DESCRIPTOR: has exactly one `isId` field, and it is a plain text field", () => {
  const idFields = WORLD_OBJECTS_DESCRIPTOR.fields.filter((f) => f.isId);
  assert.equal(idFields.length, 1);
  assert.equal(idFields[0]?.key, "id");
  assert.equal(idFields[0]?.kind, "text");
});

test("WORLD_OBJECTS_DESCRIPTOR: `surfaceGrid` is a `shape` field with `optionalObject: true` (present/absent toggle)", () => {
  const field = WORLD_OBJECTS_DESCRIPTOR.fields.find((f) => f.key === "surfaceGrid");
  assert.equal(field?.kind, "shape");
  assert.equal(field?.required, false);
  assert.equal(field?.optionalObject, true);
});

test("WORLD_OBJECTS_DESCRIPTOR: `defaultState` is a `rawJson` field", () => {
  const field = WORLD_OBJECTS_DESCRIPTOR.fields.find((f) => f.key === "defaultState");
  assert.equal(field?.kind, "rawJson");
  assert.equal(field?.required, false);
});

test("WORLD_OBJECTS_DESCRIPTOR: `observationByState` is a `stringMap` field", () => {
  const field = WORLD_OBJECTS_DESCRIPTOR.fields.find((f) => f.key === "observationByState");
  assert.equal(field?.kind, "stringMap");
  assert.equal(field?.required, false);
});

test("WORLD_OBJECTS_DESCRIPTOR: `states` reuses the plain `tags` widget", () => {
  const field = WORLD_OBJECTS_DESCRIPTOR.fields.find((f) => f.key === "states");
  assert.equal(field?.kind, "tags");
  assert.equal(field?.required, false);
});
