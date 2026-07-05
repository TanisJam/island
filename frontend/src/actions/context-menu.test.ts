import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalog, ItemInstance, Tile, WorldObject } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import type { Visibility } from "../state/visibility";
import type { ActionTarget } from "./available";
import { buildContextMenu, buildItemMenu, classifyProximity, dropTargetTile, firstFreeInventorySlot, itemOrigin, type WireTargetRef } from "./context-menu";

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

test("buildContextMenu: 'Descansar' (Rest) is offered in the 'Yo' section only when energy isn't full (crouch-crafting Slice E)", () => {
  const full = makeSnapshot(); // energy 100 === maxEnergy 100
  const fullYo = buildContextMenu(catalog, full, selfResolution(), "visible").sections.find((sec) => sec.title === "Yo")!;
  assert.ok(!fullYo.items.some((i) => i.id === "rest"), "no 'Descansar' at full energy — resting would be a no-op");

  const tired = makeSnapshot({ player: { ...makeSnapshot().player, energy: 40 } });
  const tiredYo = buildContextMenu(catalog, tired, selfResolution(), "visible").sections.find((sec) => sec.title === "Yo")!;
  const rest = tiredYo.items.find((i) => i.id === "rest");
  assert.ok(rest, "'Descansar' appears in the 'Yo' section when energy is below max");
  assert.equal(rest!.label, "Descansar");
  assert.equal(rest!.kind, "action");
  assert.deepEqual(rest!.command, { type: "Rest" });
});

test("buildContextMenu: bare self menu (no ground items on the player's own tile) never offers 'Examinar de cerca' (crouch-crafting rework: per-tile trigger, not a self affordance)", () => {
  const s = makeSnapshot();
  const menu = buildContextMenu(catalog, s, selfResolution(), "visible");
  const allIds = menu.sections.flatMap((sec) => sec.items.map((i) => i.id));
  assert.ok(!allIds.some((id) => id.startsWith("ui:crouch")), "no crouch option without loose ground items on the tile");
});

