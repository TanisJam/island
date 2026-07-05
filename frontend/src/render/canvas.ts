import type { Position } from "../contract";
import type { AssetResolver, SpriteRegion } from "./assets";
import type { Renderer } from "./renderer";
import type { Frame, RenderEntity } from "../view/viewstate";
import { cameraOffset } from "./camera";
import { TILE, SCALE, PX } from "./constants";

export { TILE, SCALE, PX };

const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
const FALLBACK_TERRAIN_COLOR = "#444";
const BRASA = "#f0a24e"; // spec "Light-Semantics Visual Identity" — selection ring uses the brasa token

/** `render/camera.ts` is the single source of truth for the camera (design.md
 * "Renderer camera" + spec "Fullscreen Map with Player-Centered Camera").
 * Both modules import `PX` from `constants.ts` (not from each other), and
 * this module imports `cameraOffset` from `camera.ts` — a one-way dependency
 * from this module onto `camera.ts`. `input/mouse.ts` MUST call the same
 * `cameraOffset` for hit-testing — never recompute the offset independently
 * — or a click during a movement tween could resolve to a different tile
 * than the one drawn under it. */

/** True when the user has requested reduced motion — gates the optional
 * selection-ring pulse (spec "Reduced motion respected"). Guarded so this
 * module stays safe to import under Node (`node:test` has no `matchMedia`). */
function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function drawEmoji(ctx: CanvasRenderingContext2D, pos: Position, emoji: string, factor = 0.72): void {
  ctx.font = `${Math.floor(PX * factor)}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, pos.x * PX + PX / 2, pos.y * PX + PX / 2 + 1);
}

/**
 * Pure bottom-aligned draw-rect math for a sprite region (design.md
 * "Consumer + draw math"). `dy` anchors the region's BOTTOM edge to the
 * bottom of the logical tile `(tileX, tileY)`, extending upward for regions
 * taller than one tile; `dx` always aligns to the tile's left edge, so wider
 * regions extend rightward. A 16x16 (single-tile) region degenerates to
 * `dy = tileY * px` (no offset) — same formula serves both cases, no
 * special-casing needed (spec "Bottom-aligned anchor for multi-cell
 * sprites").
 */
export function spriteDrawRect(
  tileX: number,
  tileY: number,
  region: { sw: number; sh: number },
  px: number,
  scale: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const dw = region.sw * scale;
  const dh = region.sh * scale;
  const dx = tileX * px;
  const dy = tileY * px + px - dh;
  return { dx, dy, dw, dh };
}

/** Thin drawImage shell (design.md "Testability hooks" — kept untested,
 * `spriteDrawRect` carries all the logic worth unit-testing). Disables
 * smoothing per-call so pixel art stays crisp regardless of any other
 * context state (`#game`'s `image-rendering: pixelated` CSS already covers
 * the common case — this is defense in depth). */
function drawSprite(ctx: CanvasRenderingContext2D, pos: Position, region: SpriteRegion): void {
  const rect = spriteDrawRect(pos.x, pos.y, region, PX, SCALE);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(region.image, region.sx, region.sy, region.sw, region.sh, rect.dx, rect.dy, rect.dw, rect.dh);
}

/** Small "×N" badge in the bottom-right of a tile, used to show how many items a pile
 *  holds. Stroked then filled so it stays legible over any terrain or glyph. */
