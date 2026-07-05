import type { ContextActionDef, InputSpec } from "../contract/catalog";
import type { ItemInstance } from "../contract/events";
import type { CatalogIndex } from "./catalog";
import type { GameState } from "./state";
import type { RTarget, TargetRef } from "./engine";
import { gatherCandidates, itemMatches, resolveTarget } from "./engine";

/** Escalation threshold (Decision 3, engram #2854): after this many prior failed
 *  attempts on the SAME signature, feedback escalates from `functionalHint` to
 *  `functionalHintSharp`. Never reveals the exact recipe item. */
export const ESCALATION_THRESHOLD = 5;

export type CombinationGrade = "nothing" | "missing_functional_piece" | "wrong_material" | "almost" | "ready";

export type CombinationClassification = {
  grade: CombinationGrade;
  recipe?: ContextActionDef;
  missing?: InputSpec[];
  satisfied: number;
  total: number;
};

/** Gathers the pieces a `TryCombination` attempt is scoped to, PER the per-tile
 *  amendment (engram #2857): `method:"crouch"` reads ONLY the world items sitting
 *  on the EXAMINED tile (no chebyshev<=1 adjacent_ground aggregation); `method:"surface"`
 *  reads the target world object's surface grid (reusing `gatherCandidates`). */
export function gatherCombinationScope(s: GameState, index: CatalogIndex, t: RTarget, method: "crouch" | "surface"): ItemInstance[] {
  if (method === "crouch") {
    return s.items.filter((i) => i.location.type === "world" && i.location.x === t.pos.x && i.location.y === t.pos.y);
  }
  return gatherCandidates(s, index, ["surface"], t);
}

/** Signature used for the escalation counter: sorted unique item-type-ids of the
 *  gathered scope, joined with "|" (matches `GameState.combinationAttempts` keys). */
export function combinationSignature(pieces: ItemInstance[]): string {
  return [...new Set(pieces.map((p) => p.itemTypeId))].sort().join("|");
}

/** True when `it` is NOT a full match for `match` but relates to it closely enough
 *  to be "present but inadequate" rather than simply absent (distinct grade:
 *  `wrong_material` vs a plain missing piece). */
function relatesButFails(index: CatalogIndex, it: ItemInstance, match: { anyTags?: string[]; minProps?: Record<string, number> }): boolean {
  const def = index.itemById.get(it.itemTypeId);
  if (!def) return false;
  if (itemMatches(index, it, match)) return false;
  if (match.anyTags && match.minProps) return match.anyTags.some((tag) => def.tags.includes(tag));
  if (match.minProps && !match.anyTags) return Object.keys(match.minProps).some((k) => k in def.properties);
  return false;
}

/** Greedily resolves a recipe's inputs against the gathered scope pieces (no reuse
 *  of a piece across inputs — mirrors `executeAction`'s claiming strategy). Returns
 *  the concrete resolution for satisfied inputs plus the specs still unsatisfied.
 *  `wrongSlot` is the first unsatisfied input where a present piece relates to the
 *  role but fails its match criteria; `partialSlot` is the first unsatisfied input
 *  where SOME matching pieces exist but not enough of them (a quantity shortfall,
 *  e.g. `count: 2` with only 1 present) — distinct from the role being entirely
 *  unaddressed. */
export function resolveRecipeInputs(
  index: CatalogIndex,
  pieces: ItemInstance[],
  recipe: ContextActionDef,
): { resolved: Record<string, ItemInstance[]>; missing: InputSpec[]; wrongSlot?: InputSpec; partialSlot?: InputSpec } {
  const claimed = new Set<string>();
  const resolved: Record<string, ItemInstance[]> = {};
  const missing: InputSpec[] = [];
  let wrongSlot: InputSpec | undefined;
  let partialSlot: InputSpec | undefined;
  for (const spec of recipe.inputs ?? []) {
    const unclaimed = pieces.filter((it) => !claimed.has(it.id));
    const matching = unclaimed.filter((it) => itemMatches(index, it, spec.match));
    if (matching.length >= spec.count) {
      const picked = matching.slice(0, spec.count);
      picked.forEach((it) => claimed.add(it.id));
      resolved[spec.name] = picked;
    } else {
      missing.push(spec);
      if (matching.length > 0) {
        if (!partialSlot) partialSlot = spec;
        matching.forEach((it) => claimed.add(it.id)); // don't let a later input re-claim these too
      } else if (!wrongSlot && unclaimed.some((it) => relatesButFails(index, it, spec.match))) {
        wrongSlot = spec;
      }
    }
  }
  return { resolved, missing, wrongSlot, partialSlot };
}

