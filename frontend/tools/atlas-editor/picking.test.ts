import { test } from "node:test";
import assert from "node:assert/strict";
import { footprintFromDrag, pastDragThreshold } from "./picking";

test("footprintFromDrag: a click (start === end) yields a single 16x16 cell", () => {
  assert.deepEqual(footprintFromDrag({ x: 5, y: 5 }, { x: 5, y: 5 }, 16), { x: 0, y: 0, w: 16, h: 16 });
});

test("footprintFromDrag: a vertical 1x2 drag yields {w:16, h:32}", () => {
  assert.deepEqual(footprintFromDrag({ x: 0, y: 0 }, { x: 0, y: 20 }, 16), { x: 0, y: 0, w: 16, h: 32 });
});

test("footprintFromDrag: a horizontal 2x1 drag yields {w:32, h:16}", () => {
  assert.deepEqual(footprintFromDrag({ x: 0, y: 0 }, { x: 20, y: 0 }, 16), { x: 0, y: 0, w: 32, h: 16 });
});

test("footprintFromDrag: direction-agnostic — dragging backward (end before start) yields the same rect", () => {
  assert.deepEqual(footprintFromDrag({ x: 20, y: 20 }, { x: 0, y: 0 }, 16), { x: 0, y: 0, w: 32, h: 32 });
});

test("footprintFromDrag: offset origin — a cell that doesn't start at (0,0)", () => {
  assert.deepEqual(footprintFromDrag({ x: 32, y: 16 }, { x: 32, y: 16 }, 16), { x: 32, y: 16, w: 16, h: 16 });
});

test("pastDragThreshold: false when the pointer barely moved", () => {
  assert.equal(pastDragThreshold({ x: 0, y: 0 }, { x: 1, y: 1 }, 4), false);
});

test("pastDragThreshold: true once movement exceeds the threshold", () => {
  assert.equal(pastDragThreshold({ x: 0, y: 0 }, { x: 10, y: 0 }, 4), true);
});
