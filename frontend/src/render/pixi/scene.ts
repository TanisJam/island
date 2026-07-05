import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { AssetResolver, VisualDescriptor } from "../assets";
import type { Frame, RenderEntity, Visibility } from "../../view/viewstate";
import { PX, SCALE } from "../constants";
import type { TextureProvider } from "./textures";

const FALLBACK_TERRAIN_COLOR = "#444";

/** Fog tint per visibility state (design.md D1). `visible` = no tint
 * (`0xffffff` multiplies every channel by 1, a no-op); `explored` dims the
 * terrain to approximate `render/canvas.ts`'s 45%-black overlay; `unseen`
 * tints fully black, which reads identically to Canvas's solid black
 * fill-rect regardless of the underlying texture. Tiles are always drawn
 * (never hidden via `.visible`) — matches Canvas, which never skips a tile
 * draw, it only ever changes what color/overlay is drawn on top. */
const FOG_TINT: Record<Visibility, number> = {
  visible: 0xffffff,
  explored: 0x737373,
  unseen: 0x000000,
};

/** Text-node factory, injected (design.md D6) so this module never
 * constructs Pixi `Text` directly at a call site that doesn't need it yet.
 * Unused by WU1a's plain-terrain path; its first consumer is the WU3
 * pile-count badge. */
export type TextFactory = (value: string) => Text;

export interface SceneDeps {
  textures: TextureProvider;
  assets: AssetResolver;
  createText?: TextFactory;
}

export interface TileScene {
  container: Container<Sprite>;
  /**
   * Reconciles the tile pool against `frame.tiles`. WU2 scope: sprite-first
   * terrain (falls back to the color-fallback texture when the resolved
   * visual has no `.sprite`) plus fog tint (design.md D1). Skips redundant
   * `.texture`/`.tint` writes when the resolved value hasn't changed since
   * the last `sync()` call (WU1b follow-up — the benchmark found unconditional
   * per-frame texture writes were the main cost driver).
   */
  sync(frame: Frame): void;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Default `TextFactory` (design.md D6 injection point) — one plain `Text`
 * per pile badge, styled to mirror `render/canvas.ts`'s `drawCount` (bold,
 * white fill, dark stroke for legibility over any terrain/glyph). Callers
 * needing a different factory (e.g. tests) pass `SceneDeps.createText`. */
function defaultCreateText(value: string): Text {
  return new Text({
    text: value,
    anchor: 0.5,
    style: {
      fontFamily: "sans-serif",
      fontWeight: "bold",
      fontSize: Math.floor(PX * 0.28),
      fill: "#fff",
      stroke: { color: "rgba(0,0,0,0.75)", width: 3 },
    },
  });
}

/**
 * One scene-graph node per entity id: `sprite` (the entity's sprite/glyph
 * texture) plus an optional `badge` (pile-count text, added/removed as the
 * entity's `count` comes and goes). `root` carries position — set to
 * `renderPos * PX` (design.md D1's entity row, literally) — with `sprite`
 * and `badge` positioned as root-relative offsets, mirroring
 * `render/canvas.ts`'s own absolute-coordinate formulas (`drawEmoji`'s
 * tile-center anchor, `drawCount`'s `PX*0.74` badge offset) turned into
 * root-relative offsets instead of recomputed per frame.
 */
interface EntityNode {
  root: Container;
  sprite: Sprite;
  badge?: Text;
}

/** Object/item/pile share ONE reconciliation loop (design.md D1's "Entities"
 * row); player is excluded here on purpose — it gets its own halo+sprite
 * container in `createPlayerScene`, never routed through this pool. */
const ENTITY_LAYER_KINDS: ReadonlySet<RenderEntity["kind"]> = new Set(["object", "pile", "item"]);

