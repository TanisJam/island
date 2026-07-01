import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemInstance, Tile, WorldObject } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { createStore } from "../state/store";
import { visibilityOf } from "../state/visibility";
import { createViewState, MS_PER_TILE, type RenderEntity } from "./viewstate";

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

test("update(): lerps renderPos toward the target across a 1-tile move's duration (MS_PER_TILE), landing exactly on target", () => {
  const store = createStore(makeSnapshot());
  const vs = createViewState(store);

  store.ingest([{ type: "PlayerMoved", playerId: "p1", path: [{ x: 9, y: 9 }], position: { x: 9, y: 9 } }]);

  vs.update(MS_PER_TILE / 2);
  const mid = findPlayer(vs.frame().entities);
  assert.equal(mid.renderPos.x, 8.5, "smoothstep ease is symmetric: t=0.5 midway in time is midway in space");
  assert.equal(mid.renderPos.y, 9);

  vs.update(MS_PER_TILE / 2);
  const end = findPlayer(vs.frame().entities);
  assert.deepEqual(end.renderPos, { x: 9, y: 9 });
});

test("update(): tween duration scales with tile distance — a farther move takes proportionally longer to complete", () => {
  const store = createStore(makeSnapshot());
  const vs = createViewState(store);

  // A 1-tile move fully completes within exactly MS_PER_TILE.
  store.ingest([{ type: "PlayerMoved", playerId: "p1", path: [{ x: 9, y: 9 }], position: { x: 9, y: 9 } }]);
  vs.update(MS_PER_TILE);
  assert.deepEqual(findPlayer(vs.frame().entities).renderPos, { x: 9, y: 9 }, "1-tile move is done after MS_PER_TILE");

  // A 5-tile straight-line move ("ir hasta ahí") must NOT be done yet at
  // that same elapsed time — constant per-tile speed means more distance
  // takes proportionally more time, not the same fixed duration.
  store.ingest([{ type: "PlayerMoved", playerId: "p1", path: [{ x: 14, y: 9 }], position: { x: 14, y: 9 } }]);
  vs.update(MS_PER_TILE);
  const midFar = findPlayer(vs.frame().entities).renderPos;
  assert.notDeepEqual(midFar, { x: 14, y: 9 }, "a 5-tile move takes longer than a 1-tile move to complete");
  assert.ok(midFar.x > 9 && midFar.x < 14, "still mid-tween toward the far target");

  // ...but it does finish once enough time has elapsed for its own (longer) duration.
  vs.update(5 * MS_PER_TILE);
  assert.deepEqual(findPlayer(vs.frame().entities).renderPos, { x: 14, y: 9 }, "5-tile move eventually lands exactly on target");
});

test("update(): very long treks are capped — duration never grows unbounded with distance", () => {
  const store = createStore(makeSnapshot({ tiles: [{ x: 8, y: 9, terrain: "grass", walkable: true, tags: ["ground"], visibility: "visible" }] }));
  const vs = createViewState(store);

  // A 50-tile move: at MS_PER_TILE-per-tile with no cap this would take
  // 5000ms+ — the cap means it's fully done well before that.
  store.ingest([{ type: "PlayerMoved", playerId: "p1", path: [{ x: 58, y: 9 }], position: { x: 58, y: 9 } }]);
  vs.update(700); // comfortably above MAX_TWEEN_MS (600), well under an uncapped 50 * MS_PER_TILE
  assert.deepEqual(findPlayer(vs.frame().entities).renderPos, { x: 58, y: 9 }, "capped duration means even a very long trek finishes quickly");
});

test("sync(): a mid-tween redirect sets fromPos to the current renderPos (no snap)", () => {
  const store = createStore(makeSnapshot());
  const vs = createViewState(store);

  // Start a tween 8,9 -> 9,9.
  store.ingest([{ type: "PlayerMoved", playerId: "p1", path: [{ x: 9, y: 9 }], position: { x: 9, y: 9 } }]);
  vs.update(MS_PER_TILE / 2);
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
  vs.update(MS_PER_TILE);
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

// --- 7th playtest fix pass: path-waypoint tweening + vision-follows-avatar ---

test("update(): tweens through EACH waypoint of PlayerMoved.path in order, not a straight-line lerp to the destination", () => {
  const store = createStore(makeSnapshot());
  const vs = createViewState(store);

  // (8,9) -> (9,9) -> (9,10): an L-shaped route. A straight-line lerp from
  // (8,9) to (9,10) at the halfway POINT IN TIME would land at (8.5, 9.5) —
  // off the actual path entirely. Following the path instead means the first
  // leg completes exactly AT the intermediate waypoint (9,9).
  store.ingest([
    { type: "PlayerMoved", playerId: "p1", path: [{ x: 9, y: 9 }, { x: 9, y: 10 }], position: { x: 9, y: 10 } },
  ]);

  vs.update(MS_PER_TILE);
  assert.deepEqual(findPlayer(vs.frame().entities).renderPos, { x: 9, y: 9 }, "first leg lands exactly on the intermediate waypoint");

  vs.update(MS_PER_TILE);
  assert.deepEqual(findPlayer(vs.frame().entities).renderPos, { x: 9, y: 10 }, "second leg lands on the final destination");
});

test("update(): an event with an empty path falls back to a single direct leg (e.g. a single-tile move)", () => {
  const store = createStore(makeSnapshot());
  const vs = createViewState(store);

  store.ingest([{ type: "PlayerMoved", playerId: "p1", path: [], position: { x: 9, y: 9 } }]);
  vs.update(MS_PER_TILE);
  assert.deepEqual(findPlayer(vs.frame().entities).renderPos, { x: 9, y: 9 });
});

test("frame(): the 'visible' ring follows the avatar's CURRENT interpolated tile, not the authoritative destination, while mid-tween", () => {
  const base = makeSnapshot();
  const tiles = [5, 6, 7, 8, 9].map((x) => makeTile(x, 5));
  const store = createStore(
    makeSnapshot({
      visionRadius: 1,
      tiles,
      player: { ...base.player, position: { x: 5, y: 5 } },
      discovered: new Set(["5,5"]),
    }),
  );
  const vs = createViewState(store);

  store.ingest([
    {
      type: "PlayerMoved",
      playerId: "p1",
      path: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
      position: { x: 8, y: 5 },
    },
  ]);

  // Mid-tween: only the first leg has completed (avatar visually at (6,5)),
  // even though the AUTHORITATIVE position already jumped to (8,5) and
  // `discovered` already includes (9,5) — marked around the destination by
  // the reducer regardless of animation state.
  vs.update(MS_PER_TILE);
  const midFrame = vs.frame();
  assert.equal(
    midFrame.tiles.find((t) => t.x === 9 && t.y === 5)!.visibility,
    "explored",
    "not yet 'visible' — the avatar hasn't visually arrived at the destination, even though it's authoritatively there",
  );
  assert.equal(
    midFrame.tiles.find((t) => t.x === 6 && t.y === 5)!.visibility,
    "visible",
    "the tile under the avatar's CURRENT interpolated position is visible",
  );

  // Once the tween fully completes, the avatar's interpolated tile catches
  // up to the destination and the far tile becomes visible too.
  vs.update(2 * MS_PER_TILE);
  assert.equal(vs.frame().tiles.find((t) => t.x === 9 && t.y === 5)!.visibility, "visible");
});
