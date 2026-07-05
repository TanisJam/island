import type { Command, CommandEnvelope, CommandResult, Event } from "../contract";
import { buildItemMenu, type ContextMenuItem } from "../actions/context-menu";
import { dispatchMenuItem, type MenuDispatchDeps } from "../actions/context-menu-dispatch";
import { fetchCatalog, fetchPlayerState, fetchZone } from "../net/api";
import type { Transport } from "../net/transport";
import { buildSnapshot } from "../state/snapshot";
import { createStore } from "../state/store";
import { createViewState } from "../view/viewstate";
import { createEmojiAssets, createSpriteAssets, parseAtlas } from "../render/assets";
import type { AssetResolver } from "../render/assets";
import { createCanvasRenderer } from "../render/canvas";
import type { Renderer } from "../render/renderer";
import { canvasToTile, createInputController } from "../input/mouse";
import { createActionPacing } from "../input/action-pacing";
import type { Ui } from "../hud/ui";
import type { HudHandlers } from "../hud/hud";
import { createDragController } from "../hud/drag";

const PLAYER_ID = "p1";
const ZONE_ID = "z1";
const STEP = 1000 / 60; // fixed update step, 60Hz (design.md "Game boot + loop")

export interface GameDeps {
  canvas: HTMLCanvasElement;
  transport: Transport;
  ui: Ui;
}

/**
 * Owns boot, Store, Transport, input, loop and ViewState wiring (design.md
 * SEAM 5 / spec "Game/App Controller Owns Composition"). `main.ts` only
 * builds `GameDeps` and calls `start()` — none of the former imperative
 * command→render glue lives there anymore.
 */
export interface Game {
  start(): Promise<void>;
  stop(): void;
}

/** Acquires the 2D drawing context for the Canvas renderer. MUST NOT be
 * called on the `?renderer=pixi` path (design.md D4) — a 2D context poisons
 * the canvas for WebGL, so the flag branch in `start()` skips this entirely
 * rather than acquiring-then-discarding it. */
function getCanvas2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo obtener el contexto 2D del canvas");
  return ctx;
}

/** Loads the tileset image from the given URL. Rejects (never throws
 * synchronously) on a missing `Image` global — e.g. under `node --test`,
 * which has no DOM — so `loadSpriteAssets` below can catch it uniformly
 * alongside a real image-load failure. */
