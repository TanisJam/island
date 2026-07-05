import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Position } from "../../contract";
import type { AssetResolver, VisualDescriptor } from "../assets";
import type { Frame, RenderEntity, Visibility } from "../../view/viewstate";
import { PX, SCALE } from "../constants";
import type { TextureProvider } from "./textures";

const FALLBACK_TERRAIN_COLOR = "#444";

/** Fog tint per visibility state (design.md D1, tightened at WU6 — parity
 * fix). `visible` = no tint (`0xffffff` multiplies every channel by 1, a
 * no-op); `unseen` tints fully black, which reads identically to Canvas's
 * solid black fill-rect regardless of the underlying texture.
 *
 * `explored` must match `render/canvas.ts`'s 45%-alpha black overlay drawn
 * OVER the terrain via `source-over` compositing: `new = old*(1-0.45) +
 * black*0.45 = old*0.55`. A multiplicative tint reproduces that exact
 * per-channel scale ONLY if the tint factor is `1 - alpha` (`0.55`), not the
 * overlay's own alpha value. WU2 originally set this to `0x737373`
 * (`0x73/255 ≈ 0.451`), which is the overlay's alpha itself, not its
 * complement — that tinted explored tiles roughly 10 percentage points
 * darker than Canvas (a ~55%-black-equivalent overlay instead of 45%).
 * `0x8c8c8c` (`0x8c/255 = 140/255 ≈ 0.549 ≈ 0.55`) is the corrected value —
 * found and fixed during WU6's fog-parity pass. */
const FOG_TINT: Record<Visibility, number> = {
  visible: 0xffffff,
  explored: 0x8c8c8c,
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

// --- FX (WU5: selection pulse + busy spinner) ---

/** Brasa token (spec "Light-Semantics Visual Identity" — the selection ring
 * uses the brasa token), same hex `render/canvas.ts`'s `drawSelection`/
 * `drawBusyIndicator` use (`#f0a24e` == `0xf0a24e`). */
const BRASA = 0xf0a24e;

/** Selection-ring pulse math (design.md D1's fx row), the SAME formula as
 * `render/canvas.ts`'s `drawSelection`: rides `frame.clockMs`, the same
 * global anim clock threaded through `Renderer.render(frame, ...)` — no
 * second, divergent clock introduced here. Reduced motion freezes it to a
 * static, fully-opaque ring (matches canvas.ts's reduced-motion branch). */
function selectionAlpha(clockMs: number, reducedMotion: boolean): number {
  return reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(clockMs / 260);
}

/** Busy-spinner rotation math (design.md D1's fx row), the SAME formula as
 * `render/canvas.ts`'s `drawBusyIndicator`: sweeps via `frame.clockMs`.
 * Reduced motion freezes the sprite to a fixed (non-rotating) orientation,
 * matching canvas.ts's reduced-motion branch. */
function spinnerRotation(clockMs: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : (clockMs / 140) % (Math.PI * 2);
}

/** Guarded the same way `render/canvas.ts`'s own `prefersReducedMotion` is
 * (safe to import under Node — `node:test` has no `matchMedia`), but exposed
 * as an INJECTABLE dependency (see `FxSceneDeps.reducedMotion`, defaulted to
 * this function), mirroring `input/action-pacing.ts`'s `reducedMotion` DI
 * shape — this lets `pixi.test.ts` force the reduced-motion branch
 * deterministically instead of depending on a real `matchMedia` that isn't
 * available under bare `node --test`. */
function defaultReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface FxSceneDeps {
  textures: TextureProvider;
  reducedMotion?: () => boolean;
}

export interface FxScene {
  container: Container;
  /**
   * Reconciles the fx layer against the current frame plus the `selection`/
   * `busy` state `Renderer.render` receives alongside the frame (design.md
   * D1's fx row / spec "Reduced-Motion Compliance for FX", "Visual Parity
   * Checklist" — selection pulse, busy spinner). Two persistent nodes, never
   * rebuilt: a selection-ring `Graphics` (visible+pulsing over the selected
   * tile when `selection` is set, hidden when `null`) and a busy-spinner
   * `Sprite` (visible+rotating over the player's head when `busy` is true
   * AND a player entity exists in the frame, hidden otherwise). Both freeze
   * to their static/non-animated variant under reduced motion.
   */
  sync(frame: Frame, selection: Position | null, busy: boolean): void;
}

/**
 * Pure fx reconciler (design.md D1/D6), same "persistent node, mutated per
 * frame" shape as the tile/entity/player reconcilers above — only the
 * `TextureProvider.forRing()` bake needs a real Pixi renderer (same
 * constraint `forGlyph` already has), so only this module's reconciliation
 * is exercised by `pixi.test.ts` (spec "Test Coverage Without GPU
 * Dependency").
 */
export function createFxScene(deps: FxSceneDeps): FxScene {
  const reducedMotion = deps.reducedMotion ?? defaultReducedMotion;
  const container = new Container();

  // Selection ring: static geometry (a stroked square the size of one tile,
  // mirroring canvas.ts's `strokeRect(pos.x*PX+1.5, pos.y*PX+1.5, PX-3,
  // PX-3)`), drawn ONCE at a tile-local origin and moved as a whole via
  // `.x`/`.y` to the selected tile each frame — never rebuilt.
  const selectionRing = new Graphics().rect(1.5, 1.5, PX - 3, PX - 3).stroke({ width: 3, color: BRASA });
  selectionRing.visible = false;
  container.addChild(selectionRing);

  // Busy spinner: the pre-baked ring texture (design.md D1 — the ONE
  // per-frame-geometry-adjacent case, a cheap `.rotation` transform instead
  // of redrawing geometry every frame), positioned over the player's head.
  const busySprite = new Sprite(deps.textures.forRing());
  busySprite.anchor.set(0.5);
  busySprite.visible = false;
  container.addChild(busySprite);

  return {
    container,
    sync(frame: Frame, selection: Position | null, busy: boolean): void {
      const reduced = reducedMotion();

      if (selection) {
        selectionRing.visible = true;
        selectionRing.x = selection.x * PX;
        selectionRing.y = selection.y * PX;
        selectionRing.alpha = selectionAlpha(frame.clockMs, reduced);
      } else {
        selectionRing.visible = false;
      }

      // Anchored to the player's INTERPOLATED renderPos (same field the
      // player pool positions itself from), just above the tile's top edge
      // (over the head) — mirrors canvas.ts's `drawBusyIndicator` call site,
      // which reads no snapshot and is gated entirely by `busy`.
      const player = busy ? frame.entities.find((entity) => entity.kind === "player") : undefined;
      if (player) {
        busySprite.visible = true;
        busySprite.x = player.renderPos.x * PX + PX / 2;
        busySprite.y = player.renderPos.y * PX - PX * 0.08;
        busySprite.rotation = spinnerRotation(frame.clockMs, reduced);
      } else {
        busySprite.visible = false;
      }
    },
  };
}
