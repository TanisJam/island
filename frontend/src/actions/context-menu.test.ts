import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, ItemInstance, Tile, WorldObject } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import type { Visibility } from "../state/visibility";
import type { ActionTarget } from "./available";
import { buildContextMenu, classifyProximity, type WireTargetRef } from "./context-menu";

const catalog: Catalog = {
  catalogVersion: "test",
  terrains: [{ id: "sand", name: "Arena", walkable: true, tags: ["ground"] }],
  items: [{ id: "seed", name: "Semilla", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: [] }],
  worldObjects: [{ id: "tree", name: "Árbol", description: "", tags: ["tree"], blocksMovement: true }],
  knowledge: [],
  actions: [
    {
      id: "search_sand",
      label: "Rebuscar en la arena",
      priority: 10,
      appliesTo: { kind: "tile", anyTerrain: ["sand"] },
      requirements: [{ type: "distance", max: 0 }],
      effects: [{ type: "add_thought", text: "Nada por aquí.", kind: "observation" }],
      thoughts: { preview: "a ver qué hay" },
    },
    {
      id: "pull_branches",
      label: "Arrancar ramas",
      priority: 20,
      appliesTo: { kind: "world_object", anyTags: ["tree"] },
      requirements: [{ type: "distance", max: 1 }],
      effects: [{ type: "add_thought", text: "Ceden algunas ramas.", kind: "observation" }],
    },
    {
      id: "reflect",
      label: "Reflexionar",
      priority: 5,
      appliesTo: { kind: "self" },
      requirements: [],
      effects: [{ type: "add_thought", text: "Pienso un poco.", kind: "observation" }],
    },
  ],
  research: [],
};

function makeTile(x: number, y: number, terrain: Tile["terrain"], walkable: boolean): Tile {
  return { x, y, terrain, walkable, tags: [], visibility: "visible" };
}

function makeSnapshot(overrides: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    zone: { id: "z1", width: 16, height: 12 },
    visionRadius: 5,
    tiles: [makeTile(5, 5, "sand", true)],
    objects: [],
    piles: [],
    items: [],
    player: { id: "p1", name: "Náufrago", position: { x: 5, y: 5 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
    ...overrides,
  };
}

// --- classifyProximity ---------------------------------------------------

test("classifyProximity: distance 0 is always self, regardless of visibility", () => {
  const s = makeSnapshot({ player: { ...makeSnapshot().player, position: { x: 5, y: 5 } } });
  assert.equal(classifyProximity(s, { x: 5, y: 5 }, "visible"), "self");
  assert.equal(classifyProximity(s, { x: 5, y: 5 }, "unseen"), "self");
});

test("classifyProximity: distance 1 (chebyshev, diagonal included) is adjacent", () => {
  const s = makeSnapshot();
  assert.equal(classifyProximity(s, { x: 6, y: 6 }, "visible"), "adjacent");
  assert.equal(classifyProximity(s, { x: 4, y: 5 }, "visible"), "adjacent");
});

test("classifyProximity: distance > 1 branches by visibility (visible/explored/unseen)", () => {
  const s = makeSnapshot();
  assert.equal(classifyProximity(s, { x: 10, y: 5 }, "visible"), "far-visible");
  assert.equal(classifyProximity(s, { x: 10, y: 5 }, "explored"), "penumbra");
  assert.equal(classifyProximity(s, { x: 10, y: 5 }, "unseen"), "unseen");
});

// --- buildContextMenu ------------------------------------------------------

function selfResolution(pos = { x: 5, y: 5 }): { preview: ActionTarget; wireRef: WireTargetRef; self: boolean } {
  return { preview: { kind: "tile", pos, tags: ["ground"], terrain: "sand" }, wireRef: { kind: "tile", x: pos.x, y: pos.y }, self: true };
}

test("buildContextMenu: self section always has the two ui items plus any self-target catalog actions", () => {
  const s = makeSnapshot();
  const menu = buildContextMenu(catalog, s, selfResolution(), "visible");
  const yo = menu.sections.find((sec) => sec.title === "Yo");
  assert.ok(yo, "a 'Yo' section is always present for self");
  const ids = yo!.items.map((i) => i.id);
  assert.ok(ids.includes("ui:inventory"));
  assert.ok(ids.includes("ui:thoughts"));
  assert.ok(ids.includes("reflect"), "self-target catalog action is included (future-proofing, even though today's real catalog has none)");
});

test("buildContextMenu: self also adds an 'Aquí' section from tile actions, and 'En el suelo' when floor items exist", () => {
  const s = makeSnapshot({ items: [{ id: "it1", itemTypeId: "seed", location: { type: "world", zoneId: "z1", x: 5, y: 5 } } as ItemInstance] });
  const menu = buildContextMenu(catalog, s, selfResolution(), "visible");
  const here = menu.sections.find((sec) => sec.title.startsWith("Aquí"));
  assert.ok(here, "tile action (search_sand, distance 0) produces an 'Aquí' section");
  assert.deepEqual(here!.items.map((i) => i.id), ["search_sand"]);

  const ground = menu.sections.find((sec) => sec.title === "En el suelo");
  assert.ok(ground, "floor items produce an 'En el suelo' section");
  assert.equal(ground!.items[0]?.command?.type, "TakeItem");
});

test("buildContextMenu: 'Decir algo' never appears anywhere in the self menu", () => {
  const s = makeSnapshot();
  const menu = buildContextMenu(catalog, s, selfResolution(), "visible");
  const allLabels = menu.sections.flatMap((sec) => sec.items.map((i) => i.label.toLowerCase()));
  assert.ok(!allLabels.some((l) => l.includes("decir algo")));
});

test("buildContextMenu: adjacent world_object gets catalog actions from computeAvailableActions, unmodified", () => {
  const s = makeSnapshot();
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 6, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: object.position, tags: ["tree"], object },
    wireRef: { kind: "world_object" as const, id: "wo1" },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  assert.equal(menu.sections.length, 1);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["pull_branches"]);
  assert.equal(menu.sections[0]?.items[0]?.command?.type, "ExecuteAction");
});

