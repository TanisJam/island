import type { GameState } from "../../domain/state";
import { deserialize, serialize, type GameRepository } from "./ports";

/**
 * Adapter SQLite (decisión A1: SQLite ahora, Postgres después).
 * Para el esqueleto persiste el estado por jugador como snapshot JSON en una fila.
 * El boundary (puerto GameRepository) ya está; migrar a tablas normalizadas o a
 * Postgres no toca el dominio. better-sqlite3 se importa de forma perezosa para que,
 * si el binario nativo no está disponible, el backend pueda seguir con in-memory.
 */
export async function createSqliteRepository(file: string): Promise<GameRepository> {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(
    "CREATE TABLE IF NOT EXISTS game_state (player_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  const upsert = db.prepare(
    "INSERT INTO game_state (player_id, snapshot, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(player_id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at",
  );
  const get = db.prepare("SELECT snapshot FROM game_state WHERE player_id = ?");

  return {
    load(playerId: string): GameState | null {
      const row = get.get(playerId) as { snapshot: string } | undefined;
      return row ? deserialize(row.snapshot) : null;
    },
    save(state: GameState): void {
      upsert.run(state.player.id, serialize(state), Date.now());
    },
    close(): void {
      db.close();
    },
  };
}
