import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveAtlasTarget } from "./atlas-targets";

test("resolveAtlasTarget: has a single-parameter signature (repoRoot only) — no path can be injected", () => {
  assert.equal(resolveAtlasTarget.length, 1);
});

test("resolveAtlasTarget: derives the atlas path from repoRoot, under frontend/public", () => {
  const root = "/home/example/island";
  const targets = resolveAtlasTarget(root);
  assert.deepEqual(targets, {
    atlasPath: join(root, "frontend", "public", "atlas.json"),
  });
});

test("resolveAtlasTarget: an arbitrary/hostile-looking repoRoot only ever changes the PREFIX, never the fixed suffix", () => {
  const hostileRoot = "/tmp/../../etc";
  const targets = resolveAtlasTarget(hostileRoot);
  assert.ok(targets.atlasPath.endsWith(join("frontend", "public", "atlas.json")));
});

test("resolveAtlasTarget: called twice with the same repoRoot is deterministic", () => {
  assert.deepEqual(resolveAtlasTarget("/a/b"), resolveAtlasTarget("/a/b"));
});
