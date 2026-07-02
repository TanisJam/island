import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCollection, type SchemaBundle } from "./validate-collection";
import { COLLECTIONS } from "./collection-registry";

// Validates against the REAL schemas on disk, run against a NON-item
// collection (`knowledge`) — the load-bearing proof that the ajv
// def-name parameterization generalized correctly, not just for items
// (design.md Risk 4/6 — "security lockstep").
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

const schemas: SchemaBundle = {
  common: readJson(join(repoRoot, "schemas", "common.json")),
  catalog: readJson(join(repoRoot, "schemas", "catalog.json")),
};

const defName = COLLECTIONS.knowledge?.defName ?? "KnowledgeDef";

const validKnowledge = {
  id: "idea_binding",
  name: "Atar",
  kind: "idea",
  unlockThought: "Puedo unir piezas si las ato bien.",
};

test("validateCollection: a schema-valid, unique-id knowledge array yields no errors", () => {
  const result = validateCollection(schemas, defName, [validKnowledge, { ...validKnowledge, id: "idea_fire" }]);
  assert.deepEqual(result.schemaErrors, []);
  assert.deepEqual(result.idErrors, []);
});

test("validateCollection: a knowledge record missing a required field (`kind`) is rejected", () => {
  const { kind: _kind, ...withoutKind } = validKnowledge;
  const result = validateCollection(schemas, defName, [withoutKind]);
  assert.ok(result.schemaErrors.length > 0);
});

test("validateCollection: an invalid `kind` enum value is rejected", () => {
  const result = validateCollection(schemas, defName, [{ ...validKnowledge, kind: "not-a-real-kind" }]);
  assert.ok(result.schemaErrors.length > 0);
  assert.ok(result.schemaErrors.some((e) => e.instancePath.includes("kind")));
});

test("validateCollection: an extra field is rejected (additionalProperties: false)", () => {
  const result = validateCollection(schemas, defName, [{ ...validKnowledge, notAField: true }]);
  assert.ok(result.schemaErrors.length > 0);
});

test("validateCollection: duplicate ids within the array are reported, schema stays valid", () => {
  const result = validateCollection(schemas, defName, [validKnowledge, { ...validKnowledge }]);
  assert.deepEqual(result.schemaErrors, []);
  assert.deepEqual(result.idErrors, ["duplicate id: idea_binding"]);
});
