import { createHttpTransport } from "./net/transport";
import { createDomUi } from "./hud/ui";
import { createGame } from "./game/game";
import { showThought } from "./hud/hud";

const BASE_URL = "http://localhost:3000";

async function boot(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  const menuEl = document.getElementById("menu") as HTMLElement | null;
  if (!canvas || !menuEl) throw new Error("Falta #game o #menu en index.html");

  const transport = createHttpTransport(BASE_URL);
  const ui = createDomUi();
  const game = createGame({ canvas, menuEl, transport, ui });

  await game.start();
}

boot().catch((e) => {
  console.error("No se pudo iniciar el cliente:", e);
  showThought(`Error al conectar con el backend: ${e instanceof Error ? e.message : String(e)}`);
});