test("buildContextMenu: self also adds an 'Aquí' section from tile actions, and 'En el suelo' (with 'Examinar de cerca') when floor items exist", () => {
  const s = makeSnapshot({ items: [{ id: "it1", itemTypeId: "seed", location: { type: "world", zoneId: "z1", x: 5, y: 5 } } as ItemInstance] });
  const menu = buildContextMenu(catalog, s, selfResolution(), "visible");
  const here = menu.sections.find((sec) => sec.title.startsWith("Aquí"));
  assert.ok(here, "tile action (search_sand, distance 0) produces an 'Aquí' section");
  assert.deepEqual(here!.items.map((i) => i.id), ["search_sand"]);

  const ground = menu.sections.find((sec) => sec.title === "En el suelo");
  assert.ok(ground, "floor items produce an 'En el suelo' section");
  assert.equal(ground!.items.find((i) => i.command?.type === "TakeItem")?.command?.type, "TakeItem");

  const crouch = ground!.items.find((i) => i.uiIntent === "crouch");
  assert.ok(crouch, "the player's own tile with ground items offers 'Examinar de cerca' (crouch-crafting rework, per-tile trigger)");
  assert.equal(crouch!.label, "Examinar de cerca");
  assert.equal(crouch!.kind, "ui");
  assert.deepEqual(crouch!.crouchAt, { x: 5, y: 5 });
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

test("buildContextMenu: adjacent tile with a loose item offers a 'Recoger' (TakeItem) entry", () => {
  const s = makeSnapshot({
    tiles: [makeTile(5, 5, "sand", true), makeTile(6, 5, "sand", true)],
    items: [{ id: "it1", itemTypeId: "seed", location: { type: "world", zoneId: "z1", x: 6, y: 5 } } as ItemInstance],
  });
  const resolution = {
    preview: { kind: "tile" as const, pos: { x: 6, y: 5 }, tags: ["ground"], terrain: "sand" as const },
    wireRef: { kind: "tile" as const, x: 6, y: 5 },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const take = menu.sections[0]?.items.find((i) => i.id === "take:it1");
  assert.ok(take, "adjacent loose item offers a Recoger entry so the menu is never empty");
  assert.equal(take!.label, "Recoger");
  assert.deepEqual(take!.command, { type: "TakeItem", target: { kind: "item", id: "it1" } });
});

test("buildContextMenu: adjacent tile with a loose item also offers 'Examinar de cerca' carrying that tile's position (crouch-crafting rework: per-tile trigger, design.md Decision 2 superseded)", () => {
  const s = makeSnapshot({
    tiles: [makeTile(5, 5, "sand", true), makeTile(6, 5, "sand", true)],
    items: [{ id: "it1", itemTypeId: "seed", location: { type: "world", zoneId: "z1", x: 6, y: 5 } } as ItemInstance],
  });
  const resolution = {
    preview: { kind: "tile" as const, pos: { x: 6, y: 5 }, tags: ["ground"], terrain: "sand" as const },
    wireRef: { kind: "tile" as const, x: 6, y: 5 },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const crouch = menu.sections[0]?.items.find((i) => i.uiIntent === "crouch");
  assert.ok(crouch, "adjacent tile with ground items offers Examinar de cerca");
  assert.equal(crouch!.label, "Examinar de cerca");
  assert.equal(crouch!.kind, "ui");
  assert.deepEqual(crouch!.crouchAt, { x: 6, y: 5 });
});

test("buildContextMenu: adjacent tile WITHOUT loose items never offers 'Examinar de cerca'", () => {
  const s = makeSnapshot({ tiles: [makeTile(5, 5, "sand", true), makeTile(6, 5, "sand", true)] });
  const resolution = {
    preview: { kind: "tile" as const, pos: { x: 6, y: 5 }, tags: ["ground"], terrain: "sand" as const },
    wireRef: { kind: "tile" as const, x: 6, y: 5 },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  assert.ok(!menu.sections[0]?.items.some((i) => i.uiIntent === "crouch"), "no crouch option on an adjacent tile with no ground items");
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

test("buildContextMenu: far-visible world_object on a walkable tile still gets 'Acercarme' to an ADJACENT tile, never the object's own tile", () => {
  // Object at (10,5) sits on walkable ground (e.g. tall grass) — but
  // 'Acercarme' must never land the player ON TOP of it, only adjacent
  // (fix: "'Acercarme' must land on a tile ADJACENT to the object, never the
  // object's own tile").
  const s = makeSnapshot({ tiles: [makeTile(5, 5, "sand", true), makeTile(9, 5, "sand", true), makeTile(10, 5, "sand", true)] });
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 10, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: object.position, tags: ["tree"], object },
    wireRef: { kind: "world_object" as const, id: "wo1" },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const approach = menu.sections[0]?.items.find((i) => i.id === "move:approach");
  assert.ok(approach, "far-visible object with a walkable tile gets an Acercarme item");
  assert.equal(approach!.label, "Acercarme");
  assert.deepEqual(approach!.command, { type: "MovePlayer", to: { x: 9, y: 5 } }, "targets the adjacent walkable tile, never (10,5) itself");
  // The real catalog action (pull_branches applies to adjacent only, not far) is
  // correctly absent — this menu is ONLY the approach item, since `computeAvailableActions`
  // itself gates on distance and rejects it from this far away.
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["move:approach"]);
});

test("buildContextMenu: 'Acercarme' reaches a valid adjacent tile for a non-walkable object (tree/rock blocking its own tile)", () => {
  // A tree/rock's own tile is very often walkable TERRAIN (grass/sand) even
  // though the OBJECT itself blocks movement (`blocksMovement: true`,
  // tracked separately by the backend) — this client only sees terrain
  // walkability, so this case is indistinguishable from the previous test at
  // the terrain layer. It's covered separately to document the "trees and
  // rocks" scenario explicitly (fix: "'Acercarme' must work for trees and
  // rocks (non-walkable objects)") and pin the exact adjacent tile picked.
  const s = makeSnapshot({ tiles: [makeTile(5, 5, "sand", true), makeTile(9, 5, "grass", true), makeTile(10, 5, "grass", true)] });
  const tree: WorldObject = { id: "wo_tree", objectTypeId: "tree", position: { x: 10, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: tree.position, tags: ["tree"], object: tree },
    wireRef: { kind: "world_object" as const, id: "wo_tree" },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const approach = menu.sections[0]?.items.find((i) => i.id === "move:approach");
  assert.ok(approach, "a blocksMovement object still gets an Acercarme item targeting a reachable neighbor");
  assert.deepEqual(approach!.command, { type: "MovePlayer", to: { x: 9, y: 5 } });
});

test("buildContextMenu: far-visible object on a non-walkable tile still gets 'Acercarme' to the nearest walkable neighbor", () => {
  const s = makeSnapshot({
    tiles: [makeTile(5, 5, "sand", true), makeTile(10, 5, "shallow_water", false), makeTile(11, 5, "sand", true)],
  });
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 10, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: object.position, tags: ["tree"], object },
    wireRef: { kind: "world_object" as const, id: "wo1" },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const approach = menu.sections[0]?.items.find((i) => i.id === "move:approach");
  assert.ok(approach, "still offers Acercarme by walking to the nearest walkable neighbor tile");
  assert.deepEqual(approach!.command, { type: "MovePlayer", to: { x: 11, y: 5 } });
});

test("buildContextMenu: 'Acercarme' picks the walkable orthogonal neighbor NEAREST to the player, not the first in a fixed scan order", () => {
  // Object at (10,5) has two walkable orthogonal neighbors: (11,5) and (9,5).
  // The player at (5,5) is much closer to (9,5) — a fixed x+1-first scan
  // order would wrongly pick (11,5) (backend's pathfinding is 4-connected and
  // BFS-based, so the nearer, more-likely-connected side should win).
  const s = makeSnapshot({
    tiles: [
      makeTile(5, 5, "sand", true),
      makeTile(9, 5, "sand", true),
      makeTile(10, 5, "shallow_water", false),
      makeTile(11, 5, "sand", true),
    ],
  });
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 10, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: object.position, tags: ["tree"], object },
    wireRef: { kind: "world_object" as const, id: "wo1" },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const approach = menu.sections[0]?.items.find((i) => i.id === "move:approach");
  assert.ok(approach);
  assert.deepEqual(approach!.command, { type: "MovePlayer", to: { x: 9, y: 5 } });
});

test("buildContextMenu: 'Acercarme' prefers an orthogonal neighbor over a closer diagonal one (backend movement is 4-connected)", () => {
  // Object at (10,5): diagonal neighbor (9,4) is walkable and closer to the
  // player at (8,4), but the orthogonal neighbor (9,5) is also walkable —
  // orthogonal must win even though it's farther, because the backend BFS
  // (backend/src/domain/pathfinding.ts) only ever connects tiles orthogonally.
  const s = makeSnapshot({
    tiles: [
      makeTile(8, 4, "sand", true),
      makeTile(9, 4, "sand", true),
      makeTile(9, 5, "sand", true),
      makeTile(10, 5, "shallow_water", false),
    ],
    player: { ...makeSnapshot().player, position: { x: 8, y: 4 } },
  });
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 10, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: object.position, tags: ["tree"], object },
    wireRef: { kind: "world_object" as const, id: "wo1" },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const approach = menu.sections[0]?.items.find((i) => i.id === "move:approach");
  assert.ok(approach);
  assert.deepEqual(approach!.command, { type: "MovePlayer", to: { x: 9, y: 5 } });
});

test("buildContextMenu: 'Acercarme' falls back to a diagonal neighbor when no orthogonal neighbor is walkable", () => {
  const s = makeSnapshot({
    tiles: [
      makeTile(5, 5, "sand", true),
      makeTile(9, 4, "sand", true), // only walkable neighbor is diagonal
      makeTile(10, 5, "shallow_water", false),
    ],
  });
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 10, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: object.position, tags: ["tree"], object },
    wireRef: { kind: "world_object" as const, id: "wo1" },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  const approach = menu.sections[0]?.items.find((i) => i.id === "move:approach");
  assert.ok(approach, "falls back to the diagonal neighbor when it's the only walkable option");
  assert.deepEqual(approach!.command, { type: "MovePlayer", to: { x: 9, y: 4 } });
});

// --- "Usar la mesa" synthesis (crafting-surface change, R7/design.md 7d) ---

const surfaceCatalog: Catalog = {
  ...catalog,
  worldObjects: [
    ...catalog.worldObjects,
    { id: "rustic_table", name: "Mesa rústica", description: "", tags: [], blocksMovement: true, surfaceGrid: { w: 3, h: 2 } },
  ],
};

test("buildContextMenu: a world_object whose type declares surfaceGrid gets a 'Usar la mesa' entry", () => {
  const s = makeSnapshot();
  const table: WorldObject = { id: "wo_table", objectTypeId: "rustic_table", position: { x: 6, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: table.position, tags: [], object: table },
    wireRef: { kind: "world_object" as const, id: "wo_table" },
    self: false,
  };
  const menu = buildContextMenu(surfaceCatalog, s, resolution, "visible");
  const surfaceItem = menu.sections[0]?.items.find((i) => i.id === "ui:surface");
  assert.ok(surfaceItem, "a surfaceGrid-bearing object offers 'Usar la mesa'");
  assert.equal(surfaceItem!.label, "Usar la mesa");
  assert.equal(surfaceItem!.uiIntent, "surface");
  assert.equal(surfaceItem!.surfaceId, "wo_table");
});

test("buildContextMenu: a world_object whose type does NOT declare surfaceGrid never gets 'Usar la mesa'", () => {
  const s = makeSnapshot();
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 6, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: object.position, tags: ["tree"], object },
    wireRef: { kind: "world_object" as const, id: "wo1" },
    self: false,
  };
  const menu = buildContextMenu(surfaceCatalog, s, resolution, "visible");
  assert.ok(!menu.sections[0]?.items.some((i) => i.id === "ui:surface"));
});