/** Classifies a `TryCombination` attempt against every `combinable`-flagged recipe,
 *  picking the BEST (closest-to-ready) match. See engram #2854 (Decision 3), the
 *  Slice B acceptance scenarios (engram #2852), and the fresh-context review that
 *  reconciled this ladder with the spec's worked example, for the grade ladder:
 *  - `ready`: all of some combinable recipe's inputs are satisfied.
 *  - `almost`: exactly one input short, and that input HAS some matching pieces —
 *    just not enough of them (a quantity shortfall, e.g. `count:2` with only 1
 *    present). Spec's "casi_falta_x" reading: you're not missing a ROLE, you just
 *    need a bit more of something you already have. NOTE: neither `improvise_crude_tool`
 *    nor `craft_simple_axe` currently authors an input with `count > 1`, so this grade
 *    is exercised via a synthetic recipe in `combination.test.ts` (same deferred
 *    status as `wrong_material` below — real catalog data to trigger it lands with
 *    a future recipe, not this batch).
 *  - `wrong_material`: exactly one input short, the role has NO matching piece, but a
 *    present piece relates to it (tag overlap) and fails its match criteria
 *    (present-but-inadequate). Also currently unreachable via the real catalog (no
 *    existing input combines `anyTags`+`minProps`) — deferred, same as above.
 *  - `missing_functional_piece`: one or more inputs are entirely unaddressed (zero
 *    matching pieces, not even a partial/wrong one) — this is the spec's literal
 *    worked example (piedra+rama present, binder ENTIRELY absent → `falta_pieza_funcional`),
 *    which is why this grade covers the single-missing-and-absent case too, not just
 *    "two or more short".
 *  - `nothing`: fewer than 2 pieces in scope, or no combinable recipe relates at all. */
export function classifyCombination(state: GameState, index: CatalogIndex, ref: TargetRef, method: "crouch" | "surface"): CombinationClassification {
  const t = resolveTarget(state, index, ref);
  if (!t) return { grade: "nothing", satisfied: 0, total: 0 };
  const pieces = gatherCombinationScope(state, index, t, method);
  if (pieces.length < 2) return { grade: "nothing", satisfied: 0, total: 0 };

  const recipes = index.actions.filter((a) => a.combinable);
  let best: { recipe: ContextActionDef; satisfied: number; total: number; missing: InputSpec[]; wrongSlot?: InputSpec; partialSlot?: InputSpec } | undefined;
  for (const recipe of recipes) {
    const total = recipe.inputs?.length ?? 0;
    const { missing, wrongSlot, partialSlot } = resolveRecipeInputs(index, pieces, recipe);
    const satisfied = total - missing.length;
    if (satisfied === 0 && !wrongSlot && !partialSlot) continue; // this recipe doesn't relate to the pieces at all
    if (!best || satisfied > best.satisfied || (satisfied === best.satisfied && missing.length < best.missing.length)) {
      best = { recipe, satisfied, total, missing, wrongSlot, partialSlot };
    }
  }
  if (!best) return { grade: "nothing", satisfied: 0, total: 0 };

  const { recipe, satisfied, total, missing, wrongSlot, partialSlot } = best;
  if (missing.length === 0) return { grade: "ready", recipe, satisfied, total };
  if (missing.length === 1) {
    if (partialSlot) return { grade: "almost", recipe, missing, satisfied, total };
    if (wrongSlot) return { grade: "wrong_material", recipe, missing, satisfied, total };
  }
  return { grade: "missing_functional_piece", recipe, missing, satisfied, total };
}

/** Function-first feedback text for a graded (non-ready) attempt. Never names the
 *  exact recipe item — only the catalog-authored `functionalHint`/`functionalHintSharp`
 *  of the primary missing/inadequate slot, selected by escalation tier. */
export function describeCombinationFeedback(c: CombinationClassification, tier: "vague" | "sharp"): string {
  const primary = c.missing?.[0];
  const hint = primary ? (tier === "sharp" ? primary.functionalHintSharp ?? primary.functionalHint : primary.functionalHint) : undefined;
  switch (c.grade) {
    case "nothing":
      return "No encuentro ninguna relación útil entre estas piezas.";
    case "missing_functional_piece":
      return hint ? `Me falta algo para esto: ${hint}.` : "Me falta algo para esto.";
    case "almost":
      return hint ? `Tengo parte de lo que necesito, pero no alcanza: ${hint}.` : "Tengo parte de lo que necesito, pero no alcanza.";
    case "wrong_material":
      return hint ? `Esto no sirve para lo que necesito: ${hint}.` : "Algo de esto no sirve para lo que necesito.";
    case "ready":
      return "Esto debería funcionar.";
  }
}
