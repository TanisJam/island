import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic, writeFileDurable } from "./write-middleware";

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
