import type { CommandEnvelope } from "../contract/commands";
import type { CommandResult } from "../contract/events";
import type { CatalogIndex } from "../domain/catalog";
import type { GameRepository } from "../infrastructure/persistence/ports";
import { HAND_LEFT, HAND_RIGHT, inventoryItems, worldItems } from "../domain/inventory";
import { VISION_RADIUS } from "../domain/state";
import { visibilityOf } from "../domain/visibility";
import { processCommand } from "./process-command";

/** Orquesta lectura de snapshots y procesamiento de comandos sobre el repositorio. */
export class GameService {
  constructor(
    private readonly index: CatalogIndex,
    private readonly repo: GameRepository,
    private readonly primaryPlayerId: string,
    private readonly now: () => number = () => Date.now(),
    private readonly rng: () => number = () => Math.random(),
  ) {}

  catalog() {
    return this.index.raw;
  }

  zoneSnapshot(zoneId: string) {
    const s = this.repo.load(this.primaryPlayerId);
    if (!s || s.zone.id !== zoneId) return null;
    return {
      zone: { id: s.zone.id, ownerPlayerId: s.zone.ownerPlayerId, type: s.zone.type, width: s.zone.width, height: s.zone.height },
      visionRadius: VISION_RADIUS,
      tiles: s.tiles.map((t) => ({ x: t.x, y: t.y, terrain: t.terrain, walkable: t.walkable, tags: t.tags, visibility: visibilityOf(s, { x: t.x, y: t.y }) })),
      objects: s.objects.filter((o) => visibilityOf(s, o.position) !== "unseen"),
      piles: s.piles,
      worldItems: worldItems(s),
      catalogVersion: this.index.raw.catalogVersion,
    };
  }

  playerState(playerId: string) {
    const s = this.repo.load(playerId);
    if (!s) return null;
    return {
      player: {
        id: s.player.id,
        name: s.player.name,
        currentZoneId: s.player.zoneId,
        position: s.player.position,
        stats: { health: s.player.health, maxHealth: s.player.maxHealth, energy: s.player.energy, maxEnergy: s.player.maxEnergy },
      },
      inventory: {
        id: `inv_${s.player.id}`,
        ownerType: "player" as const,
        ownerId: s.player.id,
        width: 4,
        height: 4,
        handSlots: { left: HAND_LEFT, right: HAND_RIGHT },
      },
      items: inventoryItems(s),
      knowledge: s.player.knowledge,
      thoughtLog: s.player.thoughtLog,
    };
  }

  command(env: CommandEnvelope): CommandResult {
    const s = this.repo.load(env.playerId);
    if (!s) throw new Error(`jugador desconocido: ${env.playerId}`);
    const result = processCommand({ state: s, index: this.index, rng: this.rng, now: this.now }, env);
    this.repo.save(s);
    return result;
  }
}
