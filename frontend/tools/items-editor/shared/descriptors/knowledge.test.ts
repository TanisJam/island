import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWLEDGE_DESCRIPTOR } from "./knowledge";

/**
 * Descriptor<->schema drift guardrail (design.md section 5's "Guardrail
 * test"). Proves the descriptor's field set, required flags, and enum
 * values stay in lockstep with the REAL `schemas/catalog.json` definition
 * rather than silently drifting apart.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");

interface KnowledgeDefSchema {
  required: string[];
  properties: Record<string, { enum?: string[] }>;
}

function readKnowledgeDef(): KnowledgeDefSchema {
  const catalogSchema = JSON.parse(readFileSync(join(repoRoot, "schemas", "catalog.json"), "utf-8")) as {
    definitions: { KnowledgeDef: KnowledgeDefSchema };
  };
  return catalogSchema.definitions.KnowledgeDef;
}

test("KNOWLEDGE_DESCRIPTOR: field keys match catalog.json#/definitions/KnowledgeDef exactly (required union properties)", () => {
  const def = readKnowledgeDef();
  const schemaKeys = new Set([...def.required, ...Object.keys(def.properties)]);
  const descriptorKeys = new Set(KNOWLEDGE_DESCRIPTOR.fields.map((f) => f.key));
  assert.deepEqual([...descriptorKeys].sort(), [...schemaKeys].sort());
});

test("KNOWLEDGE_DESCRIPTOR: each field's `required` flag matches the schema's required array", () => {
  const def = readKnowledgeDef();
  const required = new Set(def.required);
  for (const field of KNOWLEDGE_DESCRIPTOR.fields) {
    assert.equal(field.required, required.has(field.key), `field "${field.key}" required flag mismatch`);
  }
});

test("KNOWLEDGE_DESCRIPTOR: the `kind` field's enumValues match the schema's `kind` enum exactly", () => {
  const def = readKnowledgeDef();
  const kindField = KNOWLEDGE_DESCRIPTOR.fields.find((f) => f.key === "kind");
  assert.deepEqual(kindField?.enumValues, def.properties.kind?.enum);
});

test("KNOWLEDGE_DESCRIPTOR: has exactly one `isId` field", () => {
  const idFields = KNOWLEDGE_DESCRIPTOR.fields.filter((f) => f.isId);
  assert.equal(idFields.length, 1);
  assert.equal(idFields[0]?.key, "id");
});
