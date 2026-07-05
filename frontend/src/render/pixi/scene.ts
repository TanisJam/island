import { Container, Sprite, type Text } from "pixi.js";
import type { AssetResolver } from "../assets";
import type { Frame, Visibility } from "../../view/viewstate";
import { PX } from "../constants";
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
