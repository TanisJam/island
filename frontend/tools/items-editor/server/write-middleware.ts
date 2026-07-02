import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { writeAtomic, writeFileDurable } from "./fs-atomic";
import { planSaveCollection, type CatalogMeta } from "./plan-save";
import { resolveCollectionTarget } from "./targets";
import { COLLECTIONS, isKnownCollection } from "../shared/collection-registry";
import { getDescriptor } from "../shared/descriptors";

export { writeAtomic, writeFileDurable };

/**
 * Vite dev-server middleware exposing the generalized
 * `POST /__save/:collectionId` (design.md "3. Server generalization —
 * Route"). Registered ONLY under `dev:tool:items` via
 * `vite.config.items-editor.ts` — never present in `vite build`, never in
 * the game, never in the backend.
 *
 * The item-only `POST /__save-items` alias (`createItemsSaveHandler`) was
 * retired in Slice 5 — `items` now saves through this SAME generalized
 * route as every other collection (`POST /__save/items`), parameterized by
 * `shared/descriptors/items.ts::ITEMS_DESCRIPTOR`.
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

const COLLECTION_SAVE_MOUNT = "/__save";

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

/**
 * Builds the generalized `POST /__save/:collectionId` request handler
 * (design.md "3. Server generalization — Route"). When mounted via
 * `server.middlewares.use(COLLECTION_SAVE_MOUNT, handler)`, Vite/connect
 * strips the mount path so `req.url` is `/${collectionId}` — this handler
 * also works standalone (as tested) against that same convention.
 *
 * SECURITY: `collectionId` is read from the URL and validated with
 * `isKnownCollection` (an allow-listed registry key) BEFORE it is ever
 * used to build a file path (`resolveCollectionTarget`) — never trusted
 * as path text.
 */
export function createCollectionSaveHandler(root: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, errors: [{ instancePath: "/", message: "method not allowed" }] });
      return;
    }
    const rawUrl = (req.url ?? "/").split("?")[0] ?? "/";
    const collectionId = decodeURIComponent(rawUrl.replace(/^\/+/, ""));
    if (!isKnownCollection(collectionId)) {
      sendJson(res, 404, { ok: false, errors: [{ instancePath: "/", message: `unknown collection "${collectionId}"` }] });
      return;
    }
    const descriptor = getDescriptor(collectionId);
    if (!descriptor) {
      sendJson(res, 404, { ok: false, errors: [{ instancePath: "/", message: `collection "${collectionId}" has no descriptor registered yet` }] });
      return;
    }
    const targets = resolveCollectionTarget(root, collectionId);
    if (!targets) {
      // Defensive — cannot happen once isKnownCollection passed, but never
      // build a path from unvalidated input under any circumstance.
      sendJson(res, 404, { ok: false, errors: [{ instancePath: "/", message: `unknown collection "${collectionId}"` }] });
      return;
    }
    readRequestBody(req)
      .then((rawBody) => {
        const currentMeta = readJson(targets.metaPath) as CatalogMeta;
        const schemas = {
          common: readJson(targets.commonSchema),
          catalog: readJson(targets.catalogSchema),
        };
        const result = planSaveCollection(rawBody, {
          descriptor,
          defName: COLLECTIONS[collectionId]?.defName ?? "",
          currentMeta,
          schemas,
        });
        if (!result.ok) {
          sendJson(res, 400, { ok: false, errors: result.errors });
          return;
        }
        // Collection-file-first ordering, mirroring items' ADR-3: if the
        // process dies between the two renames, the only possible
        // degraded state is "catalogVersion not bumped".
        writeAtomic(targets.dataPath, result.dataJson);
        writeAtomic(targets.metaPath, result.metaJson);
        sendJson(res, 200, { ok: true, catalogVersion: result.catalogVersion, count: result.count });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unexpected error";
        sendJson(res, 500, { ok: false, errors: [{ instancePath: "/", message }] });
      });
  };
}

export function itemsEditorSavePlugin(): Plugin {
  return {
    name: "items-editor-save-plugin",
    configureServer(server) {
      server.middlewares.use(COLLECTION_SAVE_MOUNT, createCollectionSaveHandler(repoRoot));
    },
  };
}