test("buildContextMenu: adjacent world_object does NOT get an 'Acercarme' item (already close enough)", () => {
  const s = makeSnapshot();
  const object: WorldObject = { id: "wo1", objectTypeId: "tree", position: { x: 6, y: 5 }, state: {} };
  const resolution = {
    preview: { kind: "world_object" as const, pos: object.position, tags: ["tree"], object },
    wireRef: { kind: "world_object" as const, id: "wo1" },
    self: false,
  };
  const menu = buildContextMenu(catalog, s, resolution, "visible");
  assert.ok(!menu.sections[0]?.items.some((i) => i.id === "move:approach"));
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

// ---------------------------------------------------------------------------
// Per-item context menu (item-context-menu change): itemOrigin, buildItemMenu
// gating/ordering matrix (spec R2/R3), Rotar payloads (R6), firstFreeInventorySlot,
// Examinar fallback (R4.2), and dropTargetTile relocation parity.
// ---------------------------------------------------------------------------

const itemMenuCatalog: Catalog = {
  catalogVersion: "test",
  terrains: [{ id: "sand", name: "Arena", walkable: true, tags: ["ground"] }],
  items: [
    { id: "seed", name: "Semilla", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: [], observation: "Una semilla pequeña." },
    { id: "hacha", name: "Hacha", description: "", shape: { w: 1, h: 2 }, rotatable: true, properties: {}, tags: [], observation: "Un hacha filosa." },
    { id: "sin_obs", name: "Cosa sin nombre", description: "", shape: { w: 1, h: 1 }, rotatable: false, properties: {}, tags: [] },
  ],
  worldObjects: [],
  knowledge: [],
  actions: [],
  research: [],
};

/** 4x4 hand slots at (0,0)/(3,0) — matches the real backend `HAND_LEFT`/`HAND_RIGHT`
 * layout (backend/src/domain/inventory.ts), unlike the flat-list fixture above which
 * doesn't exercise the real inventory grid geometry. */
function makeItemSnapshot(overrides: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    zone: { id: "z1", width: 16, height: 12 },
    visionRadius: 5,
    tiles: [],
    objects: [],
    piles: [],
    items: [],
    player: { id: "p1", name: "Náufrago", position: { x: 5, y: 5 }, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, knowledge: [] },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 3, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "test",
    ...overrides,
  };
}

/** Fills every cell of the 4x4 player inventory with a 1x1 blocker EXCEPT
 * `freeCells`, so `firstFreeInventorySlot` tests can pin exact occupancy
 * without hand-rolling 16 fixtures per test. */
function fillInventoryExcept(freeCells: Array<{ x: number; y: number }>): ItemInstance[] {
  const items: ItemInstance[] = [];
  let id = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (freeCells.some((c) => c.x === x && c.y === y)) continue;
      items.push({ id: `blocker-${id++}`, itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x, y, rotation: 0 } });
    }
  }
  return items;
}

