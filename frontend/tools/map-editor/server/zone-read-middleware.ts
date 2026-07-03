import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Vite dev-server middleware serving `GET /zones/zone-{id}.json` LIVE from
 * the repo-root `zones/` dir (design.md "Backend Zone Loader" /
 * `frontend/tools/items-editor/server/catalog-read-middleware.ts` — same
 * repoRoot-derived-once-from-import.meta.url pattern, same
 * allow-list-before-path-join security posture, same single-path-segment
 * traversal guard). This is the ONLY zone route this slice adds — there is
 * no write route yet (Slice 3 adds `zone-write-middleware.ts`'s
 * `POST /__save-zone/:zoneId`, gated on a POST to keep this handler GET-only
 * and read-only for now).
 *
 * SECURITY: `repoRoot` is derived ONCE at module-load time, purely from
 * `import.meta.url` — never from a request. The requested filename is
 * matched against `ZONE_FILE_PATTERN` (`zone-{id}.json`, id restricted to
 * `[a-z0-9_-]+`) BEFORE it is ever used to build a file path. The filename
 * is also required to be a single path segment (no `/`, no `\`, rejects
 * `.`/`..`) so no request can escape the mount directory even before the
 * pattern check runs — 404 for anything not allow-listed, including
 * path-traversal attempts.
 */

const here = dirname(fileURLToPath(import.meta.url));
// tools/map-editor/server -> tools/map-editor -> tools -> frontend -> repoRoot
const repoRoot = join(here, "..", "..", "..", "..");

const ZONES_MOUNT = "/zones";
const ZONE_FILE_PATTERN = /^zone-[a-z0-9_-]+\.json$/i;

function isAllowedZoneFile(name: string): boolean {
  return ZONE_FILE_PATTERN.test(name);
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
 * Mirrors `catalog-read-middleware.ts`'s internal (unexported)
 * `requestedFileName` verbatim — duplicated rather than reaching into
 * another tool's server internals, matching how each `server/` module in
 * this repo owns its own request-parsing helper.
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
 * Builds the `/zones/zone-{id}.json` GET handler against an explicit
 * `repoRoot`, separated from the Vite `Plugin` wiring so it is directly
 * unit-testable (mirrors `catalog-read-middleware.ts::createCatalogReadHandler`).
 */
export function createZoneReadHandler(root: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send404(res);
      return;
    }
    const name = requestedFileName(req);
    if (!name || !isAllowedZoneFile(name)) {
      send404(res);
      return;
    }
    sendJsonFile(res, join(root, "zones", name));
  };
}

export function mapEditorZoneReadPlugin(): Plugin {
  return {
    name: "map-editor-zone-read-plugin",
    configureServer(server) {
      // Registered directly (not returned as a post-hook) so it installs
      // BEFORE Vite's internal static-file middleware, same ordering
      // precedent as `catalog-read-middleware.ts`.
      server.middlewares.use(ZONES_MOUNT, createZoneReadHandler(repoRoot));
    },
  };
}
