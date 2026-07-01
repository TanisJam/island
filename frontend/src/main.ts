import type { Command, CommandEnvelope, CommandResult, Position } from "./contract";
import { fetchCatalog, fetchPlayerState, fetchZone, postCommand } from "./net/api";
import { applyClientEvents } from "./state/reducer";
import { buildSnapshot, type ClientSnapshot } from "./state/snapshot";
import { render } from "./render/canvas";
import { renderHud, showLatestThought, showThought, type HudHandlers } from "./hud/hud";
import { createInputController } from "./input/mouse";

const PLAYER_ID = "p1";
const ZONE_ID = "z1";

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

async function boot(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  const menuEl = document.getElementById("menu") as HTMLElement | null;
  if (!canvas || !menuEl) throw new Error("Falta #game o #menu en index.html");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo obtener el contexto 2D del canvas");

  const [catalog, zone, player] = await Promise.all([fetchCatalog(), fetchZone(ZONE_ID), fetchPlayerState(PLAYER_ID)]);
  const snapshot: ClientSnapshot = buildSnapshot(zone, player);

  const sendCommand = async (command: Command): Promise<void> => {
    const env: CommandEnvelope = { playerId: PLAYER_ID, clientCommandId: crypto.randomUUID(), command };
    let result: CommandResult;
    try {
      result = await postCommand(env);
    } catch (e) {
      showThought(`No pude hablar con el backend: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!result.accepted) {
      if (result.rejection?.thought) showThought(result.rejection.thought.text);
      return;
    }
    applyClientEvents(snapshot, result.events);
    showLatestThought(snapshot);
    renderHud(catalog, snapshot, hudHandlers);
  };

  const hudHandlers: HudHandlers = {
    onEquip: (itemInstanceId) => {
      const occupied = handsOccupied(snapshot);
      const hand = !occupied.left ? "left" : !occupied.right ? "right" : null;
      if (!hand) {
        showThought("Tengo las dos manos ocupadas. Tendría que soltar algo primero.");
        return;
      }
      void sendCommand({ type: "MoveItem", itemInstanceId, to: { type: "hand", hand } });
    },
    onDrop: (itemInstanceId) => {
      void sendCommand({ type: "DropItem", itemInstanceId, to: dropTargetTile(snapshot) });
    },
  };

  const input = createInputController({ canvas, menuEl, catalog, getSnapshot: () => snapshot, sendCommand });

  function loop(): void {
    const selectedPos = input.getSelection()?.preview.pos ?? null;
    render(ctx!, snapshot, selectedPos);
    requestAnimationFrame(loop);
  }

  renderHud(catalog, snapshot, hudHandlers);
  showLatestThought(snapshot);
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error("No se pudo iniciar el cliente:", e);
  showThought(`Error al conectar con el backend: ${e instanceof Error ? e.message : String(e)}`);
});
