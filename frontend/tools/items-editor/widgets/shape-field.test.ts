import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShapeValue } from "./shape-field";

// --- required mode (optionalObject: false) ---

test("parseShapeValue (required mode): valid w/h parses to {w,h}", () => {
  assert.deepEqual(parseShapeValue("2", "3", true, false), { ok: true, value: { w: 2, h: 3 } });
});

test("parseShapeValue (required mode): `present` is ignored — always parsed from w/h", () => {
  assert.deepEqual(parseShapeValue("2", "3", false, false), { ok: true, value: { w: 2, h: 3 } });
});

test("parseShapeValue (required mode): a non-integer w fails", () => {
  const result = parseShapeValue("1.5", "3", true, false);
  assert.equal(result.ok, false);
});

test("parseShapeValue (required mode): w below the minimum (1) fails", () => {
  const result = parseShapeValue("0", "3", true, false);
  assert.equal(result.ok, false);
});

test("parseShapeValue (required mode): an empty h fails", () => {
  const result = parseShapeValue("2", "", true, false);
  assert.equal(result.ok, false);
});

// --- optional mode (optionalObject: true, e.g. world-objects.surfaceGrid) ---

test("parseShapeValue (optional mode): unchecked (absent) -> value undefined, regardless of w/h contents", () => {
  assert.deepEqual(parseShapeValue("2", "3", false, true), { ok: true, value: undefined });
});

test("parseShapeValue (optional mode): unchecked with empty/garbage w/h still resolves to undefined, not an error", () => {
  assert.deepEqual(parseShapeValue("", "", false, true), { ok: true, value: undefined });
});

test("parseShapeValue (optional mode): checked (present) with valid w/h parses to {w,h}", () => {
  assert.deepEqual(parseShapeValue("4", "5", true, true), { ok: true, value: { w: 4, h: 5 } });
});

test("parseShapeValue (optional mode): checked (present) with invalid w/h fails", () => {
  const result = parseShapeValue("0", "5", true, true);
  assert.equal(result.ok, false);
});
