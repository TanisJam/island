import "./style.css";
import { createHttpTransport } from "./net/transport";
import { createDomUi } from "./hud/ui";
import { createGame } from "./game/game";
import { showThought } from "./hud/hud";

const BASE_URL = "http://localhost:3000";

async function boot(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("Falta #game en index.html");

  const transport = createHttpTransport(BASE_URL);
  const ui = createDomUi();
  const game = createGame({ canvas, transport, ui });

  await game.start();
}

boot().catch((e) => {
  console.error("No se pudo iniciar el cliente:", e);
  showThought(`Error al conectar con el backend: ${e instanceof Error ? e.message : String(e)}`);
});
