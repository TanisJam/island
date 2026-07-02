import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRawJson } from "./raw-json-field";

test("parseRawJson: empty text is omitted (undefined) when the field is optional", () => {
  assert.deepEqual(parseRawJson("", false), { ok: true, value: undefined });
});

test("parseRawJson: whitespace-only text is treated as empty -> omitted", () => {
  assert.deepEqual(parseRawJson("   \n  ", false), { ok: true, value: undefined });
});

test("parseRawJson: empty text fails when the field is required", () => {
  assert.deepEqual(parseRawJson("", true), { ok: false, message: "This field is required" });
});

test("parseRawJson: a valid JSON object round-trips as-is", () => {
  assert.deepEqual(parseRawJson('{"lit":false,"fuel":0}', false), { ok: true, value: { lit: false, fuel: 0 } });
});

test("parseRawJson: a nested valid JSON object round-trips", () => {
  const raw = '{"lit":true,"meta":{"origin":"campfire"}}';
  assert.deepEqual(parseRawJson(raw, false), { ok: true, value: { lit: true, meta: { origin: "campfire" } } });
});

test("parseRawJson: invalid JSON syntax is rejected with an inline error", () => {
  const result = parseRawJson("{not valid json", false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.message, "Must be valid JSON");
});

test("parseRawJson: a JSON array is rejected — only objects are accepted", () => {
  const result = parseRawJson("[1,2,3]", false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.message, "Must be a JSON object, not an array or scalar");
});

test("parseRawJson: a JSON scalar (number) is rejected", () => {
  const result = parseRawJson("42", false);
  assert.equal(result.ok, false);
});

test("parseRawJson: a JSON scalar (string) is rejected", () => {
  const result = parseRawJson('"just a string"', false);
  assert.equal(result.ok, false);
});

test("parseRawJson: the JSON literal null is rejected (typeof null === 'object' but must be excluded explicitly)", () => {
  const result = parseRawJson("null", false);
  assert.equal(result.ok, false);
});

test("parseRawJson: an empty object {} is accepted", () => {
  assert.deepEqual(parseRawJson("{}", false), { ok: true, value: {} });
});
