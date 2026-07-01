import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemInstance } from "../contract";
import type { PlayerStateResponse, ZoneSnapshotResponse } from "../net/api";
import { buildSnapshot } from "./snapshot";

function zoneResponse(overrides: Partial<ZoneSnapshotResponse> = {}): ZoneSnapshotResponse {
  return {
    zone: { id: "z1", type: "personal", width: 4, height: 4 },
    visionRadius: 5,
    tiles: [{ x: 0, y: 0, terrain: "grass", walkable: true, tags: [], visibility: "visible" }],
    objects: [],
    piles: [],
    worldItems: [],
    surfaceItems: [],
    catalogVersion: "v1",
    ...overrides,
  };
}

function playerResponse(overrides: Partial<PlayerStateResponse> = {}): PlayerStateResponse {
  return {
    player: { id: "p1", name: "Náufrago", currentZoneId: "z1", position: { x: 0, y: 0 }, stats: { health: 100, maxHealth: 100, energy: 100, maxEnergy: 100 } },
    inventory: { id: "inv1", ownerType: "player", ownerId: "p1", width: 4, height: 4, handSlots: { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } } },
    items: [],
    knowledge: [],
    thoughtLog: [],
    ...overrides,
  };
}

test("buildSnapshot: merges zone.surfaceItems into the client's single items array", () => {
  const onTable: ItemInstance = { id: "it_1", itemTypeId: "small_stone", location: { type: "surface", surfaceId: "wo_table", x: 0, y: 0, rotation: 0 } };
  const onGround: ItemInstance = { id: "it_2", itemTypeId: "dry_branch", location: { type: "world", zoneId: "z1", x: 2, y: 2 } };
  const inHand: ItemInstance = { id: "it_3", itemTypeId: "plant_fiber", location: { type: "player_inventory", playerId: "p1", x: 1, y: 1, rotation: 0 } };

  const snapshot = buildSnapshot(
    zoneResponse({ worldItems: [onGround], surfaceItems: [onTable] }),
    playerResponse({ items: [inHand] }),
  );

  assert.deepEqual(
    snapshot.items.map((i) => i.id).sort(),
    ["it_1", "it_2", "it_3"],
  );
  assert.deepEqual(snapshot.items.find((i) => i.id === "it_1")?.location, onTable.location);
});

test("buildSnapshot: an empty surfaceItems array leaves items exactly as before (no regression)", () => {
  const onGround: ItemInstance = { id: "it_2", itemTypeId: "dry_branch", location: { type: "world", zoneId: "z1", x: 2, y: 2 } };
  const snapshot = buildSnapshot(zoneResponse({ worldItems: [onGround] }), playerResponse());
  assert.deepEqual(snapshot.items.map((i) => i.id), ["it_2"]);
});
