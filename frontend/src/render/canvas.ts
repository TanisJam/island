import type { Position } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { visibilityOf } from "../state/visibility";

export const TILE = 16;
export const SCALE = 3;
export const PX = TILE * SCALE; // 48px/tile, matches the 768x576 (16x12) canvas in index.html

const TERRAIN_COLORS: Record<string, string> = {
  sand: "#d9c089",
  grass: "#6a9a4f",
  shallow_water: "#4a90c2",
  dense_jungle: "#1f5c3a",
  dirt: "#8a6b4a",
  rocky_ground: "#8a8a8a",
};
const FALLBACK_TERRAIN_COLOR = "#444";

// MVP sin sprites: los emojis funcionan como stand-in de arte.
const OBJECT_EMOJI: Record<string, string> = {
  tree: "🌳",
  tall_grass: "🌾",
  small_rock: "🪨",
  wreckage: "🚢",
  rustic_table: "🛠️",
};
const ITEM_EMOJI: Record<string, string> = {
  small_stone: "🪨",
  dry_branch: "🪵",
  plant_fiber: "🌿",
  wild_seed: "🌰",
  cloth_scrap: "🧵",
  poor_wood: "🪵",
  bark: "🍂",
  crude_tool: "🔨",
  simple_axe: "🪓",
};
const PLAYER_EMOJI = "🧍";
const PILE_EMOJI = "🪙";
const UNKNOWN_EMOJI = "❔";

const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

function objectEmoji(objectTypeId: string, state: Record<string, unknown>): string {
  if (objectTypeId === "campfire") return state?.["lit"] ? "🔥" : "🪵";
  return OBJECT_EMOJI[objectTypeId] ?? UNKNOWN_EMOJI;
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

function drawSelection(ctx: CanvasRenderingContext2D, pos: Position): void {
  ctx.strokeStyle = "#ffeb3b";
  ctx.lineWidth = 3;
  ctx.strokeRect(pos.x * PX + 1.5, pos.y * PX + 1.5, PX - 3, PX - 3);
}

/**
 * Dibuja el frame: terreno sombreado por la visibilidad RE-DERIVADA (ver
 * state/visibility.ts — load-bearing, nunca confiar en `tile.visibility` directo),
 * y encima objetos / pilas / items en el suelo / jugador como emojis (MVP sin
 * sprites), más el resaltado de selección.
 */
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
    ctx.fillStyle = TERRAIN_COLORS[tile.terrain] ?? FALLBACK_TERRAIN_COLOR;
    ctx.fillRect(px, py, PX, PX);
    if (vis === "explored") {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(px, py, PX, PX);
    }
  }

  for (const obj of snapshot.objects) {
    if (visibilityOf(snapshot, obj.position) === "unseen") continue;
    drawEmoji(ctx, obj.position, objectEmoji(obj.objectTypeId, obj.state as Record<string, unknown>));
  }

  // Items grouped into a pile are drawn as a single pile glyph (+ count), not as N
  // overlapping item emojis, so collect their ids to skip them in the world-item pass.
  const piledItemIds = new Set(snapshot.piles.flatMap((p) => p.itemInstanceIds));

  for (const pile of snapshot.piles) {
    if (visibilityOf(snapshot, pile.position) === "unseen") continue;
    drawEmoji(ctx, pile.position, PILE_EMOJI, 0.6);
    drawCount(ctx, pile.position, pile.itemInstanceIds.length);
  }

  for (const item of snapshot.items) {
    if (item.location.type !== "world") continue;
    if (piledItemIds.has(item.id)) continue;
    const pos = { x: item.location.x, y: item.location.y };
    if (visibilityOf(snapshot, pos) === "unseen") continue;
    drawEmoji(ctx, pos, ITEM_EMOJI[item.itemTypeId] ?? UNKNOWN_EMOJI, 0.58);
  }

  // Jugador: un halo suave para que "vos" se distinga, y el emoji encima.
  const p = snapshot.player.position;
  ctx.fillStyle = "rgba(255,240,120,0.28)";
  ctx.beginPath();
  ctx.arc(p.x * PX + PX / 2, p.y * PX + PX / 2, PX * 0.44, 0, Math.PI * 2);
  ctx.fill();
  drawEmoji(ctx, p, PLAYER_EMOJI, 0.82);

  if (selectedPos) drawSelection(ctx, selectedPos);
}
