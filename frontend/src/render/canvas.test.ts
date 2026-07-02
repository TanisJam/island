import { test } from "node:test";
import assert from "node:assert/strict";
import { PX, SCALE, spriteDrawRect } from "./canvas";

// Table-driven over the design's worked examples (design.md "Consumer + draw
// math"): a single formula serves the single-tile, tall-multi-cell, and
// wide-multi-cell cases with no special-casing (spec "Bottom-aligned anchor
// for multi-cell sprites").
const CASES: {
  name: string;
  tileX: number;
  tileY: number;
  region: { sw: number; sh: number };
  expected: { dx: number; dy: number; dw: number; dh: number };
}[] = [
  {
    name: "16x16 single-tile terrain: no offset, aligned to the tile's top-left",
    tileX: 2,
    tileY: 3,
    region: { sw: 16, sh: 16 },
    expected: { dx: 2 * PX, dy: 3 * PX, dw: PX, dh: PX },
  },
  {
    name: "16x32 (1x2) tall object: bottom-aligned, extends one tile upward",
    tileX: 0,
    tileY: 5,
    region: { sw: 16, sh: 32 },
    expected: { dx: 0, dy: 5 * PX - PX, dw: PX, dh: 2 * PX },
  },
  {
    name: "32x16 (2x1) wide object: left-aligned, extends one tile rightward, no vertical offset",
    tileX: 4,
    tileY: 1,
    region: { sw: 32, sh: 16 },
    expected: { dx: 4 * PX, dy: 1 * PX, dw: 2 * PX, dh: PX },
  },
];

for (const c of CASES) {
  test(`spriteDrawRect: ${c.name}`, () => {
    const rect = spriteDrawRect(c.tileX, c.tileY, c.region, PX, SCALE);
    assert.deepEqual(rect, c.expected);
  });
}

test("spriteDrawRect: bottom edge of a tall region always lands exactly on the tile's bottom edge", () => {
  const rect = spriteDrawRect(0, 0, { sw: 16, sh: 32 }, PX, SCALE);
  assert.equal(rect.dy + rect.dh, PX, "region's bottom (dy + dh) must equal the logical tile's bottom (1 * PX)");
});
