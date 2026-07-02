import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnumValue } from "./enum-field";

test("parseEnumValue: the placeholder (empty string) fails when the field is required", () => {
  assert.deepEqual(parseEnumValue("", true), { ok: false, message: "Select a value" });
});

test("parseEnumValue: the placeholder is a valid 'unset' value when the field is optional", () => {
  assert.deepEqual(parseEnumValue("", false), { ok: true, value: undefined });
});

test("parseEnumValue: a selected valid option passes for a required field", () => {
  assert.deepEqual(parseEnumValue("idea", true), { ok: true, value: "idea" });
});

test("parseEnumValue: a selected valid option passes for an optional field", () => {
  assert.deepEqual(parseEnumValue("technique", false), { ok: true, value: "technique" });
});

// Free text is structurally impossible to test at the pure-function level:
// the widget only ever exposes a native <select> populated from
// `enumValues` — there is no code path through which a hand-typed string
// could reach `parseEnumValue` other than the two cases above (placeholder
// or a value already IN the descriptor's `enumValues`). This is a design
// property of the DOM widget (no <input>), not something a unit test can
// additionally exercise without a DOM environment.
