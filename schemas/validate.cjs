#!/usr/bin/env node
/**
 * Valida el catálogo real (../catalog) y fixtures de comandos/eventos contra
 * los JSON Schema. Uso:  pnpm install  &&  node validate.cjs
 */
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

const S = __dirname;
const C = path.join(S, "..", "catalog");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(read(path.join(S, "common.json")), "common.json");
ajv.addSchema(read(path.join(S, "catalog.json")), "catalog.json");
ajv.addSchema(read(path.join(S, "commands.json")), "commands.json");
ajv.addSchema(read(path.join(S, "events.json")), "events.json");

let fails = 0;
const line = (ok, label, errs) => {
  console.log(`  ${ok ? "OK " : "FAIL"} ${label}`);
  if (!ok) { fails++; (errs || []).slice(0, 5).forEach((e) => console.log(`        ${e.instancePath || "/"} ${e.message}`)); }
};
function check(validate, data, label, expect = true) {
  const ok = validate(data);
  line(ok === expect, label + (expect ? "" : "  (debe rechazar)"), ok ? [] : validate.errors);
}

// 1. Catálogo ensamblado + por colección
const catalog = {
  catalogVersion: read(path.join(C, "meta.json")).catalogVersion,
  terrains: read(path.join(C, "terrains.json")),
  items: read(path.join(C, "items.json")),
  worldObjects: read(path.join(C, "world-objects.json")),
  knowledge: read(path.join(C, "knowledge.json")),
  actions: read(path.join(C, "actions.json")),
  research: read(path.join(C, "research.json")),
};
console.log("Catálogo:");
check(ajv.getSchema("catalog.json"), catalog, "GET /catalog (ensamblado)");
const arrayOf = (def) => ajv.compile({ type: "array", items: { $ref: "catalog.json#/definitions/" + def } });
[["TerrainTypeDef", catalog.terrains], ["ItemTypeDef", catalog.items], ["WorldObjectTypeDef", catalog.worldObjects],
 ["KnowledgeDef", catalog.knowledge], ["ContextActionDef", catalog.actions], ["ResearchDef", catalog.research]]
  .forEach(([def, data]) => check(arrayOf(def), data, def));

// 2. Fixtures de contrato (positivos y negativos)
console.log("Comandos:");
const cmd = ajv.getSchema("commands.json");
check(cmd, { playerId: "p1", clientCommandId: "c1", command: { type: "ExecuteAction", actionId: "clear_jungle", target: { kind: "tile", x: 5, y: 3 } } }, "ExecuteAction válido");
check(cmd, { playerId: "p1", clientCommandId: "c2", command: { type: "Teleport", to: { x: 1, y: 1 } } }, "comando inexistente", false);

console.log("Eventos:");
const res = ajv.getSchema("events.json");
check(res, { clientCommandId: "c1", accepted: true, events: [
  { type: "TileChanged", position: { x: 5, y: 3 }, terrain: "dirt", walkable: true },
  { type: "ThoughtAdded", thought: { id: "t1", text: "Abrí un pequeño paso.", kind: "discovery", timestamp: 1 } },
] }, "CommandResult válido");
check(res, { clientCommandId: "c2", accepted: false, events: [], rejection: { code: "no_existe" } }, "rejection inválida", false);

console.log("\n" + (fails === 0 ? "✓ contrato OK" : `✗ ${fails} fallo(s)`));
process.exit(fails === 0 ? 0 : 1);
