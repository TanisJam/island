import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyClick } from "./mouse";

/**
 * `classifyClick` is the pure decision behind the click-cadence model
 * (fix-list: "single click inspects (opens menu), double click/tap moves"):
 * `onCanvasClick` is otherwise DOM/canvas-heavy and only gets smoke coverage
 * by design (see window-manager.test.ts's docstring for the same pattern) —
 * this one PURE decision is what actually gets a real unit test.
 */

const THRESHOLD = 280;

test("classifyClick: single when there is no prior click", () => {
  assert.equal(classifyClick(1000, null, { x: 5, y: 5 }, null, THRESHOLD), "single");
});

test("classifyClick: double when the second click lands on the same tile within the threshold", () => {
  assert.equal(classifyClick(1200, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "double");
});

test("classifyClick: double at exactly the threshold boundary (inclusive)", () => {
  assert.equal(classifyClick(1000 + THRESHOLD, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "double");
});

test("classifyClick: single when the second click arrives after the threshold", () => {
  assert.equal(classifyClick(1000 + THRESHOLD + 1, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "single");
});

test("classifyClick: single when the second click lands on a DIFFERENT tile, even if fast", () => {
  assert.equal(classifyClick(1050, 1000, { x: 6, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "single");
});

test("classifyClick: uses the default threshold when none is passed", () => {
  assert.equal(classifyClick(1100, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }), "double");
  assert.equal(classifyClick(1000 + 10_000, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }), "single");
});
