import { join } from "node:path";

/**
 * Resolves the hard-coded write/read target for the items-editor's atlas
 * write middleware (design.md "B3 — Atlas write target (hard-coded,
 * security)"), mirroring `targets.ts::resolveTargets`.
 *
 * SECURITY: this function accepts ONLY `repoRoot`. There is no parameter
 * through which a client-supplied path could enter — redirection is
 * structurally impossible, not merely validated away. `repoRoot` itself
 * MUST be derived at compile-time from `import.meta.url` by the caller,
 * never from a request body/header/env.
 *
 * NOTE the extra `frontend` path segment vs `targets.ts`: `repoRoot` here
 * is the parent of `frontend/` (same derivation as `targets.ts`), but
 * `atlas.json` lives under `frontend/public/`, not at repo root like
 * `catalog/`.
 */
export interface AtlasTargets {
  atlasPath: string;
}

export function resolveAtlasTarget(repoRoot: string): AtlasTargets {
  return {
    atlasPath: join(repoRoot, "frontend", "public", "atlas.json"),
  };
}
