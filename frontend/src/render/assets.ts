export type VisualKind = "object" | "item" | "pile" | "player" | "terrain";

/**
 * Everything the renderer needs to draw one visual, regardless of art
 * technology: today only `glyph`/`color` (emoji + flat fill) are populated;
 * `sprite`/`frames`/`scale` are reserved for a future sprite-atlas resolver
 * with zero `Renderer` changes (design.md SEAM 6).
 */
export interface VisualDescriptor {
  glyph?: string;
  color?: string;
  sprite?: string;
  frames?: number;
  scale?: number;
}

export interface AssetResolver {
  resolve(kind: VisualKind, typeId: string, state?: Record<string, unknown>): VisualDescriptor;
}

// MVP sin sprites: los emojis funcionan como stand-in de arte. Moved verbatim
// from render/canvas.ts (design.md File Changes — "emoji/color maps removed").
const TERRAIN_COLORS: Record<string, string> = {
  sand: "#d9c089",
  grass: "#6a9a4f",
  shallow_water: "#4a90c2",
  dense_jungle: "#1f5c3a",
  dirt: "#8a6b4a",
  rocky_ground: "#8a8a8a",
};
const FALLBACK_TERRAIN_COLOR = "#444";

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

// Draw-factor constants pulled from the previous inline calls in
// render/canvas.ts (`drawEmoji(ctx, pos, emoji, factor)`), preserved verbatim
// so identical output is guaranteed.
const OBJECT_SCALE = 0.72;
const ITEM_SCALE = 0.58;
const PILE_SCALE = 0.6;
const PLAYER_SCALE = 0.82;

function objectGlyph(objectTypeId: string, state: Record<string, unknown>): string {
  if (objectTypeId === "campfire") return state?.["lit"] ? "🔥" : "🪵";
  return OBJECT_EMOJI[objectTypeId] ?? UNKNOWN_EMOJI;
}

/**
 * Moves the OBJECT_EMOJI/ITEM_EMOJI/TERRAIN_COLORS maps and the campfire
 * lit/unlit branch out of `render/canvas.ts` verbatim (design.md "Asset
 * Resolver Behind a Function"). The `Renderer` calls `resolve` instead of
 * indexing a local table.
 */
export function createEmojiAssets(): AssetResolver {
  return {
    resolve(kind: VisualKind, typeId: string, state: Record<string, unknown> = {}): VisualDescriptor {
      switch (kind) {
        case "terrain":
          return { color: TERRAIN_COLORS[typeId] ?? FALLBACK_TERRAIN_COLOR };
        case "object":
          return { glyph: objectGlyph(typeId, state), scale: OBJECT_SCALE };
        case "item":
          return { glyph: ITEM_EMOJI[typeId] ?? UNKNOWN_EMOJI, scale: ITEM_SCALE };
        case "pile":
          return { glyph: PILE_EMOJI, scale: PILE_SCALE };
        case "player":
          return { glyph: PLAYER_EMOJI, scale: PLAYER_SCALE };
      }
    },
  };
}
