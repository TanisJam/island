import { Graphics, Rectangle, Text, Texture, type Renderer as PixiRenderer, type TextureSource } from "pixi.js";
import type { SpriteRegion } from "../assets";
import { PX } from "../constants";

/**
 * Texture adapter at the Pixi boundary (design.md D2). Lives here, NOT in
 * `render/assets.ts` — `AssetResolver`/`VisualDescriptor` stay renderer
 * agnostic. WU1a implemented `forColor` (the plain terrain color-fallback
 * path); WU2 implemented `forRegion` (sprite atlas regions, terrain); WU3
 * implements `forGlyph` (emoji/text fallback, entities — design.md D3 Plan A).
 *
 * Every texture this adapter creates is tracked (in `created` for
 * single-source textures — this now includes baked glyph textures, in
 * `regionCache` + `baseSources` for shared-source region textures) so
 * `destroy()` releases all of them together (design.md D5).
 */
export interface TextureProvider {
  forRegion(region: SpriteRegion): Texture;
  forColor(hex: string): Texture;
  forGlyph(glyph: string): Texture;
  /** WU5: the busy-spinner's pre-baked ring (design.md D1 — "pre-baked ring
   * Texture Sprite, `.rotation` advanced per frame"). One fixed shape, no
   * cache key needed — always the same texture. */
  forRing(): Texture;
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

/** Same font stack `render/canvas.ts`'s `drawEmoji` uses — the WU1b spike
 * compared this exact stack via `PIXI.Text` against Canvas `fillText` and
 * found identical color-emoji fidelity (design.md D3, Plan A confirmed). */
const GLYPH_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

/** Baked square size (px) for one glyph texture: one full tile, baked once
 * per unique glyph string (~17 across object/item/pile/player, spec
 * "Sprite-First Rendering with Emoji/Text Fallback"). Per-entity sizing
 * (object/item/pile/player each has its own `.scale` in `VisualDescriptor`)
 * is applied by the consumer (`scene.ts`) via `Sprite.width/height`, not
 * baked into the texture — this keeps the glyph cache keyed by glyph alone,
 * not by glyph+scale, matching the "one texture per unique glyph" cache
 * contract (spec "Texture Adapter Caching").
 */
const GLYPH_BAKE_SIZE = PX;

/** Busy-spinner ring geometry (WU5, design.md D1's fx row), baked ONCE — the
 * scene layer (`scene.ts`'s `createFxScene`) supplies animation purely via a
 * cheap per-frame `.rotation` transform on the `Sprite`, never rebuilding
 * this texture. Same radius/color/lineWidth/cap as `render/canvas.ts`'s
 * `drawBusyIndicator`: a dark backing disc (legibility over any terrain/
 * glyph, same trick as `drawCount`'s stroke-then-fill) plus a 3/4 brasa arc.
 * The arc is baked starting at angle 0 — the scene layer's `.rotation`
 * reproduces `drawBusyIndicator`'s sweeping start angle by rotating the
 * whole sprite instead of redrawing the arc per frame. */
const SPINNER_BRASA = 0xf0a24e; // "#f0a24e", same brasa token as render/canvas.ts
const SPINNER_RADIUS = PX * 0.16;
const SPINNER_BACKING_RADIUS = SPINNER_RADIUS + 3;
const SPINNER_BAKE_SIZE = Math.ceil(SPINNER_BACKING_RADIUS * 2 + 4);
const SPINNER_CENTER = SPINNER_BAKE_SIZE / 2;

/**
 * Creates the Pixi `TextureProvider`. Caches one `Texture` per unique input
 * (spec "Texture Adapter Caching") so repeated colors/regions/glyphs never
 * re-upload — `forColor` is cache-keyed by hex string, `forRegion` by region
 * coordinates (see `regionKey`), `forGlyph` by the glyph string itself.
 *
 * `renderer` is the live Pixi `Renderer` (from `app.renderer`, available once
 * `Application.init()` resolves) — `forGlyph` needs it to bake a `Text`
 * display object into a standalone `Texture` via `renderer.generateTexture`
 * (design.md D3: "bake one Texture per glyph via Pixi Text"). This is the
 * one adapter method that can't work without a real renderer, same as
 * `forColor`/`forRegion` already can't work without a real DOM `document`
 * (`colorCanvas`) — none of the three are exercised under bare `node --test`
 * (design.md D6); `pixi.test.ts` only exercises `scene.ts` against a stub
 * `TextureProvider`.
 */
export function createPixiTextureProvider(renderer: PixiRenderer): TextureProvider {
  const colorCache = new Map<string, Texture>();
  const glyphCache = new Map<string, Texture>();
  const created = new Set<Texture>();

  // `forRegion` shares ONE `TextureSource` per underlying tileset image
  // (never re-uploaded per tile/call) and frames a `Rectangle` sub-view over
  // it per unique region (design.md D2 — "shared base texture +
  // Rectangle(sx,sy,sw,sh)"). Sub-region textures must be destroyed with
  // `destroySource: false` since they don't own the source; each shared
  // source is destroyed exactly once in `destroy()`.
  const regionCache = new Map<string, Texture>();
  const baseSources = new Map<CanvasImageSource, TextureSource>();
  let ringTexture: Texture | undefined;

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
    forGlyph(glyph: string): Texture {
      const cached = glyphCache.get(glyph);
      if (cached) return cached;
      const text = new Text({
        text: glyph,
        style: { fontFamily: GLYPH_FONT, fontSize: GLYPH_BAKE_SIZE },
      });
      const texture = renderer.generateTexture(text);
      text.destroy();
      glyphCache.set(glyph, texture);
      created.add(texture);
      return texture;
    },
    forRing(): Texture {
      if (ringTexture) return ringTexture;
      const graphic = new Graphics()
        .circle(SPINNER_CENTER, SPINNER_CENTER, SPINNER_BACKING_RADIUS)
        .fill({ color: 0x000000, alpha: 0.55 })
        .arc(SPINNER_CENTER, SPINNER_CENTER, SPINNER_RADIUS, 0, Math.PI * 1.5)
        .stroke({ width: 3, color: SPINNER_BRASA, cap: "round" });
      const texture = renderer.generateTexture(graphic);
      graphic.destroy();
      ringTexture = texture;
      created.add(texture);
      return texture;
    },
    destroy(): void {
      for (const texture of created) texture.destroy(true);
      created.clear();
      colorCache.clear();
      glyphCache.clear();
      ringTexture = undefined;
      for (const texture of regionCache.values()) texture.destroy(false);
      regionCache.clear();
      for (const source of baseSources.values()) source.destroy();
      baseSources.clear();
    },
  };
}
