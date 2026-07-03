import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { itemsEditorCatalogReadPlugin } from "./tools/items-editor/server/catalog-read-middleware";
import { mapEditorZoneReadPlugin } from "./tools/map-editor/server/zone-read-middleware";
import { mapEditorZoneSavePlugin } from "./tools/map-editor/server/zone-write-middleware";

/**
 * Fourth, fully separate Vite entry for the dev-only map-editor tool
 * (design.md "the editor is a sibling Vite tool mirroring items-editor").
 * Deliberately duplicates the shape of `vite.config.items-editor.ts` rather
 * than consolidating into a multi-page config, matching the precedent set
 * by atlas-editor and items-editor. The game's root `vite.config.ts` stays
 * `root: "."` and never references `tools/`, so `pnpm build` (the game's
 * production build) cannot pick up this tool's code, HTML, or assets under
 * any configuration (spec "Dev-only, excluded from game build").
 */
export default defineConfig({
  root: fileURLToPath(new URL("./tools/map-editor", import.meta.url)),
  // Serves the live `frontend/public/` tree (atlas.json + tileset PNG) so
  // the canvas renderer reads/draws the exact files the game loads — zero
  // staleness/divergence, same precedent as `vite.config.items-editor.ts`.
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  server: {
    port: 5176,
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-tool-map", import.meta.url)),
    emptyOutDir: true,
  },
  // `itemsEditorCatalogReadPlugin` (reused, not copied — design.md "Reuse")
  // serves `catalog/*.json` LIVE from the repo-root source, giving the
  // terrain/world-object palettes zero-staleness reads. `mapEditorZoneReadPlugin`
  // serves `GET /zones/zone-{id}.json` LIVE the same way. `mapEditorZoneSavePlugin`
  // (Slice 3) adds `POST /__save-zone/:zoneId` — ajv-validated, atomic write
  // of the in-memory edited zone back to `zones/zone-{id}.json`.
  plugins: [itemsEditorCatalogReadPlugin(), mapEditorZoneReadPlugin(), mapEditorZoneSavePlugin()],
});
