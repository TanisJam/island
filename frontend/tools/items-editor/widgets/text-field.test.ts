import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyToUndefined } from "./text-field";

test("emptyToUndefined: an empty string means cleared -> undefined", () => {
  assert.equal(emptyToUndefined(""), undefined);
});

test("emptyToUndefined: a whitespace-only string is also treated as cleared", () => {
  assert.equal(emptyToUndefined("   "), undefined);
});

test("emptyToUndefined: a non-empty value passes through as-is (not trimmed)", () => {
  assert.equal(emptyToUndefined("  Sirve, mal.  "), "  Sirve, mal.  ");
});