/**
 * Sprite-first with glyph-fallback anchor/size branch (spec "Sprite-First
 * Rendering with Emoji/Text Fallback"), extracted so every consumer that
 * draws a `VisualDescriptor` onto a `Sprite` — `createEntityScene`'s object/
 * item/pile pool AND `createPlayerScene`'s player node — shares exactly ONE
 * implementation of the sizing rule this module already documented once
 * (a real bug WU3's browser verification caught): a `.sprite` region carries
 * its OWN pixel dimensions (`sw`/`sh`) sized via `region.sw/sh * SCALE` and
 * bottom-left-anchored so tall multi-cell sprites extend upward from the
 * entity's tile (`dx=0`, `dy=PX` relative to the node root, mirroring
 * `canvas.ts`'s `spriteDrawRect`); `VisualDescriptor.scale` is a GLYPH-only
 * draw factor (`drawEmoji`'s font-size factor) and is never set on a
 * sprite-backed visual — using it to size a sprite instead of the region's
 * own dimensions silently squashes any multi-cell sprite into a single small
 * tile-sized square. Duplicating this branch per consumer would risk that
 * regression resurfacing in exactly one of the copies.
 */
function applyEntityVisual(sprite: Sprite, visual: VisualDescriptor, textures: TextureProvider): void {
  if (visual.sprite) {
    const region = visual.sprite;
    const texture = textures.forRegion(region);
    if (sprite.texture !== texture) sprite.texture = texture;
    sprite.anchor.set(0, 1);
    sprite.x = 0;
    sprite.y = PX;
    sprite.width = region.sw * SCALE;
    sprite.height = region.sh * SCALE;
  } else {
    const texture = textures.forGlyph(visual.glyph ?? "");
    if (sprite.texture !== texture) sprite.texture = texture;
    sprite.anchor.set(0.5);
    sprite.x = PX / 2;
    sprite.y = PX / 2;
    const scale = visual.scale ?? 1;
    sprite.width = PX * scale;
    sprite.height = PX * scale;
  }
}

export interface EntityScene {
  container: Container;
  /**
   * Reconciles the entity pool against `frame.entities` (design.md D1 /
   * spec "Sprite-First Rendering with Emoji/Text Fallback", "Visual Parity
   * Checklist" — objects/items/pile badge). For each object/item/pile
   * entity: creates a node on first sight, updates position/texture/badge
   * every frame, hides it while `visibility === "unseen"` (matches
   * `canvas.ts`'s `drawObjectOrItem`/`drawPile`, which skip the draw
   * entirely while unseen — WITHOUT losing the pooled node, since fog can
   * flip back to visible next frame), and DESTROYS the node once its id no
   * longer appears in `frame.entities` at all (no leaked sprites/text for
   * departed entities). Skips redundant `.texture`/badge-text writes when
   * unchanged (WU2's diffing pattern, extended here).
   */
  sync(frame: Frame): void;
}

/**
 * Pure entity-pool reconciler (design.md D1/D6), same shape as
 * `createTileScene`: a persistent `Map<id, EntityNode>`, injected
 * `TextureProvider` + `TextFactory`, no direct Pixi texture upload or GPU
 * dependency here — only `scene.ts`'s pure reconciliation is exercised by
 * `pixi.test.ts` (spec "Test Coverage Without GPU Dependency").
 */
