import { defineConfig } from "vite";

/**
 * Single Vite config for the unified app shell (design.md D2): one dev
 * server hosts the game plus every dev-only editor route (src/main.ts's
 * hash router, design.md D3). Any editor-only server plugin (write
 * middleware, live content reader) MUST be added to `plugins` gated behind
 * `command === "serve"` so `vite build` never bundles it — the production
 * build stays game-only (spec "Production Build Excludes Editors"). Empty
 * for now: atlas-editor (tasks.md Phase 2) exports via browser download and
 * needs no server plugin; items-editor/map-editor add theirs here in later
 * slices (tasks.md Phase 3/4).
 */
export default defineConfig(({ command }) => ({
  root: ".",
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
  plugins: [...(command === "serve" ? [] : [])],
}));
