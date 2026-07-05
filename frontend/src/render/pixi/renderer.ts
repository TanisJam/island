import { Application, Container } from "pixi.js";
import type { Position } from "../../contract";
import type { AssetResolver } from "../assets";
import type { Renderer } from "../renderer";
import type { Frame } from "../../view/viewstate";
import { cameraOffset } from "../camera";
import { createPixiTextureProvider } from "./textures";
import { createTileScene, createEntityScene } from "./scene";

/**
 * Pixi implementation of the unchanged `Renderer` interface (design.md SEAM
 * 4 / D1). Retained-mode: a persistent scene graph mutated per frame instead
 * of the Canvas renderer's per-frame immediate draws. WU1a: app lifecycle +
 * plain color-fallback terrain. WU2: sprite terrain + fog tint. WU3: object/
 * item/pile entity pool + glyph fallback + pile badge. Player halo/sprite and
 * FX (selection pulse, busy spinner) land in WU4/WU5.
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

  const textures = createPixiTextureProvider(app.renderer);
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  const tileScene = createTileScene({ textures, assets });
  worldContainer.addChild(tileScene.container);

  // Layer order (design.md D1): tile -> object -> pile -> item -> player ->
  // fx. `entityScene.container` already enforces object/pile/item internally
  // (see scene.ts); player + fx land on top in WU4/WU5.
  const entityScene = createEntityScene({ textures, assets });
  worldContainer.addChild(entityScene.container);

  let destroyed = false;

  return {
    resize(width: number, height: number): void {
      if (destroyed) return;
      app.renderer.resize(width, height);
    },

    render(frame: Frame, _selection: Position | null, _busy = false): void {
      // `_selection`/`_busy` are unused until WU5 adds the selection pulse
      // and busy spinner FX layer — kept as named parameters (matching
      // `Renderer.render`'s signature) rather than dropped, so this stays a
      // drop-in seam implementation.
      if (destroyed) return;
      const offset = cameraOffset(frame, { width: app.renderer.width, height: app.renderer.height });
      worldContainer.x = offset.ox;
      worldContainer.y = offset.oy;
      tileScene.sync(frame);
      entityScene.sync(frame);
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
      app.destroy({ removeView: false }, { children: true });
    },
  };
}
