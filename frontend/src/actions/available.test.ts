import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, ItemInstance, Position, WorldObject } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { computeAvailableActions, type ActionTarget } from "./available";

const HAND_LEFT = { x: 0, y: 0 };
const HAND_RIGHT = { x: 3, y: 0 };

// `observe_tree_closely` carries no hand/energy requirement at all — its only job
// in this fixture is letting tests prove `pull_branches` and `cut_tree_crude` (which
// are mutually exclusive on hand state) still sort correctly against a third action
// that always qualifies whenever in range.
const catalog: Catalog = {
  catalogVersion: "test",
  terrains: [{ id: "sand", name: "Arena", walkable: true, tags: ["ground"] }],
  items: [
    { id: "small_stone", name: "Piedra", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: { hardness: 2 }, tags: ["stone"] },
    { id: "crude_tool", name: "Herramienta rudimentaria", description: "", shape: { w: 1, h: 2 }, rotatable: true, properties: { cutting: 1 }, tags: ["tool", "cutting"] },
  ],
  worldObjects: [{ id: "tree", name: "Árbol", description: "", tags: ["tree"], blocksMovement: true }],
  knowledge: [],
  actions: [
    {
      id: "pull_branches",
      label: "Arrancar ramas",
      priority: 20,
      appliesTo: { kind: "world_object", anyTags: ["tree"] },
      requirements: [
        { type: "distance", max: 1 },
        { type: "hand_empty", slot: "any" },
        { type: "energy", min: 1 },
      ],
      effects: [{ type: "consume_energy", amount: 1 }],
    },
    {
      id: "cut_tree_crude",
      label: "Cortar madera pobre",
      priority: 50,
      appliesTo: { kind: "world_object", anyTags: ["tree"] },
      requirements: [
        { type: "distance", max: 1 },
        { type: "hand", slot: "any", minProps: { cutting: 1 } },
        { type: "energy", min: 3 },
      ],
      effects: [{ type: "consume_energy", amount: 3 }],
    },
    {
      id: "observe_tree_closely",
      label: "Mirar más de cerca",
      priority: 35,
      appliesTo: { kind: "world_object", anyTags: ["tree"] },
      requirements: [{ type: "distance", max: 1 }],
      effects: [{ type: "add_thought", text: "Lo veo mejor de cerca.", kind: "observation" }],
    },
  ],
  research: [],
};

function makeSnapshot(overrides: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    zone: { id: "z1", width: 16, height: 12 },
    visionRadius: 5,
    tiles: [],
    objects: [],
    piles: [],
    items: [],
    player: { id: "p1", name: "Náufrago", position: { x: 5, y: 5 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
    handSlots: { left: HAND_LEFT, right: HAND_RIGHT },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
    ...overrides,
  };
}

function treeTarget(pos: Position = { x: 5, y: 6 }): ActionTarget {
  const object: WorldObject = { id: "wo_tree", objectTypeId: "tree", position: pos, state: {} };
  return { kind: "world_object", pos, tags: ["tree"], object };
}

function handItem(itemTypeId: string, slot: Position): ItemInstance {
  return { id: `it_${itemTypeId}_${slot.x}_${slot.y}`, itemTypeId, location: { type: "player_inventory", playerId: "p1", x: slot.x, y: slot.y, rotation: 0 } };
}

test("empty hands, in range, enough energy: hand_empty and no-requirement actions both qualify, sorted by priority desc", () => {
  const s = makeSnapshot();
  const result = computeAvailableActions(catalog, treeTarget(), s);
  assert.deepEqual(result.map((a) => a.id), ["observe_tree_closely", "pull_branches"]);
});

test("unmet requirement excluded: hand_empty action drops out once both hands are occupied", () => {
  const s = makeSnapshot({ items: [handItem("small_stone", HAND_LEFT), handItem("small_stone", HAND_RIGHT)] });
  const result = computeAvailableActions(catalog, treeTarget(), s);
  assert.ok(!result.some((a) => a.id === "pull_branches"), "hand_empty action excluded when both hands occupied");
});

test("hand requirement with minProps is satisfied once a matching tool is equipped, and sorts above the unconditional action", () => {
  const s = makeSnapshot({ items: [handItem("crude_tool", HAND_RIGHT)] });
  const result = computeAvailableActions(catalog, treeTarget(), s);
  // pull_branches excluded (hand_empty unmet — right hand occupied by the tool);
  // cut_tree_crude included (hand minProps.cutting satisfied by crude_tool) and
  // outranks observe_tree_closely (priority 50 > 35).
  assert.deepEqual(result.map((a) => a.id), ["cut_tree_crude", "observe_tree_closely"]);
});

test("distance requirement excludes every action when the target is out of range", () => {
  const s = makeSnapshot({ player: { id: "p1", name: "Náufrago", position: { x: 0, y: 0 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] } });
  const result = computeAvailableActions(catalog, treeTarget({ x: 10, y: 10 }), s);
  assert.deepEqual(result, []);
});

test("energy requirement excludes the action when energy is below the minimum", () => {
  const s = makeSnapshot({
    items: [handItem("crude_tool", HAND_RIGHT)],
    player: { id: "p1", name: "Náufrago", position: { x: 5, y: 5 }, energy: 2, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
  });
  const result = computeAvailableActions(catalog, treeTarget(), s);
  assert.ok(!result.some((a) => a.id === "cut_tree_crude"), "excluded: energy 2 < required 3");
  assert.deepEqual(result.map((a) => a.id), ["observe_tree_closely"], "the unconditional action still qualifies");
});

test("appliesTo selector excludes actions whose target kind/tags don't match", () => {
  const tileTarget: ActionTarget = { kind: "tile", pos: { x: 5, y: 6 }, tags: ["ground"], terrain: "sand" };
  const result = computeAvailableActions(catalog, tileTarget, makeSnapshot());
  assert.deepEqual(result, [], "no tile-targeted actions exist in this catalog fixture");
});
