import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, CommandEnvelope, CommandResult, Event } from "../contract";
import type { PlayerStateResponse, ZoneSnapshotResponse } from "../net/api";
import type { Transport } from "../net/transport";
import type { Ui } from "../hud/ui";
import type { HudHandlers } from "../hud/hud";
import type { Store } from "../state/store";
import { createGame, loadSpriteAssets } from "./game";
import { createEmojiAssets } from "../render/assets";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_RAF = globalThis.requestAnimationFrame;
const ORIGINAL_CAF = globalThis.cancelAnimationFrame;
const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;
const ORIGINAL_SET_TIMEOUT = globalThis.setTimeout;

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
    toggleCrouch: () => {},
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

// --- sendCommand's TryCombination-scoped teletype hookup (crouch-crafting
// Slice B2, fresh-context review fix). `fakeUi().mount` is a no-op, so these
// tests capture the REAL `HudHandlers` game.ts builds by overriding `mount`
// to stash it, then invoke a handler directly and flush the fire-and-forget
// `sendCommand` promise it triggers (a single macrotask tick is enough since
// `fakeTransport`-shaped sends here resolve immediately, with no real I/O
// delay). -----------------------------------------------------------------

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Boots a `Game` with a transport whose accepted response is entirely
 * driven by `respond`, and a `ui` that stashes the real `HudHandlers` (so the
 * test can invoke one directly) and records every `showThought` call. */
async function bootCapturing(respond: (env: CommandEnvelope) => CommandResult): Promise<{ handlers: HudHandlers; showThoughtCalls: string[] }> {
  const { handlers, showThoughtCalls } = await bootCapturingFull(respond);
  return { handlers, showThoughtCalls };
}

/** Same as `bootCapturing`, but also stashes the real `Store` `Ui.mount`
 * receives — needed by the Slice C (action-pacing) tests below to assert
 * whether `store.ingest` has actually run yet. */
async function bootCapturingFull(
  respond: (env: CommandEnvelope) => CommandResult,
): Promise<{ handlers: HudHandlers; showThoughtCalls: string[]; store: Store }> {
  let handlers: HudHandlers | undefined;
  let store: Store | undefined;
  const showThoughtCalls: string[] = [];
  const ui: Ui = {
    ...fakeUi(),
    mount: (s, _catalog, h) => {
      handlers = h;
      store = s;
    },
    showThought: (text) => showThoughtCalls.push(text),
  };
  const transport: Transport = { send: async (env) => respond(env), onEvents: () => () => {} };
  const game = createGame({ canvas: fakeCanvas(), transport, ui });
  await game.start();
  if (!handlers || !store) throw new Error("Ui.mount was never called — boot must have failed silently");
  return { handlers, showThoughtCalls, store };
}

/** Deterministic fake timer for game.ts's action-pacing wiring (Slice C,
 * engram #2854): intercepts non-zero `setTimeout` delays (the ones
 * `action-pacing.ts`'s default scheduler uses for a real `durationMs`) and
 * captures them instead of running them, so a test can assert "not yet
 * applied" before manually firing the callback. `ms === 0` calls (this
 * file's own `flushMicrotasks`) are passed through to the REAL `setTimeout`
 * unchanged, so both mechanisms can coexist in the same test. */
