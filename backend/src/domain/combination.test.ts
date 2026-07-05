import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContextActionDef } from "../contract/catalog";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { loadZone } from "../infrastructure/zone/loader";
import { seedState } from "../bootstrap/seed";
import { classifyCombination } from "./combination";
import type { CatalogIndex } from "./catalog";
import type { GameState } from "./state";

const { index } = loadCatalog();
const template = loadZone("z1");

let n = 0;
function addOnGround(s: GameState, itemTypeId: string, x: number, y: number): void {
  s.items.push({ id: `gnd_${itemTypeId}_${n++}`, itemTypeId, location: { type: "world", zoneId: s.zone.id, x, y } });
}

test("classifyCombination (crouch): nothing — piezas sin relación con ningún recipe combinable", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "bark", p.x, p.y);
  addOnGround(s, "wild_seed", p.x, p.y);
  const c = classifyCombination(s, index, { kind: "tile", x: p.x, y: p.y }, "crouch");
  assert.equal(c.grade, "nothing");
});

test("classifyCombination (crouch): nothing — menos de 2 piezas en el tile", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "small_stone", p.x, p.y);
  const c = classifyCombination(s, index, { kind: "tile", x: p.x, y: p.y }, "crouch");
  assert.equal(c.grade, "nothing");
});

test("classifyCombination (crouch): missing_functional_piece — sólo un rol tocado, faltan >=2", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "small_stone", p.x, p.y);
  addOnGround(s, "small_stone", p.x, p.y); // segunda piedra: sigue sirviendo sólo de "head", handle/binder siguen ausentes
  const c = classifyCombination(s, index, { kind: "tile", x: p.x, y: p.y }, "crouch");
  assert.equal(c.grade, "missing_functional_piece");
  assert.equal(c.missing?.length, 2);
});

// Reconciled with the spec's worked example (engram #2852: "piedra + rama present,
// binder ENTIRELY absent" -> falta_pieza_funcional): a single missing input with NO
// matching pieces at all (not even a partial/wrong one) grades as missing_functional_piece,
// not almost — see the classifyCombination doc comment for the full ladder rationale.
test("classifyCombination (crouch): missing_functional_piece — falta exactamente una pieza, totalmente ausente (ejemplo del spec)", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "small_stone", p.x, p.y); // head
  addOnGround(s, "dry_branch", p.x, p.y); // handle
  const c = classifyCombination(s, index, { kind: "tile", x: p.x, y: p.y }, "crouch");
  assert.equal(c.grade, "missing_functional_piece");
  assert.equal(c.missing?.length, 1);
  assert.equal(c.missing?.[0]?.name, "binder");
});

// "almost" is reserved for a QUANTITY shortfall — some matching pieces exist but not
// enough of them (e.g. count:2, only 1 present) — distinct from the role being
// entirely unaddressed. Neither real combinable recipe authors count>1 today, so
// (like wrong_material) this is exercised via a synthetic recipe.
test("classifyCombination (crouch): almost — hay piezas que matchean el rol, pero no alcanzan en cantidad", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "plant_fiber", p.x, p.y); // binding: 2 — matchea, pero sólo hay 1 unidad
  addOnGround(s, "small_stone", p.x, p.y); // sólo para pasar el piso de >=2 piezas en el tile
  const needsTwoBinders: ContextActionDef = {
    id: "test_only_needs_two_binders",
    label: "test",
    priority: 1,
    combinable: true,
    appliesTo: { kind: "self" },
    requirements: [],
    inputs: [
      { name: "binder", scope: ["hands"], match: { minProps: { binding: 1 } }, count: 2, consume: true, functionalHint: "algo para atar", functionalHintSharp: "algo flexible y fibroso para atar" },
    ],
    effects: [{ type: "add_item", itemTypeId: "crude_tool", to: "inventory" }],
  };
  const fakeIndex: CatalogIndex = { ...index, actions: [needsTwoBinders] };
  const c = classifyCombination(s, fakeIndex, { kind: "tile", x: p.x, y: p.y }, "crouch");
  assert.equal(c.grade, "almost");
});

test("classifyCombination (crouch): ready — las tres piezas satisfacen improvise_crude_tool", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "small_stone", p.x, p.y);
  addOnGround(s, "dry_branch", p.x, p.y);
  addOnGround(s, "plant_fiber", p.x, p.y);
  const c = classifyCombination(s, index, { kind: "tile", x: p.x, y: p.y }, "crouch");
  assert.equal(c.grade, "ready");
  assert.equal(c.recipe?.id, "improvise_crude_tool");
});

test("classifyCombination (crouch): wrong_material — una pieza se relaciona con el rol pero falla minProps", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "dry_branch", p.x, p.y); // handle_candidate, length: 2 — relacionado pero insuficiente para un mango "largo"
  addOnGround(s, "small_stone", p.x, p.y); // sólo para pasar el piso de >=2 piezas en el tile
  // Receta sintética SOLO para este test (no toca catalog/actions.json): ninguna receta real
  // combina hoy anyTags+minProps en el mismo input, así que el catálogo productivo no puede
  // disparar 'wrong_material' todavía — este test ejercita el clasificador directamente.
  const longHandleRecipe: ContextActionDef = {
    id: "test_only_long_handle",
    label: "test",
    priority: 1,
    combinable: true,
    appliesTo: { kind: "self" },
    requirements: [],
    inputs: [
      { name: "handle", scope: ["hands"], match: { anyTags: ["handle_candidate"], minProps: { length: 5 } }, count: 1, consume: true, functionalHint: "algo largo para agarrar", functionalHintSharp: "una rama larga y firme" },
    ],
    effects: [{ type: "add_item", itemTypeId: "crude_tool", to: "inventory" }],
  };
  const fakeIndex: CatalogIndex = { ...index, actions: [longHandleRecipe] };
  const c = classifyCombination(s, fakeIndex, { kind: "tile", x: p.x, y: p.y }, "crouch");
  assert.equal(c.grade, "wrong_material");
});

// --- MANDATORY (amendment #2857): el gather del método "crouch" es POR TILE ---

test("classifyCombination (crouch): piezas en un tile ADYACENTE no cuentan para el tile examinado", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "small_stone", p.x, p.y);
  addOnGround(s, "dry_branch", p.x + 1, p.y); // adyacente (chebyshev 1) — NO debe sumarse
  const c = classifyCombination(s, index, { kind: "tile", x: p.x, y: p.y }, "crouch");
  assert.equal(c.grade, "nothing", "sólo 1 pieza vive en el tile examinado; la del tile adyacente no cuenta");
});

test("classifyCombination (crouch): las mismas piezas en el MISMO tile sí combinan", () => {
  const s = seedState(index, template);
  const p = s.player.position;
  addOnGround(s, "small_stone", p.x, p.y);
  addOnGround(s, "dry_branch", p.x, p.y);
  const c = classifyCombination(s, index, { kind: "tile", x: p.x, y: p.y }, "crouch");
  assert.equal(c.grade, "missing_functional_piece", "ambas piezas en el mismo tile examinado sí se cuentan juntas (sólo falta el binder)");
});
