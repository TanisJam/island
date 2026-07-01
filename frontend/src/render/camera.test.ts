import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame, RenderEntity } from "../view/viewstate";
import { cameraOffset, screenToTile, type CanvasRect } from "./camera";
import { PX } from "./canvas";

function player(renderPos: { x: number; y: number }): RenderEntity {
  return { id: "p1", kind: "player", typeId: "player", renderPos, visibility: "visible" };
}

function frameWith(entities: RenderEntity[], zone = { width: 32, height: 24 }): Frame {
  return { zone, tiles: [], entities, clockMs: 0 };
}

const IDENTITY_RECT: CanvasRect = { left: 0, top: 0, cssWidth: 800, cssHeight: 600, bufferWidth: 800, bufferHeight: 600 };

test("cameraOffset centers the viewport on the player's renderPos", () => {
  const frame = frameWith([player({ x: 5, y: 5 })]);
  const offset = cameraOffset(frame, { width: 800, height: 600 });
  // camX = 5.5, camY = 5.5 -> ox = 400 - 5.5*PX, oy = 300 - 5.5*PX
  assert.equal(offset.ox, 400 - 5.5 * PX);
  assert.equal(offset.oy, 300 - 5.5 * PX);
});

test("cameraOffset falls back to the zone's geometric center when there is no player entity", () => {
  const frame = frameWith([], { width: 32, height: 24 });
  const offset = cameraOffset(frame, { width: 800, height: 600 });
  assert.equal(offset.ox, 400 - (32 / 2 + 0.5) * PX);
  assert.equal(offset.oy, 300 - (24 / 2 + 0.5) * PX);
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
