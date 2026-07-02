import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESEARCH_DESCRIPTOR } from "./research";

/**
 * Descriptor<->schema drift guardrail (design.md section 5's "Guardrail
 * test"), mirroring `knowledge.test.ts`. Proves the descriptor's field set,
 * required flags, and enum values stay in lockstep with the REAL
 * `schemas/catalog.json` definition rather than silently drifting apart.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");

interface ResearchDefSchema {
  required: string[];
  properties: Record<string, { enum?: string[] }>;
}

function readResearchDef(): ResearchDefSchema {
  const catalogSchema = JSON.parse(readFileSync(join(repoRoot, "schemas", "catalog.json"), "utf-8")) as {
    definitions: { ResearchDef: ResearchDefSchema };
  };
  return catalogSchema.definitions.ResearchDef;
}

test("RESEARCH_DESCRIPTOR: field keys match catalog.json#/definitions/ResearchDef exactly (required union properties)", () => {
  const def = readResearchDef();
  const schemaKeys = new Set([...def.required, ...Object.keys(def.properties)]);
  const descriptorKeys = new Set(RESEARCH_DESCRIPTOR.fields.map((f) => f.key));
  assert.deepEqual([...descriptorKeys].sort(), [...schemaKeys].sort());
});

test("RESEARCH_DESCRIPTOR: each field's `required` flag matches the schema's required array", () => {
  const def = readResearchDef();
  const required = new Set(def.required);
  for (const field of RESEARCH_DESCRIPTOR.fields) {
    assert.equal(field.required, required.has(field.key), `field "${field.key}" required flag mismatch`);
  }
});

test("RESEARCH_DESCRIPTOR: the `status` field's enumValues match the schema's `status` enum exactly", () => {
  const def = readResearchDef();
  const statusField = RESEARCH_DESCRIPTOR.fields.find((f) => f.key === "status");
  assert.deepEqual(statusField?.enumValues, def.properties.status?.enum);
});

test("RESEARCH_DESCRIPTOR: has exactly one `isId` field", () => {
  const idFields = RESEARCH_DESCRIPTOR.fields.filter((f) => f.isId);
  assert.equal(idFields.length, 1);
  assert.equal(idFields[0]?.key, "id");
});
