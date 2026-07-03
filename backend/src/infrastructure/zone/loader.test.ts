import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadZone } from "./loader";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const zonesDir = join(repoRoot, "zones");

test("loadZone: carga y valida la zona 'z1' real", () => {
  const template = loadZone("z1");
  assert.equal(template.width, 16);
  assert.equal(template.height, 12);
  assert.equal(template.tiles.length, template.width * template.height);
  assert.ok(template.objects.some((o) => o.objectTypeId === "rustic_table" && o.x === 8 && o.y === 8));
});

test("loadZone: falla rápido si el archivo no existe", () => {
  assert.throws(() => loadZone("__does-not-exist__"));
});

test("loadZone: falla rápido si el archivo no cumple el schema", () => {
  const badId = "__invalid-fixture__";
  const badPath = join(zonesDir, `zone-${badId}.json`);
  mkdirSync(zonesDir, { recursive: true });
  // Missing required "objects" field -> schema-invalid.
  writeFileSync(badPath, JSON.stringify({ width: 1, height: 1, tiles: ["grass"] }));
  try {
    assert.throws(() => loadZone(badId));
  } finally {
    rmSync(badPath, { force: true });
  }
});
