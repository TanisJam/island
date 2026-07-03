import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../catalog/loader";
import { loadZone } from "../zone/loader";
import { seedState } from "../../bootstrap/seed";
import { deserialize, serialize } from "./ports";

const { index } = loadCatalog();
const template = loadZone("z1");

test("serialize/deserialize: round-trips 'inventories'", () => {
  const s = seedState(index, template);
  s.objects.push({ id: "wo_table_ports", objectTypeId: "rustic_table", position: { x: 3, y: 3 }, state: {}, tags: [], visibility: "visible" });
  s.inventories["wo_table_ports"] = { width: 3, height: 2 };
  const json = serialize(s);
  const restored = deserialize(json);
  assert.deepEqual(restored.inventories, s.inventories);
});

test("deserialize: un snapshot legacy sin 'inventories' se completa con {}", () => {
  const s = seedState(index, template);
  const json = JSON.stringify({ ...s, discovered: [...s.discovered] });
  const legacy = JSON.parse(json);
  delete legacy.inventories;
  const restored = deserialize(JSON.stringify(legacy));
  assert.deepEqual(restored.inventories, {});
});
