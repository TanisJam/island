import type { Command, CommandEnvelope, CommandResult, Position } from "../contract";
import { fetchCatalog, fetchPlayerState, fetchZone } from "../net/api";
import type { Transport } from "../net/transport";
import { buildSnapshot, type ClientSnapshot } from "../state/snapshot";
import { createStore } from "../state/store";
import { createViewState } from "../view/viewstate";
import { createEmojiAssets } from "../render/assets";
import { createCanvasRenderer } from "../render/canvas";
import { canvasToTile, createInputController } from "../input/mouse";
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

function handsOccupied(snapshot: ClientSnapshot): { left: boolean; right: boolean } {
  const occupied = (slot: { x: number; y: number }) =>
    snapshot.items.some((it) => it.location.type === "player_inventory" && it.location.x === slot.x && it.location.y === slot.y);
  return { left: occupied(snapshot.handSlots.left), right: occupied(snapshot.handSlots.right) };
}

/** Tile donde soltar: el primer adyacente caminable (queda visible al lado del jugador
 *  y dentro del rango de crafting); si no hay, el tile propio. */
function dropTargetTile(snapshot: ClientSnapshot): Position {
  const p = snapshot.player.position;
  for (const d of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
    const c = { x: p.x + d.x, y: p.y + d.y };
    if (snapshot.tiles.find((t) => t.x === c.x && t.y === c.y)?.walkable) return c;
  }
  return p;
}

export function createGame(deps: GameDeps): Game {
  let rafId: number | null = null;

  async function start(): Promise<void> {
    const ctx = deps.canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo obtener el contexto 2D del canvas");

    const [catalog, zone, player] = await Promise.all([fetchCatalog(), fetchZone(ZONE_ID), fetchPlayerState(PLAYER_ID)]);
    const snapshot = buildSnapshot(zone, player);

    const store = createStore(snapshot);
    const viewState = createViewState(store);
    const assets = createEmojiAssets();
    const renderer = createCanvasRenderer(ctx, assets);

    // Fullscreen map (spec "Fullscreen Map with Player-Centered Camera"):
    // size the canvas to the viewport now, and re-fit on every resize —
    // `render/canvas.ts`'s camera translate recenters on the player using
    // whatever width/height the canvas buffer currently has.
    renderer.resize(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", () => renderer.resize(window.innerWidth, window.innerHeight));

    const sendCommand = async (command: Command): Promise<void> => {
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
      // Single merge point (design.md "Event merge point"): Store.ingest is
      // also what a future pushed-event Transport would call. No manual
      // renderHud call here — Ui reacts to Store notifications on its own.
      store.ingest(result.events);
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
    });

    const hudHandlers: HudHandlers = {
      onEquip: (itemInstanceId) => {
        const occupied = handsOccupied(store.getState());
        const hand = !occupied.left ? "left" : !occupied.right ? "right" : null;
        if (!hand) {
          deps.ui.showThought("Tengo las dos manos ocupadas. Tendría que soltar algo primero.");
          return;
        }
        void sendCommand({ type: "MoveItem", itemInstanceId, to: { type: "hand", hand } });
      },
      onDrop: (itemInstanceId) => {
        void sendCommand({ type: "DropItem", itemInstanceId, to: dropTargetTile(store.getState()) });
      },
      bindDrag: dragController.bindCell,
    };

    const input = createInputController({
      canvas: deps.canvas,
      catalog,
      getSnapshot: store.getState,
      getFrame: viewState.frame,
      sendCommand,
      ui: deps.ui,
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
      renderer.render(viewState.frame(), input.getSelection()?.preview.pos ?? null);
      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  return { start, stop };
}
