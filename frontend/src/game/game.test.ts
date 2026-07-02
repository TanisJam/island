import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, CommandEnvelope, CommandResult, Event } from "../contract";
import type { PlayerStateResponse, ZoneSnapshotResponse } from "../net/api";
import type { Transport } from "../net/transport";
import type { Ui } from "../hud/ui";
import { createGame, loadSpriteAssets } from "./game";
import { createEmojiAssets } from "../render/assets";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_RAF = globalThis.requestAnimationFrame;
const ORIGINAL_CAF = globalThis.cancelAnimationFrame;
const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;

function emptyCatalog(): Catalog {
  return { catalogVersion: "v1", terrains: [], items: [], worldObjects: [], knowledge: [], actions: [], research: [] };
}

function zoneResponse(): ZoneSnapshotResponse {
  return {
    zone: { id: "z1", type: "personal", width: 4, height: 4 },
    visionRadius: 5,
    tiles: [{ x: 0, y: 0, terrain: "grass", walkable: true, tags: [], visibility: "visible" }],
    objects: [],
    piles: [],
    worldItems: [],
    surfaceItems: [],
    catalogVersion: "v1",
  };
}

function playerResponse(): PlayerStateResponse {
  return {
    player: { id: "p1", name: "Náufrago", currentZoneId: "z1", position: { x: 0, y: 0 }, stats: { health: 100, maxHealth: 100, energy: 100, maxEnergy: 100 } },
    inventory: { id: "inv1", ownerType: "player", ownerId: "p1", width: 4, height: 4, handSlots: { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } } },
    items: [],
    knowledge: [],
    thoughtLog: [],
  };
}

/** Stubs the three boot GETs based on the request path, mirroring the
 * fetch-stubbing pattern used by net/transport.test.ts. */
function stubBootFetch(): void {
  globalThis.fetch = (async (url: string | URL) => {
    const path = String(url);
    const body = path.includes("/catalog") ? emptyCatalog() : path.includes("/zones/") ? zoneResponse() : playerResponse();
    return { ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response;
  }) as typeof fetch;
}

/** Runs the callback exactly once, synchronously, instead of scheduling a
 * real animation frame — Node has no `requestAnimationFrame`. */
function stubSingleTickRaf(): void {
  let fired = false;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    if (!fired) {
      fired = true;
      cb(performance.now());
    }
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
}

function fakeCanvasContext(): CanvasRenderingContext2D {
  const noop = () => {};
  return {
    canvas: { width: 64, height: 64 },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    strokeText: noop,
    beginPath: noop,
    arc: noop,
    fill: noop,
    save: noop,
    restore: noop,
    translate: noop,
  } as unknown as CanvasRenderingContext2D;
}

function fakeCanvas(): HTMLCanvasElement {
  return { getContext: () => fakeCanvasContext(), addEventListener: () => {} } as unknown as HTMLCanvasElement;
}

/** `input/mouse.ts` registers a document-level click listener to close the
 * context menu on outside clicks. Node has no DOM `document` global. */
function stubDocument(): void {
  (globalThis as { document?: unknown }).document = { addEventListener: () => {} };
}

/** `game/game.ts` wires `window.addEventListener("resize", ...)` and reads
 * `window.innerWidth/innerHeight` to size the fullscreen canvas (spec
 * "Fullscreen Map with Player-Centered Camera"). Node has no DOM `window`
 * global. */
function stubWindowGlobal(): void {
  (globalThis as { window?: unknown }).window = { innerWidth: 64, innerHeight: 64, addEventListener: () => {} };
}

function fakeTransport(): Transport {
  return {
    send: async (_env: CommandEnvelope): Promise<CommandResult> => ({ clientCommandId: "c1", accepted: true, events: [] as Event[] }),
    onEvents: () => () => {},
  };
}

function fakeUi(): Ui {
  return {
    mount: () => {},
    showThought: () => {},
    destroy: () => {},
    toggleInventory: () => {},
    toggleThoughts: () => {},
    toggleSurface: () => {},
    openContextMenu: () => {},
    closeContextMenu: () => {},
  };
}

// --- loadSpriteAssets degrade paths (spec "Missing atlas or image degrades
// to emoji, does not crash boot" — explicit scenarios, not incidental
// coverage via the boot test above; batch-2 apply requirement). ---

test("loadSpriteAssets: atlas.json 404 degrades cleanly to a pure emoji resolver", async () => {
  globalThis.fetch = (async () =>
    ({ ok: false, status: 404, statusText: "Not Found", json: async () => ({}) }) as unknown as Response) as typeof fetch;
  try {
    const fallback = createEmojiAssets();
    const resolver = await loadSpriteAssets(fallback);
    assert.deepEqual(resolver.resolve("object", "tree"), fallback.resolve("object", "tree"));
    assert.deepEqual(resolver.resolve("terrain", "sand"), fallback.resolve("terrain", "sand"));
    assert.equal(resolver.resolve("object", "tree").sprite, undefined);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test("loadSpriteAssets: a malformed atlas.json (200 but fails parseAtlas) degrades cleanly to a pure emoji resolver", async () => {
  globalThis.fetch = (async () =>
    ({ ok: true, status: 200, statusText: "OK", json: async () => ({ not: "an atlas" }) }) as unknown as Response) as typeof fetch;
  try {
    const fallback = createEmojiAssets();
    const resolver = await loadSpriteAssets(fallback);
    assert.deepEqual(resolver.resolve("item", "small_stone"), fallback.resolve("item", "small_stone"));
    assert.equal(resolver.resolve("item", "small_stone").sprite, undefined);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test("loadSpriteAssets: a fetch rejection (network failure) degrades cleanly to a pure emoji resolver", async () => {
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  try {
    const fallback = createEmojiAssets();
    const resolver = await loadSpriteAssets(fallback);
    assert.deepEqual(resolver.resolve("player", "player"), fallback.resolve("player", "player"));
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test("createGame().start(): boots, builds a store, and one loop tick renders without throwing", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  try {
    const game = createGame({ canvas: fakeCanvas(), transport: fakeTransport(), ui: fakeUi() });
    await assert.doesNotReject(() => game.start());
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  }
});
