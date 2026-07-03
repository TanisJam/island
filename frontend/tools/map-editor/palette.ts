/**
 * Palette panels (design.md Slice 2 — "palette.ts: terrain palette from live
 * /catalog/terrains.json"; Slice 3 task 3.1 extends this with a world-object
 * palette from live `/catalog/world-objects.json`). Both fetch their
 * catalog LIVE (served by `itemsEditorCatalogReadPlugin`, reused from
 * items-editor — design.md "Reuse: catalog-read-middleware"), render one
 * button per entry, and track the current selection. Selecting a swatch
 * only updates the handle's `selectedId()` / fires `onSelect` — `main.ts` is
 * the one that decides what selecting a terrain vs. an object DOES (switch
 * the active paint tool, wire the click handler, etc.), keeping this module
 * a dumb, reusable "fetch + render a labeled button grid" building block
 * shared by both panels instead of two near-duplicate implementations.
 */

export interface TerrainCatalogEntry {
  id: string;
  name: string;
  walkable: boolean;
  tags: string[];
  observation?: string;
}

export interface WorldObjectCatalogEntry {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  blocksMovement?: boolean;
  observation?: string;
}

export interface PaletteOptions {
  mountEl: HTMLElement;
  onSelect?(id: string): void;
}

export interface PaletteHandle {
  selectedId(): string | null;
  destroy(): void;
}

interface PaletteEntry {
  id: string;
  label: string;
  title: string;
}

const TERRAINS_ROUTE = "/catalog/terrains.json";
const WORLD_OBJECTS_ROUTE = "/catalog/world-objects.json";

async function createPalette(route: string, toEntry: (raw: unknown) => PaletteEntry, { mountEl, onSelect }: PaletteOptions): Promise<PaletteHandle> {
  mountEl.innerHTML = "";
  mountEl.classList.add("palette");

  const res = await fetch(route, { cache: "no-store" });
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
  const raw = (await res.json()) as unknown[];
  const entries = raw.map(toEntry);

  let selected: string | null = null;
  const buttons = new Map<string, HTMLButtonElement>();

  for (const entry of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-swatch";
    btn.textContent = entry.label;
    btn.title = entry.title;
    btn.addEventListener("click", () => {
      selected = entry.id;
      for (const [id, otherBtn] of buttons) otherBtn.classList.toggle("active", id === entry.id);
      onSelect?.(entry.id);
    });
    buttons.set(entry.id, btn);
    mountEl.appendChild(btn);
  }

  return {
    selectedId: () => selected,
    destroy: () => {
      mountEl.innerHTML = "";
    },
  };
}

export function createTerrainPalette(options: PaletteOptions): Promise<PaletteHandle> {
  return createPalette(
    TERRAINS_ROUTE,
    (raw) => {
      const terrain = raw as TerrainCatalogEntry;
      return { id: terrain.id, label: terrain.name, title: `${terrain.id} — ${terrain.walkable ? "walkable" : "blocks movement"}` };
    },
    options,
  );
}

export function createObjectPalette(options: PaletteOptions): Promise<PaletteHandle> {
  return createPalette(
    WORLD_OBJECTS_ROUTE,
    (raw) => {
      const worldObject = raw as WorldObjectCatalogEntry;
      return { id: worldObject.id, label: worldObject.name, title: `${worldObject.id}${worldObject.blocksMovement ? " — blocks movement" : ""}` };
    },
    options,
  );
}
