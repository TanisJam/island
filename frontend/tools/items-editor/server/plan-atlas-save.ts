import { parseAtlas, type Atlas, type AtlasRegion } from "../../../src/render/assets";

/**
 * Server-side atlas-save planning (design.md "B4 — Pure atlas save
 * planner"). PURE — builds the full new contents of `atlas.json` in memory
 * and never touches `fs`; `atlas-write-middleware.ts` is the only caller
 * and only performs the actual write once this returns `ok: true`.
 *
 * SECURITY-CRITICAL: `rawBody` is read for its `.typeId`, `.kind`, and
 * `.region` (or `.clear`) fields ONLY. Any other field on `rawBody` (a
 * client-supplied `atlas`, `path`, `file`, `target`, `image`, `tile`, or
 * anything else) is NEVER read here and therefore can never influence the
 * output. The write target always comes from `resolveAtlasTarget(repoRoot)`
 * (server/atlas-targets.ts), which this module does not even import. See
 * `plan-atlas-save.test.ts` for the load-bearing proof.
 *
 * SECURITY-CRITICAL (bucket allow-list, Slice 3b atlasKind generalization;
 * widened to include `player` by atlas-editor-fold Slice 1): `kind` selects
 * WHICH atlas bucket (`terrain`/`object`/`item`/`player`) is patched — it is
 * checked against `ALLOWED_ATLAS_KINDS` and rejected outright if it is
 * anything else (e.g. `"__proto__"`, an arbitrary string). It is a
 * bucket-key selector, never a path or file target.
 *
 * SECURITY-CRITICAL (prototype pollution): `typeId` is used as a dynamic
 * property key on the cloned atlas's selected bucket. A `typeId` of
 * `"__proto__"` or `"constructor"` is REJECTED outright as invalid input —
 * never reaches a bracket assignment — so it can never reassign or corrupt
 * the object's prototype chain.
 */

export interface PlanAtlasSaveInput {
  /** The freshly-read, already-parsed atlas the middleware read from disk
   * THIS request — never a client-supplied copy. */
  currentAtlas: Atlas;
}

export type SaveError = { instancePath: string; message: string };

export type PlanAtlasSaveResult =
  | { ok: true; atlasJson: string; typeId: string; region: AtlasRegion | null }
  | { ok: false; errors: SaveError[] };

/** Keys that would reassign/corrupt an object's prototype chain if used as
 * a bracket-assignment property key. Rejected outright as invalid typeIds. */
const UNSAFE_TYPE_IDS = new Set(["__proto__", "constructor", "prototype"]);

/** Atlas buckets a texture panel is allowed to write to (Slice 3b atlasKind
 * generalization). `player` was added in atlas-editor-fold Slice 1 — the
 * items-editor's standalone "Player" tab mounts a texture panel targeting
 * this bucket (single fixed typeId `"player"`), even though no
 * `COLLECTIONS` entry has `atlasKind: "player"`. */
const ALLOWED_ATLAS_KINDS = new Set(["terrain", "object", "item", "player"]);
type AllowedAtlasKind = "terrain" | "object" | "item" | "player";

function isAllowedAtlasKind(value: unknown): value is AllowedAtlasKind {
  return typeof value === "string" && ALLOWED_ATLAS_KINDS.has(value);
}

function err(message: string, instancePath = "/typeId"): PlanAtlasSaveResult {
  return { ok: false, errors: [{ instancePath, message }] };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

type RegionResult = { ok: true; region: AtlasRegion } | { ok: false; error: SaveError };

/** Reconstructs a region field-by-field from the raw request — only these
 * four keys are ever copied, so a stray/extra/`__proto__` key inside
 * `rawBody.region` can never reach the written file (mirrors
 * `plan-save.ts::reconstructItem`'s defense-in-depth pattern). */
function readRegion(rawRegion: unknown): RegionResult {
  if (typeof rawRegion !== "object" || rawRegion === null) {
    return { ok: false, error: { instancePath: "/region", message: "region must be an object" } };
  }
  const r = rawRegion as Record<string, unknown>;
  const { x, y, w, h } = r;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) {
    return { ok: false, error: { instancePath: "/region", message: "x/y/w/h must be finite numbers" } };
  }
  if (w <= 0 || h <= 0 || x < 0 || y < 0) {
    return { ok: false, error: { instancePath: "/region", message: "w/h must be > 0 and x/y must be >= 0" } };
  }
  return { ok: true, region: { x, y, w, h } };
}

export function planAtlasSave(rawBody: unknown, input: PlanAtlasSaveInput): PlanAtlasSaveResult {
  if (typeof rawBody !== "object" || rawBody === null) {
    return err("body must be an object");
  }
  const body = rawBody as Record<string, unknown>;

  const typeId = body.typeId;
  if (typeof typeId !== "string" || typeId.length === 0) {
    return err("typeId must be a non-empty string");
  }
  if (UNSAFE_TYPE_IDS.has(typeId)) {
    return err(`typeId "${typeId}" is not allowed`);
  }

  if (!isAllowedAtlasKind(body.kind)) {
    return err(`kind must be one of ${[...ALLOWED_ATLAS_KINDS].join("|")}`, "/kind");
  }
  const kind = body.kind;

  const isClear = body.clear === true;

  // Deep-clone so `input.currentAtlas` (and everything except the target
  // bucket's typeId entry) is preserved byte-for-byte in the output.
  const next: Atlas = structuredClone(input.currentAtlas);
  next[kind] ??= {};
  const bucket = next[kind] as Record<string, AtlasRegion>;

  let region: AtlasRegion | null;
  if (isClear) {
    delete bucket[typeId];
    region = null;
  } else {
    const parsed = readRegion(body.region);
    if (!parsed.ok) {
      return { ok: false, errors: [parsed.error] };
    }
    bucket[typeId] = parsed.region;
    region = parsed.region;
  }

  try {
    parseAtlas(next);
  } catch (error) {
    const message = error instanceof Error ? error.message : "resulting atlas is invalid";
    return { ok: false, errors: [{ instancePath: "/", message }] };
  }

  return {
    ok: true,
    atlasJson: `${JSON.stringify(next, null, 2)}\n`,
    typeId,
    region,
  };
}
