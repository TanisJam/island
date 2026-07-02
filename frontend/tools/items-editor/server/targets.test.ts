import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveTargets } from "./targets";

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
