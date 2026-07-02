import { test } from "node:test";
import assert from "node:assert/strict";
import { setProp, removeProp } from "./props-field";

test("setProp: sets a new numeric key", () => {
  assert.deepEqual(setProp({}, "hardness", "2"), { ok: true, props: { hardness: 2 } });
});

test("setProp: trims the key before storing", () => {
  assert.deepEqual(setProp({}, "  weight  ", "1"), { ok: true, props: { weight: 1 } });
});

test("setProp: overwrites an existing key without disturbing siblings", () => {
  assert.deepEqual(setProp({ hardness: 2, weight: 1 }, "hardness", "5"), {
    ok: true,
    props: { hardness: 5, weight: 1 },
  });
});

test("setProp: fails on an empty key", () => {
  assert.deepEqual(setProp({}, "  ", "1"), { ok: false });
});

test("setProp: fails on a non-numeric value", () => {
  assert.deepEqual(setProp({}, "hardness", "abc"), { ok: false });
});

test("setProp: does not mutate the input object", () => {
  const original = { hardness: 2 };
  setProp(original, "weight", "1");
  assert.deepEqual(original, { hardness: 2 });
});

test("removeProp: removes the given key", () => {
  assert.deepEqual(removeProp({ hardness: 2, weight: 1 }, "hardness"), { weight: 1 });
});

test("removeProp: a no-op when the key is absent", () => {
  assert.deepEqual(removeProp({ hardness: 2 }, "missing"), { hardness: 2 });
});

test("removeProp: does not mutate the input object", () => {
  const original = { hardness: 2, weight: 1 };
  removeProp(original, "hardness");
  assert.deepEqual(original, { hardness: 2, weight: 1 });
});
