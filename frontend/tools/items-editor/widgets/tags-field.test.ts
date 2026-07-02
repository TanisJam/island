import { test } from "node:test";
import assert from "node:assert/strict";
import { addTag, removeTag } from "./tags-field";

test("addTag: appends a trimmed non-empty tag", () => {
  assert.deepEqual(addTag(["wood"], "  fuel  "), ["wood", "fuel"]);
});

test("addTag: ignores an empty/whitespace-only tag", () => {
  assert.deepEqual(addTag(["wood"], "   "), ["wood"]);
});

test("addTag: de-duplicates an already-present tag", () => {
  assert.deepEqual(addTag(["wood", "fuel"], "wood"), ["wood", "fuel"]);
});

test("addTag: does not mutate the input array", () => {
  const original = ["wood"];
  addTag(original, "fuel");
  assert.deepEqual(original, ["wood"]);
});

test("removeTag: removes the matching tag", () => {
  assert.deepEqual(removeTag(["wood", "fuel"], "wood"), ["fuel"]);
});

test("removeTag: a no-op when the tag is absent", () => {
  assert.deepEqual(removeTag(["wood"], "missing"), ["wood"]);
});

test("removeTag: does not mutate the input array", () => {
  const original = ["wood", "fuel"];
  removeTag(original, "wood");
  assert.deepEqual(original, ["wood", "fuel"]);
});