function drawCount(ctx: CanvasRenderingContext2D, pos: Position, n: number): void {
  ctx.font = `bold ${Math.floor(PX * 0.28)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = pos.x * PX + PX * 0.74;
  const cy = pos.y * PX + PX * 0.74;
  const label = `×${n}`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.strokeText(label, cx, cy);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, cx, cy);
}

/** Brasa selection ring (spec "Light-Semantics State Treatments" — "the
 * selection shows a brasa ring"). Pulses gently via `frame.clockMs`, same
 * global anim clock the loop already advances every tick; suppressed to a
 * static ring when `prefers-reduced-motion` is set. */
function drawSelection(ctx: CanvasRenderingContext2D, pos: Position, clockMs: number): void {
  const pulse = prefersReducedMotion() ? 1 : 0.7 + 0.3 * Math.sin(clockMs / 260);
  ctx.strokeStyle = BRASA;
  ctx.lineWidth = 3;
  ctx.globalAlpha = pulse;
  ctx.strokeRect(pos.x * PX + 1.5, pos.y * PX + 1.5, PX - 3, PX - 3);
  ctx.globalAlpha = 1;
}

/**
 * "Action in progress" cue drawn OVER the avatar while `ActionPacing.isWorking()`
 * (the deferred `durationMs` window — same window that shows the "Trabajando…"
 * teletype). A brasa arc spinning around a dark backing disc just above the
 * player's head, animated off `clockMs` — the SAME global anim clock the
 * selection-ring pulse already rides (`drawSelection`). Under reduced motion
 * the arc is static (no rotation), mirroring how `drawSelection` freezes its
 * pulse. Purely cosmetic: reads no snapshot, gated entirely by the `busy` flag
 * threaded into `render`. */
function drawBusyIndicator(ctx: CanvasRenderingContext2D, pos: Position, clockMs: number): void {
  const cx = pos.x * PX + PX / 2;
  const cy = pos.y * PX - PX * 0.08; // just above the tile's top edge (over the head)
  const r = PX * 0.16;
  // Dark backing disc so the arc stays legible over any terrain or glyph
  // (same legibility trick as drawCount's stroke-then-fill).
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.fill();
  // A 3/4 arc; its start angle sweeps with the clock so it reads as spinning.
  const start = prefersReducedMotion() ? 0 : (clockMs / 140) % (Math.PI * 2);
  ctx.strokeStyle = BRASA;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + Math.PI * 1.5);
  ctx.stroke();
  ctx.lineCap = "butt";
}

/**
 * Canvas 2D implementation of `Renderer` (design.md SEAM 4). Draws
 * EXCLUSIVELY from the `Frame` produced by `ViewState.frame()`: terrain and
 * entity visibility are read from the frame, NEVER recomputed via
 * `visibilityOf`, and it NEVER receives a `ClientSnapshot`. Visuals come
 * from `AssetResolver.resolve`, never from a local emoji/color table.
 *
 * Draw order is enforced explicitly (object -> pile -> item -> player) to
 * match the previous inline behavior in render/canvas.ts, regardless of the
 * iteration order `Frame.entities` happens to carry.
 */
export function createCanvasRenderer(ctx: CanvasRenderingContext2D, assets: AssetResolver): Renderer {
  function drawObjectOrItem(entity: RenderEntity): void {
    if (entity.visibility === "unseen") return;
    const visual = assets.resolve(entity.kind, entity.typeId, entity.state);
    if (visual.sprite) drawSprite(ctx, entity.renderPos, visual.sprite);
    else drawEmoji(ctx, entity.renderPos, visual.glyph ?? "", visual.scale);
  }

  function drawPile(entity: RenderEntity): void {
    if (entity.visibility === "unseen") return;
    const visual = assets.resolve("pile", entity.typeId);
    if (visual.sprite) drawSprite(ctx, entity.renderPos, visual.sprite);
    else drawEmoji(ctx, entity.renderPos, visual.glyph ?? "", visual.scale);
    if (entity.count !== undefined) drawCount(ctx, entity.renderPos, entity.count);
  }

  // Jugador: un halo suave para que "vos" se distinga, y el sprite/emoji encima.
  // Always drawn regardless of `visibility` — matches the previous behavior,
  // where the player's own position was never fog-culled.
  function drawPlayer(entity: RenderEntity): void {
    const p = entity.renderPos;
    ctx.fillStyle = "rgba(255,240,120,0.28)";
    ctx.beginPath();
    ctx.arc(p.x * PX + PX / 2, p.y * PX + PX / 2, PX * 0.44, 0, Math.PI * 2);
    ctx.fill();
    const visual = assets.resolve("player", entity.typeId);
    if (visual.sprite) drawSprite(ctx, p, visual.sprite);
    else drawEmoji(ctx, p, visual.glyph ?? "", visual.scale);
  }

  return {
    resize(width: number, height: number): void {
      ctx.canvas.width = width;
      ctx.canvas.height = height;
    },

    render(frame: Frame, selection: Position | null, busy = false): void {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // Fullscreen, player-centered camera (spec "Fullscreen Map with
      // Player-Centered Camera"): every draw below happens inside this
      // translate, in tile space, exactly as before — only the origin moved.
      const offset = cameraOffset(frame, { width: ctx.canvas.width, height: ctx.canvas.height });
      ctx.save();
      ctx.translate(offset.ox, offset.oy);

      for (const tile of frame.tiles) {
        const px = tile.x * PX;
        const py = tile.y * PX;
        if (tile.visibility === "unseen") {
          ctx.fillStyle = "#000";
          ctx.fillRect(px, py, PX, PX);
          continue;
        }
        // Terrain has NO glyph fallback (unlike entities), so it needs its
        // own fill-OR-sprite branch rather than reusing the entity
        // `sprite ? drawSprite : drawEmoji` shape (design.md "canvas.ts has
        // TWO draw paths"). Without this explicit branch a mapped terrain
        // (e.g. sand) would resolve to `{sprite: ...}` with `.color`
        // undefined and silently fall through to the gray fallback color,
        // never drawing the sprite.
        const v = assets.resolve("terrain", tile.terrain);
        if (v.sprite) drawSprite(ctx, { x: tile.x, y: tile.y }, v.sprite);
        else {
          ctx.fillStyle = v.color ?? FALLBACK_TERRAIN_COLOR;
          ctx.fillRect(px, py, PX, PX);
        }
        if (tile.visibility === "explored") {
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(px, py, PX, PX);
        }
      }

      for (const entity of frame.entities) if (entity.kind === "object") drawObjectOrItem(entity);
      for (const entity of frame.entities) if (entity.kind === "pile") drawPile(entity);
      for (const entity of frame.entities) if (entity.kind === "item") drawObjectOrItem(entity);
      for (const entity of frame.entities) {
        if (entity.kind !== "player") continue;
        drawPlayer(entity);
        // Anchored to the player's INTERPOLATED renderPos so it tracks the
        // avatar in tile-space (moves with the camera), drawn last over the
        // player so it's never occluded. Only while an action is in progress.
        if (busy) drawBusyIndicator(ctx, entity.renderPos, frame.clockMs);
      }

      if (selection) drawSelection(ctx, selection, frame.clockMs);

      ctx.restore();
    },

    destroy(): void {
      // Canvas 2D holds no external resources to release.
    },
  };
}
