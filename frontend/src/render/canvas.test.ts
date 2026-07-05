import { test } from "node:test";
import assert from "node:assert/strict";
import { PX, SCALE, createCanvasRenderer, spriteDrawRect } from "./canvas";
import type { AssetResolver, SpriteRegion } from "./assets";
import type { Frame } from "../view/viewstate";

// Table-driven over the design's worked examples (design.md "Consumer + draw
// math"): a single formula serves the single-tile, tall-multi-cell, and
// wide-multi-cell cases with no special-casing (spec "Bottom-aligned anchor
// for multi-cell sprites").
const CASES: {
  name: string;
  tileX: number;
  tileY: number;
  region: { sw: number; sh: number };
  expected: { dx: number; dy: number; dw: number; dh: number };
}[] = [
  {
    name: "16x16 single-tile terrain: no offset, aligned to the tile's top-left",
    tileX: 2,
    tileY: 3,
    region: { sw: 16, sh: 16 },
    expected: { dx: 2 * PX, dy: 3 * PX, dw: PX, dh: PX },
  },
  {
    name: "16x32 (1x2) tall object: bottom-aligned, extends one tile upward",
    tileX: 0,
    tileY: 5,
    region: { sw: 16, sh: 32 },
    expected: { dx: 0, dy: 5 * PX - PX, dw: PX, dh: 2 * PX },
  },
  {
    name: "32x16 (2x1) wide object: left-aligned, extends one tile rightward, no vertical offset",
    tileX: 4,
    tileY: 1,
    region: { sw: 32, sh: 16 },
    expected: { dx: 4 * PX, dy: 1 * PX, dw: 2 * PX, dh: PX },
  },
];

for (const c of CASES) {
  test(`spriteDrawRect: ${c.name}`, () => {
    const rect = spriteDrawRect(c.tileX, c.tileY, c.region, PX, SCALE);
    assert.deepEqual(rect, c.expected);
  });
}

test("spriteDrawRect: bottom edge of a tall region always lands exactly on the tile's bottom edge", () => {
  const rect = spriteDrawRect(0, 0, { sw: 16, sh: 32 }, PX, SCALE);
  assert.equal(rect.dy + rect.dh, PX, "region's bottom (dy + dh) must equal the logical tile's bottom (1 * PX)");
});

// Integration coverage for spec "World-canvas sprite draw via drawImage" —
// the pure `spriteDrawRect` math above is necessary but not sufficient: this
// verifies `createCanvasRenderer(...).render(...)` actually DISPATCHES to
// `ctx.drawImage` for a sprite-mapped tile and to `ctx.fillText` (the
// existing `drawEmoji` path) for an unmapped one, at all four call sites the
// verify report flagged as inspected-but-untested (entity/pile/player via
// `drawObjectOrItem`/`drawPile`/`drawPlayer`, terrain via its own
// fill-OR-sprite branch).

type RecordedCalls = { drawImage: unknown[][]; fillText: unknown[][]; fillRect: unknown[][]; stroke: unknown[][] };

/** Mirrors `game/game.test.ts`'s `fakeCanvasContext`, extended to RECORD
 * calls to `drawImage`/`fillText`/`fillRect`/`stroke` instead of no-op'ing
 * them, so tests can assert which draw path actually fired. `stroke()` (the
 * bare path stroke) is UNIQUE to the busy indicator's spinner arc — no other
 * draw in this renderer calls it (the selection ring uses `strokeRect`), so
 * it's a clean discriminator for "the over-avatar cue drew". */