export function createEntityScene(deps: SceneDeps): EntityScene {
  const createText = deps.createText ?? defaultCreateText;

  // Ordered sub-containers enforce draw order within this pool (design.md
  // D1 layer order: tile -> OBJECT -> PILE -> ITEM -> player -> fx) —
  // object/pile/item children paint in this fixed order regardless of
  // `frame.entities`' own iteration order, matching `canvas.ts`'s three
  // explicit passes (`drawObjectOrItem` for object, `drawPile`, then
  // `drawObjectOrItem` again for item).
  const objectLayer = new Container();
  const pileLayer = new Container();
  const itemLayer = new Container();
  const container = new Container();
  container.addChild(objectLayer, pileLayer, itemLayer);

  const nodes = new Map<string, EntityNode>();

  function layerFor(kind: RenderEntity["kind"]): Container {
    if (kind === "pile") return pileLayer;
    if (kind === "item") return itemLayer;
    return objectLayer; // "object" — "player" never reaches here (filtered in sync)
  }

  function createNode(entity: RenderEntity): EntityNode {
    // Anchor/position/size are branch-dependent (sprite vs glyph — see
    // `sync`) and rewritten every frame regardless, so the initial values
    // here are placeholders only.
    const sprite = new Sprite();
    const root = new Container();
    root.addChild(sprite);
    layerFor(entity.kind).addChild(root);
    const node: EntityNode = { root, sprite };
    nodes.set(entity.id, node);
    return node;
  }

  function removeNode(id: string): void {
    const node = nodes.get(id);
    if (!node) return;
    node.root.destroy({ children: true });
    nodes.delete(id);
  }

  return {
    container,
    sync(frame: Frame): void {
      const seen = new Set<string>();

      for (const entity of frame.entities) {
        if (!ENTITY_LAYER_KINDS.has(entity.kind)) continue; // player: WU4 scope
        seen.add(entity.id);

        // Matches `canvas.ts`'s `drawObjectOrItem`/`drawPile`: both return
        // immediately without drawing anything while unseen. The node stays
        // pooled (fog can flip back to visible next frame) but hidden.
        if (entity.visibility === "unseen") {
          const existing = nodes.get(entity.id);
          if (existing) existing.root.visible = false;
          continue;
        }

        const node = nodes.get(entity.id) ?? createNode(entity);
        node.root.visible = true;
        node.root.x = entity.renderPos.x * PX;
        node.root.y = entity.renderPos.y * PX;

        // Sprite-first with glyph fallback (spec "Sprite-First Rendering
        // with Emoji/Text Fallback" — entities, unlike terrain, always have
        // a glyph fallback per `createEmojiAssets`). Shared with
        // `createPlayerScene` via `applyEntityVisual` (see its doc comment
        // for the sizing rule this branch enforces).
        const visual = deps.assets.resolve(entity.kind, entity.typeId, entity.state ?? {});
        applyEntityVisual(node.sprite, visual, deps.textures);

        // Pile-count badge (spec "Pile count badge"), reconciled by id
        // alongside the rest of the node — added the first time `count` is
        // defined, removed if it ever stops being defined, text updated only
        // when the label actually changes (WU2's diffing pattern extended).
        if (entity.kind === "pile" && entity.count !== undefined) {
          const label = `×${entity.count}`;
          if (!node.badge) {
            node.badge = createText(label);
            node.badge.x = PX * 0.74;
            node.badge.y = PX * 0.74;
            node.root.addChild(node.badge);
          } else if (node.badge.text !== label) {
            node.badge.text = label;
          }
        } else if (node.badge) {
          node.badge.destroy();
          node.badge = undefined;
        }
      }

      for (const id of nodes.keys()) {
        if (!seen.has(id)) removeNode(id);
      }
    },
  };
}

// --- Player (WU4: halo + sprite) ---

/** Halo geometry/paint (design.md D1 "Player halo -> one baked `Graphics`
 * circle under player sprite (static)"), same radius/color/alpha as
 * `render/canvas.ts`'s `drawPlayer` arc (`rgba(255,240,120,0.28)` at
 * `PX*0.44`, `255,240,120` == `0xfff078`). Built ONCE per node — static
 * geometry, never rebuilt per frame (unlike the WU5 busy-spinner rotation,
 * this halo never animates). */
const HALO_COLOR = 0xfff078;
const HALO_ALPHA = 0.28;
const HALO_RADIUS_FACTOR = 0.44;

function createHalo(): Graphics {
  return new Graphics()
    .circle(PX / 2, PX / 2, PX * HALO_RADIUS_FACTOR)
    .fill({ color: HALO_COLOR, alpha: HALO_ALPHA });
}

/** One node per player id: a static `halo` (added first, so it paints
 * BELOW `sprite` in Pixi's back-to-front child order — design.md D1's
 * layer order ends "...player" as a single row, halo-under-sprite within
 * it) plus the player's own sprite/glyph, sized via the same
 * `applyEntityVisual` branch WU3's entity pool established. */
interface PlayerNode {
  root: Container;
  halo: Graphics;
  sprite: Sprite;
}

export interface PlayerScene {
  container: Container;
  /**
   * Reconciles the player node against `frame.entities` (design.md D1
   * "Player" row / spec "Visual Parity Checklist" — player halo+sprite).
   * Unlike `createEntityScene`'s object/item/pile pool, the player is NEVER
   * fog-culled while `visibility === "unseen"` — mirrors `canvas.ts`'s
   * `drawPlayer`, which is called unconditionally regardless of visibility
   * ("the player's own position was never fog-culled"). The node is only
   * destroyed once the player's id no longer appears in `frame.entities` at
   * all (matches the object/item/pile pool's own destroy rule).
   */
  sync(frame: Frame): void;
}

