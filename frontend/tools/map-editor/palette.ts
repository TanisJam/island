/**
 * Terrain palette panel (design.md Slice 2 — "palette.ts: terrain palette
 * from live /catalog/terrains.json"). Fetches the catalog LIVE (served by
 * `itemsEditorCatalogReadPlugin`, reused from items-editor — design.md
 * "Reuse: catalog-read-middleware"), renders one button per terrain, and
 * tracks the current selection. READ-ONLY this slice: selecting a swatch
 * only updates `selectedTerrainId()` / fires `onSelect` — nothing paints yet
 * (Slice 3 wires the selection into `zone-canvas.ts` click/drag handling on
 * top of `zone-model.ts::paintTile`).
 */

export interface TerrainCatalogEntry {
  id: string;
  name: string;
  walkable: boolean;
  tags: string[];
  observation?: string;
}

export interface PaletteOptions {
  mountEl: HTMLElement;
  onSelect?(terrainId: string): void;
}

export interface PaletteHandle {
  selectedTerrainId(): string | null;
  destroy(): void;
}

const TERRAINS_ROUTE = "/catalog/terrains.json";

export async function createTerrainPalette({ mountEl, onSelect }: PaletteOptions): Promise<PaletteHandle> {
  mountEl.innerHTML = "";
  mountEl.classList.add("palette");

  const res = await fetch(TERRAINS_ROUTE, { cache: "no-store" });
  if (!res.ok) throw new Error(`terrains.json: HTTP ${res.status}`);
  const terrains = (await res.json()) as TerrainCatalogEntry[];

  let selected: string | null = null;
  const buttons = new Map<string, HTMLButtonElement>();

  for (const terrain of terrains) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-swatch";
    btn.textContent = terrain.name;
    btn.title = `${terrain.id} — ${terrain.walkable ? "walkable" : "blocks movement"}`;
    btn.addEventListener("click", () => {
      selected = terrain.id;
      for (const [id, otherBtn] of buttons) otherBtn.classList.toggle("active", id === terrain.id);
      onSelect?.(terrain.id);
    });
    buttons.set(terrain.id, btn);
    mountEl.appendChild(btn);
  }

  return {
    selectedTerrainId: () => selected,
    destroy: () => {
      mountEl.innerHTML = "";
    },
  };
}