function loadTilesetImage(src: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    if (typeof Image !== "function") {
      reject(new Error("Image is not available in this environment"));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load tileset image: ${src}`));
    img.src = src;
  });
}

/**
 * Fetches `atlas.json` + the tileset image it references and builds a
 * `createSpriteAssets` resolver. ANY failure along the way (404, malformed
 * JSON, image load error, missing `Image` global) soft-falls back to
 * `fallback` — never rejects, never throws (spec "Missing atlas or image
 * degrades to emoji, does not crash boot"; design.md "Boot failure").
 */
export async function loadSpriteAssets(fallback: AssetResolver): Promise<AssetResolver> {
  try {
    const res = await fetch("/atlas.json");
    if (!res.ok) return fallback;
    const atlas = parseAtlas(await res.json());
    const image = await loadTilesetImage(`/${atlas.image}`);
    return createSpriteAssets(atlas, image);
  } catch {
    return fallback;
  }
}

export function createGame(deps: GameDeps): Game {
  let rafId: number | null = null;
  // Set the instant `stop()` is called and checked again once the renderer
  // (Canvas, synchronous; or Pixi, async via `app.init()`) is ready — this is
  // the guard against `stop()` racing the async Pixi init (design.md D5): a
  // fast stop-after-start must never leave an initializing Pixi app / GL
  // context nobody will ever `destroy()`.
  let stopped = false;
  let renderer: Renderer | null = null;

  async function start(): Promise<void> {
    stopped = false;

    // Renderer selection flag (spec "Renderer Selection Flag", design.md
    // D4). Read and branched on BEFORE any `getContext("2d")` call — the
    // Pixi branch never touches the 2D context path at all, since acquiring
    // one first would poison the canvas for WebGL. Node-safe guard (mirrors
    // `render/canvas.ts`'s `prefersReducedMotion()`): `location` doesn't
    // exist under `node --test`, so the flag is simply off there — Canvas
    // stays the default, matching every existing boot test's expectations.
    const usePixi = typeof location !== "undefined" && new URLSearchParams(location.search).get("renderer") === "pixi";

    const [catalog, zone, player, assets] = await Promise.all([
      fetchCatalog(),
      fetchZone(ZONE_ID),
      fetchPlayerState(PLAYER_ID),
      loadSpriteAssets(createEmojiAssets()),
    ]);
    const snapshot = buildSnapshot(zone, player);

    const store = createStore(snapshot);
    const viewState = createViewState(store);

    let createdRenderer: Renderer;
    if (usePixi) {
      // Pixi is dynamically imported (NOT a static top-level import) so Vite
      // code-splits pixi.js into a lazy chunk fetched ONLY on the
      // `?renderer=pixi` path — Canvas-default users never download it
      // (~144 kB gzip), honoring "Canvas the default at every step" until the
      // renderer is retired at parity (WU7).
      const { createPixiRenderer } = await import("../render/pixi/renderer");
      createdRenderer = await createPixiRenderer(deps.canvas, assets);
    } else {
      createdRenderer = createCanvasRenderer(getCanvas2dContext(deps.canvas), assets);
    }

    if (stopped) {
      // `stop()` fired while the awaits above (in particular Pixi's async
      // `app.init()`) were still in flight. Tear the freshly created
      // renderer down immediately and bail out before wiring anything else
      // (input, HUD, the render loop) — never let a stopped game keep
      // running.
      createdRenderer.destroy();
      return;
    }
    renderer = createdRenderer;

    // Fullscreen map (spec "Fullscreen Map with Player-Centered Camera"):
    // size the canvas to the viewport now, and re-fit on every resize —
    // `render/canvas.ts`'s camera translate recenters on the player using
    // whatever width/height the canvas buffer currently has.
    createdRenderer.resize(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", () => createdRenderer.resize(window.innerWidth, window.innerHeight));

    // Slice C — Action Duration (Decision 1, engram #2854): gates input and
    // defers `store.ingest` for the window a `CommandResult.durationMs > 0`
    // reports, showing "Trabajando…" via the existing teletype meanwhile.
    // `durationMs` absent/0 is untouched — `applyResult` ingests immediately,
    // reproducing today's exact instant behavior.
    //
    // Fresh-context-review hardening: `beginDispatch()` is called
    // SYNCHRONOUSLY, before `await transport.send(...)` — this closes a race
    // the original `isBusy()`-only gate missed, where a second command fired
    // WHILE the first's network round-trip was still pending (not yet
    // deferred, not yet even resolved) slipped through untouched, since
    // `busy` used to only get set once a result with `durationMs>0` came
    // back. `endDispatch()` runs in a `finally` so busy ALWAYS clears — even
    // on a transport rejection, a not-accepted result, or a synchronous
    // throw inside `applyResult` itself — except on the one path that must
    // NOT clear yet: `applyResult` returning `true` (deferred), where the
    // module's own scheduled callback owns clearing busy once the duration
    // actually elapses.
    const actionPacing = createActionPacing({
      ingest: store.ingest,
      showBusy: deps.ui.showThought,
    });

    const sendCommand = async (command: Command): Promise<void> => {
      // Input gate: a command is DROPPED (never queued) if one is already
      // in flight — covers the network round-trip AND any deferred duration
      // window. `input/mouse.ts` additionally suppresses click dispatch for
      // the same reason, as a second line of defense for paths that don't go
      // through `sendCommand` at all (e.g. the "select" click decision).
      if (!actionPacing.beginDispatch()) return;

      let deferred = false;
      try {
        const env: CommandEnvelope = { playerId: PLAYER_ID, clientCommandId: crypto.randomUUID(), command };
        let result: CommandResult;
        try {
          result = await deps.transport.send(env);
        } catch (e) {
          deps.ui.showThought(`No pude hablar con el backend: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        if (!result.accepted) {
          if (result.rejection?.thought) deps.ui.showThought(result.rejection.thought.text);
          return;
        }

        // Single merge point (design.md "Event merge point"): `actionPacing`
        // is what calls `store.ingest` — immediately when `durationMs` is
        // absent/0, or after the gated window elapses otherwise. Either way
        // it's the same `store.ingest` a future pushed-event Transport would
        // also call. No manual renderHud call here — Ui reacts to Store
        // notifications on its own.
        deferred = actionPacing.applyResult(result, () => {
          // Surface `TryCombination`'s own `ThoughtAdded` feedback in the
          // teletype (crouch-crafting Slice B2) — its graded hint ("Me falta
          // algo...") or ready-craft success thought would otherwise only reach
          // `thoughtLog` (visible later via "Ver mis pensamientos") with no
          // immediate on-screen text after clicking "Probar combinación".
          // `onApplied` here ALWAYS runs after the events were actually
          // applied (instant or deferred), which is why it's wired through
          // `actionPacing.applyResult` rather than run unconditionally right
          // after `sendCommand`'s await — a Slice C timed craft must show this
          // feedback when the craft COMPLETES, not the instant it was accepted.
          //
          // DELIBERATELY SCOPED to `TryCombination` only (fresh-context review
          // fix, crouch-crafting Slice B2): the applied `store.ingest` runs
          // SYNCHRONOUSLY and re-renders every open window, including `ui.ts`'s
          // `rerender()`, which already writes the teletype via
          // `inventoryAddedMessage(...)` ("Guardé X en la mochila") whenever a
          // command's events add an item to the inventory. `showThought` is
          // last-write-wins (no queue) — a GENERAL post-apply hook here (any
          // command, any `ThoughtAdded`) would clobber that confirmation for the
          // majority of gather/craft actions (`cut_tree_crude`,
          // `improvise_crude_tool`, `separate_wreckage_crude`,
          // `discover_binding`, ...), which all pair `add_item` with
          // `thoughts.success` — a real regression to shipped `main` behavior.
          // For a `TryCombination` READY craft that also adds its output to the
          // inventory, showing the recipe's success thought OVER the
          // inventory-added line is the desired outcome (arguably more
          // informative), so no special-casing is needed within this branch.
          if (command.type === "TryCombination") {
            const isThoughtAdded = (e: Event): e is Extract<Event, { type: "ThoughtAdded" }> => e.type === "ThoughtAdded";
            const thoughtEvents = result.events.filter(isThoughtAdded);
            const lastThought = thoughtEvents[thoughtEvents.length - 1];
            if (lastThought) deps.ui.showThought(lastThought.thought.text);
          }
        });
      } finally {
        // Every non-deferred exit (transport rejection, not-accepted result,
        // instantly-applied result, or a synchronous throw anywhere above)
        // clears busy here. The ONE case that must NOT clear here is a
        // deferred `applyResult` — busy stays set until its own scheduled
        // callback fires and clears it, so a new command can't slip in
        // during the "Trabajando…" window either.
        if (!deferred) actionPacing.endDispatch();
      }
    };

    // Drag controller (design.md "Drag engine (pure + DOM)"): constructed
    // here because game.ts is the only layer that holds BOTH the canvas AND
    // `viewState.frame` — the HUD deliberately never touches the camera
    // directly. `resolveMapTile` reuses the exact same camera inverse the
    // click handler uses (`input/mouse.ts`'s `canvasToTile`), so a drag-drop
    // on the map resolves to the same tile a click there would.
    const dragController = createDragController({
      getSnapshot: store.getState,
      sendCommand,
      catalog,
      canvas: deps.canvas,
      resolveMapTile: (clientX, clientY) => canvasToTile(clientX, clientY, deps.canvas, viewState.frame()),
      showThought: deps.ui.showThought,
      // item-context-menu Phase 4: close any open item/context menu the
      // instant a drag starts, before it can relocate the item its
      // Rotar/Guardar/Soltar entries were frozen against.
      closeMenu: deps.ui.closeContextMenu,
    });

    const hudHandlers: HudHandlers = {
      onObserve: (itemInstanceId) => {
        void sendCommand({ type: "Observe", target: { kind: "item", id: itemInstanceId } });
      },
      onTryCombination: (pos) => {
        void sendCommand({ type: "TryCombination", method: "crouch", target: { kind: "tile", x: pos.x, y: pos.y } });
      },
      onTryCombinationSurface: (surfaceId) => {
        void sendCommand({ type: "TryCombination", method: "surface", target: { kind: "world_object", id: surfaceId } });
      },
      // Item-context-menu change (WU3, design.md Component 3/Component 5):
      // builds the property/origin-gated menu for the tapped/clicked item and
      // dispatches the selected entry through the shared `dispatchMenuItem`
      // (extracted in WU2). No `onMove` — the item menu has no selection
      // concept to clear, unlike the canvas menu's `input/mouse.ts` caller.
      // `dispatchDeps` deliberately re-reads `store.getState()`/`catalog` at
      // SELECTION time (not menu-build time) via the closures below, same
      // "always current" discipline as every other `sendCommand`-backed
      // handler in this file.
      openItemMenu: (item, at, source) => {
        const menu = buildItemMenu(item, catalog, store.getState());
        const dispatchDeps: MenuDispatchDeps = {
          sendCommand,
          toggleInventory: deps.ui.toggleInventory,
          toggleThoughts: deps.ui.toggleThoughts,
          toggleSurface: deps.ui.toggleSurface,
          toggleCrouch: deps.ui.toggleCrouch,
          showThought: deps.ui.showThought,
          onError: () => deps.ui.showThought("Algo salió mal. Mejor intento otra cosa."),
        };
        const onSelect = (menuItem: ContextMenuItem): void => dispatchMenuItem(menuItem, dispatchDeps);
        if (source === "tap") deps.ui.openItemMenu(menu, at, onSelect);
        else deps.ui.openContextMenu(menu, at, onSelect);
      },
      bindDrag: dragController.bindCell,
      bindGrid: dragController.bindGrid,
      unbindGrid: dragController.unbindGrid,
    };

    const input = createInputController({
      canvas: deps.canvas,
      catalog,
      getSnapshot: store.getState,
      getFrame: viewState.frame,
      sendCommand,
      ui: deps.ui,
      isBusy: actionPacing.isBusy,
    });

    // `Ui.mount` already renders once immediately and subscribes to future
    // Store notifications — no manual renderHud call needed here.
    deps.ui.mount(store, catalog, hudHandlers);

    // Wires a future push channel into the same ingestion path used by
    // command responses (design.md "Event merge point"). No-op today since
    // the HTTP transport never emits through `onEvents`.
    deps.transport.onEvents(store.ingest);

    let last = performance.now();
    let acc = 0;

    function frame(now: number): void {
      acc += now - last;
      last = now;
      while (acc >= STEP) {
        viewState.update(STEP);
        acc -= STEP;
      }
      createdRenderer.render(viewState.frame(), input.getSelection()?.preview.pos ?? null, actionPacing.isWorking());
      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
  }

  function stop(): void {
    stopped = true;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    // Load-bearing (design.md D5): Canvas's `destroy()` was always a no-op,
    // which hid the fact this was never called at all. Pixi's `destroy()`
    // actually releases GPU resources (textures + the app/renderer) — skip
    // this and every `start()` after a `stop()` leaks the previous instance.
    if (renderer) {
      renderer.destroy();
      renderer = null;
    }
  }

  return { start, stop };
}
