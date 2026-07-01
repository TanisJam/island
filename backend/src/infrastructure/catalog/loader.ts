import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import type { Catalog } from "../../contract/catalog";
import { buildIndex, type CatalogIndex } from "../../domain/catalog";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const catalogDir = join(repoRoot, "catalog");
const schemasDir = join(repoRoot, "schemas");

const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

/** Carga el catálogo desde /catalog, lo VALIDA contra /schemas y construye el índice.
 *  Si el contenido no cumple el schema, el backend no arranca (fail-fast). */
export function loadCatalog(): { catalog: Catalog; index: CatalogIndex } {
  const meta = readJson(join(catalogDir, "meta.json"));
  const catalog: Catalog = {
    catalogVersion: meta.catalogVersion,
    terrains: readJson(join(catalogDir, "terrains.json")),
    items: readJson(join(catalogDir, "items.json")),
    worldObjects: readJson(join(catalogDir, "world-objects.json")),
    knowledge: readJson(join(catalogDir, "knowledge.json")),
    actions: readJson(join(catalogDir, "actions.json")),
    research: readJson(join(catalogDir, "research.json")),
  };

  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(readJson(join(schemasDir, "common.json")), "common.json");
  ajv.addSchema(readJson(join(schemasDir, "catalog.json")), "catalog.json");
  const validate = ajv.getSchema("catalog.json");
  if (!validate) throw new Error("No se pudo compilar el schema del catálogo");
  if (!validate(catalog)) {
    const msg = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    throw new Error(`Catálogo inválido contra el schema: ${msg}`);
  }

  return { catalog, index: buildIndex(catalog) };
}
