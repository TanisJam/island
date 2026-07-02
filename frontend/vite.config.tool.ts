import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Second, fully separate Vite entry for the dev-only atlas-editor tool
 * (design.md "Tool location"). The game's `vite.config.ts` root stays "."
 * and never references `tools/`, so `pnpm build` (the game's production
 * build) cannot pick up this tool's code, HTML, or assets under any
 * configuration (spec "Tool excluded from game build").
 */
export default defineConfig({
  root: fileURLToPath(new URL("./tools/atlas-editor", import.meta.url)),
  server: {
    port: 5174,
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-tool", import.meta.url)),
    emptyOutDir: true,
  },
});