function stubFakeTimers(): { fire: () => void; pending: number } {
  const calls: Array<() => void> = [];
  const originalRaw = ORIGINAL_SET_TIMEOUT as unknown as (cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => unknown;
  const fake = ((cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): unknown => {
    if (!ms) return originalRaw(cb, ms, ...args);
    calls.push(() => cb(...args));
    return 0;
  }) as typeof setTimeout;
  globalThis.setTimeout = fake;
  return {
    fire: () => {
      const cb = calls.shift();
      if (!cb) throw new Error("stubFakeTimers.fire(): no pending scheduled call");
      cb();
    },
    get pending() {
      return calls.length;
    },
  };
}

test("game.ts sendCommand: a TryCombination accepted response's graded ThoughtAdded feedback reaches the teletype via ui.showThought", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  try {
    const { handlers, showThoughtCalls } = await bootCapturing((env) =>
      env.command.type === "TryCombination"
        ? {
            clientCommandId: env.clientCommandId,
            accepted: true,
            events: [{ type: "ThoughtAdded", thought: { id: "t1", text: "Me falta algo: algo para atar.", kind: "observation", timestamp: 1 } }],
          }
        : { clientCommandId: env.clientCommandId, accepted: true, events: [] },
    );

    handlers.onTryCombination?.({ x: 0, y: 0 });
    await flushMicrotasks();

    assert.deepEqual(showThoughtCalls, ["Me falta algo: algo para atar."], "the graded feedback thought is surfaced to the teletype");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  }
});

test("game.ts hudHandlers.onTryCombinationSurface: dispatches TryCombination with method:'surface' against the mesa's world_object target (crouch-crafting Slice D, Decision 6)", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  try {
    let captured: CommandEnvelope["command"] | undefined;
    const { handlers } = await bootCapturing((env) => {
      captured = env.command;
      return { clientCommandId: env.clientCommandId, accepted: true, events: [] };
    });

    handlers.onTryCombinationSurface?.("wo_table_1");
    await flushMicrotasks();

    assert.deepEqual(captured, { type: "TryCombination", method: "surface", target: { kind: "world_object", id: "wo_table_1" } });
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  }
});

test("game.ts sendCommand REGRESSION GUARD: a non-TryCombination accepted command's ThoughtAdded is NOT written to the teletype by sendCommand itself — inventoryAddedMessage (ui.ts's own rerender) stays the sole teletype writer for those commands", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  try {
    const { handlers, showThoughtCalls } = await bootCapturing((env) =>
      env.command.type === "Observe"
        ? {
            clientCommandId: env.clientCommandId,
            accepted: true,
            // Shaped like a gather/craft action's real response (e.g.
            // `cut_tree_crude`/`improvise_crude_tool`): pairs an inventory
            // add with a success thought. Before the fix, game.ts's GENERAL
            // accepted-path hookup would have shown this thought and
            // clobbered `inventoryAddedMessage`'s "Guardé..." confirmation
            // that `ui.ts`'s own rerender writes for the SAME response.
            events: [
              {
                type: "ItemAddedToInventory",
                item: { id: "it1", itemTypeId: "small_stone", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } },
              },
              { type: "ThoughtAdded", thought: { id: "t2", text: "Encontré algo útil.", kind: "observation", timestamp: 1 } },
            ],
          }
        : { clientCommandId: env.clientCommandId, accepted: true, events: [] },
    );

    handlers.onObserve?.("it1");
    await flushMicrotasks();

    assert.deepEqual(showThoughtCalls, [], "sendCommand must not call showThought itself for a non-TryCombination command, even when its response carries a ThoughtAdded");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  }
});

// --- Slice C (Decision 1, engram #2854): sendCommand's action-pacing wiring ---

test("game.ts sendCommand: durationMs>0 DEFERS store.ingest until the fake timer fires — energy stays 100 during the gate, updates only after", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  const timers = stubFakeTimers();
  try {
    const { handlers, store } = await bootCapturingFull((env) =>
      env.command.type === "Observe"
        ? { clientCommandId: env.clientCommandId, accepted: true, events: [{ type: "EnergyChanged", energy: 42 }], durationMs: 900 }
        : { clientCommandId: env.clientCommandId, accepted: true, events: [] },
    );

    assert.equal(store.getState().player.energy, 100, "unchanged before the command even resolves");
    handlers.onObserve?.("it1");
    await flushMicrotasks(); // let the fire-and-forget sendCommand run up to actionPacing.handleResult

    assert.equal(store.getState().player.energy, 100, "NOT yet applied — durationMs>0 must gate ingest before the timer fires");
    assert.equal(timers.pending, 1, "the 900ms window was scheduled");

    timers.fire();

    assert.equal(store.getState().player.energy, 42, "applied once the scheduled duration elapses");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
    globalThis.setTimeout = ORIGINAL_SET_TIMEOUT;
  }
});

