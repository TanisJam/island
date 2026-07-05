import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame, RenderEntity } from "../view/viewstate";
import { cameraOffset, screenToTile, type CanvasRect } from "./camera";
import { PX } from "./constants";

function player(renderPos: { x: number; y: number }): RenderEntity {
  return { id: "p1", kind: "player", typeId: "player", renderPos, visibility: "visible" };
}

function frameWith(entities: RenderEntity[], zone = { width: 32, height: 24 }): Frame {
  return { zone, tiles: [], entities, clockMs: 0 };
}

const IDENTITY_RECT: CanvasRect = { left: 0, top: 0, cssWidth: 800, cssHeight: 600, bufferWidth: 800, bufferHeight: 600 };

test("cameraOffset centers exactly on the player when far enough from every edge (no clamp)", () => {
  // A 40x30 zone, player at its center: the raw centering offset stays well
  // inside the clamp range on both axes, so this is a pure test of the
  // (unclamped) centering formula.
  const frame = frameWith([player({ x: 20, y: 15 })], { width: 40, height: 30 });
  const offset = cameraOffset(frame, { width: 800, height: 600 });
  // camX = 20.5, camY = 15.5 -> ox = 400 - 20.5*PX, oy = 300 - 15.5*PX
  assert.equal(offset.ox, 400 - 20.5 * PX);
  assert.equal(offset.oy, 300 - 15.5 * PX);
});

test("cameraOffset falls back to the zone's geometric center when there is no player entity", () => {
  const frame = frameWith([], { width: 32, height: 24 });
  const offset = cameraOffset(frame, { width: 800, height: 600 });
  assert.equal(offset.ox, 400 - (32 / 2 + 0.5) * PX);
  assert.equal(offset.oy, 300 - (24 / 2 + 0.5) * PX);
});

// --- camera clamp to map bounds (fix "camera moves too much") -------------

test("cameraOffset clamps to the map's near edge (top-left) when the player is close to it", () => {
  // 32x24 zone, player near the top-left corner: the raw centering offset
  // would show empty space beyond the map's edge, so it clamps to 0 (the
  // map's own edge touches the viewport's edge) instead.
  const frame = frameWith([player({ x: 5, y: 5 })], { width: 32, height: 24 });
  const offset = cameraOffset(frame, { width: 800, height: 600 });
  assert.equal(offset.ox, 0);
  assert.equal(offset.oy, 0);
});

test("cameraOffset clamps to the map's far edge (bottom-right) when the player is close to it", () => {
  const frame = frameWith([player({ x: 30, y: 22 })], { width: 32, height: 24 });
  const offset = cameraOffset(frame, { width: 800, height: 600 });
  const mapWidthPx = 32 * PX;
  const mapHeightPx = 24 * PX;
  assert.equal(offset.ox, 800 - mapWidthPx, "clamps so the map's right edge aligns with the viewport's right edge");
  assert.equal(offset.oy, 600 - mapHeightPx, "clamps so the map's bottom edge aligns with the viewport's bottom edge");
});

test("cameraOffset centers a map smaller than the viewport instead of clamping to a degenerate range", () => {
  const frame = frameWith([player({ x: 3, y: 2 })], { width: 6, height: 4 });
  const offset = cameraOffset(frame, { width: 800, height: 600 });
  const mapWidthPx = 6 * PX;
  const mapHeightPx = 4 * PX;
  assert.equal(offset.ox, (800 - mapWidthPx) / 2);
  assert.equal(offset.oy, (600 - mapHeightPx) / 2);
});

test("screenToTile inverts cameraOffset: clicking the center of a rendered tile resolves to that tile", () => {
  const frame = frameWith([player({ x: 5, y: 5 })]);
  const offset = cameraOffset(frame, { width: 800, height: 600 });

  // Tile (tx, ty) is drawn at world pixel (tx*PX + offset.ox, ty*PX + offset.oy).
  // Click at the CENTER of tile (9, 2) and expect that exact tile back.
  const tx = 9;
  const ty = 2;
  const point = { x: tx * PX + offset.ox + PX / 2, y: ty * PX + offset.oy + PX / 2 };
  const tile = screenToTile(point, IDENTITY_RECT, offset);
  assert.deepEqual(tile, { x: tx, y: ty });
});

test("screenToTile round-trips correctly when the player is mid-tween (fractional renderPos)", () => {
  // Player halfway between (5,5) and (6,5): renderPos.x = 5.5.
  const frame = frameWith([player({ x: 5.5, y: 5 })]);
  const offset = cameraOffset(frame, { width: 800, height: 600 });

  const tx = 3;
  const ty = 7;
  const point = { x: tx * PX + offset.ox + PX / 2, y: ty * PX + offset.oy + PX / 2 };
  const tile = screenToTile(point, IDENTITY_RECT, offset);
  assert.deepEqual(tile, { x: tx, y: ty }, "click resolves to the exact tile rendered under the cursor, even mid-tween");
});

test("screenToTile accounts for CSS scaling (buffer size != CSS box size)", () => {
  const frame = frameWith([player({ x: 0, y: 0 })]);
  const offset = cameraOffset(frame, { width: 800, height: 600 });
  const rect: CanvasRect = { left: 10, top: 20, cssWidth: 400, cssHeight: 300, bufferWidth: 800, bufferHeight: 600 };

  const tx = 4;
  const ty = 1;
  // World pixel center of tile (tx,ty), converted back into a CSS-space client point
  // (scale factor 0.5, plus the rect's screen offset).
  const worldCx = tx * PX + offset.ox + PX / 2;
  const worldCy = ty * PX + offset.oy + PX / 2;
  const point = { x: worldCx / 2 + rect.left, y: worldCy / 2 + rect.top };

  const tile = screenToTile(point, rect, offset);
  assert.deepEqual(tile, { x: tx, y: ty });
});
