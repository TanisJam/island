#!/usr/bin/env node
/**
 * Genera tipos TypeScript desde los JSON Schema del contrato.
 * Uso:  pnpm install  &&  node codegen.cjs
 * Salida: schemas/generated/*.ts
 *
 * Estrategia: bundle() resuelve los $ref a common.json; luego se promueve el
 * $ref raíz a la raíz del documento (json-schema-to-typescript no soporta $ref
 * en la raíz). El resto de los $defs quedan como tipos nombrados.
 */
const fs = require("fs");
const path = require("path");
const { compile } = require("json-schema-to-typescript");
const RP = require("@apidevtools/json-schema-ref-parser");
const parser = RP.default || RP;

const S = __dirname;
const OUT = path.join(S, "generated");
fs.mkdirSync(OUT, { recursive: true });

const ROOTS = [
  { file: "catalog.json", fallback: "Catalog" },
  { file: "commands.json", fallback: "CommandEnvelope" },
  { file: "events.json", fallback: "CommandResult" },
  { file: "zone.json", fallback: "ZoneTemplate" },
];

(async () => {
  for (const { file, fallback } of ROOTS) {
    const bundled = await parser.bundle(path.join(S, file));
    const defs = bundled.definitions || {};
    const rootName = (bundled.$ref || "").split("/").pop() || fallback;
    const rootDef = defs[rootName] || bundled;
    const schema = Object.assign({}, rootDef, { title: rootName, definitions: defs });
    const ts = await compile(schema, rootName, {
      bannerComment: `// AUTOGENERADO desde schemas/${file} — no editar a mano.`,
      additionalProperties: false,
      declareExternallyReferenced: true,
    });
    const out = path.join(OUT, file.replace(".json", ".ts"));
    fs.writeFileSync(out, ts);
    const n = (ts.match(/export (interface|type) \w+/g) || []).length;
    console.log(`  ${file} -> generated/${path.basename(out)} (${n} tipos)`);
  }
  console.log("✓ codegen OK");
})().catch((e) => { console.error("codegen falló:", e.message); process.exit(1); });
