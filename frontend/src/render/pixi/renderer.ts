import { Application, Container, Sprite, Texture, TextureSource } from "pixi.js";
import type { Position } from "../../contract";
import type { AssetResolver } from "../assets";
import type { Renderer } from "../renderer";
import type { Frame } from "../../view/viewstate";
import { cameraOffset } from "../camera";
import { createPixiTextureProvider } from "./textures";
import { createTileScene, createLightScene, createEntityScene, createPlayerScene, createFxScene } from "./scene";

/** "sombra" token (mockup `luz-de-fuego.html`'s `--sombra: #0f1a16` is the
 * page background; the vignette itself darkens with a slightly warmer/darker
 * near-black, `rgb(6,10,8)`, matching its `#vignette` CSS rule verbatim). */
const VIGNETTE_RGB = "6,10,8";

/** Single alpha constant driving the vignette's edge/bottom darkness
 * (design.md D4 — "day-night-ready": a future day-night cycle can drive this
 * one value instead of touching the bake itself). Ported from the mockup's
 * `#vignette` CSS, which uses two slightly different stop alphas (.55/.82)
 * for its radial vs. linear layer — collapsed to one shared constant here so
 * there's a single knob, at a small fidelity cost the design accepts. */
const AMBIENT_DARKNESS = 0.55;

/** Bake size (px) for the vignette gradient — baked ONCE at a fixed square
 * resolution, then stretched to the exact viewport via `Sprite.width/height`
 * on every `resize()` (a non-uniform stretch, which is what turns the baked
 * circular falloff into an ellipse matching the viewport's aspect ratio —
 * the same effect the mockup's `120% 80%` radial-gradient extents produce). */
const VIGNETTE_BAKE_SIZE = 512;

/**
 * Bakes the vignette gradient onto an offscreen 2D canvas: a radial falloff
 * (transparent center, out to `AMBIENT_DARKNESS`-alpha dark edge, centered
 * slightly above middle) plus a bottom linear darken layered on top via
 * normal alpha blending — port of the mockup's `#vignette` two-layer
 * `background` (design.md D4). Never touches WebGL; this is a plain 2D
 * canvas, matching `textures.ts`'s own `colorCanvas` helper's approach.
 */
function bakeVignette(): HTMLCanvasElement {
  const size = VIGNETTE_BAKE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear el contexto 2D para la textura del viñeteado");

  const cx = size * 0.5;
  const cy = size * 0.42;
  const radius = size * 0.62;
  const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  radial.addColorStop(0, `rgba(${VIGNETTE_RGB},0)`);
  radial.addColorStop(0.45, `rgba(${VIGNETTE_RGB},0)`);
  radial.addColorStop(1, `rgba(${VIGNETTE_RGB},${AMBIENT_DARKNESS})`);
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, size, size);

  const bottomStart = size * 0.62;
  const linear = ctx.createLinearGradient(0, bottomStart, 0, size);
  linear.addColorStop(0, `rgba(${VIGNETTE_RGB},0)`);
  linear.addColorStop(1, `rgba(${VIGNETTE_RGB},${AMBIENT_DARKNESS})`);
  ctx.fillStyle = linear;
  ctx.fillRect(0, bottomStart, size, size - bottomStart);

  return canvas;
}

/**
 * Pixi implementation of the unchanged `Renderer` interface (design.md SEAM
 * 4 / D1). Retained-mode: a persistent scene graph mutated per frame instead
 * of the Canvas renderer's per-frame immediate draws. WU1a: app lifecycle +
 * plain color-fallback terrain. WU2: sprite terrain + fog tint. WU3: object/
 * item/pile entity pool + glyph fallback + pile badge. WU4: player halo +
 * sprite (never fog-culled). WU5: selection pulse + busy spinner fx layer,
 * landing last in the layer order (design.md D1: tile -> object -> pile ->
 * item -> player -> fx) — this is the last feature WU before Canvas parity.
 *
 * `Application.init()` is async (Pixi v8 requirement), hence the
 * `Promise<Renderer>` return type — callers (`game.ts`) MUST await this
 * before the render loop starts, and MUST guard against `stop()` firing
 * while the promise is still pending (design.md D5) so a fast stop-after-
 * start never leaks an initializing Pixi app / GL context.
 */