// --- itemOrigin -------------------------------------------------------------

test("itemOrigin: a player_inventory item NOT covering a hand slot is 'bag'", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  assert.equal(itemOrigin(item, itemMenuCatalog, s), "bag");
});

test("itemOrigin: a player_inventory item covering a hand slot is 'hand' (coversHand via inventoryCellsForItem)", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  assert.equal(itemOrigin(item, itemMenuCatalog, s), "hand");
});

test("itemOrigin: a surface item is 'surface' even at coordinates that would coincide with a hand slot (inventoryCellsForItem returns [] for non-inventory items)", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "surface", surfaceId: "table1", x: 0, y: 0, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  assert.equal(itemOrigin(item, itemMenuCatalog, s), "surface");
});

test("itemOrigin: a world item is not menu-eligible (null)", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "world", zoneId: "z1", x: 2, y: 2 } };
  const s = makeItemSnapshot({ items: [item] });
  assert.equal(itemOrigin(item, itemMenuCatalog, s), null);
});

// --- buildItemMenu: R2 gating matrix + R3 ordering, per origin -------------

test("buildItemMenu: bag origin, non-rotatable item -> [Equipar, Soltar, Examinar], no Rotar, Guardar never offered from bag", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["equipar", "soltar", "examinar"]);
  assert.ok(!menu.sections[0]?.items.some((i) => i.id === "guardar"), "Guardar is never offered for bag origin (R2)");
});

