import { defineConfig } from "vite";
import { itemsEditorAtlasSavePlugin } from "./tools/items-editor/server/atlas-write-middleware";
import { itemsEditorCatalogReadPlugin } from "./tools/items-editor/server/catalog-read-middleware";
import { itemsEditorSavePlugin } from "./tools/items-editor/server/write-middleware";
import { mapEditorZoneReadPlugin } from "./tools/map-editor/server/zone-read-middleware";
import { mapEditorZoneSavePlugin } from "./tools/map-editor/server/zone-write-middleware";

/**
 * Single Vite config for the unified app shell (design.md D2): one dev
 * server hosts the game plus every dev-only editor route (src/main.ts's
 * hash router, design.md D3). Any editor-only server plugin (write
 * middleware, live content reader) MUST be added to `plugins` gated behind
 * `command === "serve"` so `vite build` never bundles it — the production
 * build stays game-only (spec "Production Build Excludes Editors").
 * atlas-editor (tasks.md Phase 2) exports via browser download and needs no
 * server plugin. items-editor (tasks.md Phase 3) needs three: the generic
 * collection-save route (`itemsEditorSavePlugin`), the atlas-region save
 * route (`itemsEditorAtlasSavePlugin`), and the live catalog/schema reader
 * (`itemsEditorCatalogReadPlugin`) — all three were previously registered
 * only under the standalone `vite.config.items-editor.ts`, deleted in the
 * items-editor migration. map-editor (tasks.md Phase 4) reuses
 * `itemsEditorCatalogReadPlugin` for its terrain/world-object palettes and
 * adds two of its own: `mapEditorZoneReadPlugin` (`GET
 * /zones/zone-{id}.json`, live from the repo-root `zones/` dir) and
 * `mapEditorZoneSavePlugin` (`POST /__save-zone/:zoneId`, ajv-validated
 * atomic write) — both previously registered only under the now-deleted
 * standalone `vite.config.map-editor.ts`.
 */
export default defineConfig(({ command }) => ({
  root: ".",
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
  plugins: [
    ...(command === "serve"
      ? [
          itemsEditorSavePlugin(),
          itemsEditorAtlasSavePlugin(),
          itemsEditorCatalogReadPlugin(),
          mapEditorZoneReadPlugin(),
          mapEditorZoneSavePlugin(),
        ]
      : []),
  ],
}));
