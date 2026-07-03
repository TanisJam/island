import { test } from "node:test";
import assert from "node:assert/strict";
import type { ZoneTemplate } from "../../src/contract/zone";
import { paintTile, placeObject, removeObjectAt } from "./zone-model";

function makeTemplate(): ZoneTemplate {
  return {
    width: 2,
    height: 2,
    tiles: ["sand", "grass", "grass", "sand"],
    objects: [{ objectTypeId: "tree", x: 0, y: 0 }],
  };
}

test("paintTile: sets tiles[i] for the given (x,y), leaving the rest untouched", () => {
  const before = makeTemplate();
  const after = paintTile(before, 1, 0, "shallow_water");
  assert.deepEqual(after.tiles, ["sand", "shallow_water", "grass", "sand"]);
  // pure — the input template is not mutated
  assert.deepEqual(before.tiles, ["sand", "grass", "grass", "sand"]);
});

test("paintTile: (0,0) and (width-1,height-1) both resolve to the correct flat index", () => {
  const before = makeTemplate();
  assert.deepEqual(paintTile(before, 0, 0, "dirt").tiles, ["dirt", "grass", "grass", "sand"]);
  assert.deepEqual(paintTile(before, 1, 1, "dirt").tiles, ["sand", "grass", "grass", "dirt"]);
});

test("paintTile: throws on an out-of-bounds coordinate instead of silently no-op-ing", () => {
  const template = makeTemplate();
  assert.throws(() => paintTile(template, 2, 0, "sand"));
  assert.throws(() => paintTile(template, 0, 2, "sand"));
  assert.throws(() => paintTile(template, -1, 0, "sand"));
});

test("placeObject: appends a new placement without a state override", () => {
  const before = makeTemplate();
  const after = placeObject(before, "small_rock", 1, 1);
  assert.deepEqual(after.objects, [
    { objectTypeId: "tree", x: 0, y: 0 },
    { objectTypeId: "small_rock", x: 1, y: 1 },
  ]);
  // pure — the input template's objects array is not mutated
  assert.equal(before.objects.length, 1);
});

test("placeObject: carries an optional state override through unchanged", () => {
  const before = makeTemplate();
  const after = placeObject(before, "campfire", 0, 1, { lit: true, fuel: 3 });
  assert.deepEqual(after.objects[1], { objectTypeId: "campfire", x: 0, y: 1, state: { lit: true, fuel: 3 } });
});

test("removeObjectAt: removes every placement at the given (x,y)", () => {
  const before: ZoneTemplate = {
    width: 2,
    height: 2,
    tiles: ["sand", "grass", "grass", "sand"],
    objects: [
      { objectTypeId: "tree", x: 0, y: 0 },
      { objectTypeId: "small_rock", x: 0, y: 0 },
      { objectTypeId: "tall_grass", x: 1, y: 1 },
    ],
  };
  const after = removeObjectAt(before, 0, 0);
  assert.deepEqual(after.objects, [{ objectTypeId: "tall_grass", x: 1, y: 1 }]);
});

test("removeObjectAt: is a no-op (same contents, new array) when nothing is placed there", () => {
  const before = makeTemplate();
  const after = removeObjectAt(before, 1, 1);
  assert.deepEqual(after.objects, before.objects);
  assert.notEqual(after.objects, before.objects);
});
