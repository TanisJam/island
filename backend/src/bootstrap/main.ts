import { GameService } from "../application/game-service";
import { loadCatalog } from "../infrastructure/catalog/loader";
import { buildServer } from "../infrastructure/http/server";
import { InMemoryGameRepository } from "../infrastructure/persistence/in-memory-repo";
import type { GameRepository } from "../infrastructure/persistence/ports";
import { createSqliteRepository } from "../infrastructure/persistence/sqlite-repo";
import { loadZone } from "../infrastructure/zone/loader";
import { seedState } from "./seed";

const PLAYER_ID = "p1";
const ZONE_ID = "z1";
const PORT = Number(process.env.PORT ?? 3000);

async function chooseRepo(): Promise<GameRepository> {
  if (process.env.DB === "sqlite") {
    try {
      const repo = await createSqliteRepository(process.env.DB_FILE ?? "island.db");
      console.log("Persistencia: SQLite");
      return repo;
    } catch (e) {
      console.warn("SQLite no disponible, fallback a in-memory:", e instanceof Error ? e.message : e);
    }
  }
  console.log("Persistencia: in-memory");
  return new InMemoryGameRepository();
}

async function main(): Promise<void> {
  const { catalog, index } = loadCatalog();
  console.log(`Catálogo OK (v${catalog.catalogVersion}): ${catalog.items.length} items, ${catalog.worldObjects.length} objetos, ${catalog.actions.length} acciones`);

  const template = loadZone(ZONE_ID);
  console.log(`Zona '${ZONE_ID}' OK: ${template.width}x${template.height}, ${template.objects.length} objetos`);

  const repo = await chooseRepo();
  if (!repo.load(PLAYER_ID)) repo.save(seedState(index, template, PLAYER_ID, ZONE_ID));

  const service = new GameService(index, repo, PLAYER_ID);
  const app = buildServer(service);
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Isla Misteriosa backend escuchando en http://localhost:${PORT}`);
  console.log(`  GET  /catalog`);
  console.log(`  GET  /zones/${ZONE_ID}`);
  console.log(`  GET  /players/${PLAYER_ID}/state`);
  console.log(`  POST /commands`);
}

main().catch((e) => {
  console.error("Fallo al iniciar:", e);
  process.exit(1);
});
