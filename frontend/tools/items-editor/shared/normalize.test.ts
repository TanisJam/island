import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeItem, itemToFormState, type ItemFormState } from "./normalize";
import type { ItemTypeDef } from "../../../src/contract/catalog";

const baseForm: ItemFormState = {
  id: "crude_tool",
  name: "Herramienta rudimentaria",
  description: "Una piedra atada a una rama.",
  width: 1,
  height: 2,
  rotatable: true,
  properties: { cutting: 1 },
  tags: ["tool", "crude"],
};

test("normalizeItem: maps width/height into shape.w/shape.h", () => {
  const item = normalizeItem(baseForm);
  assert.deepEqual(item.shape, { w: 1, h: 2 });
});

test("normalizeItem: an absent optional (durability, observation) is OMITTED, not null or 0", () => {
  const item = normalizeItem(baseForm) as unknown as Record<string, unknown>;
  assert.equal("durability" in item, false);
  assert.equal("observation" in item, false);
  assert.deepEqual(Object.keys(item).sort(), [
    "description",
    "id",
    "name",
    "properties",
    "rotatable",
    "shape",
    "tags",
  ]);
});

test("normalizeItem: a present optional durability of 0 is kept (distinct from cleared/undefined)", () => {
  const item = normalizeItem({ ...baseForm, durability: 0 });
  assert.equal(item.durability, 0);
});

test("normalizeItem: present optionals are included as-is", () => {
  const item = normalizeItem({ ...baseForm, durability: 20, observation: "Sirve, mal." });
  assert.equal(item.durability, 20);
  assert.equal(item.observation, "Sirve, mal.");
});

test("normalizeItem: properties and tags are copied, not aliased", () => {
  const item = normalizeItem(baseForm);
  item.properties.cutting = 999;
  item.tags.push("mutated");
  assert.equal(baseForm.properties.cutting, 1);
  assert.deepEqual(baseForm.tags, ["tool", "crude"]);
});

test("itemToFormState: maps shape.w/shape.h into width/height and omits absent optionals", () => {
  const source: ItemTypeDef = {
    id: "small_stone",
    name: "Piedra pequeña",
    description: "Una piedra.",
    shape: { w: 1, h: 1 },
    rotatable: false,
    properties: { hardness: 2 },
    tags: ["stone"],
  };
  const form = itemToFormState(source) as unknown as Record<string, unknown>;
  assert.equal(form.width, 1);
  assert.equal(form.height, 1);
  assert.equal("durability" in form, false);
  assert.equal("observation" in form, false);
});

test("itemToFormState -> normalizeItem round-trips an item with all optionals set", () => {
  const source: ItemTypeDef = {
    id: "simple_axe",
    name: "Hacha simple",
    description: "Un hacha con filo de verdad.",
    shape: { w: 1, h: 2 },
    rotatable: true,
    properties: { cutting: 3, chopping: 3 },
    tags: ["tool", "axe"],
    durability: 40,
    observation: "Con esto puedo cortar de verdad.",
  };
  assert.deepEqual(normalizeItem(itemToFormState(source)), source);
});
