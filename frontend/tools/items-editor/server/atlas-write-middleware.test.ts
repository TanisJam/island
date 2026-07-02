import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAtlasSaveHandler } from "./atlas-write-middleware";
import type { Atlas } from "../../../src/render/assets";

/**
 * SECURITY-CRITICAL integration suite (spec "Hard-coded, fresh-read write
 * target", design.md "B5 — Atlas write middleware + plugin"). Proves the
 * actual HTTP handler — not just the pure planner — cannot be redirected
 * away from its target file, always re-reads fresh from disk, and never
 * persists a client-sent full atlas.
 *
 * Every test spins up a REAL `http.Server` against `createAtlasSaveHandler`
 * pointed at a throwaway temp-dir fixture file — never
 * `frontend/public/atlas.json`. No test in this file ever touches the real
 * repo atlas file.
 */

const baseAtlas: Atlas = {
  image: "spring_outdoorsTileSheet..png",
  tile: 16,
  terrain: { sand: { x: 16, y: 112, w: 16, h: 16 } },
  item: { simple_axe: { x: 32, y: 1232, w: 16, h: 16 } },
};

async function withServer(fn: (opts: { url: string; atlasPath: string }) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "atlas-write-mw-test-"));
  const atlasPath = join(dir, "atlas.json");
  writeFileSync(atlasPath, `${JSON.stringify(baseAtlas, null, 2)}\n`);
  const server: Server = createServer(createAtlasSaveHandler(atlasPath));
  try {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    await fn({ url: `http://127.0.0.1:${port}/__save-atlas`, atlasPath });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

async function post(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

test("atlas-write-middleware: patches only the target typeId, preserving every other entry, on disk", async () => {
  await withServer(async ({ url, atlasPath }) => {
    const { status, json } = await post(url, { typeId: "crude_tool", region: { x: 1, y: 1, w: 16, h: 16 } });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const onDisk = JSON.parse(readFileSync(atlasPath, "utf-8")) as Atlas;
    assert.deepEqual(onDisk.item?.crude_tool, { x: 1, y: 1, w: 16, h: 16 });
    assert.deepEqual(onDisk.item?.simple_axe, baseAtlas.item?.simple_axe);
    assert.deepEqual(onDisk.terrain, baseAtlas.terrain);
  });
});

test("atlas-write-middleware: SECURITY — client cannot redirect the write target; hostile path/file/target/full-atlas fields are ignored", async () => {
  await withServer(async ({ url, atlasPath }) => {
    const { status, json } = await post(url, {
      typeId: "crude_tool",
      region: { x: 2, y: 2, w: 16, h: 16 },
      path: "../../etc/passwd",
      file: "/etc/passwd",
      target: "../../../root/.ssh/authorized_keys",
      atlas: { image: "EVIL.png", tile: 1, item: { simple_axe: { x: 0, y: 0, w: 1, h: 1 } } },
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    // The only file ever written is the hard-coded atlasPath fixture, and
    // its content proves the hostile full-atlas payload was never trusted.
    const onDisk = JSON.parse(readFileSync(atlasPath, "utf-8")) as Atlas;
    assert.equal(onDisk.image, baseAtlas.image);
    assert.deepEqual(onDisk.item?.simple_axe, baseAtlas.item?.simple_axe);
    assert.deepEqual(onDisk.item?.crude_tool, { x: 2, y: 2, w: 16, h: 16 });
    const raw = readFileSync(atlasPath, "utf-8");
    for (const hostileValue of ["../../etc/passwd", "/etc/passwd", "../../../root/.ssh/authorized_keys", "EVIL.png"]) {
      assert.equal(raw.includes(hostileValue), false, `leaked: ${hostileValue}`);
    }
  });
});

test("atlas-write-middleware: fresh read-modify-write — a mapping written externally between requests survives a subsequent save", async () => {
  await withServer(async ({ url, atlasPath }) => {
    await post(url, { typeId: "crude_tool", region: { x: 1, y: 1, w: 16, h: 16 } });
    // Simulate another session/tool (e.g. atlas-editor) writing a new
    // mapping directly to disk between this client's saves.
    const midway = JSON.parse(readFileSync(atlasPath, "utf-8")) as Atlas;
    midway.item = { ...midway.item, external_item: { x: 99, y: 99, w: 16, h: 16 } };
    writeFileSync(atlasPath, JSON.stringify(midway, null, 2));

    const { status, json } = await post(url, { typeId: "bark", region: { x: 3, y: 3, w: 16, h: 16 } });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const onDisk = JSON.parse(readFileSync(atlasPath, "utf-8")) as Atlas;
    assert.deepEqual(onDisk.item?.bark, { x: 3, y: 3, w: 16, h: 16 });
    assert.deepEqual(onDisk.item?.external_item, { x: 99, y: 99, w: 16, h: 16 });
    assert.deepEqual(onDisk.item?.crude_tool, { x: 1, y: 1, w: 16, h: 16 });
  });
});

test("atlas-write-middleware: rejects non-POST with 405", async () => {
  await withServer(async ({ url }) => {
    const res = await fetch(url, { method: "GET" });
    assert.equal(res.status, 405);
  });
});

test("atlas-write-middleware: rejects an invalid region with 400 and does not write to disk", async () => {
  await withServer(async ({ url, atlasPath }) => {
    const before = readFileSync(atlasPath, "utf-8");
    const { status, json } = await post(url, { typeId: "crude_tool", region: { x: "bad", y: 1, w: 16, h: 16 } });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(readFileSync(atlasPath, "utf-8"), before);
  });
});

test("atlas-write-middleware: rejects a hostile __proto__ typeId with 400 and does not write to disk", async () => {
  await withServer(async ({ url, atlasPath }) => {
    const before = readFileSync(atlasPath, "utf-8");
    const { status, json } = await post(url, { typeId: "__proto__", region: { x: 1, y: 1, w: 16, h: 16 } });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(readFileSync(atlasPath, "utf-8"), before);
  });
});

test("atlas-write-middleware: clear removes a mapping on disk", async () => {
  await withServer(async ({ url, atlasPath }) => {
    const { status, json } = await post(url, { typeId: "simple_axe", clear: true });
    assert.equal(status, 200);
    assert.equal(json.region, null);
    const onDisk = JSON.parse(readFileSync(atlasPath, "utf-8")) as Atlas;
    assert.equal("simple_axe" in (onDisk.item ?? {}), false);
  });
});
