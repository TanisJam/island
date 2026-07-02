import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planSaveCollection, reconstructRecord, type CatalogMeta } from "./plan-save";
import type { SchemaBundle } from "../shared/validate-items";
import { KNOWLEDGE_DESCRIPTOR } from "../shared/descriptors/knowledge";
import { RESEARCH_DESCRIPTOR } from "../shared/descriptors/research";
import { TERRAINS_DESCRIPTOR } from "../shared/descriptors/terrains";
import { WORLD_OBJECTS_DESCRIPTOR } from "../shared/descriptors/world-objects";
import { ITEMS_DESCRIPTOR } from "../shared/descriptors/items";
import { COLLECTIONS } from "../shared/collection-registry";

/**
 * SECURITY-CRITICAL test suite (spec "Persist via hard-coded server-side
 * write middleware" + "Path traversal blocked", design.md "ADR-2" +
 * "Security-property test approach").
 *
 * `planSaveCollection` is pure and never touches `fs` — the write target is
 * decided exclusively by
 * `server/targets.ts::resolveCollectionTarget(repoRoot, collectionId)`,
 * which this module does not even import. These tests prove that NO
 * client-supplied field, however path-like or traversal-shaped, ever
 * reaches the write plan or influences it in any way.
 *
 * The item-only `planSave`/`reconstructItem` tests were retired in Slice 5
 * along with the functions they covered — the "items" block below (using
 * `planSaveCollection`/`ITEMS_DESCRIPTOR`, mirroring the
 * knowledge/research/terrains/world-objects blocks) reproduces every one of
 * those security/validation assertions against the generalized path items
 * now runs through, so no coverage is lost.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

const schemas: SchemaBundle = {
  common: readJson(join(repoRoot, "schemas", "common.json")),
  catalog: readJson(join(repoRoot, "schemas", "catalog.json")),
};

const currentMeta: CatalogMeta = {
  catalogVersion: "0.1.0",
  game: "Isla Misteriosa",
  slice: "MVP 0.1 — Vertical Slice jugable",
  collections: ["terrains", "items", "world-objects", "knowledge", "actions", "research"],
};

const validItem: Record<string, unknown> = {
  id: "small_stone",
  name: "Piedra pequeña",
  description: "Una piedra dura.",
  shape: { w: 1, h: 1 },
  rotatable: false,
  properties: { hardness: 2 },
  tags: ["stone"],
};

function itemsInput() {
  return { descriptor: ITEMS_DESCRIPTOR, defName: COLLECTIONS.items?.defName ?? "ItemTypeDef", currentMeta, schemas };
}

// --- The load-bearing security proof --------------------------------------

test("plan-save.ts source: never imports fs or server/targets — it cannot write anywhere itself", () => {
  const source = readFileSync(join(here, "plan-save.ts"), "utf-8");
  const importLines = source
    .split("\n")
    .filter((line) => /^\s*import\b/.test(line))
    .join("\n");
  assert.equal(/["']node:fs["']/.test(importLines), false, "must not import node:fs");
  assert.equal(/["']\.\/targets["']/.test(importLines), false, "must not import ./targets");
});

// --- items (Slice 5) — proves planSaveCollection/reconstructRecord on the ---
// migrated collection reproduces every security/validation property the
// retired item-only planSave/reconstructItem had.

test("planSaveCollection (items): hostile path/file/target/traversal fields on the body are completely IGNORED", () => {
  const hostileBody = {
    records: [validItem],
    path: "../../etc/passwd",
    file: "/etc/passwd",
    target: "../../../root/.ssh/authorized_keys",
    filePath: "../../../../catalog/items.json",
    __proto__: { polluted: true },
  };
  const result = planSaveCollection(hostileBody, itemsInput());
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result);
  for (const hostileValue of [
    "../../etc/passwd",
    "/etc/passwd",
    "../../../root/.ssh/authorized_keys",
    "../../../../catalog/items.json",
  ]) {
    assert.equal(serialized.includes(hostileValue), false, `leaked: ${hostileValue}`);
  }
});

test("planSaveCollection (items): only rawBody.records is consumed — a body with hostile fields and NO records is rejected, not redirected", () => {
  const result = planSaveCollection({ path: "../../etc/passwd", file: "/etc/passwd" }, itemsInput());
  assert.equal(result.ok, false);
});

test("planSaveCollection (items): a non-object rawBody (string/number/null/array) is rejected safely", () => {
  for (const bad of [null, "not-an-object", 42, ["array", "not", "object"]]) {
    const result = planSaveCollection(bad, itemsInput());
    assert.equal(result.ok, false);
  }
});

test("planSaveCollection (items): rejects a schema-invalid item (shape.w violates minimum:1) — no write plan is produced", () => {
  const result = planSaveCollection({ records: [{ ...validItem, shape: { w: 0, h: 1 } }] }, itemsInput());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.instancePath.includes("shape/w")));
  }
  assert.equal("dataJson" in result, false);
  assert.equal("metaJson" in result, false);
});

test("planSaveCollection (items): rejects an item with an extra field (additionalProperties: false) — no write plan is produced", () => {
  const result = planSaveCollection({ records: [{ ...validItem, path: "../../etc/passwd" }] }, itemsInput());
  assert.equal(result.ok, false);
});

test("planSaveCollection (items): rejects duplicate ids within the records array — no write plan is produced", () => {
  const result = planSaveCollection({ records: [validItem, { ...validItem }] }, itemsInput());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((e) => e.message.includes("small_stone")));
  }
  assert.equal("dataJson" in result, false);
});

test("planSaveCollection (items): a rejected save never bumps catalogVersion (spec 'Rejected save does not bump version')", () => {
  const result = planSaveCollection({ records: [{ ...validItem, shape: { w: 0, h: 1 } }] }, itemsInput());
  assert.equal(result.ok, false);
  assert.equal("metaJson" in result, false);
});

test("planSaveCollection (items): a valid save bumps catalogVersion and preserves other meta fields", () => {
  const result = planSaveCollection({ records: [validItem] }, itemsInput());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.catalogVersion, "0.1.1");
    assert.equal(result.count, 1);
    const meta = JSON.parse(result.metaJson);
    assert.equal(meta.catalogVersion, "0.1.1");
    assert.equal(meta.game, "Isla Misteriosa");
    assert.deepEqual(meta.collections, currentMeta.collections);
    const records = JSON.parse(result.dataJson);
    assert.equal(records.length, 1);
    assert.equal(records[0].id, "small_stone");
  }
});

test("reconstructRecord (items): copies ONLY descriptor keys — an extra/unknown field on the raw input is stripped", () => {
  const raw = { ...validItem, durability: 5, path: "../../etc/passwd" };
  const record = reconstructRecord(ITEMS_DESCRIPTOR, raw);
  assert.deepEqual(Object.keys(record).sort(), ["description", "durability", "id", "name", "properties", "rotatable", "shape", "tags"]);
  assert.equal(JSON.stringify(record).includes("etc/passwd"), false);
});

test("reconstructRecord (items): an absent optional (durability) is omitted from the output, not null", () => {
  const record = reconstructRecord(ITEMS_DESCRIPTOR, validItem);
  assert.equal("durability" in record, false);
});

test("reconstructRecord (items): the `shape`-kind field is deep-cloned, not a shared reference", () => {
  const shape = { w: 2, h: 3 };
  const record = reconstructRecord(ITEMS_DESCRIPTOR, { ...validItem, shape });
  assert.notEqual(record.shape, shape);
  assert.deepEqual(record.shape, shape);
});

test("reconstructRecord (items): the `numberMap`-kind field (properties) is deep-cloned, not a shared reference", () => {
  const properties = { hardness: 2 };
  const record = reconstructRecord(ITEMS_DESCRIPTOR, { ...validItem, properties });
  assert.notEqual(record.properties, properties);
  assert.deepEqual(record.properties, properties);
});

test("reconstructRecord (items): the `tags`-kind field is deep-cloned, not a shared reference", () => {
  const tags = ["stone"];
  const record = reconstructRecord(ITEMS_DESCRIPTOR, { ...validItem, tags });
  assert.notEqual(record.tags, tags);
  assert.deepEqual(record.tags, tags);
});

// --- reconstructRecord / planSaveCollection (design.md "3. Server generalization") ---
// Proven on `knowledge` — a NON-item collection — so the descriptor-driven
// allow-list is confirmed to generalize, not just work for items
// (design.md Risk 4/6 — "security lockstep").

const validKnowledge: Record<string, unknown> = {
  id: "idea_binding",
  name: "Atar",
  kind: "idea",
  unlockThought: "Puedo unir piezas si las ato bien.",
};

test("reconstructRecord: copies ONLY descriptor keys — an extra/unknown field on the raw input is stripped", () => {
  const raw = { ...validKnowledge, path: "../../etc/passwd", file: "/etc/passwd" };
  const record = reconstructRecord(KNOWLEDGE_DESCRIPTOR, raw);
  assert.deepEqual(Object.keys(record).sort(), ["id", "kind", "name", "unlockThought"]);
  assert.equal(JSON.stringify(record).includes("etc/passwd"), false);
});

test("reconstructRecord: an absent optional field is omitted from the output, not null", () => {
  const { unlockThought: _unlockThought, ...withoutThought } = validKnowledge;
  const record = reconstructRecord(KNOWLEDGE_DESCRIPTOR, withoutThought);
  assert.equal("unlockThought" in record, false);
  assert.equal("unlockOnObserveTags" in record, false);
});

test("reconstructRecord: a `tags`-kind field (unlockOnObserveTags) is deep-cloned, not a shared reference", () => {
  const tags = ["fire"];
  const record = reconstructRecord(KNOWLEDGE_DESCRIPTOR, { ...validKnowledge, unlockOnObserveTags: tags });
  assert.notEqual(record.unlockOnObserveTags, tags);
  assert.deepEqual(record.unlockOnObserveTags, tags);
});

test("reconstructRecord: a __proto__-own-property key on the raw input never reaches the output or pollutes Object.prototype", () => {
  const raw = JSON.parse('{"id":"idea_binding","name":"Atar","kind":"idea","__proto__":{"polluted":true}}') as Record<string, unknown>;
  const record = reconstructRecord(KNOWLEDGE_DESCRIPTOR, raw);
  assert.equal((Object.prototype as unknown as { polluted?: unknown }).polluted, undefined);
  assert.equal((record as { polluted?: unknown }).polluted, undefined);
});

test("planSaveCollection: a valid knowledge save bumps catalogVersion and writes only descriptor fields", () => {
  const result = planSaveCollection(
    { records: [validKnowledge] },
    { descriptor: KNOWLEDGE_DESCRIPTOR, defName: COLLECTIONS.knowledge?.defName ?? "KnowledgeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.catalogVersion, "0.1.1");
    const records = JSON.parse(result.dataJson);
    assert.deepEqual(records[0], validKnowledge);
  }
});

test("planSaveCollection: hostile path/file/target fields on the body never reach the write plan", () => {
  const hostileBody = { records: [validKnowledge], path: "../../etc/passwd", file: "/etc/passwd", target: "../../../root/.ssh/authorized_keys" };
  const result = planSaveCollection(hostileBody, {
    descriptor: KNOWLEDGE_DESCRIPTOR,
    defName: COLLECTIONS.knowledge?.defName ?? "KnowledgeDef",
    currentMeta,
    schemas,
  });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result);
  for (const hostileValue of ["../../etc/passwd", "/etc/passwd", "../../../root/.ssh/authorized_keys"]) {
    assert.equal(serialized.includes(hostileValue), false, `leaked: ${hostileValue}`);
  }
});

test("planSaveCollection: rejects a schema-invalid record (bad `kind` enum) — no write plan is produced", () => {
  const result = planSaveCollection(
    { records: [{ ...validKnowledge, kind: "not-a-real-kind" }] },
    { descriptor: KNOWLEDGE_DESCRIPTOR, defName: COLLECTIONS.knowledge?.defName ?? "KnowledgeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, false);
  assert.equal("dataJson" in result, false);
});

test("planSaveCollection: rejects duplicate ids within the records array", () => {
  const result = planSaveCollection(
    { records: [validKnowledge, { ...validKnowledge }] },
    { descriptor: KNOWLEDGE_DESCRIPTOR, defName: COLLECTIONS.knowledge?.defName ?? "KnowledgeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((e) => e.message.includes("idea_binding")));
  }
});

// --- research (Slice 2) — proves reconstructRecord/planSaveCollection also ---
// generalize to a SECOND non-item collection, not just knowledge (mirrors the
// knowledge block above exactly).

const validResearch: Record<string, unknown> = {
  id: "heat_containment",
  name: "Contención de calor",
  status: "hidden",
  revealedBy: ["discovery_fire_lit"],
  teaserThought: "El fuego se escapa rápido.",
};

test("reconstructRecord (research): copies ONLY descriptor keys — an extra/unknown field on the raw input is stripped", () => {
  const raw = { ...validResearch, path: "../../etc/passwd", file: "/etc/passwd" };
  const record = reconstructRecord(RESEARCH_DESCRIPTOR, raw);
  assert.deepEqual(Object.keys(record).sort(), ["id", "name", "revealedBy", "status", "teaserThought"]);
  assert.equal(JSON.stringify(record).includes("etc/passwd"), false);
});

test("reconstructRecord (research): an absent optional field is omitted from the output, not null", () => {
  const { revealedBy: _revealedBy, teaserThought: _teaserThought, ...withoutOptionals } = validResearch;
  const record = reconstructRecord(RESEARCH_DESCRIPTOR, withoutOptionals);
  assert.equal("revealedBy" in record, false);
  assert.equal("teaserThought" in record, false);
});

test("reconstructRecord (research): the `tags`-kind field (revealedBy) is deep-cloned, not a shared reference", () => {
  const revealedBy = ["discovery_fire_lit"];
  const record = reconstructRecord(RESEARCH_DESCRIPTOR, { ...validResearch, revealedBy });
  assert.notEqual(record.revealedBy, revealedBy);
  assert.deepEqual(record.revealedBy, revealedBy);
});

test("planSaveCollection (research): a valid save bumps catalogVersion and writes only descriptor fields", () => {
  const result = planSaveCollection(
    { records: [validResearch] },
    { descriptor: RESEARCH_DESCRIPTOR, defName: COLLECTIONS.research?.defName ?? "ResearchDef", currentMeta, schemas },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.catalogVersion, "0.1.1");
    const records = JSON.parse(result.dataJson);
    assert.deepEqual(records[0], validResearch);
  }
});

test("planSaveCollection (research): rejects a schema-invalid record (bad `status` enum) — no write plan is produced", () => {
  const result = planSaveCollection(
    { records: [{ ...validResearch, status: "not-a-real-status" }] },
    { descriptor: RESEARCH_DESCRIPTOR, defName: COLLECTIONS.research?.defName ?? "ResearchDef", currentMeta, schemas },
  );
  assert.equal(result.ok, false);
  assert.equal("dataJson" in result, false);
});

test("planSaveCollection (research): rejects duplicate ids within the records array", () => {
  const result = planSaveCollection(
    { records: [validResearch, { ...validResearch }] },
    { descriptor: RESEARCH_DESCRIPTOR, defName: COLLECTIONS.research?.defName ?? "ResearchDef", currentMeta, schemas },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((e) => e.message.includes("heat_containment")));
  }
});

// --- terrains (Slice 3b) — proves reconstructRecord/planSaveCollection also ---
// generalize to a freely-addable-id collection: `id` has no schema enum
// anymore (Slice 3a opened TerrainType to a plain string), so a BRAND-NEW
// terrain id (not one of the 6 seed terrains) must save successfully.

const validTerrain: Record<string, unknown> = {
  id: "swamp",
  name: "Swamp",
  walkable: false,
  tags: ["wet", "hazard"],
  observation: "Ground squelches underfoot.",
};

test("reconstructRecord (terrains): copies ONLY descriptor keys — an extra/unknown field on the raw input is stripped", () => {
  const raw = { ...validTerrain, path: "../../etc/passwd", file: "/etc/passwd" };
  const record = reconstructRecord(TERRAINS_DESCRIPTOR, raw);
  assert.deepEqual(Object.keys(record).sort(), ["id", "name", "observation", "tags", "walkable"]);
  assert.equal(JSON.stringify(record).includes("etc/passwd"), false);
});

test("reconstructRecord (terrains): an absent optional field (observation) is omitted from the output, not null", () => {
  const { observation: _observation, ...withoutObservation } = validTerrain;
  const record = reconstructRecord(TERRAINS_DESCRIPTOR, withoutObservation);
  assert.equal("observation" in record, false);
});

test("reconstructRecord (terrains): the `tags`-kind field is deep-cloned, not a shared reference", () => {
  const tags = ["wet", "hazard"];
  const record = reconstructRecord(TERRAINS_DESCRIPTOR, { ...validTerrain, tags });
  assert.notEqual(record.tags, tags);
  assert.deepEqual(record.tags, tags);
});

test("planSaveCollection (terrains): a BRAND-NEW terrain id (not one of the 6 seed terrains) saves successfully — proves terrain-add works end-to-end (Slice 3a+3b)", () => {
  const result = planSaveCollection(
    { records: [validTerrain] },
    { descriptor: TERRAINS_DESCRIPTOR, defName: COLLECTIONS.terrains?.defName ?? "TerrainTypeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.catalogVersion, "0.1.1");
    const records = JSON.parse(result.dataJson);
    assert.deepEqual(records[0], validTerrain);
  }
});

test("planSaveCollection (terrains): rejects a schema-invalid record (missing required `walkable`) — no write plan is produced", () => {
  const { walkable: _walkable, ...withoutWalkable } = validTerrain;
  const result = planSaveCollection(
    { records: [withoutWalkable] },
    { descriptor: TERRAINS_DESCRIPTOR, defName: COLLECTIONS.terrains?.defName ?? "TerrainTypeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, false);
  assert.equal("dataJson" in result, false);
});

test("planSaveCollection (terrains): rejects duplicate ids within the records array", () => {
  const result = planSaveCollection(
    { records: [validTerrain, { ...validTerrain }] },
    { descriptor: TERRAINS_DESCRIPTOR, defName: COLLECTIONS.terrains?.defName ?? "TerrainTypeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((e) => e.message.includes("swamp")));
  }
});

// --- world-objects (Slice 4) — proves reconstructRecord/planSaveCollection ---
// also generalize to a collection with NESTED (`surfaceGrid`, `shape`),
// freeform-object (`defaultState`, `rawJson`), and map (`observationByState`,
// `stringMap`) fields, not just scalars/tags like the earlier collections.

const validWorldObject: Record<string, unknown> = {
  id: "campfire",
  name: "Campfire",
  description: "A ring of stones with embers inside.",
  tags: ["heat_source", "light_source"],
  blocksMovement: false,
  states: ["lit", "unlit"],
  surfaceGrid: { w: 2, h: 2 },
  observation: "Warm to the touch.",
  defaultState: { lit: false, fuel: 0 },
  observationByState: { lit: "Embers glow steadily.", unlit: "Cold ash." },
};

test("reconstructRecord (world-objects): copies ONLY descriptor keys — an extra/unknown field on the raw input is stripped", () => {
  const raw = { ...validWorldObject, path: "../../etc/passwd", file: "/etc/passwd" };
  const record = reconstructRecord(WORLD_OBJECTS_DESCRIPTOR, raw);
  assert.deepEqual(Object.keys(record).sort(), [
    "blocksMovement",
    "defaultState",
    "description",
    "id",
    "name",
    "observation",
    "observationByState",
    "states",
    "surfaceGrid",
    "tags",
  ]);
  assert.equal(JSON.stringify(record).includes("etc/passwd"), false);
});

test("reconstructRecord (world-objects): all optional fields absent are omitted from the output, not null", () => {
  const minimal: Record<string, unknown> = {
    id: "campfire",
    name: "Campfire",
    description: "A ring of stones with embers inside.",
    tags: ["heat_source"],
    blocksMovement: false,
  };
  const record = reconstructRecord(WORLD_OBJECTS_DESCRIPTOR, minimal);
  assert.equal("states" in record, false);
  assert.equal("surfaceGrid" in record, false);
  assert.equal("observation" in record, false);
  assert.equal("defaultState" in record, false);
  assert.equal("observationByState" in record, false);
});

test("reconstructRecord (world-objects): the `shape`-kind field (surfaceGrid) is deep-cloned, not a shared reference", () => {
  const surfaceGrid = { w: 2, h: 2 };
  const record = reconstructRecord(WORLD_OBJECTS_DESCRIPTOR, { ...validWorldObject, surfaceGrid });
  assert.notEqual(record.surfaceGrid, surfaceGrid);
  assert.deepEqual(record.surfaceGrid, surfaceGrid);
});

test("reconstructRecord (world-objects): the `rawJson`-kind field (defaultState) round-trips the freeform object", () => {
  const defaultState = { lit: false, fuel: 0 };
  const record = reconstructRecord(WORLD_OBJECTS_DESCRIPTOR, { ...validWorldObject, defaultState });
  assert.deepEqual(record.defaultState, defaultState);
});

test("reconstructRecord (world-objects): the `stringMap`-kind field (observationByState) is deep-cloned, not a shared reference", () => {
  const observationByState = { lit: "Embers glow steadily." };
  const record = reconstructRecord(WORLD_OBJECTS_DESCRIPTOR, { ...validWorldObject, observationByState });
  assert.notEqual(record.observationByState, observationByState);
  assert.deepEqual(record.observationByState, observationByState);
});

test("planSaveCollection (world-objects): a valid save with ALL fields (incl. surfaceGrid/defaultState/observationByState) bumps catalogVersion and writes only descriptor fields", () => {
  const result = planSaveCollection(
    { records: [validWorldObject] },
    { descriptor: WORLD_OBJECTS_DESCRIPTOR, defName: COLLECTIONS["world-objects"]?.defName ?? "WorldObjectTypeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.catalogVersion, "0.1.1");
    const records = JSON.parse(result.dataJson);
    assert.deepEqual(records[0], validWorldObject);
  }
});

test("planSaveCollection (world-objects): a valid save with ONLY the required fields (all optionals omitted) round-trips", () => {
  const minimal = {
    id: "loose_rock",
    name: "Loose rock",
    description: "A fist-sized rock.",
    tags: ["debris"],
    blocksMovement: false,
  };
  const result = planSaveCollection(
    { records: [minimal] },
    { descriptor: WORLD_OBJECTS_DESCRIPTOR, defName: COLLECTIONS["world-objects"]?.defName ?? "WorldObjectTypeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    const records = JSON.parse(result.dataJson);
    assert.deepEqual(records[0], minimal);
  }
});

test("planSaveCollection (world-objects): rejects a schema-invalid record (surfaceGrid.w below minimum) — no write plan is produced", () => {
  const result = planSaveCollection(
    { records: [{ ...validWorldObject, surfaceGrid: { w: 0, h: 2 } }] },
    { descriptor: WORLD_OBJECTS_DESCRIPTOR, defName: COLLECTIONS["world-objects"]?.defName ?? "WorldObjectTypeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, false);
  assert.equal("dataJson" in result, false);
});

test("planSaveCollection (world-objects): rejects a schema-invalid record (observationByState value not a string) — no write plan is produced", () => {
  const result = planSaveCollection(
    { records: [{ ...validWorldObject, observationByState: { lit: 5 } }] },
    { descriptor: WORLD_OBJECTS_DESCRIPTOR, defName: COLLECTIONS["world-objects"]?.defName ?? "WorldObjectTypeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, false);
  assert.equal("dataJson" in result, false);
});

test("planSaveCollection (world-objects): rejects duplicate ids within the records array", () => {
  const result = planSaveCollection(
    { records: [validWorldObject, { ...validWorldObject }] },
    { descriptor: WORLD_OBJECTS_DESCRIPTOR, defName: COLLECTIONS["world-objects"]?.defName ?? "WorldObjectTypeDef", currentMeta, schemas },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((e) => e.message.includes("campfire")));
  }
});
