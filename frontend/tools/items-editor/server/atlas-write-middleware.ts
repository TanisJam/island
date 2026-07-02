import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { parseAtlas } from "../../../src/render/assets";
import { resolveAtlasTarget } from "./atlas-targets";
import { writeAtomic } from "./fs-atomic";
import { planAtlasSave } from "./plan-atlas-save";

/**
 * Vite dev-server middleware exposing `POST /__save-atlas` (design.md
 * "B5 — Atlas write middleware + plugin"). Registered ONLY under
 * `dev:tool:items` via `vite.config.items-editor.ts` — never present in
 * `vite build`, never in the game, never in the backend.
 *
 * SECURITY: `repoRoot` is derived ONCE, at module-load time, purely from
 * `import.meta.url` — the same pattern as `write-middleware.ts` and
 * `backend/src/infrastructure/catalog/loader.ts`. It is NEVER read from a
 * request body, header, or environment variable.
 *
 * This middleware deliberately INLINES its own `JSON.parse(readFileSync(...))`
 * reader rather than importing `write-middleware.ts`'s unexported `readJson`
 * — the two save flows stay fully isolated modules (design.md file-changes
 * note); the atlas flow never shares code paths with the items flow beyond
 * the generic `writeAtomic` durability helper.
 *
 * CONCURRENT-EDIT SAFETY: the FULL atlas is re-read fresh from disk on
 * every request — the server never trusts or persists a client-sent full
 * atlas — so a mapping written by atlas-editor or another session between
 * panel-boot and save is preserved (spec "Concurrent edit is not
 * clobbered").
 */

const here = dirname(fileURLToPath(import.meta.url));
// tools/items-editor/server -> tools/items-editor -> tools -> frontend -> repoRoot
const repoRoot = join(here, "..", "..", "..", "..");

const SAVE_ROUTE = "/__save-atlas";

function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error instanceof Error ? error : new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(payload);
}

/**
 * Builds the actual request handler against an explicit `atlasPath`,
 * separated from the Vite `Plugin` wiring so it is directly unit-testable
 * (real `http.Server` + a temp-dir atlas fixture) without ever touching
 * `frontend/public/atlas.json` in tests. `itemsEditorAtlasSavePlugin` below
 * is the ONLY caller in production, and it always supplies the hard-coded,
 * compile-time-derived path — `atlasPath` is never sourced from a request.
 */
export function createAtlasSaveHandler(atlasPath: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, errors: [{ instancePath: "/", message: "method not allowed" }] });
      return;
    }
    readRequestBody(req)
      .then((rawBody) => {
        // Fresh read-modify-write EVERY request — never trust a
        // client-sent atlas (spec "Hard-coded, fresh-read write target").
        const raw = JSON.parse(readFileSync(atlasPath, "utf-8"));
        const currentAtlas = parseAtlas(raw);
        const result = planAtlasSave(rawBody, { currentAtlas });
        if (!result.ok) {
          sendJson(res, 400, { ok: false, errors: result.errors });
          return;
        }
        writeAtomic(atlasPath, result.atlasJson);
        sendJson(res, 200, { ok: true, region: result.region });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unexpected error";
        sendJson(res, 500, { ok: false, errors: [{ instancePath: "/", message }] });
      });
  };
}

export function itemsEditorAtlasSavePlugin(): Plugin {
  return {
    name: "items-editor-atlas-save-plugin",
    configureServer(server) {
      const { atlasPath } = resolveAtlasTarget(repoRoot);
      server.middlewares.use(SAVE_ROUTE, createAtlasSaveHandler(atlasPath));
    },
  };
}
