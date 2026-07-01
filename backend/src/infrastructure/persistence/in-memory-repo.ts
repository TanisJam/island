import type { GameState } from "../../domain/state";
import type { GameRepository } from "./ports";

/** Adapter en memoria. Default del MVP: mantiene el estado vivo por jugador. */
export class InMemoryGameRepository implements GameRepository {
  private states = new Map<string, GameState>();

  load(playerId: string): GameState | null {
    return this.states.get(playerId) ?? null;
  }

  save(state: GameState): void {
    this.states.set(state.player.id, state);
  }

  close(): void {
    this.states.clear();
  }
}