test("buildItemMenu: bag origin, rotatable item -> [Equipar, Rotar, Soltar, Examinar]", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "hacha", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["equipar", "rotar", "soltar", "examinar"]);
});

test("buildItemMenu: bag origin with both hands occupied -> Equipar is ABSENT (omitted at build time, not an unreachable rejection thought, spec R2.3)", () => {
  const bagItem: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const leftHandItem: ItemInstance = { id: "it2", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
  const rightHandItem: ItemInstance = { id: "it3", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 3, y: 0, rotation: 0 } };
  const s = makeItemSnapshot({ items: [bagItem, leftHandItem, rightHandItem] });
  const menu = buildItemMenu(bagItem, itemMenuCatalog, s);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["soltar", "examinar"], "Equipar simply omitted, remaining order unchanged");
});

test("buildItemMenu: hand origin never offers Rotar even for a rotatable item (D4) -> [Guardar, Soltar, Examinar]", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "hacha", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["guardar", "soltar", "examinar"]);
});

test("buildItemMenu: hand origin, every OTHER cell occupied -> Guardar is still present, targeting the item's own current cell (exceptId excludes it from the occupied set, so it's the one slot always technically free for its own occupant)", () => {
  const handItem: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
  const blockers = fillInventoryExcept([{ x: 0, y: 0 }]);
  const s = makeItemSnapshot({ items: [handItem, ...blockers] });
  const menu = buildItemMenu(handItem, itemMenuCatalog, s);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["guardar", "soltar", "examinar"]);
  const guardar = menu.sections[0]?.items.find((i) => i.id === "guardar");
  assert.deepEqual(guardar?.command, { type: "MoveItem", itemInstanceId: "it1", to: { type: "inventory", ownerId: "p1", x: 0, y: 0, rotation: 0 } });
});

test("buildItemMenu: mesa origin, non-rotatable item -> [Guardar, Equipar, Examinar], Soltar unconditionally absent", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "surface", surfaceId: "table1", x: 0, y: 0, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["guardar", "equipar", "examinar"]);
  assert.ok(!menu.sections[0]?.items.some((i) => i.id === "soltar"), "Soltar is NEVER offered for mesa origin (R2.4/R7.3)");
});

test("buildItemMenu: mesa origin, rotatable item -> [Guardar, Rotar, Equipar, Examinar] (D2/D5 resolved: Equipar included on mesa)", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "hacha", location: { type: "surface", surfaceId: "table1", x: 0, y: 0, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["guardar", "rotar", "equipar", "examinar"]);
});

test("buildItemMenu: mesa origin with both hands occupied -> Equipar ABSENT, Soltar still absent", () => {
  const mesaItem: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "surface", surfaceId: "table1", x: 0, y: 0, rotation: 0 } };
  const leftHandItem: ItemInstance = { id: "it2", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
  const rightHandItem: ItemInstance = { id: "it3", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 3, y: 0, rotation: 0 } };
  const s = makeItemSnapshot({ items: [mesaItem, leftHandItem, rightHandItem] });
  const menu = buildItemMenu(mesaItem, itemMenuCatalog, s);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["guardar", "examinar"]);
});

