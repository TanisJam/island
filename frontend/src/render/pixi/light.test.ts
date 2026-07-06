import { test } from "node:test";
import assert from "node:assert/strict";
import { Sprite, Texture } from "pixi.js";
import { createLightScene } from "./scene";
import type { TextureProvider } from "./textures";
import type { AssetResolver, LightSpec, VisualDescriptor } from "../assets";
import type { Frame, RenderEntity } from "../../view/viewstate";

/**
 * GL-free coverage for `createLightScene` (design.md D8, spec "GL-Free Test
 * Coverage"): runs under bare `node --test`, no `app.init()`, no real GL
 * context — same constraint `pixi.test.ts` documents at its own top. Both
 * light-emitter shapes this spec covers (campfire's runtime `state.lit`
 * fork and the mushroom's static catalog `glow`) collapse to the SAME
 * `visual.light` shape by the time they reach the reconciler, so fixtures
 * here don't need to model either producer specifically — only the
 * resolved `VisualDescriptor.light` (or its absence) matters.
 */

const CAMPFIRE_LIGHT: LightSpec = { radius: 3.5, color: "#f0a24e", intensity: 0.65 };
const MUSHROOM_LIGHT: LightSpec = { radius: 2, color: "#7fe0c9", intensity: 0.55 };

function stubTextures(): TextureProvider {
  return {
    forColor: () => Texture.EMPTY,
    forRegion: () => Texture.EMPTY,
    forGlyph: () => Texture.EMPTY,
    forRing: () => Texture.EMPTY,
    forGlow: () => Texture.EMPTY,
    destroy: () => {},
  };
}

function frame(entities: RenderEntity[], clockMs = 0): Frame {
  return { zone: { width: 1, height: 1 }, tiles: [], entities, clockMs };
}

function litCampfire(id = "campfire-1"): RenderEntity {
  return { id, kind: "object", typeId: "campfire", renderPos: { x: 2, y: 3 }, visibility: "visible", state: { lit: true } };
}

function unlitCampfire(id = "campfire-1"): RenderEntity {
  return { id, kind: "object", typeId: "campfire", renderPos: { x: 2, y: 3 }, visibility: "visible", state: { lit: false } };
}

function unseenLitCampfire(id = "campfire-1"): RenderEntity {
  return { id, kind: "object", typeId: "campfire", renderPos: { x: 2, y: 3 }, visibility: "unseen", state: { lit: true } };
}

function visibleMushroom(id = "mushroom-1"): RenderEntity {
  return { id, kind: "object", typeId: "bioluminescent_mushroom", renderPos: { x: 5, y: 5 }, visibility: "visible" };
}

function unseenMushroom(id = "mushroom-1"): RenderEntity {
  return { id, kind: "object", typeId: "bioluminescent_mushroom", renderPos: { x: 5, y: 5 }, visibility: "unseen" };
}

/** Per-entity light lookup, keyed by the fixed typeId scheme the fixtures
 * above use — mirrors the real `objectLight()` seam closely enough for this
 * reconciler-only suite (campfire is state-gated, mushroom is unconditional
 * once it appears with `visibility: "visible"`). */
function assetsFor(lightByTypeId: Record<string, LightSpec>): AssetResolver {
  return {
    resolve(_kind, typeId, state = {}): VisualDescriptor {
      if (typeId === "campfire") return state["lit"] ? { light: lightByTypeId["campfire"] } : {};
      const light = lightByTypeId[typeId];
      return light ? { light } : {};
    },
  };
}

const ASSETS = assetsFor({ campfire: CAMPFIRE_LIGHT, bioluminescent_mushroom: MUSHROOM_LIGHT });

test("createLightScene: lit + visible campfire has a light node", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS });
  scene.sync(frame([litCampfire()]));
  assert.equal(scene.container.children.length, 1);
});

test("createLightScene: unlit campfire has no light node", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS });
  scene.sync(frame([unlitCampfire()]));
  assert.equal(scene.container.children.length, 0);
});

test("createLightScene: lit but not-visible (unseen) campfire has no light node — no glow leaks into fog", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS });
  scene.sync(frame([unseenLitCampfire()]));
  assert.equal(scene.container.children.length, 0);
});

test("createLightScene: visible mushroom has a light node", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS });
  scene.sync(frame([visibleMushroom()]));
  assert.equal(scene.container.children.length, 1);
});

test("createLightScene: not-visible (unseen) mushroom has no light node", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS });
  scene.sync(frame([unseenMushroom()]));
  assert.equal(scene.container.children.length, 0);
});

test("createLightScene: a lit campfire that goes unlit removes its pooled node (not merely hides it)", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS });
  scene.sync(frame([litCampfire()]));
  assert.equal(scene.container.children.length, 1);
  scene.sync(frame([unlitCampfire()]));
  assert.equal(scene.container.children.length, 0, "no light node lingers once the emitter has no light");
});

test("createLightScene: node is destroyed once the entity id no longer appears in frame.entities at all", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS });
  scene.sync(frame([litCampfire()]));
  assert.equal(scene.container.children.length, 1);
  scene.sync(frame([]));
  assert.equal(scene.container.children.length, 0);
});

test("createLightScene: both a campfire and a mushroom resolve through the identical reconciler path simultaneously", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS });
  scene.sync(frame([litCampfire(), visibleMushroom()]));
  assert.equal(scene.container.children.length, 2);
});

// --- Reduced motion (spec "Reduced-Motion Steady Light") ---

test("createLightScene: reduced motion true — alpha/scale stay constant across frames with different clockMs", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS, reducedMotion: () => true });
  scene.sync(frame([litCampfire()], 0));
  const sprite = scene.container.children[0] as Sprite;
  const alpha0 = sprite.alpha;
  const width0 = sprite.width;

  scene.sync(frame([litCampfire()], 500));
  assert.equal(sprite.alpha, alpha0, "alpha must not change frame to frame under reduced motion");
  assert.equal(sprite.width, width0, "scale must not change frame to frame under reduced motion");

  scene.sync(frame([litCampfire()], 1000));
  assert.equal(sprite.alpha, alpha0);
  assert.equal(sprite.width, width0);
});

test("createLightScene: reduced motion false — alpha/scale vary with clockMs (subtle breathing)", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS, reducedMotion: () => false });
  scene.sync(frame([litCampfire()], 0));
  const sprite = scene.container.children[0] as Sprite;
  const alpha0 = sprite.alpha;
  const width0 = sprite.width;

  scene.sync(frame([litCampfire()], 450));
  const alphaChanged = sprite.alpha !== alpha0;
  const widthChanged = sprite.width !== width0;
  assert.ok(alphaChanged || widthChanged, "alpha or scale should vary with the clock under normal motion");
});

test("createLightScene: container uses additive blend mode (never fights the multiplicative fog tint)", () => {
  const scene = createLightScene({ textures: stubTextures(), assets: ASSETS });
  assert.equal(scene.container.blendMode, "add");
});
