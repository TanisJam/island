import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSavePayload, imagePxFromClientPoint, previewScale } from "./texture-panel-math";

test("previewScale: a 16x16 region fits into 96px at integer scale 6 (nearest-neighbor, no upscale blur)", () => {
  assert.deepEqual(previewScale({ w: 16, h: 16 }, 96), { scale: 6, dw: 96, dh: 96 });
});

test("previewScale: a non-square region keeps a single uniform scale (aspect preserved)", () => {
  // 32x16 into 96 -> limited by width: floor(96/32)=3, floor(96/16)=6 -> min=3
  assert.deepEqual(previewScale({ w: 32, h: 16 }, 96), { scale: 3, dw: 96, dh: 48 });
});

test("previewScale: never scales below 1x even if the region is larger than maxPx", () => {
  assert.deepEqual(previewScale({ w: 200, h: 50 }, 96), { scale: 1, dw: 200, dh: 50 });
});

test("previewScale: degenerate (zero/negative) region falls back to scale 1 instead of throwing", () => {
  assert.deepEqual(previewScale({ w: 0, h: 16 }, 96), { scale: 1, dw: 0, dh: 16 });
  assert.deepEqual(previewScale({ w: 16, h: -4 }, 96), { scale: 1, dw: 16, dh: -4 });
});

test("previewScale: degenerate maxPx falls back to scale 1", () => {
  assert.deepEqual(previewScale({ w: 16, h: 16 }, 0), { scale: 1, dw: 16, dh: 16 });
});

test("buildSavePayload: a picked footprint builds a {typeId, kind, region} payload with exactly x/y/w/h", () => {
  const payload = buildSavePayload("simple_axe", "item", { x: 32, y: 1232, w: 16, h: 16 });
  assert.deepEqual(payload, { typeId: "simple_axe", kind: "item", region: { x: 32, y: 1232, w: 16, h: 16 } });
});

test("buildSavePayload: a null region (cleared selection) builds a {typeId, kind, clear:true} payload", () => {
  const payload = buildSavePayload("simple_axe", "item", null);
  assert.deepEqual(payload, { typeId: "simple_axe", kind: "item", clear: true });
});

test("buildSavePayload: carries a non-item kind through unchanged (Slice 3b atlasKind generalization)", () => {
  const payload = buildSavePayload("sand", "terrain", { x: 16, y: 112, w: 16, h: 16 });
  assert.deepEqual(payload, { typeId: "sand", kind: "terrain", region: { x: 16, y: 112, w: 16, h: 16 } });
});

test("buildSavePayload: never leaks extra properties from a region-shaped object beyond x/y/w/h", () => {
  const hostile = { x: 1, y: 2, w: 3, h: 4, atlas: "EVIL", path: "../../etc" } as unknown as {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  const payload = buildSavePayload("t", "item", hostile);
  assert.deepEqual(payload, { typeId: "t", kind: "item", region: { x: 1, y: 2, w: 3, h: 4 } });
});

test("imagePxFromClientPoint: divides client coords by zoom relative to the canvas origin", () => {
  const point = imagePxFromClientPoint({ x: 108, y: 54 }, { x: 20, y: 10 }, 4);
  assert.deepEqual(point, { x: 22, y: 11 });
});

test("imagePxFromClientPoint: zoom 1 is a plain offset subtraction", () => {
  const point = imagePxFromClientPoint({ x: 50, y: 60 }, { x: 10, y: 10 }, 1);
  assert.deepEqual(point, { x: 40, y: 50 });
});
