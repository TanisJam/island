import { Rectangle, Texture, type TextureSource } from "pixi.js";
import type { SpriteRegion } from "../assets";

/**
 * Texture adapter at the Pixi boundary (design.md D2). Lives here, NOT in
 * `render/assets.ts` — `AssetResolver`/`VisualDescriptor` stay renderer
 * agnostic. WU1a implemented `forColor` (the plain terrain color-fallback
 * path); WU2 implements `forRegion` (sprite atlas regions, terrain) for real.
 * `forGlyph` (emoji/text fallback, WU3) stays a typed stub, extended in its
 * own work unit.
 *
 * Every texture this adapter creates is tracked (in `created` for
 * single-source textures, in `regionCache` + `baseSources` for
 * shared-source region textures) so `destroy()` releases all of them
 * together (design.md D5).
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
/** Cache key for a sprite-atlas region. `forRegion` only receives the
 * `SpriteRegion` itself (design.md D2's `TextureProvider` shape), not the
 * `kind`/`typeId` that produced it — but `AssetResolver.resolve` always maps
 * a given `kind:typeId` to the exact same fixed `(sx,sy,sw,sh)` rectangle
 * over the shared tileset image (spec "Sprited entity" scenario source data
 * never changes at runtime), so keying the cache by the region's own
 * coordinates is behaviorally equivalent to keying by `kind:typeId`: a
 * repeated request for the same `kind:typeId` always produces the same key
 * and hits the cache (spec "Texture Adapter Caching" — no re-upload).
 */
function regionKey(region: SpriteRegion): string {
  return `${region.sx},${region.sy},${region.sw},${region.sh}`;
}

/**
 * Creates the Pixi `TextureProvider`. Caches one `Texture` per unique input
 * (spec "Texture Adapter Caching") so repeated colors/regions/glyphs never
 * re-upload — `forColor` is cache-keyed by hex string, `forRegion` by region
 * coordinates (see `regionKey`); `forGlyph` (glyph string) gets its own
 * cache when WU3 implements it.
 */
export function createPixiTextureProvider(): TextureProvider {
  const colorCache = new Map<string, Texture>();
  const created = new Set<Texture>();

  // `forRegion` shares ONE `TextureSource` per underlying tileset image
  // (never re-uploaded per tile/call) and frames a `Rectangle` sub-view over
  // it per unique region (design.md D2 — "shared base texture +
  // Rectangle(sx,sy,sw,sh)"). Sub-region textures must be destroyed with
  // `destroySource: false` since they don't own the source; each shared
  // source is destroyed exactly once in `destroy()`.
  const regionCache = new Map<string, Texture>();
  const baseSources = new Map<CanvasImageSource, TextureSource>();

  function baseSourceFor(image: CanvasImageSource): TextureSource {
    const cached = baseSources.get(image);
    if (cached) return cached;
    const source = Texture.from(image, true).source;
    baseSources.set(image, source);
    return source;
  }

  return {
    forColor(hex: string): Texture {
      const cached = colorCache.get(hex);
      if (cached) return cached;
      const texture = Texture.from(colorCanvas(hex), true);
      colorCache.set(hex, texture);
      created.add(texture);
      return texture;
    },
    forRegion(region: SpriteRegion): Texture {
      const key = regionKey(region);
      const cached = regionCache.get(key);
      if (cached) return cached;
      const source = baseSourceFor(region.image);
      const texture = new Texture({
        source,
        frame: new Rectangle(region.sx, region.sy, region.sw, region.sh),
      });
      regionCache.set(key, texture);
      return texture;
    },
    forGlyph(): Texture {
      throw new Error("TextureProvider.forGlyph is not implemented yet (lands in WU3 — entity glyph fallback)");
    },
    destroy(): void {
      for (const texture of created) texture.destroy(true);
      created.clear();
      colorCache.clear();
      for (const texture of regionCache.values()) texture.destroy(false);
      regionCache.clear();
      for (const source of baseSources.values()) source.destroy();
      baseSources.clear();
    },
  };
}
