import { Container, Sprite, type Text } from "pixi.js";
import type { AssetResolver } from "../assets";
import type { Frame } from "../../view/viewstate";
import { PX } from "../constants";
import type { TextureProvider } from "./textures";

const FALLBACK_TERRAIN_COLOR = "#444";

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
   * Reconciles the tile pool against `frame.tiles`. WU1a scope: plain
   * color-fallback only (design.md "plain (color-fallback only, no sprites
   * yet) terrain render to prove the scene graph works end-to-end") — no
   * sprite regions, no fog tint yet. Sprite-first rendering and fog tint
   * land in WU2.
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
        const visual = deps.assets.resolve("terrain", tile.terrain);
        sprite.texture = deps.textures.forColor(visual.color ?? FALLBACK_TERRAIN_COLOR);
      }
    },
  };
}
