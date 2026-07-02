import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { itemsEditorAtlasSavePlugin } from "./tools/items-editor/server/atlas-write-middleware";
import { itemsEditorSavePlugin } from "./tools/items-editor/server/write-middleware";

/**
 * Third, fully separate Vite entry for the dev-only items-editor tool
 * (design.md "ADR-1 — Sibling Vite config (hosting)"). Deliberately
 * duplicates the shape of `vite.config.tool.ts` (atlas-editor) instead of
 * consolidating into a multi-page config: atlas-editor is already shipped
 * and tested, and this tool additionally needs a write-middleware plugin
 * atlas-editor does not have. The game's `vite.config.ts` root stays "."
 * and never references `tools/`, so `pnpm build` (the game's production
 * build) cannot pick up this tool's code, HTML, or assets under any
 * configuration (spec "Dev-only, excluded from game build").
 */
export default defineConfig({
  root: fileURLToPath(new URL("./tools/items-editor", import.meta.url)),
  // Serves the live `frontend/public/` tree (atlas.json + tileset PNG) so
  // the texture panel reads/renders the exact files the game loads and the
  // atlas-write middleware targets — zero staleness/divergence (design.md
  // Slice B "B1 — publicDir"). `import.meta.url` here is this config file's
  // own path (`frontend/vite.config.items-editor.ts`), so `./public`
  // resolves to `frontend/public`.
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  server: {
    port: 5175,
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-tool-items", import.meta.url)),
    emptyOutDir: true,
  },
  plugins: [itemsEditorSavePlugin(), itemsEditorAtlasSavePlugin()],
});
