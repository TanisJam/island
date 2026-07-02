export type VisualKind = "object" | "item" | "pile" | "player" | "terrain";

/**
 * A drawable region inside a loaded tileset image. Self-contained (carries
 * its own `image`) so the `Renderer` can draw a sprite without ever knowing
 * about an atlas (design.md "Load-bearing seam decision").
 */
export interface SpriteRegion {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Everything the renderer needs to draw one visual, regardless of art
 * technology: `glyph`/`color` (emoji + flat fill) or `sprite` (tileset
 * region) — mutually exclusive per draw call (design.md SEAM 6).
 */
export interface VisualDescriptor {
  glyph?: string;
  color?: string;
  sprite?: SpriteRegion;
  frames?: number;
  scale?: number;
}

export interface AssetResolver {
  resolve(kind: VisualKind, typeId: string, state?: Record<string, unknown>): VisualDescriptor;
}

/** One mapped region inside `atlas.json`, in tileset pixel coordinates.
 * `frames` is reserved for future animation support and ignored by this
 * v1 consumer (spec "Out of Scope"). */
export interface AtlasRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  frames?: number;
}

/** `pile` has no atlas entry (design.md Atlas JSON schema) — it always
 * resolves through the emoji fallback. */
export type AtlasKind = Exclude<VisualKind, "pile">;

/** Frozen per-kind nested atlas schema (design.md "Atlas JSON schema
 * (frozen)"). `image` is the tileset filename, `tile` is the tool's picking
 * grid size in px (not used by this consumer). */
export interface Atlas {
  image: string;
  tile: number;
  terrain?: Record<string, AtlasRegion>;
  object?: Record<string, AtlasRegion>;
  item?: Record<string, AtlasRegion>;
  player?: Record<string, AtlasRegion>;
}

const ATLAS_KINDS: AtlasKind[] = ["terrain", "object", "item", "player"];

/** `true` when every entry in a per-kind bucket has numeric `x`/`y`/`w`/`h`
 * (the atlas-editor tool is now a second producer of this file — batch-2
 * gate review flagged that a merely-object-shaped-but-non-numeric entry,
 * e.g. `{ sand: { x: "0", y: 0, w: 16, h: 16 } }`, previously passed
 * validation silently and would only fail later, deep inside draw math). */
function hasValidRegionShape(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const region = value as Record<string, unknown>;
  return (
    typeof region.x === "number" &&
    typeof region.y === "number" &&
    typeof region.w === "number" &&
    typeof region.h === "number"
  );
}

/**
 * Validates and returns the parsed `atlas.json` payload, or throws on any
 * malformed shape. The caller (game.ts boot) is responsible for catching
 * this and falling back to `createEmojiAssets()` — this function itself
 * never swallows errors (design.md "Boot failure" — soft-fallback lives at
 * the call site, not here). Beyond the per-kind bucket shape, every entry
 * inside a bucket must carry numeric `x`/`y`/`w`/`h` — a malformed single
 * entry throws rather than silently producing a region that fails later at
 * draw time.
 */
export function parseAtlas(json: unknown): Atlas {
  if (typeof json !== "object" || json === null) throw new Error("Invalid atlas: root is not an object");
  const obj = json as Record<string, unknown>;
  if (typeof obj.image !== "string") throw new Error("Invalid atlas: 'image' must be a string");
  if (typeof obj.tile !== "number") throw new Error("Invalid atlas: 'tile' must be a number");
  for (const kind of ATLAS_KINDS) {
    const value = obj[kind];
    if (value === undefined) continue;
    if (typeof value !== "object" || value === null) {
      throw new Error(`Invalid atlas: '${kind}' must be an object when present`);
    }
    for (const [typeId, region] of Object.entries(value as Record<string, unknown>)) {
      if (!hasValidRegionShape(region)) {
        throw new Error(`Invalid atlas: '${kind}.${typeId}' must have numeric x/y/w/h`);
      }
    }
  }
  return obj as unknown as Atlas;
}

/** Pure lookup (design.md "Consumer + draw math"): `atlas[kind]?.[typeId]`,
 * `null` when unmapped. `kind: "pile"` is excluded at the type level — piles
 * never have an atlas entry. */
export function lookupRegion(atlas: Atlas, kind: AtlasKind, typeId: string): AtlasRegion | null {
  return atlas[kind]?.[typeId] ?? null;
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

/**
 * Decorates `createEmojiAssets()`: a mapped `typeId` resolves to a `.sprite`
 * region; anything unmapped (including all `pile`s, which never have an
 * atlas entry) delegates verbatim to the wrapped emoji resolver — no
 * duplicated glyph/color logic (spec "createSpriteAssets implements
 * AssetResolver unchanged").
 */
export function createSpriteAssets(atlas: Atlas, image: CanvasImageSource): AssetResolver {
  const fallback = createEmojiAssets();
  return {
    resolve(kind: VisualKind, typeId: string, state: Record<string, unknown> = {}): VisualDescriptor {
      if (kind === "pile") return fallback.resolve(kind, typeId, state);
      const region = lookupRegion(atlas, kind, typeId);
      if (!region) return fallback.resolve(kind, typeId, state);
      return { sprite: { image, sx: region.x, sy: region.y, sw: region.w, sh: region.h } };
    },
  };
}
