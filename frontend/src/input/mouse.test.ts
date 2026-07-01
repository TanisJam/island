import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog } from "../contract";
import { classifyClick, describeSelection, resolveClickDecision } from "./mouse";

/**
 * `classifyClick`, `resolveClickDecision` and `describeSelection` are the
 * PURE decisions behind the SELECT-FIRST click model (fix-list: "1 click
 * selects, re-click on the already-selected tile opens the menu, double
 * click moves"): `onCanvasClick` is otherwise DOM/canvas-heavy and only gets
 * smoke coverage by design (see window-manager.test.ts's docstring for the
 * same pattern) — these are the actual decisions that get real unit tests.
 */

const THRESHOLD = 280;

test("classifyClick: single when there is no prior click", () => {
  assert.equal(classifyClick(1000, null, { x: 5, y: 5 }, null, THRESHOLD), "single");
});

test("classifyClick: double when the second click lands on the same tile within the threshold", () => {
  assert.equal(classifyClick(1200, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "double");
});

test("classifyClick: double at exactly the threshold boundary (inclusive)", () => {
  assert.equal(classifyClick(1000 + THRESHOLD, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "double");
});

test("classifyClick: single when the second click arrives after the threshold", () => {
  assert.equal(classifyClick(1000 + THRESHOLD + 1, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "single");
});

test("classifyClick: single when the second click lands on a DIFFERENT tile, even if fast", () => {
  assert.equal(classifyClick(1050, 1000, { x: 6, y: 5 }, { x: 5, y: 5 }, THRESHOLD), "single");
});

test("classifyClick: uses the default threshold when none is passed", () => {
  assert.equal(classifyClick(1100, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }), "double");
  assert.equal(classifyClick(1000 + 10_000, 1000, { x: 5, y: 5 }, { x: 5, y: 5 }), "single");
});

// --- resolveClickDecision (SELECT-FIRST model) ---------------------------

test("resolveClickDecision: a double click on a walkable tile always moves, regardless of selection", () => {
  assert.equal(resolveClickDecision("double", { x: 5, y: 5 }, null, true), "move");
  assert.equal(resolveClickDecision("double", { x: 5, y: 5 }, { x: 5, y: 5 }, true), "move");
});

test("resolveClickDecision: a double click on a NON-walkable tile degrades to a single (never a failed move)", () => {
  // Nothing selected yet -> selects, exactly like a genuine single would.
  assert.equal(resolveClickDecision("double", { x: 5, y: 5 }, null, false), "select");
  // Already selected -> opens the menu, exactly like a genuine single would.
  assert.equal(resolveClickDecision("double", { x: 5, y: 5 }, { x: 5, y: 5 }, false), "menu");
});

test("resolveClickDecision: a single click with nothing selected yet just selects", () => {
  assert.equal(resolveClickDecision("single", { x: 5, y: 5 }, null, true), "select");
  assert.equal(resolveClickDecision("single", { x: 5, y: 5 }, null, false), "select");
});

test("resolveClickDecision: a single click on a DIFFERENT tile than the current selection moves the selection there (no menu)", () => {
  assert.equal(resolveClickDecision("single", { x: 6, y: 5 }, { x: 5, y: 5 }, true), "select");
});

test("resolveClickDecision: a single click on the ALREADY-selected tile opens the menu", () => {
  assert.equal(resolveClickDecision("single", { x: 5, y: 5 }, { x: 5, y: 5 }, true), "menu");
  assert.equal(resolveClickDecision("single", { x: 5, y: 5 }, { x: 5, y: 5 }, false), "menu");
});

// --- describeSelection (inspect thought on select) ------------------------

const catalog: Catalog = {
  catalogVersion: "test",
  terrains: [{ id: "sand", name: "Arena", walkable: true, tags: ["ground"] }],
  items: [{ id: "seed", name: "Semilla", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: [] }],
  worldObjects: [{ id: "tree", name: "Árbol", description: "", tags: ["tree"], blocksMovement: true }],
  knowledge: [],
  actions: [],
  research: [],
};

test("describeSelection: a world object reads 'Veo {nombre}.'", () => {
  const resolved = {
    key: "wo:o1",
    wireRef: { kind: "world_object" as const, id: "o1" },
    preview: {
      kind: "world_object" as const,
      pos: { x: 5, y: 5 },
      tags: ["tree"],
      object: { id: "o1", objectTypeId: "tree", position: { x: 5, y: 5 }, tags: [], state: {} },
    },
    walkable: false,
  };
  assert.equal(describeSelection(catalog, resolved), "Veo Árbol.");
});

test("describeSelection: a loose ground item reads 'Veo {nombre} en el suelo.'", () => {
  const resolved = {
    key: "item:i1",
    wireRef: { kind: "item" as const, id: "i1" },
    preview: {
      kind: "item" as const,
      pos: { x: 5, y: 5 },
      tags: [],
      item: { id: "i1", itemTypeId: "seed", location: { type: "world" as const, zoneId: "z1", x: 5, y: 5 } },
    },
    walkable: false,
  };
  assert.equal(describeSelection(catalog, resolved), "Veo Semilla en el suelo.");
});

test("describeSelection: a bare tile reads '{Terreno}.'", () => {
  const resolved = {
    key: "tile:5,5",
    wireRef: { kind: "tile" as const, x: 5, y: 5 },
    preview: { kind: "tile" as const, pos: { x: 5, y: 5 }, tags: [], terrain: "sand" as const },
    walkable: true,
  };
  assert.equal(describeSelection(catalog, resolved), "Arena.");
});
