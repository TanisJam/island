import type { Position } from "../contract";
import type { AssetResolver } from "./assets";
import type { Renderer } from "./renderer";
import type { Frame, RenderEntity } from "../view/viewstate";
import { cameraOffset } from "./camera";

export const TILE = 16;
export const SCALE = 3;
export const PX = TILE * SCALE; // 48px/tile

const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
const FALLBACK_TERRAIN_COLOR = "#444";
const BRASA = "#f0a24e"; // spec "Light-Semantics Visual Identity" — selection ring uses the brasa token

/** `render/camera.ts` is the single source of truth for the camera (design.md
 * "Renderer camera" + spec "Fullscreen Map with Player-Centered Camera").
 * `camera.ts` imports `PX` from here, and this module imports `cameraOffset`
 * back from `camera.ts` — a deliberate two-way ES-module reference. Both
 * sides only ever read the other's export from inside function bodies
 * invoked after both modules finish loading (never at top level), so the
 * cycle is safe. `input/mouse.ts` MUST call the same `cameraOffset` for
 * hit-testing — never recompute the offset independently — or a click during
 * a movement tween could resolve to a different tile than the one drawn
 * under it. */

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
    drawEmoji(ctx, entity.renderPos, visual.glyph ?? "", visual.scale);
  }

  function drawPile(entity: RenderEntity): void {
    if (entity.visibility === "unseen") return;
    const visual = assets.resolve("pile", entity.typeId);
    drawEmoji(ctx, entity.renderPos, visual.glyph ?? "", visual.scale);
    if (entity.count !== undefined) drawCount(ctx, entity.renderPos, entity.count);
  }

  // Jugador: un halo suave para que "vos" se distinga, y el emoji encima.
  // Always drawn regardless of `visibility` — matches the previous behavior,
  // where the player's own position was never fog-culled.
  function drawPlayer(entity: RenderEntity): void {
    const p = entity.renderPos;
    ctx.fillStyle = "rgba(255,240,120,0.28)";
    ctx.beginPath();
    ctx.arc(p.x * PX + PX / 2, p.y * PX + PX / 2, PX * 0.44, 0, Math.PI * 2);
    ctx.fill();
    const visual = assets.resolve("player", entity.typeId);
    drawEmoji(ctx, p, visual.glyph ?? "", visual.scale);
  }

  return {
    resize(width: number, height: number): void {
      ctx.canvas.width = width;
      ctx.canvas.height = height;
    },

    render(frame: Frame, selection: Position | null): void {
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
        ctx.fillStyle = assets.resolve("terrain", tile.terrain).color ?? FALLBACK_TERRAIN_COLOR;
        ctx.fillRect(px, py, PX, PX);
        if (tile.visibility === "explored") {
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(px, py, PX, PX);
        }
      }

      for (const entity of frame.entities) if (entity.kind === "object") drawObjectOrItem(entity);
      for (const entity of frame.entities) if (entity.kind === "pile") drawPile(entity);
      for (const entity of frame.entities) if (entity.kind === "item") drawObjectOrItem(entity);
      for (const entity of frame.entities) if (entity.kind === "player") drawPlayer(entity);

      if (selection) drawSelection(ctx, selection, frame.clockMs);

      ctx.restore();
    },

    destroy(): void {
      // Canvas 2D holds no external resources to release.
    },
  };
}