test("game.ts sendCommand: durationMs absent/0 applies immediately — no regression for non-timed commands", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  const timers = stubFakeTimers();
  try {
    const { handlers, store } = await bootCapturingFull((env) =>
      env.command.type === "Observe" ? { clientCommandId: env.clientCommandId, accepted: true, events: [{ type: "EnergyChanged", energy: 77 }] } : { clientCommandId: env.clientCommandId, accepted: true, events: [] },
    );

    handlers.onObserve?.("it1");
    await flushMicrotasks();

    assert.equal(store.getState().player.energy, 77, "instant application, exactly like before Slice C");
    assert.equal(timers.pending, 0, "nothing scheduled for an untimed command");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
    globalThis.setTimeout = ORIGINAL_SET_TIMEOUT;
  }
});

test("game.ts sendCommand: a second command sent while busy is ignored (early-return, no transport call)", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  const timers = stubFakeTimers();
  try {
    let sendCount = 0;
    let handlers: HudHandlers | undefined;
    const ui: Ui = {
      ...fakeUi(),
      mount: (_store, _catalog, h) => {
        handlers = h;
      },
    };
    const transport: Transport = {
      send: async (env) => {
        sendCount++;
        return env.command.type === "Observe"
          ? { clientCommandId: env.clientCommandId, accepted: true, events: [], durationMs: 900 }
          : { clientCommandId: env.clientCommandId, accepted: true, events: [] };
      },
      onEvents: () => () => {},
    };
    const game = createGame({ canvas: fakeCanvas(), transport, ui });
    await game.start();
    if (!handlers) throw new Error("Ui.mount was never called");

    handlers.onObserve?.("it1"); // starts a 900ms-gated command -> busy
    await flushMicrotasks();
    assert.equal(sendCount, 1);
    assert.equal(timers.pending, 1, "still busy, timer pending");

    handlers.onObserve?.("it2"); // sent while busy -> must be ignored BEFORE calling transport
    await flushMicrotasks();
    assert.equal(sendCount, 1, "sendCommand's isBusy() early-return prevented a second transport.send call");

    timers.fire(); // clears busy
    await flushMicrotasks();
    handlers.onObserve?.("it3"); // now allowed again
    await flushMicrotasks();
    assert.equal(sendCount, 2, "a new command is accepted once busy clears");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
    globalThis.setTimeout = ORIGINAL_SET_TIMEOUT;
  }
});

// --- Fresh-context-review hardening: the in-flight guard closes a race the
// original isBusy()-only gate missed (busy used to only get set AFTER a
// result with durationMs>0 came back — nothing gated the network round-trip
// itself). ------------------------------------------------------------------

test("game.ts sendCommand: a second command fired WHILE the first's transport.send is still PENDING (not yet resolved) is dropped — the in-flight race", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  try {
    let sendCount = 0;
    let resolveFirst: ((result: CommandResult) => void) | undefined;
    let handlers: HudHandlers | undefined;
    const ui: Ui = {
      ...fakeUi(),
      mount: (_store, _catalog, h) => {
        handlers = h;
      },
    };
    const transport: Transport = {
      send: (env) => {
        sendCount++;
        if (sendCount === 1) {
          // Deliberately never resolves until the test calls `resolveFirst`
          // — simulates a real network round-trip that's still in flight,
          // as opposed to the fakeTransport-style instant resolution the
          // OTHER "second command while busy" test above exercises (which
          // only covers the SEQUENTIAL/post-response case).
          return new Promise<CommandResult>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({ clientCommandId: env.clientCommandId, accepted: true, events: [] });
      },
      onEvents: () => () => {},
    };
    const game = createGame({ canvas: fakeCanvas(), transport, ui });
    await game.start();
    if (!handlers) throw new Error("Ui.mount was never called");

    handlers.onObserve?.("it1"); // starts the round-trip — does NOT resolve yet
    handlers.onObserve?.("it2"); // fired WHILE the first is still pending -> must be dropped
    await flushMicrotasks();

    assert.equal(sendCount, 1, "the second command never reached transport.send — beginDispatch() dropped it synchronously, before any await");

    resolveFirst?.({ clientCommandId: "c1", accepted: true, events: [] });
    await flushMicrotasks();

    handlers.onObserve?.("it3"); // now allowed again — the first command's lifecycle fully completed
    await flushMicrotasks();
    assert.equal(sendCount, 2, "a new command is accepted once the in-flight command's lifecycle fully completes");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  }
});

