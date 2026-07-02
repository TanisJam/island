/**
 * Deterministic `catalogVersion` bump (design.md "ADR-3 — Atomic write +
 * deterministic catalogVersion bump"). Increments the trailing numeric
 * ("patch") segment of a `major.minor.patch` string. Chosen over a
 * timestamp because it is deterministic, reproducible, testable, and
 * matches the existing `"0.1.0"` format in `catalog/meta.json`.
 *
 * Non-conforming input THROWS rather than silently guessing — `meta.json`
 * is hand-curated, so a malformed version is a real bug to surface, not a
 * value to coerce.
 */
export function bumpCatalogVersion(current: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.trim());
  if (!match) {
    throw new Error(`bumpCatalogVersion: "${current}" is not a valid major.minor.patch version`);
  }
  const [, major, minor, patch] = match;
  const nextPatch = Number(patch) + 1;
  return `${major}.${minor}.${nextPatch}`;
}
