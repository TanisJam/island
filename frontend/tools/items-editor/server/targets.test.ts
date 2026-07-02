import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveCollectionTarget, resolveTargets } from "./targets";

test("resolveTargets: has a single-parameter signature (repoRoot only) — no path can be injected", () => {
  assert.equal(resolveTargets.length, 1);
});

test("resolveTargets: derives all four paths purely from repoRoot", () => {
  const root = "/home/example/island";
  const targets = resolveTargets(root);
  assert.deepEqual(targets, {
    itemsPath: join(root, "catalog", "items.json"),
    metaPath: join(root, "catalog", "meta.json"),
    commonSchema: join(root, "schemas", "common.json"),
    catalogSchema: join(root, "schemas", "catalog.json"),
  });
});

test("resolveTargets: an arbitrary/hostile-looking repoRoot only ever changes the PREFIX, never the fixed suffix", () => {
  const hostileRoot = "/tmp/../../etc";
  const targets = resolveTargets(hostileRoot);
  assert.ok(targets.itemsPath.endsWith(join("catalog", "items.json")));
  assert.ok(targets.metaPath.endsWith(join("catalog", "meta.json")));
});

test("resolveTargets: called twice with the same repoRoot is deterministic", () => {
  assert.deepEqual(resolveTargets("/a/b"), resolveTargets("/a/b"));
});

// --- resolveCollectionTarget (design.md "3. Server generalization") --------

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

test("resolveCollectionTarget: an unknown collectionId is rejected (returns null, no path is ever built)", () => {
  assert.equal(resolveCollectionTarget("/home/example/island", "not-a-real-collection"), null);
});

test("resolveCollectionTarget: a prototype-chain lookalike collectionId is rejected — SECURITY", () => {
  assert.equal(resolveCollectionTarget("/home/example/island", "constructor"), null);
  assert.equal(resolveCollectionTarget("/home/example/island", "__proto__"), null);
});
