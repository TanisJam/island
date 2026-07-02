import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLLECTIONS, isKnownCollection } from "./collection-registry";

/**
 * Registry-integrity guardrail (design.md Risk 1 — naming drift). Proves
 * `COLLECTIONS` stays in lockstep with the REAL on-disk `catalog/meta.json`
 * and `schemas/catalog.json` rather than drifting silently.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

test("COLLECTIONS: keys match catalog/meta.json's collections, minus the deferred `actions` collection", () => {
  const meta = readJson(join(repoRoot, "catalog", "meta.json")) as { collections: string[] };
  const expected = meta.collections.filter((id) => id !== "actions").sort();
  assert.deepEqual(Object.keys(COLLECTIONS).sort(), expected);
});

test("COLLECTIONS: every entry's `id` matches its own key", () => {
  for (const [key, meta] of Object.entries(COLLECTIONS)) {
    assert.equal(meta.id, key);
  }
});

test("COLLECTIONS: schemaKey values match Catalog's own properties in schemas/catalog.json (minus catalogVersion/actions)", () => {
  const catalogSchema = readJson(join(repoRoot, "schemas", "catalog.json")) as {
    definitions: { Catalog: { properties: Record<string, unknown> } };
  };
  const catalogProps = new Set(Object.keys(catalogSchema.definitions.Catalog.properties).filter((k) => k !== "catalogVersion" && k !== "actions"));
  const schemaKeys = new Set(Object.values(COLLECTIONS).map((c) => c.schemaKey));
  assert.deepEqual(schemaKeys, catalogProps);
});

test("COLLECTIONS: every defName resolves to a real definition in schemas/catalog.json", () => {
  const catalogSchema = readJson(join(repoRoot, "schemas", "catalog.json")) as {
    definitions: Record<string, unknown>;
  };
  for (const meta of Object.values(COLLECTIONS)) {
    assert.ok(meta.defName in catalogSchema.definitions, `missing definition: ${meta.defName}`);
  }
});

test("isKnownCollection: true for a registered id", () => {
  assert.equal(isKnownCollection("knowledge"), true);
});

test("isKnownCollection: false for an unregistered id", () => {
  assert.equal(isKnownCollection("not-a-real-collection"), false);
});

test("isKnownCollection: false for a prototype-chain property (not an own key) — SECURITY", () => {
  // `"constructor" in {}` is true (inherited from Object.prototype); a naive
  // `collectionId in COLLECTIONS` check would wrongly treat this as known.
  assert.equal(isKnownCollection("constructor"), false);
  assert.equal(isKnownCollection("toString"), false);
  assert.equal(isKnownCollection("__proto__"), false);
});
