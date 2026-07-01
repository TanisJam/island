import type { Position } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { visibilityOf } from "../state/visibility";
import type { AssetResolver } from "./assets";
import { createEmojiAssets } from "./assets";
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

// ---------------------------------------------------------------------------
// TEMPORARY SHIM — kept only so `main.ts` keeps compiling before the Phase 5
// migration (tasks.md 3.1). Delete this export (tasks.md 5.3) once main.ts
// builds its loop from `createGame`/`createCanvasRenderer` instead. Uses the
// same `AssetResolver` as the seam above (no local emoji/color tables), but
// still reads directly from `ClientSnapshot` + `visibilityOf`, matching the
// pre-refactor behavior exactly.
// ---------------------------------------------------------------------------
const legacyAssets: AssetResolver = createEmojiAssets();

export function render(ctx: CanvasRenderingContext2D, snapshot: ClientSnapshot, selectedPos: Position | null): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (const tile of snapshot.tiles) {
    const vis = visibilityOf(snapshot, { x: tile.x, y: tile.y });
    const px = tile.x * PX;
    const py = tile.y * PX;
    if (vis === "unseen") {
      ctx.fillStyle = "#000";
      ctx.fillRect(px, py, PX, PX);
      continue;
    }
    ctx.fillStyle = legacyAssets.resolve("terrain", tile.terrain).color ?? FALLBACK_TERRAIN_COLOR;
    ctx.fillRect(px, py, PX, PX);
    if (vis === "explored") {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(px, py, PX, PX);
    }
  }

  for (const obj of snapshot.objects) {
    if (visibilityOf(snapshot, obj.position) === "unseen") continue;
    const visual = legacyAssets.resolve("object", obj.objectTypeId, obj.state as Record<string, unknown>);
    drawEmoji(ctx, obj.position, visual.glyph ?? "", visual.scale);
  }

  // Items grouped into a pile are drawn as a single pile glyph (+ count), not as N
  // overlapping item emojis, so collect their ids to skip them in the world-item pass.
  const piledItemIds = new Set(snapshot.piles.flatMap((p) => p.itemInstanceIds));

  for (const pile of snapshot.piles) {
    if (visibilityOf(snapshot, pile.position) === "unseen") continue;
    const visual = legacyAssets.resolve("pile", pile.itemTypeId);
    drawEmoji(ctx, pile.position, visual.glyph ?? "", visual.scale);
    drawCount(ctx, pile.position, pile.itemInstanceIds.length);
  }

  for (const item of snapshot.items) {
    if (item.location.type !== "world") continue;
    if (piledItemIds.has(item.id)) continue;
    const pos = { x: item.location.x, y: item.location.y };
    if (visibilityOf(snapshot, pos) === "unseen") continue;
    const visual = legacyAssets.resolve("item", item.itemTypeId);
    drawEmoji(ctx, pos, visual.glyph ?? "", visual.scale);
  }

  const p = snapshot.player.position;
  ctx.fillStyle = "rgba(255,240,120,0.28)";
  ctx.beginPath();
  ctx.arc(p.x * PX + PX / 2, p.y * PX + PX / 2, PX * 0.44, 0, Math.PI * 2);
  ctx.fill();
  const playerVisual = legacyAssets.resolve("player", "player");
  drawEmoji(ctx, p, playerVisual.glyph ?? "", playerVisual.scale);

  if (selectedPos) drawSelection(ctx, selectedPos);
}