test("game.ts sendCommand: the in-flight guard clears via finally even when transport.send REJECTS — no stuck freeze", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  try {
    let sendCount = 0;
    let handlers: HudHandlers | undefined;
    const showThoughtCalls: string[] = [];
    const ui: Ui = {
      ...fakeUi(),
      mount: (_store, _catalog, h) => {
        handlers = h;
      },
      showThought: (t) => showThoughtCalls.push(t),
    };
    const transport: Transport = {
      send: async (env) => {
        sendCount++;
        if (sendCount === 1) throw new Error("network down");
        return { clientCommandId: env.clientCommandId, accepted: true, events: [] };
      },
      onEvents: () => () => {},
    };
    const game = createGame({ canvas: fakeCanvas(), transport, ui });
    await game.start();
    if (!handlers) throw new Error("Ui.mount was never called");

    handlers.onObserve?.("it1"); // transport.send rejects
    await flushMicrotasks();

    assert.equal(sendCount, 1);
    assert.ok(showThoughtCalls[0]?.includes("No pude hablar con el backend"), "the transport-error thought still surfaces");

    handlers.onObserve?.("it2"); // must NOT be stuck — the finally must have cleared the guard even on rejection
    await flushMicrotasks();
    assert.equal(sendCount, 2, "a subsequent command goes through — no stuck-busy freeze after a transport rejection");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  }
});

test("game.ts sendCommand: a TryCombination's teletype feedback surfaces AFTER the deferred ingest, not before (durationMs>0)", async () => {
  stubBootFetch();
  stubSingleTickRaf();
  stubDocument();
  stubWindowGlobal();
  const timers = stubFakeTimers();
  try {
    const { handlers, showThoughtCalls, store } = await bootCapturingFull((env) =>
      env.command.type === "TryCombination"
        ? {
            clientCommandId: env.clientCommandId,
            accepted: true,
            events: [{ type: "EnergyChanged", energy: 50 }, { type: "ThoughtAdded", thought: { id: "t1", text: "Esto debería funcionar.", kind: "discovery", timestamp: 1 } }],
            durationMs: 1200,
          }
        : { clientCommandId: env.clientCommandId, accepted: true, events: [] },
    );

    handlers.onTryCombination?.({ x: 0, y: 0 });
    await flushMicrotasks();

    // "Trabajando…" is the busy-gate affordance itself (action-pacing.ts's
    // showBusy) — the craft's OWN graded/success feedback must not appear yet.
    assert.deepEqual(showThoughtCalls, ["Trabajando…"], "only the busy affordance shows — the craft is still 'in progress'");
    assert.equal(store.getState().player.energy, 100, "events not yet applied either");

    timers.fire();

    assert.equal(store.getState().player.energy, 50, "events applied once the craft's duration elapses");
    assert.deepEqual(showThoughtCalls, ["Trabajando…", "Esto debería funcionar."], "feedback surfaces AFTER the deferred ingest, matching the craft's actual completion");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.requestAnimationFrame = ORIGINAL_RAF;
    globalThis.cancelAnimationFrame = ORIGINAL_CAF;
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
    globalThis.setTimeout = ORIGINAL_SET_TIMEOUT;
  }
});