test("buildItemMenu: mesa origin, inventory completely full -> Guardar AND Equipar both absent (only Examinar left for a non-rotatable item)", () => {
  const mesaItem: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "surface", surfaceId: "table1", x: 0, y: 0, rotation: 0 } };
  const blockers = fillInventoryExcept([]);
  const s = makeItemSnapshot({ items: [mesaItem, ...blockers] });
  const menu = buildItemMenu(mesaItem, itemMenuCatalog, s);
  assert.deepEqual(menu.sections[0]?.items.map((i) => i.id), ["examinar"]);
});

// --- Equipar payload (first free hand) --------------------------------------

test("buildItemMenu: Equipar targets the first free hand (left before right)", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  const equipar = menu.sections[0]?.items.find((i) => i.id === "equipar");
  assert.deepEqual(equipar?.command, { type: "MoveItem", itemInstanceId: "it1", to: { type: "hand", hand: "left" } });
});

test("buildItemMenu: Equipar targets the right hand when the left is already occupied", () => {
  const bagItem: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const leftHandItem: ItemInstance = { id: "it2", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 0, y: 0, rotation: 0 } };
  const s = makeItemSnapshot({ items: [bagItem, leftHandItem] });
  const menu = buildItemMenu(bagItem, itemMenuCatalog, s);
  const equipar = menu.sections[0]?.items.find((i) => i.id === "equipar");
  assert.deepEqual(equipar?.command, { type: "MoveItem", itemInstanceId: "it1", to: { type: "hand", hand: "right" } });
});

// --- Soltar payload (dropTargetTile reuse) ----------------------------------

test("buildItemMenu: Soltar dispatches DropItem to dropTargetTile(snapshot)'s heuristic target", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeItemSnapshot({
    items: [item],
    tiles: [makeTile(5, 5, "sand", false), makeTile(6, 5, "sand", true)],
  });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  const soltar = menu.sections[0]?.items.find((i) => i.id === "soltar");
  assert.deepEqual(soltar?.command, { type: "DropItem", itemInstanceId: "it1", to: { x: 6, y: 5 } });
});

// --- Rotar payload (R6.1/R6.2) — own toggle logic, both directions ----------

test("buildItemMenu: Rotar toggles inventory rotation 0 -> 90", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "hacha", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  const rotar = menu.sections[0]?.items.find((i) => i.id === "rotar");
  assert.deepEqual(rotar?.command, { type: "MoveItem", itemInstanceId: "it1", to: { type: "inventory", ownerId: "p1", x: 1, y: 1, rotation: 90 } });
});

test("buildItemMenu: Rotar toggles inventory rotation 90 -> 0", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "hacha", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 90 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  const rotar = menu.sections[0]?.items.find((i) => i.id === "rotar");
  assert.deepEqual(rotar?.command, { type: "MoveItem", itemInstanceId: "it1", to: { type: "inventory", ownerId: "p1", x: 1, y: 1, rotation: 0 } });
});

test("buildItemMenu: Rotar toggles surface rotation 0 -> 90", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "hacha", location: { type: "surface", surfaceId: "table1", x: 2, y: 0, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  const rotar = menu.sections[0]?.items.find((i) => i.id === "rotar");
  assert.deepEqual(rotar?.command, { type: "MoveItem", itemInstanceId: "it1", to: { type: "surface", surfaceId: "table1", x: 2, y: 0, rotation: 90 } });
});

test("buildItemMenu: Rotar toggles surface rotation 90 -> 0", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "hacha", location: { type: "surface", surfaceId: "table1", x: 2, y: 0, rotation: 90 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  const rotar = menu.sections[0]?.items.find((i) => i.id === "rotar");
  assert.deepEqual(rotar?.command, { type: "MoveItem", itemInstanceId: "it1", to: { type: "surface", surfaceId: "table1", x: 2, y: 0, rotation: 0 } });
});

// --- firstFreeInventorySlot --------------------------------------------------

