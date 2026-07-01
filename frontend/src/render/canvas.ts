import type { Position } from "../contract";
import type { AssetResolver } from "./assets";
import type { Renderer } from "./renderer";
import type { Frame, RenderEntity } from "../view/viewstate";

export const TILE = 16;
export const SCALE = 3;
export const PX = TILE * SCALE; // 48px/tile, matches the 768x576 (16x12) canvas in index.html

const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
const FALLBACK_TERRAIN_COLOR = "#444";

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

function drawSelection(ctx: CanvasRenderingContext2D, pos: Position): void {
  ctx.strokeStyle = "#ffeb3b";
  ctx.lineWidth = 3;
  ctx.strokeRect(pos.x * PX + 1.5, pos.y * PX + 1.5, PX - 3, PX - 3);
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

      if (selection) drawSelection(ctx, selection);
    },

    destroy(): void {
      // Canvas 2D holds no external resources to release.
    },
  };
}
