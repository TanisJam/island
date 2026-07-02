import { test } from "node:test";
import assert from "node:assert/strict";
import { bumpCatalogVersion } from "./catalog-version";

test("bumpCatalogVersion: increments the trailing patch segment", () => {
  assert.equal(bumpCatalogVersion("0.1.0"), "0.1.1");
});

test("bumpCatalogVersion: is deterministic — same input always yields the same output", () => {
  assert.equal(bumpCatalogVersion("1.4.0"), bumpCatalogVersion("1.4.0"));
  assert.equal(bumpCatalogVersion("1.4.0"), "1.4.1");
});

test("bumpCatalogVersion: rolls a double-digit patch forward correctly", () => {
  assert.equal(bumpCatalogVersion("2.0.9"), "2.0.10");
});

test("bumpCatalogVersion: throws on a non-semver string", () => {
  assert.throws(() => bumpCatalogVersion("not-a-version"));
});

test("bumpCatalogVersion: throws on a partial version (missing patch)", () => {
  assert.throws(() => bumpCatalogVersion("1.4"));
});

test("bumpCatalogVersion: throws on empty string", () => {
  assert.throws(() => bumpCatalogVersion(""));
});
