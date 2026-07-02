import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { writeAtomic, writeFileDurable } from "./fs-atomic";
import { planSave, type CatalogMeta } from "./plan-save";
import { resolveTargets } from "./targets";

export { writeAtomic, writeFileDurable };

/**
 * Vite dev-server middleware exposing `POST /__save-items` (design.md
 * "Request/Response Contract"). Registered ONLY under `dev:tool:items` via
 * `vite.config.items-editor.ts` — never present in `vite build`, never in
 * the game, never in the backend.
 *
 * SECURITY: `repoRoot` is derived ONCE, at module-load time, purely from
 * `import.meta.url` — the exact pattern used by
 * `backend/src/infrastructure/catalog/loader.ts`. It is NEVER read from a
 * request body, header, or environment variable, so this middleware
 * always writes to the same hard-coded catalog files regardless of what a
 * client sends (spec "Path traversal blocked").
 */

const here = dirname(fileURLToPath(import.meta.url));
// tools/items-editor/server -> tools/items-editor -> tools -> frontend -> repoRoot
const repoRoot = join(here, "..", "..", "..", "..");

const SAVE_ROUTE = "/__save-items";

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf-8"));

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

export function itemsEditorSavePlugin(): Plugin {
  return {
    name: "items-editor-save-plugin",
    configureServer(server) {
      const targets = resolveTargets(repoRoot);
      server.middlewares.use(SAVE_ROUTE, (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, errors: [{ instancePath: "/", message: "method not allowed" }] });
          return;
        }
        readRequestBody(req)
          .then((rawBody) => {
            const currentMeta = readJson(targets.metaPath) as CatalogMeta;
            const schemas = {
              common: readJson(targets.commonSchema),
              catalog: readJson(targets.catalogSchema),
            };
            const result = planSave(rawBody, { currentMeta, schemas });
            if (!result.ok) {
              sendJson(res, 400, { ok: false, errors: result.errors });
              return;
            }
            // Items-first ordering (design.md "ADR-3"): if the process
            // dies between the two renames, the only possible degraded
            // state is "catalogVersion not bumped" — never a corrupted
            // items file.
            writeAtomic(targets.itemsPath, result.itemsJson);
            writeAtomic(targets.metaPath, result.metaJson);
            sendJson(res, 200, { ok: true, catalogVersion: result.catalogVersion, count: result.count });
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "unexpected error";
            sendJson(res, 500, { ok: false, errors: [{ instancePath: "/", message }] });
          });
      });
    },
  };
}
