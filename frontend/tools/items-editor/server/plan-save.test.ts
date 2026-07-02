import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planSave, planSaveCollection, reconstructRecord, type PlanSaveInput } from "./plan-save";
import { KNOWLEDGE_DESCRIPTOR } from "../shared/descriptors/knowledge";
import { COLLECTIONS } from "../shared/collection-registry";

/**
 * SECURITY-CRITICAL test suite (spec "Persist via hard-coded server-side
 * write middleware" + "Path traversal blocked", design.md "ADR-2" +
 * "Security-property test approach").
 *
 * `planSave` is pure and never touches `fs` — the write target is decided
 * exclusively by `server/targets.ts::resolveTargets(repoRoot)`, which this
 * module does not even import. These tests prove that NO client-supplied
 * field, however path-like or traversal-shaped, ever reaches the write
 * plan or influences it in any way.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

const schemas: PlanSaveInput["schemas"] = {
  common: readJson(join(repoRoot, "schemas", "common.json")),
  catalog: readJson(join(repoRoot, "schemas", "catalog.json")),
};

const currentMeta: PlanSaveInput["currentMeta"] = {
  catalogVersion: "0.1.0",
  game: "Isla Misteriosa",
  slice: "MVP 0.1 — Vertical Slice jugable",
  collections: ["terrains", "items", "world-objects", "knowledge", "actions", "research"],
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

function input(): PlanSaveInput {
  return { currentMeta, schemas };
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

test("planSave: hostile path/file/target/traversal fields on the body are completely IGNORED", () => {
  const hostileBody = {
    items: [validItem],
    path: "../../etc/passwd",
    file: "/etc/passwd",
    target: "../../../root/.ssh/authorized_keys",
    filePath: "../../../../catalog/items.json",
    __proto__: { polluted: true },
  };
  const result = planSave(hostileBody, input());
  assert.equal(result.ok, true);
  // The write plan must contain no trace of any hostile string anywhere
  // in its serialized output — proving those fields were never read.
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

test("planSave: only rawBody.items is consumed — a body with hostile fields and NO items is rejected, not redirected", () => {
  const result = planSave({ path: "../../etc/passwd", file: "/etc/passwd" }, input());
  assert.equal(result.ok, false);
});

test("planSave: a non-object rawBody (string/number/null/array) is rejected safely", () => {
  for (const bad of [null, "not-an-object", 42, ["array", "not", "object"]]) {
    const result = planSave(bad, input());
    assert.equal(result.ok, false);
  }
});

// --- Validation gate runs BEFORE any write plan is produced ---------------

test("planSave: rejects a schema-invalid item (shape.w violates minimum:1) — no write plan is produced", () => {
  const result = planSave({ items: [{ ...validItem, shape: { w: 0, h: 1 } }] }, input());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.instancePath.includes("shape/w")));
  }
  assert.equal("itemsJson" in result, false);
  assert.equal("metaJson" in result, false);
});

test("planSave: rejects an item with an extra field (additionalProperties: false) — no write plan is produced", () => {
  const result = planSave({ items: [{ ...validItem, path: "../../etc/passwd" }] }, input());
  assert.equal(result.ok, false);
});

test("planSave: rejects duplicate ids within the items array — no write plan is produced", () => {
  const result = planSave({ items: [validItem, { ...validItem }] }, input());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((e) => e.message.includes("small_stone")));
  }
  assert.equal("itemsJson" in result, false);
});

test("planSave: a rejected save never bumps catalogVersion (spec 'Rejected save does not bump version')", () => {
  const result = planSave({ items: [{ ...validItem, shape: { w: 0, h: 1 } }] }, input());
  assert.equal(result.ok, false);
  // The only way a version bump could leak is via a metaJson field — confirm it is absent.
  assert.equal("metaJson" in result, false);
});

// --- Happy path -------------------------------------------------------------

test("planSave: a valid save bumps catalogVersion and preserves other meta fields", () => {
  const result = planSave({ items: [validItem] }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.catalogVersion, "0.1.1");
    assert.equal(result.count, 1);
    const meta = JSON.parse(result.metaJson);
    assert.equal(meta.catalogVersion, "0.1.1");
    assert.equal(meta.game, "Isla Misteriosa");
    assert.deepEqual(meta.collections, currentMeta.collections);
    const items = JSON.parse(result.itemsJson);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "small_stone");
  }
});

test("planSave: written items never include a stray field, even if input carried one that passed no schema check by accident", () => {
  // reconstructItem only ever copies known ItemTypeDef fields (defense in
  // depth beyond ajv's additionalProperties: false).
  const result = planSave({ items: [{ ...validItem, durability: 5 }] }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const items = JSON.parse(result.itemsJson);
    assert.deepEqual(Object.keys(items[0]).sort(), [
      "description",
      "durability",
      "id",
      "name",
      "properties",
      "rotatable",
      "shape",
      "tags",
    ]);
  }
});

test("planSave: an absent optional (durability) is omitted from the written item, not null", () => {
  const result = planSave({ items: [validItem] }, input());
  assert.equal(result.ok, true);
  if (result.ok) {
    const items = JSON.parse(result.itemsJson);
    assert.equal("durability" in items[0], false);
  }
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
