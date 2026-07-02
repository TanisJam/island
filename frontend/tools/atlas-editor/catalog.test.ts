import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogTypeIdsByKind } from "./catalog";

test("catalogTypeIdsByKind: extracts ids per kind and hardcodes the single player typeId", () => {
  const result = catalogTypeIdsByKind(
    [{ id: "sand" }, { id: "grass" }],
    [{ id: "tree" }, { id: "small_rock" }],
    [{ id: "small_stone" }],
  );
  assert.deepEqual(result, {
    terrain: ["sand", "grass"],
    object: ["tree", "small_rock"],
    item: ["small_stone"],
    player: ["player"],
  });
});

test("catalogTypeIdsByKind: empty catalog files yield empty lists (still shows the player entry)", () => {
  const result = catalogTypeIdsByKind([], [], []);
  assert.deepEqual(result, { terrain: [], object: [], item: [], player: ["player"] });
});
