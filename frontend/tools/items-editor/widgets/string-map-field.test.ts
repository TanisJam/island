import { test } from "node:test";
import assert from "node:assert/strict";
import { setStringProp, removeStringProp } from "./string-map-field";

test("setStringProp: sets a new string key", () => {
  assert.deepEqual(setStringProp({}, "lit", "embers glow"), { ok: true, props: { lit: "embers glow" } });
});

test("setStringProp: trims the key before storing", () => {
  assert.deepEqual(setStringProp({}, "  unlit  ", "dark"), { ok: true, props: { unlit: "dark" } });
});

test("setStringProp: overwrites an existing key without disturbing siblings", () => {
  assert.deepEqual(setStringProp({ lit: "glow", unlit: "dark" }, "lit", "roaring"), {
    ok: true,
    props: { lit: "roaring", unlit: "dark" },
  });
});

test("setStringProp: fails on an empty key", () => {
  assert.deepEqual(setStringProp({}, "  ", "value"), { ok: false });
});

test("setStringProp: an empty VALUE is valid — not coerced to a number, not rejected", () => {
  assert.deepEqual(setStringProp({}, "lit", ""), { ok: true, props: { lit: "" } });
});

test("setStringProp: a non-numeric string value is valid, unlike setProp's numeric coercion", () => {
  assert.deepEqual(setStringProp({}, "lit", "embers glow"), { ok: true, props: { lit: "embers glow" } });
});

test("setStringProp: does not mutate the input object", () => {
  const original = { lit: "glow" };
  setStringProp(original, "unlit", "dark");
  assert.deepEqual(original, { lit: "glow" });
});

test("removeStringProp: removes the given key", () => {
  assert.deepEqual(removeStringProp({ lit: "glow", unlit: "dark" }, "lit"), { unlit: "dark" });
});

test("removeStringProp: a no-op when the key is absent", () => {
  assert.deepEqual(removeStringProp({ lit: "glow" }, "missing"), { lit: "glow" });
});

test("removeStringProp: does not mutate the input object", () => {
  const original = { lit: "glow", unlit: "dark" };
  removeStringProp(original, "lit");
  assert.deepEqual(original, { lit: "glow", unlit: "dark" });
});
