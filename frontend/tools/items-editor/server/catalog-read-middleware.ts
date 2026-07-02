import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { isKnownCollection } from "../shared/collection-registry";

/**
 * Vite dev-server middleware serving `GET /catalog/*.json` and
 * `GET /schemas/{common,catalog}.json` LIVE from the repo-root source of
 * truth (same precedent as `vite.config.items-editor.ts`'s `publicDir`,
 * which already serves `atlas.json` straight from `frontend/public` for
 * "zero staleness/divergence"). Registered ONLY under `dev:tool:items` —
 * never present in `vite build` (the production tool bundle instead ships
 * the `sync:catalog:items` / `sync:schemas:items` on-disk copies, see
 * `build:tool:items` in package.json — `vite build` has no dev-server to
 * install middleware on, so those copies are the only way the built HTML's
 * relative `fetch('./catalog/...')` resolves after deployment).
 *
 * BUG THIS FIXES: the dev server used to serve `catalog/*.json` and
 * `schemas/*.json` from ONE-TIME `cp` copies made at server startup
 * (`sync:catalog:items` / `sync:schemas:items` in `dev:tool:items`), while
 * saves (`write-middleware.ts`) always wrote to the live source
 * (`repoRoot/catalog/*.json`). Reads and writes diverged after the first
 * save, so a save + reload without restarting the dev server showed stale
 * data until the next server start re-ran the `cp`. This middleware makes
 * reads and writes target the SAME live files, closing that gap — the
 * `sync:*` steps were removed from `dev:tool:items` accordingly (they
 * remain in `build:tool:items` only).
 *
 * SECURITY: mirrors `targets.ts::resolveCollectionTarget`. `repoRoot` is
 * derived ONCE, at module-load time, purely from `import.meta.url` — never
 * from a request. The requested filename is matched against an ALLOW-LIST
 * (`isKnownCollection` from the shared registry, plus `meta.json`, for
 * catalog reads; the fixed pair `common.json`/`catalog.json` for schema
 * reads) BEFORE it is ever used to build a file path. The filename is also
 * required to be a single path segment (no `/`, no `\`, rejects `.`/`..`)
 * so no request can escape the mount directory even before the allow-list
 * check runs — 404 for anything not allow-listed, including path-traversal
 * attempts.
 */

const here = dirname(fileURLToPath(import.meta.url));
// tools/items-editor/server -> tools/items-editor -> tools -> frontend -> repoRoot
const repoRoot = join(here, "..", "..", "..", "..");

const CATALOG_MOUNT = "/catalog";
const SCHEMAS_MOUNT = "/schemas";

const ALLOWED_SCHEMA_FILES = new Set(["common.json", "catalog.json"]);

function isAllowedCatalogFile(name: string): boolean {
  if (name === "meta.json") return true;
  if (!name.endsWith(".json")) return false;
  const collectionId = name.slice(0, -".json".length);
  return isKnownCollection(collectionId);
}

function send404(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: false, errors: [{ instancePath: "/", message: "not found" }] }));
}

function sendJsonFile(res: ServerResponse, absPath: string): void {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf-8");
  } catch {
    send404(res);
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(raw);
}

/**
 * Extracts a single path segment from the (mount-stripped) request URL.
 * Returns `null` if the URL is empty, contains an extra path separator, or
 * is a `.`/`..` traversal token — the caller then 404s. This is defense in
 * depth: even without the allow-list below, no filename derived from a
 * request can ever address a file outside the intended directory.
 */
function requestedFileName(req: IncomingMessage): string | null {
  const rawUrl = (req.url ?? "/").split("?")[0] ?? "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawUrl);
  } catch {
    return null;
  }
  const trimmed = decoded.replace(/^\/+/, "");
  if (trimmed.length === 0) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (trimmed === "." || trimmed === "..") return null;
  return trimmed;
}

/**
 * Builds the `/catalog/*.json` GET handler against an explicit `repoRoot`,
 * separated from the Vite `Plugin` wiring so it is directly unit-testable
 * (mirrors `write-middleware.ts::createCollectionSaveHandler`).
 */
export function createCatalogReadHandler(root: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send404(res);
      return;
    }
    const name = requestedFileName(req);
    if (!name || !isAllowedCatalogFile(name)) {
      send404(res);
      return;
    }
    sendJsonFile(res, join(root, "catalog", name));
  };
}

/**
 * Builds the `/schemas/{common,catalog}.json` GET handler against an
 * explicit `repoRoot`, separated from the Vite `Plugin` wiring for the same
 * reason as `createCatalogReadHandler`.
 */
export function createSchemasReadHandler(root: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send404(res);
      return;
    }
    const name = requestedFileName(req);
    if (!name || !ALLOWED_SCHEMA_FILES.has(name)) {
      send404(res);
      return;
    }
    sendJsonFile(res, join(root, "schemas", name));
  };
}

export function itemsEditorCatalogReadPlugin(): Plugin {
  return {
    name: "items-editor-catalog-read-plugin",
    configureServer(server) {
      // Registered directly (not returned as a post-hook) so it installs
      // BEFORE Vite's internal static-file middleware — the same ordering
      // precedent as `write-middleware.ts`'s `itemsEditorSavePlugin`. This
      // guarantees live source always wins over any stale on-disk copy
      // that might still be sitting under `tools/items-editor/catalog` or
      // `tools/items-editor/schemas` from a prior `sync:*` run.
      server.middlewares.use(CATALOG_MOUNT, createCatalogReadHandler(repoRoot));
      server.middlewares.use(SCHEMAS_MOUNT, createSchemasReadHandler(repoRoot));
    },
  };
}
