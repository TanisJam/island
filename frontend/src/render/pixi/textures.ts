import { Texture } from "pixi.js";
import type { SpriteRegion } from "../assets";

/**
 * Texture adapter at the Pixi boundary (design.md D2). Lives here, NOT in
 * `render/assets.ts` — `AssetResolver`/`VisualDescriptor` stay renderer
 * agnostic. WU1a implements `forColor` for real (the plain terrain
 * color-fallback path); `forRegion` (sprite atlas regions, WU2) and
 * `forGlyph` (emoji/text fallback, WU3) are typed stubs today, extended in
 * their respective work units.
 *
 * Every texture this adapter creates is tracked in `created` so `destroy()`
 * releases all of them together (design.md D5) — the Set-based teardown is
 * wired from day one even though only `forColor` populates it yet.
 */
export interface TextureProvider {
  forRegion(region: SpriteRegion): Texture;
  forColor(hex: string): Texture;
  forGlyph(glyph: string): Texture;
  destroy(): void;
}

/** Builds a 1x1 canvas filled with `hex`, the smallest possible backing
 * source for a solid-color `Texture` (there is no GPU-side "flat fill"
 * primitive in Pixi — a 1x1 sampled texture stretched over the sprite's
 * `width`/`height` is the standard way to get one). */
function colorCanvas(hex: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear el contexto 2D para la textura de color de respaldo");
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 1, 1);
  return canvas;
}

/**
 * Creates the Pixi `TextureProvider`. Caches one `Texture` per unique input
 * (spec "Texture Adapter Caching") so repeated colors/regions/glyphs never
 * re-upload — `forColor` is cache-keyed by hex string today; `forRegion`
 * (kind:typeId) and `forGlyph` (glyph string) get their own caches when WU2/
 * WU3 implement them.
 */
export function createPixiTextureProvider(): TextureProvider {
  const colorCache = new Map<string, Texture>();
  const created = new Set<Texture>();

  return {
    forColor(hex: string): Texture {
      const cached = colorCache.get(hex);
      if (cached) return cached;
      const texture = Texture.from(colorCanvas(hex), true);
      colorCache.set(hex, texture);
      created.add(texture);
      return texture;
    },
    forRegion(): Texture {
      throw new Error("TextureProvider.forRegion is not implemented yet (lands in WU2 — sprite terrain)");
    },
    forGlyph(): Texture {
      throw new Error("TextureProvider.forGlyph is not implemented yet (lands in WU3 — entity glyph fallback)");
    },
    destroy(): void {
      for (const texture of created) texture.destroy(true);
      created.clear();
      colorCache.clear();
    },
  };
}