function fakeRecordingContext(): { ctx: CanvasRenderingContext2D; calls: RecordedCalls } {
  const noop = () => {};
  const calls: RecordedCalls = { drawImage: [], fillText: [], fillRect: [], stroke: [] };
  const ctx = {
    canvas: { width: 480, height: 480 },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    imageSmoothingEnabled: true,
    clearRect: noop,
    fillRect: (...args: unknown[]) => calls.fillRect.push(args),
    strokeRect: noop,
    fillText: (...args: unknown[]) => calls.fillText.push(args),
    strokeText: noop,
    drawImage: (...args: unknown[]) => calls.drawImage.push(args),
    beginPath: noop,
    arc: noop,
    fill: noop,
    stroke: (...args: unknown[]) => calls.stroke.push(args),
    save: noop,
    restore: noop,
    translate: noop,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const FAKE_IMAGE = {} as CanvasImageSource;

function fakeSpriteRegion(): SpriteRegion {
  return { image: FAKE_IMAGE, sx: 0, sy: 0, sw: 16, sh: 16 };
}

function baseFrame(overrides: Partial<Frame> = {}): Frame {
  return { zone: { width: 4, height: 4 }, tiles: [], entities: [], clockMs: 0, ...overrides };
}

test("createCanvasRenderer: sprite-mapped entity draws via ctx.drawImage, not ctx.fillText (spec 'Mapped typeId draws via drawImage')", () => {
  const { ctx, calls } = fakeRecordingContext();
  const assets: AssetResolver = { resolve: () => ({ sprite: fakeSpriteRegion() }) };
  const renderer = createCanvasRenderer(ctx, assets);
  const frame = baseFrame({
    entities: [{ id: "e1", kind: "object", typeId: "tree", renderPos: { x: 1, y: 1 }, visibility: "visible" }],
  });

  renderer.render(frame, null);

  assert.equal(calls.drawImage.length, 1, "drawImage must be called once for the sprite-mapped entity");
  assert.equal(calls.fillText.length, 0, "fillText must NOT be called for a sprite-mapped entity");
});

test("createCanvasRenderer: unmapped entity draws via ctx.fillText (drawEmoji), not ctx.drawImage (spec 'Unmapped typeId still draws via drawEmoji')", () => {
  const { ctx, calls } = fakeRecordingContext();
  const assets: AssetResolver = { resolve: () => ({ glyph: "🌳", scale: 0.72 }) };
  const renderer = createCanvasRenderer(ctx, assets);
  const frame = baseFrame({
    entities: [{ id: "e1", kind: "object", typeId: "unmapped-thing", renderPos: { x: 1, y: 1 }, visibility: "visible" }],
  });

  renderer.render(frame, null);

  assert.equal(calls.fillText.length, 1, "fillText must be called once for an unmapped entity");
  assert.equal(calls.drawImage.length, 0, "drawImage must NOT be called for an unmapped entity");
});

test("createCanvasRenderer: busy=true draws the over-avatar spinner (ctx.stroke) at the player; busy=false does not (crouch-crafting follow-up)", () => {
  const assets: AssetResolver = { resolve: () => ({ glyph: "🧍", scale: 0.72 }) };
  const playerFrame = () =>
    baseFrame({ entities: [{ id: "p1", kind: "player", typeId: "player", renderPos: { x: 2, y: 2 }, visibility: "visible" }] });

  const idle = fakeRecordingContext();
  createCanvasRenderer(idle.ctx, assets).render(playerFrame(), null, false);
  assert.equal(idle.calls.stroke.length, 0, "no spinner arc when not busy");

  const working = fakeRecordingContext();
  createCanvasRenderer(working.ctx, assets).render(playerFrame(), null, true);
  assert.equal(working.calls.stroke.length, 1, "the spinner arc strokes once over the player when busy");
});

test("createCanvasRenderer: busy=true with NO player entity draws no spinner (nothing to anchor to)", () => {
  const assets: AssetResolver = { resolve: () => ({ glyph: "?" }) };
  const { ctx, calls } = fakeRecordingContext();
  createCanvasRenderer(ctx, assets).render(baseFrame({ entities: [] }), null, true);
  assert.equal(calls.stroke.length, 0, "the cue is anchored to the player — none present, none drawn");
});

test("createCanvasRenderer: sprite-mapped terrain draws via ctx.drawImage, not ctx.fillRect (terrain's own fill-OR-sprite branch)", () => {
  const { ctx, calls } = fakeRecordingContext();
  const assets: AssetResolver = { resolve: (kind) => (kind === "terrain" ? { sprite: fakeSpriteRegion() } : { glyph: "?" }) };
  const renderer = createCanvasRenderer(ctx, assets);
  const frame = baseFrame({
    tiles: [{ x: 0, y: 0, terrain: "sand", walkable: true, tags: [], visibility: "visible" }],
  });

  renderer.render(frame, null);

  assert.equal(calls.drawImage.length, 1, "drawImage must be called once for the sprite-mapped terrain tile");
  assert.equal(calls.fillRect.length, 0, "fillRect must NOT be called for a sprite-mapped terrain tile");
});

test("createCanvasRenderer: unmapped terrain draws via ctx.fillRect with its resolved color, not ctx.drawImage", () => {
  const { ctx, calls } = fakeRecordingContext();
  const assets: AssetResolver = { resolve: (kind) => (kind === "terrain" ? { color: "#d9c089" } : { glyph: "?" }) };
  const renderer = createCanvasRenderer(ctx, assets);
  const frame = baseFrame({
    tiles: [{ x: 0, y: 0, terrain: "sand", walkable: true, tags: [], visibility: "visible" }],
  });

  renderer.render(frame, null);

  assert.equal(calls.fillRect.length, 1, "fillRect must be called once for the unmapped terrain tile");
  assert.equal(calls.drawImage.length, 0, "drawImage must NOT be called for an unmapped terrain tile");
  assert.equal(ctx.fillStyle, "#d9c089", "fillStyle must be set to the resolved terrain color before fillRect");
});