test("firstFreeInventorySlot: fits rotation 0 first when it fits, without trying rotation 90", () => {
  const s = makeItemSnapshot({ items: [] }); // fully empty 4x4, hands at (0,0)/(3,0)
  const candidate: ItemInstance = { id: "candidate", itemTypeId: "hacha", location: { type: "world", zoneId: "z1", x: 0, y: 0 } };
  const slot = firstFreeInventorySlot(s, itemMenuCatalog, candidate);
  assert.deepEqual(slot, { x: 1, y: 0, rotation: 0 }, "first non-hand cell where a 1x2 vertical footprint fits");
});

test("firstFreeInventorySlot: falls back to rotation 90 when rotation 0 fits nowhere in the grid", () => {
  // Only (2,3) and (3,3) are free — no vertical 1x2 pair fits anywhere (every
  // (x,y)/(x,y+1) pair has at least one occupied cell), but the horizontal
  // 2x1 pair at (2,3)-(3,3) does.
  const blockers = fillInventoryExcept([{ x: 2, y: 3 }, { x: 3, y: 3 }]);
  const s = makeItemSnapshot({ items: blockers });
  const candidate: ItemInstance = { id: "candidate", itemTypeId: "hacha", location: { type: "world", zoneId: "z1", x: 0, y: 0 } };
  const slot = firstFreeInventorySlot(s, itemMenuCatalog, candidate);
  assert.deepEqual(slot, { x: 2, y: 3, rotation: 90 });
});

test("firstFreeInventorySlot: excludes the item's OWN currently-occupied cells (exceptId) so re-stowing doesn't collide with itself", () => {
  const ownHacha: ItemInstance = { id: "it-hacha-self", itemTypeId: "hacha", location: { type: "player_inventory", playerId: "p1", x: 0, y: 1, rotation: 0 } };
  const blockers = fillInventoryExcept([{ x: 0, y: 1 }, { x: 0, y: 2 }]);
  const s = makeItemSnapshot({ items: [ownHacha, ...blockers] });
  const slot = firstFreeInventorySlot(s, itemMenuCatalog, ownHacha);
  assert.deepEqual(slot, { x: 0, y: 1, rotation: 0 }, "the item's own two cells are excluded from the occupied set, so its current slot is reported free");
});

test("firstFreeInventorySlot: returns null when the entire 4x4 grid is occupied by other items", () => {
  const blockers = fillInventoryExcept([]);
  const s = makeItemSnapshot({ items: blockers });
  const candidate: ItemInstance = { id: "candidate", itemTypeId: "seed", location: { type: "world", zoneId: "z1", x: 0, y: 0 } };
  assert.equal(firstFreeInventorySlot(s, itemMenuCatalog, candidate), null);
});

// --- Examinar fallback (R4.2) ------------------------------------------------

test("buildItemMenu: Examinar uses the catalog's authored observation text, no Command attached", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "seed", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  const examinar = menu.sections[0]?.items.find((i) => i.id === "examinar");
  assert.equal(examinar?.kind, "info");
  assert.equal(examinar?.thought, "Una semilla pequeña.");
  assert.equal(examinar?.command, undefined, "Examinar is client-only, never dispatches a Command (R4.1)");
});

test("buildItemMenu: Examinar falls back to a generic thought when the catalog def has no authored observation (R4.2, synthetic fixture — no current catalog item exercises this)", () => {
  const item: ItemInstance = { id: "it1", itemTypeId: "sin_obs", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };
  const s = makeItemSnapshot({ items: [item] });
  const menu = buildItemMenu(item, itemMenuCatalog, s);
  const examinar = menu.sections[0]?.items.find((i) => i.id === "examinar");
  assert.equal(examinar?.thought, "Veo Cosa sin nombre de cerca.");
});

// --- dropTargetTile relocation parity ---------------------------------------

test("dropTargetTile: returns the first walkable orthogonal neighbor of the player", () => {
  const s = makeItemSnapshot({ tiles: [makeTile(5, 5, "sand", false), makeTile(6, 5, "sand", true), makeTile(4, 5, "sand", true)] });
  assert.deepEqual(dropTargetTile(s), { x: 6, y: 5 });
});

test("dropTargetTile: falls back to the player's own tile when no orthogonal neighbor is walkable", () => {
  const s = makeItemSnapshot({ tiles: [] }); // no tiles at all => no neighbor found walkable
  assert.deepEqual(dropTargetTile(s), { x: 5, y: 5 });
});
