import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCollectionSaveHandler, createItemsSaveHandler, writeAtomic, writeFileDurable } from "./write-middleware";

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "items-editor-write-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("writeFileDurable: writes the exact contents to disk (fsync completes before returning)", () => {
  withTmpDir((dir) => {
    const path = join(dir, "durable.txt");
    writeFileDurable(path, "hello durable world");
    assert.equal(readFileSync(path, "utf-8"), "hello durable world");
  });
});

test("writeAtomic: target contains the full new contents, no partial writes", () => {
  withTmpDir((dir) => {
    const target = join(dir, "items.json");
    writeAtomic(target, '{"ok":true}');
    assert.equal(readFileSync(target, "utf-8"), '{"ok":true}');
  });
});

test("writeAtomic: no leftover .tmp-* file after a successful write (tmp is renamed, not left behind)", () => {
  withTmpDir((dir) => {
    const target = join(dir, "meta.json");
    writeAtomic(target, '{"catalogVersion":"0.1.1"}');
    const leftovers = readdirSync(dir).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(leftovers, []);
    assert.ok(existsSync(target));
  });
});

test("writeAtomic: overwrites an existing target file's contents fully", () => {
  withTmpDir((dir) => {
    const target = join(dir, "items.json");
    writeAtomic(target, '{"count":1}');
    writeAtomic(target, '{"count":2}');
    assert.equal(readFileSync(target, "utf-8"), '{"count":2}');
  });
});

// --- HTTP handler integration tests (mirrors atlas-write-middleware.test.ts) ---
// Every test spins up a REAL http.Server against a throwaway temp-dir repoRoot
// fixture (its own catalog/*.json + a copy of the REAL schemas) — never the
// real repo's catalog files.

const here = dirname(fileURLToPath(import.meta.url));
const realRepoRoot = join(here, "..", "..", "..", "..");

const baseMeta = {
  catalogVersion: "0.1.0",
  game: "Isla Misteriosa",
  slice: "MVP 0.1 — Vertical Slice jugable",
  collections: ["terrains", "items", "world-objects", "knowledge", "actions", "research"],
};

const validKnowledge = { id: "idea_binding", name: "Atar", kind: "idea" };
const validItem = {
  id: "small_stone",
  name: "Piedra pequeña",
  description: "Una piedra dura.",
  shape: { w: 1, h: 1 },
  rotatable: false,
  properties: { hardness: 2 },
  tags: ["stone"],
};

function withRepoRootFixture<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "items-editor-write-mw-test-"));
  mkdirSync(join(dir, "catalog"), { recursive: true });
  mkdirSync(join(dir, "schemas"), { recursive: true });
  writeFileSync(join(dir, "catalog", "meta.json"), `${JSON.stringify(baseMeta, null, 2)}\n`);
  writeFileSync(join(dir, "catalog", "knowledge.json"), `${JSON.stringify([validKnowledge], null, 2)}\n`);
  writeFileSync(join(dir, "catalog", "items.json"), `${JSON.stringify([validItem], null, 2)}\n`);
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

async function withServer<T>(handler: ReturnType<typeof createCollectionSaveHandler>, fn: (baseUrl: string) => Promise<T>): Promise<T> {
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

test("createCollectionSaveHandler: POST /knowledge writes catalog/knowledge.json and bumps catalogVersion", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCollectionSaveHandler(root), async (baseUrl) => {
      const { status, json } = await post(`${baseUrl}/knowledge`, { records: [validKnowledge, { ...validKnowledge, id: "idea_fire" }] });
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.catalogVersion, "0.1.1");
      const onDisk = JSON.parse(readFileSync(join(root, "catalog", "knowledge.json"), "utf-8"));
      assert.equal(onDisk.length, 2);
      const meta = JSON.parse(readFileSync(join(root, "catalog", "meta.json"), "utf-8"));
      assert.equal(meta.catalogVersion, "0.1.1");
    });
  });
});

test("createCollectionSaveHandler: POST /research writes catalog/research.json and bumps catalogVersion (Slice 2, second collection proving generalization)", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCollectionSaveHandler(root), async (baseUrl) => {
      const validResearch = { id: "heat_containment", name: "Contención de calor", status: "hidden" };
      const { status, json } = await post(`${baseUrl}/research`, { records: [validResearch, { ...validResearch, id: "idea_shelter" }] });
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.catalogVersion, "0.1.1");
      const onDisk = JSON.parse(readFileSync(join(root, "catalog", "research.json"), "utf-8"));
      assert.equal(onDisk.length, 2);
      const meta = JSON.parse(readFileSync(join(root, "catalog", "meta.json"), "utf-8"));
      assert.equal(meta.catalogVersion, "0.1.1");
    });
  });
});

test("createCollectionSaveHandler: POST /not-a-real-collection returns 404 and touches no file", async () => {
  await withRepoRootFixture(async (root) => {
    const before = readFileSync(join(root, "catalog", "meta.json"), "utf-8");
    await withServer(createCollectionSaveHandler(root), async (baseUrl) => {
      const { status, json } = await post(`${baseUrl}/not-a-real-collection`, { records: [] });
      assert.equal(status, 404);
      assert.equal(json.ok, false);
    });
    assert.equal(readFileSync(join(root, "catalog", "meta.json"), "utf-8"), before);
    assert.equal(existsSync(join(root, "catalog", "not-a-real-collection.json")), false);
  });
});

test("createCollectionSaveHandler: rejects non-POST with 405", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createCollectionSaveHandler(root), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/knowledge`, { method: "GET" });
      assert.equal(res.status, 405);
    });
  });
});

test("createCollectionSaveHandler: rejects a schema-invalid record with 400 and writes no file", async () => {
  await withRepoRootFixture(async (root) => {
    const before = readFileSync(join(root, "catalog", "knowledge.json"), "utf-8");
    await withServer(createCollectionSaveHandler(root), async (baseUrl) => {
      const { status, json } = await post(`${baseUrl}/knowledge`, { records: [{ ...validKnowledge, kind: "not-a-real-kind" }] });
      assert.equal(status, 400);
      assert.equal(json.ok, false);
    });
    assert.equal(readFileSync(join(root, "catalog", "knowledge.json"), "utf-8"), before);
  });
});

test("createItemsSaveHandler: /__save-items still works unchanged — POST writes catalog/items.json and bumps catalogVersion (regression check)", async () => {
  await withRepoRootFixture(async (root) => {
    await withServer(createItemsSaveHandler(root), async (baseUrl) => {
      const { status, json } = await post(`${baseUrl}/__save-items`, { items: [validItem, { ...validItem, id: "dry_branch" }] });
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.catalogVersion, "0.1.1");
      const onDisk = JSON.parse(readFileSync(join(root, "catalog", "items.json"), "utf-8"));
      assert.equal(onDisk.length, 2);
    });
  });
});
