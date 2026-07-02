import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveCollectionTarget } from "./targets";

// --- resolveCollectionTarget (design.md "3. Server generalization") --------
// The item-only `resolveTargets`/`CatalogTargets` (hardcoded to
// `catalog/items.json`) was retired in Slice 5 — `items` now resolves
// through this SAME generalized path as every other collection, covered
// below by the dedicated "items" case.

test("resolveCollectionTarget: has a two-parameter signature (repoRoot, collectionId only) — no path can be injected", () => {
  assert.equal(resolveCollectionTarget.length, 2);
});

test("resolveCollectionTarget: a known collectionId resolves to catalog/{id}.json plus shared meta/schema paths", () => {
  const root = "/home/example/island";
  const targets = resolveCollectionTarget(root, "knowledge");
  assert.deepEqual(targets, {
    dataPath: join(root, "catalog", "knowledge.json"),
    metaPath: join(root, "catalog", "meta.json"),
    commonSchema: join(root, "schemas", "common.json"),
    catalogSchema: join(root, "schemas", "catalog.json"),
  });
});

test("resolveCollectionTarget: \"items\" resolves to catalog/items.json — the same path the retired item-only resolveTargets used", () => {
  const root = "/home/example/island";
  const targets = resolveCollectionTarget(root, "items");
  assert.deepEqual(targets, {
    dataPath: join(root, "catalog", "items.json"),
    metaPath: join(root, "catalog", "meta.json"),
    commonSchema: join(root, "schemas", "common.json"),
    catalogSchema: join(root, "schemas", "catalog.json"),
  });
});

test("resolveCollectionTarget: an arbitrary/hostile-looking repoRoot only ever changes the PREFIX, never the fixed suffix", () => {
  const hostileRoot = "/tmp/../../etc";
  const targets = resolveCollectionTarget(hostileRoot, "items");
  assert.ok(targets?.dataPath.endsWith(join("catalog", "items.json")));
  assert.ok(targets?.metaPath.endsWith(join("catalog", "meta.json")));
});

test("resolveCollectionTarget: called twice with the same arguments is deterministic", () => {
  assert.deepEqual(resolveCollectionTarget("/a/b", "items"), resolveCollectionTarget("/a/b", "items"));
});

test("resolveCollectionTarget: an unknown collectionId is rejected (returns null, no path is ever built)", () => {
  assert.equal(resolveCollectionTarget("/home/example/island", "not-a-real-collection"), null);
});

test("resolveCollectionTarget: a prototype-chain lookalike collectionId is rejected — SECURITY", () => {
  assert.equal(resolveCollectionTarget("/home/example/island", "constructor"), null);
  assert.equal(resolveCollectionTarget("/home/example/island", "__proto__"), null);
});
