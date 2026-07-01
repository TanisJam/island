import type { Position } from "../contract";
import type { Frame } from "../view/viewstate";
import { PX } from "./canvas";

/**
 * Single source of truth for the fullscreen player-centered camera
 * (design.md "Renderer camera" + spec "Fullscreen Map with Player-Centered
 * Camera"). Both `render/canvas.ts` (drawing) and `input/mouse.ts`
 * (hit-testing) MUST derive the camera from this module instead of
 * recomputing the offset independently — that's what keeps a click during a
 * movement tween resolve to the exact tile rendered under the cursor.
 */

export type Viewport = { width: number; height: number };
export type ScreenPoint = { x: number; y: number };
export type CameraOffset = { ox: number; oy: number };

/**
 * Rectangle describing where the canvas element sits on screen and how its
 * CSS box maps to its backing pixel buffer. `cssWidth`/`cssHeight` are the
 * element's `getBoundingClientRect()` size; `bufferWidth`/`bufferHeight` are
 * `canvas.width`/`canvas.height`. Kept as plain numbers (not a real
 * `DOMRect`) so `screenToTile` stays pure and unit-testable without a DOM.
 */
export type CanvasRect = {
  left: number;
  top: number;
  cssWidth: number;
  cssHeight: number;
  bufferWidth: number;
  bufferHeight: number;
};

/**
 * Clamps a raw camera translate offset to the map's bounds along one axis:
 * the visible world-space window (`[-offset, viewportSize - offset)`) never
 * extends past `[0, mapSizePx)`. If the map is smaller than the viewport on
 * this axis, clamping to "never show past the edge" is impossible either
 * direction, so the map is centered instead (fix "camera moves too much" —
 * near the middle of a large map the player barely scrolls the view;
 * dragging toward an edge, the camera stops following once the edge is in
 * frame instead of continuing to reveal off-map space).
 */
function clampAxis(rawOffset: number, mapSizePx: number, viewportSize: number): number {
  if (mapSizePx <= viewportSize) return (viewportSize - mapSizePx) / 2;
  const min = viewportSize - mapSizePx; // offset when the map's far edge touches the viewport's far edge
  const max = 0; // offset when the map's near edge touches the viewport's near edge
  return Math.min(Math.max(rawOffset, min), max);
}

/**
 * Centers the camera on the player's (possibly mid-tween) `renderPos`, then
 * clamps the result to the map's bounds (`frame.zone.width/height`) so the
 * view never scrolls past the map edges. Falls back to the zone's geometric
 * center when no player entity is present in the frame (e.g. before the
 * first sync). `+0.5` targets the middle of the player's current tile-space
 * position, matching how tiles are drawn at `tile * PX` with size `PX` in
 * `render/canvas.ts`.
 */
export function cameraOffset(frame: Frame, viewport: Viewport): CameraOffset {
  const player = frame.entities.find((e) => e.kind === "player");
  const camX = (player?.renderPos.x ?? frame.zone.width / 2) + 0.5;
  const camY = (player?.renderPos.y ?? frame.zone.height / 2) + 0.5;
  const rawOx = viewport.width / 2 - camX * PX;
  const rawOy = viewport.height / 2 - camY * PX;
  return {
    ox: clampAxis(rawOx, frame.zone.width * PX, viewport.width),
    oy: clampAxis(rawOy, frame.zone.height * PX, viewport.height),
  };
}

/**
 * Exact inverse of the draw transform: `render/canvas.ts` draws tile `(x,y)`
 * at world pixel `(x*PX + ox, y*PX + oy)`. Given a screen-space point (e.g.
 * `MouseEvent.clientX/clientY`) and the same `offset` used to render the
 * current frame, this returns the integer tile under that point.
 */
export function screenToTile(point: ScreenPoint, canvasRect: CanvasRect, offset: CameraOffset): Position {
  const scaleX = canvasRect.cssWidth === 0 ? 1 : canvasRect.bufferWidth / canvasRect.cssWidth;
  const scaleY = canvasRect.cssHeight === 0 ? 1 : canvasRect.bufferHeight / canvasRect.cssHeight;
  const px = (point.x - canvasRect.left) * scaleX;
  const py = (point.y - canvasRect.top) * scaleY;
  const worldX = px - offset.ox;
  const worldY = py - offset.oy;
  return { x: Math.floor(worldX / PX), y: Math.floor(worldY / PX) };
}
