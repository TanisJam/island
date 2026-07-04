import { watch } from "node:fs";
import type { CatalogIndex } from "../domain/catalog";
import type { GameRepository } from "../infrastructure/persistence/ports";
import { loadZone } from "../infrastructure/zone/loader";
import { seedState } from "./seed";

export type ReloadZone = (zoneId: string) => void;

/**
 * Re-siembra el estado de un jugador a partir de la última versión de una zona en
 * disco, SIN reiniciar el proceso (D5, design.md `unified-app`). A diferencia del
 * boot (fail-fast en `main()`), acá el fallo es fail-SAFE: si la zona es inválida,
 * está a medio escribir, o no existe, se loguea y se preserva el último estado
 * bueno — la excepción nunca escapa. Re-sembrar DESCARTA el estado runtime en
 * curso del jugador (posición, inventario, piles, etc.); no hay merge con lo que
 * había antes (decisión aceptada, ver design.md "Re-seed semantics").
 */
export function createReloadZone(index: CatalogIndex, repo: GameRepository, playerId: string): ReloadZone {
  return function reloadZone(zoneId: string): void {
    try {
      const template = loadZone(zoneId);
      const state = seedState(index, template, playerId, zoneId);
      repo.save(state);
      console.log(`Zona '${zoneId}' recargada en caliente (${template.width}x${template.height}, ${template.objects.length} objetos)`);
    } catch (e) {
      console.error(`Fallo al recargar zona '${zoneId}' — se mantiene el estado anterior:`, e instanceof Error ? e.message : e);
    }
  };
}

const ZONE_FILE_RE = /^zone-(.+)\.json$/;

/**
 * Observa `zonesDir` (ver `infrastructure/zone/loader.ts`) y llama a
 * `reloadZone(id)` cuando `zone-{id}.json` cambia. El editor de mapas escribe con
 * `writeAtomic` (tmp-file + rename, ver `zone-write-middleware.ts`), lo que dispara
 * varios eventos fs por guardado; el debounce (~50ms) por zoneId los colapsa en una
 * sola recarga.
 */
export function watchZones(zonesDir: string, reloadZone: ReloadZone, debounceMs = 50): void {
  const timers = new Map<string, NodeJS.Timeout>();
  watch(zonesDir, (_event, filename) => {
    if (!filename) return;
    const match = ZONE_FILE_RE.exec(filename.toString());
    const zoneId = match?.[1];
    if (!zoneId) return;
    const existing = timers.get(zoneId);
    if (existing) clearTimeout(existing);
    timers.set(
      zoneId,
      setTimeout(() => {
        timers.delete(zoneId);
        reloadZone(zoneId);
      }, debounceMs),
    );
  });
}
