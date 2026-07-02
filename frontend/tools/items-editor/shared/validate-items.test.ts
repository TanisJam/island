import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateItems, type SchemaBundle } from "./validate-items";

// Validates against the REAL schemas on disk (design.md "server validates
// against the REAL schemas/*.json on disk (authoritative)") so this test
// fails if the schema and the tool drift apart.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

const schemas: SchemaBundle = {
  common: readJson(join(repoRoot, "schemas", "common.json")),
  catalog: readJson(join(repoRoot, "schemas", "catalog.json")),
};

const validItem = {
  id: "small_stone",
  name: "Piedra pequeña",
  description: "Una piedra dura.",
  shape: { w: 1, h: 1 },
  rotatable: false,
  properties: { hardness: 2 },
  tags: ["stone"],
};

test("validateItems: a schema-valid, unique-id array yields no errors", () => {
  const result = validateItems(schemas, [
    validItem,
    { ...validItem, id: "dry_branch", shape: { w: 1, h: 2 } },
  ]);
  assert.deepEqual(result.schemaErrors, []);
  assert.deepEqual(result.idErrors, []);
});

test("validateItems: shape.w below minimum:1 is rejected with a field-specific error", () => {
  const result = validateItems(schemas, [{ ...validItem, shape: { w: 0, h: 1 } }]);
  assert.ok(result.schemaErrors.length > 0);
  assert.ok(result.schemaErrors.some((e) => e.instancePath.includes("shape/w")));
});

test("validateItems: an extra field is rejected (additionalProperties: false)", () => {
  const result = validateItems(schemas, [{ ...validItem, notAField: true }]);
  assert.ok(result.schemaErrors.length > 0);
});

test("validateItems: duplicate ids within the array are reported, schema stays valid", () => {
  const result = validateItems(schemas, [validItem, { ...validItem }]);
  assert.deepEqual(result.schemaErrors, []);
  assert.deepEqual(result.idErrors, ["duplicate id: small_stone"]);
});

test("validateItems: optional fields (durability, observation) are accepted when present", () => {
  const result = validateItems(schemas, [
    { ...validItem, durability: 20, observation: "Se ve fuerte." },
  ]);
  assert.deepEqual(result.schemaErrors, []);
});

test("validateItems: missing a required field is rejected", () => {
  const { description: _description, ...withoutDescription } = validItem;
  const result = validateItems(schemas, [withoutDescription]);
  assert.ok(result.schemaErrors.length > 0);
});
