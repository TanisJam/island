import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemInstance, Tile, WorldObject } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { createStore } from "../state/store";
import { visibilityOf } from "../state/visibility";
import { createViewState, MOVE_MS, type RenderEntity } from "./viewstate";

function makeTile(x: number, y: number, terrain: Tile["terrain"] = "grass", walkable = true): Tile {
  return { x, y, terrain, walkable, tags: ["ground"], visibility: "visible" };
}

function makeSnapshot(overrides: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    zone: { id: "z1", width: 16, height: 12 },
    visionRadius: 5,
    tiles: [makeTile(8, 9), makeTile(30, 30)],
    objects: [],
    piles: [],
    items: [],
    player: {
      id: "p1",
      name: "Náufrago",
      position: { x: 8, y: 9 },
      energy: 100,
      maxEnergy: 100,
      health: 100,
      maxHealth: 100,
      knowledge: [],
    },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 3, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "v1",
    ...overrides,
  };
}

function findPlayer(entities: RenderEntity[], playerId = "p1"): RenderEntity {
  return entities.find((e) => e.id === playerId)!;
}

test("frame(): new entities spawn at the authoritative position with no tween", () => {
  const store = createStore(makeSnapshot());
  const vs = createViewState(store);
  const player = findPlayer(vs.frame().entities);
  assert.deepEqual(player.renderPos, { x: 8, y: 9 });
});

test("update(): lerps renderPos toward the target across MOVE_MS, landing exactly on target", () => {
  const store = createStore(makeSnapshot());
  const vs = createViewState(store);

  store.ingest([{ type: "PlayerMoved", playerId: "p1", path: [{ x: 9, y: 9 }], position: { x: 9, y: 9 } }]);

  vs.update(MOVE_MS / 2);
  const mid = findPlayer(vs.frame().entities);
  assert.equal(mid.renderPos.x, 8.5, "smoothstep ease is symmetric: t=0.5 midway in time is midway in space");
  assert.equal(mid.renderPos.y, 9);

  vs.update(MOVE_MS / 2);
  const end = findPlayer(vs.frame().entities);
  assert.deepEqual(end.renderPos, { x: 9, y: 9 });
});

test("sync(): a mid-tween redirect sets fromPos to the current renderPos (no snap)", () => {
  const store = createStore(makeSnapshot());
  const vs = createViewState(store);

  // Start a tween 8,9 -> 9,9.
  store.ingest([{ type: "PlayerMoved", playerId: "p1", path: [{ x: 9, y: 9 }], position: { x: 9, y: 9 } }]);
  vs.update(MOVE_MS / 2);
  const midway = findPlayer(vs.frame().entities).renderPos;
  assert.ok(midway.x > 8 && midway.x < 9, "player is mid-tween before the redirect");

  // Redirect before the first tween finishes: 9,9 -> 9,10.
  store.ingest([{ type: "PlayerMoved", playerId: "p1", path: [{ x: 9, y: 10 }], position: { x: 9, y: 10 } }]);

  // Immediately after the redirect, elapsed=0 so renderPos == fromPos, which
  // MUST be the midway point captured just before the redirect — never a
  // snap back to the previous target (9,9) nor to the original start (8,9).
  const rightAfterRedirect = findPlayer(vs.frame().entities).renderPos;
  assert.deepEqual(rightAfterRedirect, midway);

  // Advancing time now moves FROM the midway point TOWARD the new target.
  vs.update(MOVE_MS);
  const afterFullTween = findPlayer(vs.frame().entities).renderPos;
  assert.deepEqual(afterFullTween, { x: 9, y: 10 });
});

test("reconcile: entities are added and removed as they appear/disappear in the snapshot", () => {
  const obj: WorldObject = { id: "wo_1", objectTypeId: "tree", position: { x: 2, y: 2 }, state: {} };
  const store = createStore(makeSnapshot({ objects: [obj] }));
  const vs = createViewState(store);

  assert.ok(vs.frame().entities.some((e) => e.id === "wo_1"), "object present after initial sync");

  vs.sync(makeSnapshot({ objects: [] }));
  assert.ok(!vs.frame().entities.some((e) => e.id === "wo_1"), "object removed once absent from the snapshot");

  const obj2: WorldObject = { id: "wo_2", objectTypeId: "tree", position: { x: 3, y: 3 }, state: {} };
  vs.sync(makeSnapshot({ objects: [obj2] }));
  assert.ok(vs.frame().entities.some((e) => e.id === "wo_2"), "newly added object appears");
});

test("reconcile: world items already grouped into a pile do not get their own entity", () => {
  const item: ItemInstance = { id: "it_1", itemTypeId: "small_stone", location: { type: "world", zoneId: "z1", x: 5, y: 5 } };
  const store = createStore(
    makeSnapshot({
      items: [item],
      piles: [{ id: "pile_1", itemTypeId: "small_stone", zoneId: "z1", position: { x: 5, y: 5 }, itemInstanceIds: ["it_1", "it_2"] }],
    }),
  );
  const vs = createViewState(store);
  const entities = vs.frame().entities;

  assert.ok(entities.some((e) => e.id === "pile_1" && e.kind === "pile" && e.count === 2));
  assert.ok(!entities.some((e) => e.id === "it_1"), "the piled item does not get a separate item entity");
});

test("frame().tiles: visibility matches visibilityOf for every tile", () => {
  const snapshot = makeSnapshot();
  const store = createStore(snapshot);
  const vs = createViewState(store);

  const frame = vs.frame();
  for (const tile of frame.tiles) {
    assert.equal(tile.visibility, visibilityOf(snapshot, { x: tile.x, y: tile.y }));
  }
  // Sanity: the far tile (30,30) is out of vision range and never discovered.
  assert.equal(frame.tiles.find((t) => t.x === 30 && t.y === 30)!.visibility, "unseen");
});

// NOTE: `PlayerMoved.path` (already on the wire) carries waypoints for
// multi-tile moves. This baseline intentionally uses a straight-line lerp
// from the previous renderPos to the new authoritative position and does not
// tween through intermediate waypoints — deferred as a follow-up per
// design.md "Open Questions".
