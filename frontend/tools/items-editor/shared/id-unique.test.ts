import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIdUnique } from "./id-unique";

const items = [{ id: "small_stone" }, { id: "dry_branch" }, { id: "bark" }];

test("checkIdUnique: a brand-new id is unique", () => {
  const result = checkIdUnique(items, "wild_seed");
  assert.deepEqual(result, { ok: true, conflictIndex: null });
});

test("checkIdUnique: creating with an existing id is blocked (spec 'Duplicate id on create blocked')", () => {
  const result = checkIdUnique(items, "small_stone");
  assert.deepEqual(result, { ok: false, conflictIndex: 0 });
});

test("checkIdUnique: renaming an item to its OWN current id is not a conflict when editingIndex excludes it", () => {
  const result = checkIdUnique(items, "dry_branch", 1);
  assert.deepEqual(result, { ok: true, conflictIndex: null });
});

test("checkIdUnique: renaming an item to a SIBLING's id is blocked (spec 'Duplicate id on rename blocked')", () => {
  // Renaming items[0] ("small_stone") to "bark" collides with items[2].
  const result = checkIdUnique(items, "bark", 0);
  assert.deepEqual(result, { ok: false, conflictIndex: 2 });
});

test("checkIdUnique: with no editingIndex (new item), any existing id is a conflict", () => {
  const result = checkIdUnique(items, "bark");
  assert.deepEqual(result, { ok: false, conflictIndex: 2 });
});
