import "./style.css";
import { createHttpTransport } from "./net/transport";
import { createDomUi } from "./hud/ui";
import { createGame } from "./game/game";
import { showThought } from "./hud/hud";

const BASE_URL = "http://localhost:3000";

/** Dev-only editor route names wired to a mount-capable module. All three
 * editors (atlas, items, map) are wired as of this slice (design.md D3,
 * tasks.md Phase 4). */
type EditorRoute = "atlas" | "items" | "map";

const KNOWN_EDITOR_ROUTES: readonly EditorRoute[] = ["atlas", "items", "map"];

function parseEditorRoute(hash: string): EditorRoute | null {
  const match = /^#\/editor\/(\w+)$/.exec(hash);
  const name = match?.[1];
  return (KNOWN_EDITOR_ROUTES as readonly string[]).includes(name ?? "") ? (name as EditorRoute) : null;
}

async function mountGame(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("Falta #game en index.html");

  const transport = createHttpTransport(BASE_URL);
  const ui = createDomUi();
  const game = createGame({ canvas, transport, ui });

  await game.start();
}

/** Shows the game container, hides the editor container. Idempotent —
 * safe to call even when the game is already visible. */
function showGame(): void {
  document.getElementById("app-editor")?.setAttribute("hidden", "");
  document.getElementById("app-game")?.removeAttribute("hidden");
}

/** Hides the game container, mounts the requested dev-only editor into
 * `#app-editor` via a DEV-gated dynamic import. The `import()` call MUST
 * stay lexically nested directly inside the `if (import.meta.env.DEV)`
 * branch (not hoisted into a module-scope lookup table) — Vite inlines
 * `import.meta.env.DEV` to the literal `false` at build time, and Rollup's
 * dead-code elimination only drops an `import()` call when it can prove the
 * whole branch containing it is unreachable (design.md D3, spec
 * "Production Build Excludes Editors"). */
async function showEditor(route: EditorRoute): Promise<void> {
  if (!import.meta.env.DEV) return;
  const editorEl = document.getElementById("app-editor");
  if (!editorEl) return;

  document.getElementById("app-game")?.setAttribute("hidden", "");
  editorEl.hidden = false;
  editorEl.innerHTML = "";

  try {
    if (route === "atlas") {
      const mod = await import("../tools/atlas-editor/main");
      mod.mount(editorEl);
    } else if (route === "items") {
      const mod = await import("../tools/items-editor/main");
      mod.mount(editorEl);
    } else if (route === "map") {
      const mod = await import("../tools/map-editor/main");
      mod.mount(editorEl);
    }
  } catch (e) {
    editorEl.textContent = `No se pudo cargar el editor "${route}": ${e instanceof Error ? e.message : String(e)}`;
  }
}

function handleRoute(): void {
  const route = parseEditorRoute(location.hash);
  if (route) {
    void showEditor(route);
  } else {
    showGame();
  }
}

/** Small DEV-only nav so a developer can reach editor routes without typing
 * the hash by hand (design.md D3 "dev overlay"). Statically eliminated
 * from the production bundle along with the rest of this DEV branch. */
function renderDevSwitcher(): void {
  if (!import.meta.env.DEV) return;
  if (document.getElementById("dev-switcher")) return;

  const nav = document.createElement("nav");
  nav.id = "dev-switcher";
  nav.style.cssText =
    "position:fixed;top:0;right:0;z-index:9999;display:flex;gap:8px;padding:6px 10px;background:rgba(0,0,0,0.6);font:12px monospace;";
  nav.innerHTML = `
    <a href="#/" style="color:#fff;">Game</a>
    <a href="#/editor/atlas" style="color:#fff;">Atlas Editor</a>
    <a href="#/editor/items" style="color:#fff;">Items Editor</a>
    <a href="#/editor/map" style="color:#fff;">Map Editor</a>
  `;
  document.body.appendChild(nav);
}

async function boot(): Promise<void> {
  renderDevSwitcher();
  window.addEventListener("hashchange", handleRoute);
  handleRoute();
  await mountGame();
}

boot().catch((e) => {
  console.error("No se pudo iniciar el cliente:", e);
  showThought(`Error al conectar con el backend: ${e instanceof Error ? e.message : String(e)}`);
});