export async function createPixiRenderer(canvas: HTMLCanvasElement, assets: AssetResolver): Promise<Renderer> {
  const app = new Application();
  await app.init({ canvas, backgroundAlpha: 1, antialias: false });

  // Pixel-art crispness: Pixi v8 defaults every texture to `linear`
  // filtering, which BLURS the pixel-art sprites AND bleeds neighbouring
  // atlas texels across each region's frame edge (the visible seams between
  // tiles). The whole game is pixel art, so switch the global default to
  // `nearest` BEFORE any texture/source is created — the equivalent of the
  // retired Canvas renderer's `imageSmoothingEnabled = false`.
  TextureSource.defaultOptions.scaleMode = "nearest";

  const textures = createPixiTextureProvider(app.renderer);
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  const tileScene = createTileScene({ textures, assets });
  worldContainer.addChild(tileScene.container);

  // Lighting (design.md D1): additive light pools sit OVER terrain but
  // UNDER entity/player sprites so they never wash out the art on top of
  // them — inserted here, between tile and entity/pile/item.
  const lightScene = createLightScene({ textures, assets });
  worldContainer.addChild(lightScene.container);

  // Layer order (design.md D1): tile -> light -> object -> pile -> item ->
  // player -> fx. `entityScene.container` already enforces object/pile/item
  // internally (see scene.ts); player lands on top here, fx lands on top of
  // that.
  const entityScene = createEntityScene({ textures, assets });
  worldContainer.addChild(entityScene.container);

  const playerScene = createPlayerScene({ textures, assets });
  worldContainer.addChild(playerScene.container);

  const fxScene = createFxScene({ textures });
  worldContainer.addChild(fxScene.container);

  // Screen-space vignette (design.md D4 / spec "Screen-Space Vignette"):
  // added to `app.stage` AFTER `worldContainer`, so it paints on top of
  // everything world-space, but it is NEVER a child of `worldContainer`
  // itself — the camera-pan offset applied to `worldContainer.x/y` below
  // never touches it, keeping it fixed to the viewport.
  const vignetteTexture = Texture.from(bakeVignette(), true);
  const vignette = new Sprite(vignetteTexture);
  vignette.width = app.renderer.width;
  vignette.height = app.renderer.height;
  app.stage.addChild(vignette);

  let destroyed = false;

  return {
    resize(width: number, height: number): void {
      if (destroyed) return;
      app.renderer.resize(width, height);
      vignette.width = width;
      vignette.height = height;
    },

    render(frame: Frame, selection: Position | null, busy = false): void {
      if (destroyed) return;
      const offset = cameraOffset(frame, { width: app.renderer.width, height: app.renderer.height });
      // Pixel-snap the world container to integer device pixels so the tile
      // grid never straddles a sub-pixel boundary mid-tween — which would
      // reintroduce 1px seams even with nearest filtering.
      worldContainer.x = Math.round(offset.ox);
      worldContainer.y = Math.round(offset.oy);
      tileScene.sync(frame);
      lightScene.sync(frame);
      entityScene.sync(frame);
      playerScene.sync(frame);
      fxScene.sync(frame, selection, busy);
    },

    destroy(): void {
      // Load-bearing (design.md D5): unlike Canvas's no-op `destroy()`, this
      // one actually releases GPU resources — every cached texture via the
      // adapter's own tracked `Set`, then the Pixi app/renderer itself.
      // `removeView: false` because `game.ts` owns the canvas element (it
      // was never Pixi's to remove); `children: true` tears down the whole
      // scene graph this renderer built.
      if (destroyed) return;
      destroyed = true;
      textures.destroy();
      // The vignette's baked canvas texture isn't tracked by the `textures`
      // adapter (design.md D4 keeps it local to this module) and
      // `app.destroy(..., { children: true })` below does NOT destroy child
      // textures (only display objects) — destroy it explicitly or it leaks.
      vignetteTexture.destroy(true);
      app.destroy({ removeView: false }, { children: true });
    },
  };
}