test("buildContextMenu: far walkable tile gets a move item labeled 'Ir hasta ahí' (walk there)", () => {
  const s = makeSnapshot({ tiles: [makeTile(5, 5, "sand", true), makeTile(10, 5, "sand", true)] });
  const resolution = {
    preview: { kind: "tile" as const, pos: { x: 10, y: 5 }, tags: ["ground"], terrain: "sand" as const },
    wireRef: { kind: "tile" as const, x: 10, y: 5 },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const move = menu.sections[0]?.items.find((i) => i.kind === "move");
  assert.ok(move, "walkable far tile gets a move item");
  assert.equal(move!.label, "Ir hasta ahí");
  assert.deepEqual(move!.command, { type: "MovePlayer", to: { x: 10, y: 5 } });
});

test("buildContextMenu: adjacent walkable tile gets a move item labeled 'Ir hasta acá'", () => {
  const s = makeSnapshot({ tiles: [makeTile(5, 5, "sand", true), makeTile(6, 5, "grass", true)] });
  const resolution = {
    preview: { kind: "tile" as const, pos: { x: 6, y: 5 }, tags: [], terrain: "grass" as const },
    wireRef: { kind: "tile" as const, x: 6, y: 5 },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const move = menu.sections[0]?.items.find((i) => i.kind === "move");
  assert.equal(move?.label, "Ir hasta acá");
});

test("buildContextMenu: non-walkable far tile gets no move item, only whatever catalog actions apply", () => {
  const s = makeSnapshot({ tiles: [makeTile(5, 5, "sand", true), makeTile(10, 5, "shallow_water", false)] });
  const resolution = {
    preview: { kind: "tile" as const, pos: { x: 10, y: 5 }, tags: [], terrain: "shallow_water" as const },
    wireRef: { kind: "tile" as const, x: 10, y: 5 },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  assert.ok(!menu.sections[0]?.items.some((i) => i.kind === "move"));
});

test("buildContextMenu: penumbra target gets a single dim move-only item", () => {
  const s = makeSnapshot();
  const resolution = {
    preview: { kind: "tile" as const, pos: { x: 10, y: 5 }, tags: [], terrain: "sand" as const },
    wireRef: { kind: "tile" as const, x: 10, y: 5 },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "explored");
  assert.equal(menu.sections.length, 1);
  assert.equal(menu.sections[0]?.dim, true);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.kind), ["move"]);
});

test("buildContextMenu: unseen target gets a single dim mute item that is never a disabled action", () => {
  const s = makeSnapshot();
  const resolution = {
    preview: { kind: "tile" as const, pos: { x: 10, y: 5 }, tags: [], terrain: "sand" as const },
    wireRef: { kind: "tile" as const, x: 10, y: 5 },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "unseen" as Visibility);
  assert.equal(menu.sections[0]?.dim, true);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.kind), ["mute"]);
  assert.equal(menu.sections[0]?.items[0]?.command, undefined);
});
