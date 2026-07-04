import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { zonesDir } from "../infrastructure/zone/loader";
import { InMemoryGameRepository } from "../infrastructure/persistence/in-memory-repo";
import type { ZoneTemplate } from "../contract/zone";
import { createReloadZone } from "./reload-zone";

const { index } = loadCatalog();
const PLAYER_ID = "p1";

test("createReloadZone: re-seeds the repo from a new template written to disk", () => {
  const zoneId = "__reload-test-valid__";
  const path = join(zonesDir, `zone-${zoneId}.json`);
  const templateA: ZoneTemplate = { width: 1, height: 1, tiles: ["grass"], objects: [] };
  const templateB: ZoneTemplate = { width: 1, height: 2, tiles: ["grass", "sand"], objects: [] };
  const repo = new InMemoryGameRepository();
  const reloadZone = createReloadZone(index, repo, PLAYER_ID);

  mkdirSync(zonesDir, { recursive: true });
  try {
    writeFileSync(path, JSON.stringify(templateA));
    reloadZone(zoneId);
    const first = repo.load(PLAYER_ID);
    assert.ok(first, "expected a state after the first reload");
    assert.equal(first!.zone.width, 1);
    assert.equal(first!.zone.height, 1);
    assert.equal(first!.zone.id, zoneId);

    writeFileSync(path, JSON.stringify(templateB));
    reloadZone(zoneId);
    const second = repo.load(PLAYER_ID);
    assert.ok(second, "expected a state after the second reload");
    assert.equal(second!.zone.height, 2, "re-seed should reflect the new template written to disk");
  } finally {
    rmSync(path, { force: true });
  }
});

test("createReloadZone: fail-safe — a malformed zone file preserves the previous state without throwing", () => {
  const zoneId = "__reload-test-malformed__";
  const path = join(zonesDir, `zone-${zoneId}.json`);
  const good: ZoneTemplate = { width: 1, height: 1, tiles: ["grass"], objects: [] };
  const repo = new InMemoryGameRepository();
  const reloadZone = createReloadZone(index, repo, PLAYER_ID);

  mkdirSync(zonesDir, { recursive: true });
  try {
    writeFileSync(path, JSON.stringify(good));
    reloadZone(zoneId);
    const before = repo.load(PLAYER_ID);
    assert.ok(before, "expected a good state before the malformed write");

    // Simulates a mid-write / corrupted save landing on disk.
    writeFileSync(path, "{ not valid json");
    assert.doesNotThrow(() => reloadZone(zoneId));

    const after = repo.load(PLAYER_ID);
    assert.deepEqual(after, before, "state must be unchanged after a failed reload");
  } finally {
    rmSync(path, { force: true });
  }
});

test("createReloadZone: fail-safe — an unknown zone id logs and does not throw or touch state", () => {
  const repo = new InMemoryGameRepository();
  const reloadZone = createReloadZone(index, repo, PLAYER_ID);

  assert.equal(repo.load(PLAYER_ID), null);
  assert.doesNotThrow(() => reloadZone("__reload-test-does-not-exist__"));
  assert.equal(repo.load(PLAYER_ID), null, "no state should be persisted for a zone that failed to load");
});
