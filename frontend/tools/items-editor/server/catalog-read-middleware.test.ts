import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogReadHandler, createSchemasReadHandler } from "./catalog-read-middleware";

// --- HTTP handler integration tests (mirrors write-middleware.test.ts) ---
// Every test spins up a REAL http.Server against a throwaway temp-dir
// repoRoot fixture (its own catalog/*.json + a copy of the REAL schemas) —
// never the real repo's catalog files. `req.url` in these tests is already
// mount-relative (e.g. `/terrains.json`), matching how Vite/connect strips
// the `/catalog` or `/schemas` mount prefix in production.

const here = dirname(fileURLToPath(import.meta.url));
const realRepoRoot = join(here, "..", "..", "..", "..");

const baseMeta = {
  catalogVersion: "0.1.0",
  game: "Isla Misteriosa",
  slice: "MVP 0.1 — Vertical Slice jugable",
  collections: ["terrains", "items", "world-objects", "knowledge", "actions", "research"],
};

const validTerrain = { id: "sand", name: "Sand", walkable: true, tags: ["ground"] };

function withRepoRootFixture<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "items-editor-read-mw-test-"));
  mkdirSync(join(dir, "catalog"), { recursive: true });
  mkdirSync(join(dir, "schemas"), { recursive: true });
  writeFileSync(join(dir, "catalog", "meta.json"), `${JSON.stringify(baseMeta, null, 2)}\n`);
  writeFileSync(join(dir, "catalog", "terrains.json"), `${JSON.stringify([validTerrain], null, 2)}\n`);
  copyFileSync(join(realRepoRoot, "schemas", "common.json"), join(dir, "schemas", "common.json"));
  copyFileSync(join(realRepoRoot, "schemas", "catalog.json"), join(dir, "schemas", "catalog.json"));
  return (async () => {
    try {
      return await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

async function withServer<T>(
  handler: ReturnType<typeof createCatalogReadHandler> | ReturnType<typeof createSchemasReadHandler>,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
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
 * normalization — `fetch()`/`new URL()` would collapse `..` before the
 * request is even sent, which would silently defeat these tests). Used
 * only to exercise the handler's own defense-in-depth traversal rejection.
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

test("createCatalogReadHandler: GET /terrains.json serves the LIVE source file (not a stale copy)", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCatalogReadHandler(root), async (baseUrl) => {
      const { status, body } = await get(`${baseUrl}/terrains.json`);
      assert.equal(status, 200);
      assert.deepEqual(body, [validTerrain]);
    });
  });
});

test("createCatalogReadHandler: reflects a write made AFTER server start with no restart (proves the staleness bug is fixed)", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCatalogReadHandler(root), async (baseUrl) => {
      const before = await get(`${baseUrl}/terrains.json`);
      assert.deepEqual(before.body, [validTerrain]);

      // Simulate a save landing on the live source AFTER the handler/server
      // already started — no restart happens between this write and the
      // next read.
      const newTerrain = { id: "swamp", name: "Swamp", walkable: false, tags: ["wet"] };
      writeFileSync(join(root, "catalog", "terrains.json"), `${JSON.stringify([validTerrain, newTerrain], null, 2)}\n`);

      const after = await get(`${baseUrl}/terrains.json`);
      assert.equal(after.status, 200);
      assert.deepEqual(after.body, [validTerrain, newTerrain]);
    });
  });
});

test("createCatalogReadHandler: GET /meta.json serves catalog/meta.json", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCatalogReadHandler(root), async (baseUrl) => {
      const { status, body } = await get(`${baseUrl}/meta.json`);
      assert.equal(status, 200);
      assert.deepEqual(body, baseMeta);
    });
  });
});

test("createCatalogReadHandler: GET /not-a-real-collection.json returns 404 (not allow-listed)", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCatalogReadHandler(root), async (baseUrl) => {
      const { status, body } = await get(`${baseUrl}/not-a-real-collection.json`);
      assert.equal(status, 404);
      assert.equal((body as { ok: boolean }).ok, false);
    });
  });
});

test("createCatalogReadHandler: rejects path traversal via a literal '..' segment with 404 and never escapes the catalog dir", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCatalogReadHandler(root), async (baseUrl) => {
      const { status } = await rawGet(baseUrl, "/../schemas/common.json");
      assert.equal(status, 404);
    });
  });
});

test("createCatalogReadHandler: rejects an encoded traversal attempt (%2e%2e) with 404", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCatalogReadHandler(root), async (baseUrl) => {
      const { status } = await rawGet(baseUrl, "/%2e%2e/schemas/common.json");
      assert.equal(status, 404);
    });
  });
});

test("createCatalogReadHandler: rejects an absolute-path-style request (extra leading segment) with 404", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCatalogReadHandler(root), async (baseUrl) => {
      const { status } = await rawGet(baseUrl, "//etc/passwd");
      assert.equal(status, 404);
    });
  });
});

test("createCatalogReadHandler: rejects non-GET methods with 404", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCatalogReadHandler(root), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/terrains.json`, { method: "POST", body: "{}" });
      assert.equal(res.status, 404);
    });
  });
});

test("createSchemasReadHandler: GET /common.json and /catalog.json serve the live schema files", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createSchemasReadHandler(root), async (baseUrl) => {
      const common = await get(`${baseUrl}/common.json`);
      assert.equal(common.status, 200);
      assert.ok(common.body && typeof common.body === "object");

      const catalog = await get(`${baseUrl}/catalog.json`);
      assert.equal(catalog.status, 200);
      assert.ok(catalog.body && typeof catalog.body === "object");
    });
  });
});

test("createSchemasReadHandler: GET /not-a-real-schema.json returns 404 (not allow-listed)", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createSchemasReadHandler(root), async (baseUrl) => {
      const { status } = await get(`${baseUrl}/not-a-real-schema.json`);
      assert.equal(status, 404);
    });
  });
});

test("createSchemasReadHandler: rejects path traversal via a literal '..' segment with 404", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createSchemasReadHandler(root), async (baseUrl) => {
      const { status } = await rawGet(baseUrl, "/../catalog/meta.json");
      assert.equal(status, 404);
    });
  });
});
