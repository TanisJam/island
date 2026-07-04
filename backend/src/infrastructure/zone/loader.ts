import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import type { ZoneTemplate } from "../../contract/zone";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
export const zonesDir = join(repoRoot, "zones");
const schemasDir = join(repoRoot, "schemas");

const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

/** Carga una zona desde /zones/zone-{zoneId}.json y la VALIDA contra
 *  /schemas/zone.json. Mirrors `catalog/loader.ts`: si el contenido no cumple
 *  el schema (o el archivo no existe), el backend no arranca (fail-fast). */
export function loadZone(zoneId: string): ZoneTemplate {
  const template = readJson(join(zonesDir, `zone-${zoneId}.json`)) as ZoneTemplate;

  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(readJson(join(schemasDir, "zone.json")), "zone.json");
  const validate = ajv.getSchema("zone.json");
  if (!validate) throw new Error("No se pudo compilar el schema de zona");
  if (!validate(template)) {
    const msg = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    throw new Error(`Zona '${zoneId}' inválida contra el schema: ${msg}`);
  }

  return template;
}
