import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import Ajv from "ajv";
import type { GameService } from "../../application/game-service";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, "..", "..", "..", "..", "schemas");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

/** Construye el servidor HTTP. Las rutas son finas: delegan en el GameService.
 *  POST /commands valida el body contra commands.json antes de procesar. */
export function buildServer(service: GameService): FastifyInstance {
  const app = Fastify({ logger: false });

  // Dev: permite cualquier origen para que el frontend (Vite, :5173) pueda llamar
  // a este backend (:3000) desde el navegador.
  app.register(cors, { origin: true });

  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(readJson(join(schemasDir, "common.json")), "common.json");
  ajv.addSchema(readJson(join(schemasDir, "commands.json")), "commands.json");
  const validateCommand = ajv.getSchema("commands.json");

  app.get("/health", async () => ({ ok: true }));

  app.get("/catalog", async () => service.catalog());

  app.get("/zones/:zoneId", async (req, reply) => {
    const { zoneId } = req.params as { zoneId: string };
    const snap = service.zoneSnapshot(zoneId);
    if (!snap) return reply.code(404).send({ error: "zone not found" });
    return snap;
  });

  app.get("/players/:playerId/state", async (req, reply) => {
    const { playerId } = req.params as { playerId: string };
    const st = service.playerState(playerId);
    if (!st) return reply.code(404).send({ error: "player not found" });
    return st;
  });

  app.post("/commands", async (req, reply) => {
    if (validateCommand && !validateCommand(req.body)) {
      return reply.code(400).send({ error: "invalid command", details: validateCommand.errors });
    }
    try {
      return service.command(req.body as any);
    } catch (e) {
      return reply.code(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  return app;
}
