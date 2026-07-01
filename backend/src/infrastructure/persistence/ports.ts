import type { GameState } from "../../domain/state";

/** Puerto de persistencia. El dominio depende de esta interfaz, no de SQLite, para
 *  que el salto SQLite -> PostgreSQL no toque la lógica de juego (decisión A1). */
export interface GameRepository {
  load(playerId: string): GameState | null;
  save(state: GameState): void;
  close(): void;
}

// Serialización compartida por los adapters que persisten (Set no es JSON-serializable).
export function serialize(s: GameState): string {
  return JSON.stringify({ ...s, discovered: [...s.discovered] });
}

export function deserialize(json: string): GameState {
  const o = JSON.parse(json);
  return { ...o, discovered: new Set<string>(o.discovered ?? []), inventories: o.inventories ?? {} };
}
