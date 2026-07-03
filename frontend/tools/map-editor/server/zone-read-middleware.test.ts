import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZoneReadHandler } from "./zone-read-middleware";

// --- HTTP handler integration tests (mirrors catalog-read-middleware.test.ts) ---
// Every test spins up a REAL http.Server against a throwaway temp-dir
// repoRoot fixture (its own zones/*.json) — never the real repo's zone
// files. `req.url` in these tests is already mount-relative (e.g.
// `/zone-z1.json`), matching how Vite/connect strips the `/zones` mount
// prefix in production.

const validZone = { width: 2, height: 1, tiles: ["sand", "grass"], objects: [] };

function withRepoRootFixture<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "map-editor-read-mw-test-"));
  mkdirSync(join(dir, "zones"), { recursive: true });
  writeFileSync(join(dir, "zones", "zone-z1.json"), `${JSON.stringify(validZone, null, 2)}\n`);
  return (async () => {
    try {
      return await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

async function withServer<T>(handler: ReturnType<typeof createZoneReadHandler>, fn: (baseUrl: string) => Promise<T>): Promise<T> {
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

async function get(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/**
 * Sends a request with a LITERAL raw path (no WHATWG URL dot-segment
 * normalization), used only to exercise the handler's own defense-in-depth
 * traversal rejection — mirrors `catalog-read-middleware.test.ts::rawGet`.
 */
async function rawGet(baseUrl: string, rawPath: string): Promise<{ status: number }> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: rawPath, method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("createZoneReadHandler: GET /zone-z1.json serves the LIVE source file", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneReadHandler(root), async (baseUrl) => {
      const { status, body } = await get(`${baseUrl}/zone-z1.json`);
      assert.equal(status, 200);
      assert.deepEqual(body, validZone);
    });
  });
});

test("createZoneReadHandler: reflects a write made AFTER server start with no restart", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneReadHandler(root), async (baseUrl) => {
      const before = await get(`${baseUrl}/zone-z1.json`);
      assert.deepEqual(before.body, validZone);

      const edited = { ...validZone, tiles: ["grass", "grass"] };
      writeFileSync(join(root, "zones", "zone-z1.json"), `${JSON.stringify(edited, null, 2)}\n`);

      const after = await get(`${baseUrl}/zone-z1.json`);
      assert.equal(after.status, 200);
      assert.deepEqual(after.body, edited);
    });
  });
});

test("createZoneReadHandler: GET /not-a-zone.json returns 404 (not allow-listed)", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneReadHandler(root), async (baseUrl) => {
      const { status, body } = await get(`${baseUrl}/not-a-zone.json`);
      assert.equal(status, 404);
      assert.equal((body as { ok: boolean }).ok, false);
    });
  });
});

test("createZoneReadHandler: GET /zone-does-not-exist.json returns 404 (allow-listed pattern, missing file)", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneReadHandler(root), async (baseUrl) => {
      const { status } = await get(`${baseUrl}/zone-does-not-exist.json`);
      assert.equal(status, 404);
    });
  });
});

test("createZoneReadHandler: rejects path traversal via a literal '..' segment with 404", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneReadHandler(root), async (baseUrl) => {
      const { status } = await rawGet(baseUrl, "/../catalog/meta.json");
      assert.equal(status, 404);
    });
  });
});

test("createZoneReadHandler: rejects an encoded traversal attempt (%2e%2e) with 404", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneReadHandler(root), async (baseUrl) => {
      const { status } = await rawGet(baseUrl, "/%2e%2e/catalog/meta.json");
      assert.equal(status, 404);
    });
  });
});

test("createZoneReadHandler: rejects non-GET methods with 404", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createZoneReadHandler(root), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/zone-z1.json`, { method: "POST", body: "{}" });
      assert.equal(res.status, 404);
    });
  });
});
