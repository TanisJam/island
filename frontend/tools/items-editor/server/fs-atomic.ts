import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";

/**
 * Shared atomic/durable filesystem write helpers, extracted out of
 * `write-middleware.ts` so `atlas-write-middleware.ts` (design.md Slice B)
 * can reuse the exact same durability guarantee without copy-pasting it.
 */

/**
 * Writes `contents` to `path` and `fsync`s the file descriptor before
 * closing it, so the data is durable on disk (not just buffered in the
 * page cache) by the time this returns. Pure side-effect wrapper, kept
 * standalone so it stays unit-testable independent of the rename step.
 */
export function writeFileDurable(path: string, contents: string): void {
  const fd = openSync(path, "w");
  try {
    writeSync(fd, contents, null, "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Atomic + durable write: write to a sibling tmp file, `fsync` it so the
 * data is flushed to disk, THEN `renameSync` over the target (rename is
 * atomic within one filesystem, design.md "ADR-3": "write tmp -> fsync ->
 * rename") so the target is never left half-written and never points at
 * not-yet-durable data.
 */
export function writeAtomic(targetPath: string, contents: string): void {
  const tmpPath = `${targetPath}.tmp-${randomBytes(6).toString("hex")}`;
  writeFileDurable(tmpPath, contents);
  try {
    renameSync(tmpPath, targetPath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup of the tmp file; the rename error is what matters
    }
    throw error;
  }
}