/**
 * Pure player reconciler (design.md D1/D6), same pool shape as
 * `createEntityScene` but scoped to `kind === "player"` and never hidden by
 * fog — only `scene.ts`'s pure reconciliation is exercised by
 * `pixi.test.ts` (spec "Test Coverage Without GPU Dependency").
 */
export function createPlayerScene(deps: SceneDeps): PlayerScene {
  const container = new Container();
  const nodes = new Map<string, PlayerNode>();

  function createNode(): PlayerNode {
    const halo = createHalo();
    const sprite = new Sprite();
    const root = new Container();
    // z-order within this node: halo first (renders below), sprite second
    // (renders on top) — Pixi's `Container` paints children in the order
    // they were added, back-to-front.
    root.addChild(halo, sprite);
    container.addChild(root);
    return { root, halo, sprite };
  }

  function removeNode(id: string): void {
    const node = nodes.get(id);
    if (!node) return;
    node.root.destroy({ children: true });
    nodes.delete(id);
  }

  return {
    container,
    sync(frame: Frame): void {
      const seen = new Set<string>();

      for (const entity of frame.entities) {
        if (entity.kind !== "player") continue;
        seen.add(entity.id);

        let node = nodes.get(entity.id);
        if (!node) {
          node = createNode();
          nodes.set(entity.id, node);
        }

        // Never fog-culled (canvas.ts's `drawPlayer` comment, verbatim):
        // "the player's own position was never fog-culled" — always visible
        // regardless of `entity.visibility`.
        node.root.visible = true;
        node.root.x = entity.renderPos.x * PX;
        node.root.y = entity.renderPos.y * PX;

        // canvas.ts's `drawPlayer` resolves via the fixed "player" kind and
        // does NOT pass `entity.state` — mirrored here verbatim.
        const visual = deps.assets.resolve("player", entity.typeId);
        applyEntityVisual(node.sprite, visual, deps.textures);
      }

      for (const id of nodes.keys()) {
        if (!seen.has(id)) removeNode(id);
      }
    },
  };
}

/**
 * Pure tile-pool reconciler (design.md D1/D6): a persistent
 * `Map<"x,y", Sprite>`, built lazily and reused across frames rather than
 * rebuilt every tick — this is what `pixi.test.ts` exercises to assert
 * scene-graph shape without ever touching a real GPU/GL context. Takes an
 * injected `TextureProvider` (no direct Pixi texture upload here) and
 * `AssetResolver` (renderer-agnostic — same resolver the Canvas renderer
 * uses).
 */
export function createTileScene(deps: SceneDeps): TileScene {
  const container = new Container<Sprite>();
  const pool = new Map<string, Sprite>();

  function tileFor(x: number, y: number): Sprite {
    const key = tileKey(x, y);
    const existing = pool.get(key);
    if (existing) return existing;
    const sprite = new Sprite();
    sprite.x = x * PX;
    sprite.y = y * PX;
    sprite.width = PX;
    sprite.height = PX;
    pool.set(key, sprite);
    container.addChild(sprite);
    return sprite;
  }

  return {
    container,
    sync(frame: Frame): void {
      for (const tile of frame.tiles) {
        const sprite = tileFor(tile.x, tile.y);

        // Sprite-first with color fallback (spec "Sprite-First Rendering
        // with Emoji/Text Fallback" — terrain has no glyph fallback, so it's
        // sprite-or-color, mirroring `render/canvas.ts`'s own terrain
        // branch rather than the entity glyph-fallback shape).
        const visual = deps.assets.resolve("terrain", tile.terrain);
        const texture = visual.sprite
          ? deps.textures.forRegion(visual.sprite)
          : deps.textures.forColor(visual.color ?? FALLBACK_TERRAIN_COLOR);

        // Diffing (WU1b follow-up): only write `.texture`/`.tint` when the
        // resolved value actually changed since the last sync — the WU1b
        // stress benchmark found unconditional per-frame writes were the
        // main cost driver of this reconciler.
        if (sprite.texture !== texture) sprite.texture = texture;
        const tint = FOG_TINT[tile.visibility];
        if (sprite.tint !== tint) sprite.tint = tint;
      }
    },
  };
}
