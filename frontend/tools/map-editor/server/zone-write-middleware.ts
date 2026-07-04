import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { type ValidateFunction } from "ajv";
import type { Plugin } from "vite";
import { writeAtomic } from "../../items-editor/server/fs-atomic";
import type { ZoneTemplate } from "../../../src/contract/zone";

/**
 * Vite dev-server middleware exposing `POST /__save-zone/:zoneId`
 * (design.md "Backend Zone Loader" / task 3.4 — "mirror
 * items-editor/server/write-middleware.ts"). Registered in the unified
 * `vite.config.ts`, gated on `command === "serve"` (tasks.md Phase 4) —
 * never present in `vite build`, never in the game, never in the backend.
 *
 * Unlike `write-middleware.ts`'s generalized `/__save/:collectionId`
 * (records array + catalogVersion bump), a zone save has no "current file
 * merged with a patch" step — the editor already holds the FULL in-memory
 * `ZoneTemplate` (Slice 2's read + Slice 3's paint/place/remove all operate
 * on one complete template), so the body IS the next file content. The only
 * server-side jobs are: (1) allow-list the target filename exactly like
 * `zone-read-middleware.ts`'s `GET` route, (2) ajv-validate the body against
 * `schemas/zone.json` (mirrors `backend/src/infrastructure/zone/loader.ts`'s
 * fail-fast validation — invalid zones can never reach disk from either
 * side), (3) `writeAtomic` (imported, not copied, from
 * `items-editor/server/fs-atomic` — design.md "Reuse").
 *
 * SECURITY: `repoRoot` is derived ONCE, at module-load time, purely from
 * `import.meta.url` — the same pattern as every other `server/*.ts` in this
 * repo. The requested zone id is extracted the SAME way
 * `zone-read-middleware.ts::requestedFileName` does (single path segment,
 * no `/`/`\`, rejects `.`/`..`) BEFORE it is ever used to build the
 * `zone-{id}.json` filename, which is then checked against the SAME
 * `ZONE_FILE_PATTERN` the read route enforces — a request can never write
 * outside `zones/` or to a non-`zone-*.json` file.
 *
 * DEFENSE IN DEPTH: even though ajv's `additionalProperties: false` already
 * rejects any stray top-level/nested key, the validated body is
 * reconstructed field-by-field (`reconstructZone`) before it is
 * `JSON.stringify`-ed — mirrors `plan-save.ts::reconstructRecord`'s
 * "never write the raw parsed object straight to disk" convention used
 * throughout this repo's other save handlers.
 */

const here = dirname(fileURLToPath(import.meta.url));
// tools/map-editor/server -> tools/map-editor -> tools -> frontend -> repoRoot
const repoRoot = join(here, "..", "..", "..", "..");

const ZONE_SAVE_MOUNT = "/__save-zone";
const ZONE_FILE_PATTERN = /^zone-[a-z0-9_-]+\.json$/i;

function isAllowedZoneFile(name: string): boolean {
  return ZONE_FILE_PATTERN.test(name);
}

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
 * Extracts a single path segment from the (mount-stripped) request URL.
 * Mirrors `zone-read-middleware.ts::requestedFileName` (itself mirroring
 * `catalog-read-middleware.ts`'s internal helper) verbatim — duplicated
 * rather than reaching into another module's internals, matching how each
 * `server/*.ts` module in this repo owns its own request-parsing helper.
 */
function requestedZoneId(req: IncomingMessage): string | null {
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

function compileZoneValidator(schemaPath: string): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(JSON.parse(readFileSync(schemaPath, "utf-8")), "zone.json");
  const validate = ajv.getSchema("zone.json");
  if (!validate) throw new Error("map-editor: could not compile schemas/zone.json");
  return validate;
}

/** Rebuilds the on-disk shape field-by-field from the ajv-validated body —
 * see "DEFENSE IN DEPTH" above. `state` is omitted entirely (not set to
 * `undefined`) when absent, matching `zone-model.ts::placeObject`'s
 * convention so a round-tripped save never grows a stray `"state":
 * undefined`. */
function reconstructZone(zone: ZoneTemplate): ZoneTemplate {
  return {
    width: zone.width,
    height: zone.height,
    tiles: zone.tiles.map((tile) => String(tile)),
    objects: zone.objects.map((object) =>
      object.state !== undefined
        ? { objectTypeId: object.objectTypeId, x: object.x, y: object.y, state: object.state }
        : { objectTypeId: object.objectTypeId, x: object.x, y: object.y },
    ),
  };
}

/**
 * Builds the `POST /__save-zone/:zoneId` handler against an explicit
 * `root`, separated from the Vite `Plugin` wiring so it is directly
 * unit-testable (mirrors every other `server/*.ts` handler in this repo).
 */
export function createZoneSaveHandler(root: string) {
  const schemaPath = join(root, "schemas", "zone.json");
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, errors: [{ instancePath: "/", message: "method not allowed" }] });
      return;
    }
    const zoneId = requestedZoneId(req);
    const fileName = zoneId ? `zone-${zoneId}.json` : null;
    if (!fileName || !isAllowedZoneFile(fileName)) {
      sendJson(res, 404, { ok: false, errors: [{ instancePath: "/", message: "unknown or invalid zone id" }] });
      return;
    }
    readRequestBody(req)
      .then((rawBody) => {
        const validate = compileZoneValidator(schemaPath);
        if (!validate(rawBody)) {
          const errors = (validate.errors ?? []).map((e) => ({ instancePath: e.instancePath || "/", message: e.message ?? "invalid" }));
          sendJson(res, 400, { ok: false, errors });
          return;
        }
        const zoneJson = `${JSON.stringify(reconstructZone(rawBody as ZoneTemplate), null, 2)}\n`;
        writeAtomic(join(root, "zones", fileName), zoneJson);
        sendJson(res, 200, { ok: true });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unexpected error";
        sendJson(res, 500, { ok: false, errors: [{ instancePath: "/", message }] });
      });
  };
}

export function mapEditorZoneSavePlugin(): Plugin {
  return {
    name: "map-editor-zone-save-plugin",
    configureServer(server) {
      server.middlewares.use(ZONE_SAVE_MOUNT, createZoneSaveHandler(repoRoot));
    },
  };
}
