import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRequiredNumber, parseOptionalNumber } from "./number-field";

test("parseRequiredNumber: empty string fails", () => {
  assert.deepEqual(parseRequiredNumber(""), { ok: false });
});

test("parseRequiredNumber: non-numeric input fails", () => {
  assert.deepEqual(parseRequiredNumber("abc"), { ok: false });
});

test("parseRequiredNumber: a valid integer within min passes", () => {
  assert.deepEqual(parseRequiredNumber("2", { min: 1, integer: true }), { ok: true, value: 2 });
});

test("parseRequiredNumber: shape.w below minimum:1 fails", () => {
  assert.deepEqual(parseRequiredNumber("0", { min: 1, integer: true }), { ok: false });
});

test("parseRequiredNumber: a non-integer fails when integer is required", () => {
  assert.deepEqual(parseRequiredNumber("1.5", { integer: true }), { ok: false });
});

test("parseOptionalNumber: empty string is a valid cleared state (undefined, not 0)", () => {
  assert.deepEqual(parseOptionalNumber(""), { ok: true, value: undefined });
});

test("parseOptionalNumber: a present value of 0 is kept (distinct from cleared)", () => {
  assert.deepEqual(parseOptionalNumber("0"), { ok: true, value: 0 });
});

test("parseOptionalNumber: non-numeric non-empty input still fails", () => {
  assert.deepEqual(parseOptionalNumber("nope"), { ok: false });
});
