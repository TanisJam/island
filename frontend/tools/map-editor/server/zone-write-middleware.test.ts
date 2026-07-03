import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createZoneSaveHandler } from "./zone-write-middleware";

// --- HTTP handler integration tests (mirrors write-middleware.test.ts /
// atlas-write-middleware.test.ts). Every test spins up a REAL http.Server
// against a throwaway temp-dir repoRoot fixture (its own zones/*.json + a
// copy of the REAL schemas/zone.json) — never the real repo's zone files.

const here = dirname(fileURLToPath(import.meta.url));
const realRepoRoot = join(here, "..", "..", "..", "..");

const validZone = {
  width: 2,
  height: 1,
  tiles: ["sand", "grass"],
  objects: [{ objectTypeId: "tree", x: 0, y: 0 }],
};

function withRepoRootFixture<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "map-editor-write-mw-test-"));
  mkdirSync(join(dir, "zones"), { recursive: true });
  mkdirSync(join(dir, "schemas"), { recursive: true });
  writeFileSync(join(dir, "zones", "zone-z1.json"), `${JSON.stringify(validZone, null, 2)}\n`);
  copyFileSync(join(realRepoRoot, "schemas", "zone.json"), join(dir, "schemas", "zone.json"));
  return (async () => {
    try {
      return await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

async function withServer<T>(handler: ReturnType<typeof createZoneSaveHandler>, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createServer(handler);
  try {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function post(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

/**
 * Sends a POST with a LITERAL raw path (no WHATWG URL dot-segment
 * normalization — `fetch()` would silently collapse `/../x` before it ever
 * reaches the server), used only to exercise the handler's own
 * defense-in-depth traversal rejection — mirrors
 * `zone-read-middleware.test.ts::rawGet`.
 */
async function rawPost(baseUrl: string, rawPath: string, body: unknown): Promise<{ status: number }> {
  const { hostname, port } = new URL(baseUrl);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: rawPath, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

test("createZoneSaveHandler: POST /z1 with a valid zone writes zones/zone-z1.json atomically and re-validates", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneSaveHandler(root), async (baseUrl) => {
      const edited = { width: 2, height: 1, tiles: ["grass", "grass"], objects: [] };
      const { status, json } = await post(`${baseUrl}/z1`, edited);
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      const onDisk = JSON.parse(readFileSync(join(root, "zones", "zone-z1.json"), "utf-8"));
      assert.deepEqual(onDisk, edited);
    });
  });
});

test("createZoneSaveHandler: preserves an object's optional state field on round-trip", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneSaveHandler(root), async (baseUrl) => {
      const edited = { width: 1, height: 1, tiles: ["sand"], objects: [{ objectTypeId: "campfire", x: 0, y: 0, state: { lit: true, fuel: 3 } }] };
      const { status, json } = await post(`${baseUrl}/z1`, edited);
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      const onDisk = JSON.parse(readFileSync(join(root, "zones", "zone-z1.json"), "utf-8"));
      assert.deepEqual(onDisk.objects[0], { objectTypeId: "campfire", x: 0, y: 0, state: { lit: true, fuel: 3 } });
    });
  });
});

test("createZoneSaveHandler: rejects a schema-invalid zone with 400 and writes no file", async () => {
  await withRepoRootFixture(async (root) => {
    const before = readFileSync(join(root, "zones", "zone-z1.json"), "utf-8");
    await withServer(createZoneSaveHandler(root), async (baseUrl) => {
      const invalid = { width: 2, height: 1, tiles: ["sand", "grass"] }; // missing required "objects"
      const { status, json } = await post(`${baseUrl}/z1`, invalid);
      assert.equal(status, 400);
      assert.equal(json.ok, false);
    });
    assert.equal(readFileSync(join(root, "zones", "zone-z1.json"), "utf-8"), before);
  });
});

test("createZoneSaveHandler: rejects a zone with an unknown extra field with 400 (additionalProperties: false) and writes no file", async () => {
  await withRepoRootFixture(async (root) => {
    const before = readFileSync(join(root, "zones", "zone-z1.json"), "utf-8");
    await withServer(createZoneSaveHandler(root), async (baseUrl) => {
      const invalid = { ...validZone, hostileExtra: "nope" };
      const { status, json } = await post(`${baseUrl}/z1`, invalid);
      assert.equal(status, 400);
      assert.equal(json.ok, false);
    });
    assert.equal(readFileSync(join(root, "zones", "zone-z1.json"), "utf-8"), before);
  });
});

test("createZoneSaveHandler: rejects a multi-segment path with 404 (a client-normalized '..' collapses to this before reaching the server)", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneSaveHandler(root), async (baseUrl) => {
      const { status, json } = await post(`${baseUrl}/catalog/meta`, validZone);
      assert.equal(status, 404);
      assert.equal(json.ok, false);
    });
    assert.equal(existsSync(join(root, "catalog")), false);
  });
});

test("createZoneSaveHandler: rejects a literal '..' traversal segment with 404 and touches no file outside zones/", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneSaveHandler(root), async (baseUrl) => {
      const { status } = await rawPost(baseUrl, "/../catalog/meta", validZone);
      assert.equal(status, 404);
    });
    assert.equal(existsSync(join(root, "catalog")), false);
  });
});

test("createZoneSaveHandler: rejects non-POST with 405", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneSaveHandler(root), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/z1`, { method: "GET" });
      assert.equal(res.status, 405);
    });
  });
});

test("createZoneSaveHandler: a brand-new zone id (not yet on disk) is allowed and creates the file", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneSaveHandler(root), async (baseUrl) => {
      const { status, json } = await post(`${baseUrl}/z2`, validZone);
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      const onDisk = JSON.parse(readFileSync(join(root, "zones", "zone-z2.json"), "utf-8"));
      assert.deepEqual(onDisk, validZone);
    });
  });
});
