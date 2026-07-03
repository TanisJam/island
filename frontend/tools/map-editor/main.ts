import { parseAtlas, type Atlas } from "../../src/render/assets";
import type { ZoneTemplate } from "../../src/contract/zone";
import { createZoneCanvas } from "./zone-canvas";
import { createTerrainPalette } from "./palette";

/**
 * Thin bootstrap for the map editor (design.md Slice 2 — read-only render +
 * palette). Fetches `atlas.json` (served from `publicDir`), the tileset
 * image, `zone-z1.json` (served by `zone-read-middleware.ts`, live from
 * repo source), and the terrain catalog (served by the reused
 * `itemsEditorCatalogReadPlugin`), then renders the grid with real sprites
 * and mounts the terrain palette. No paint/place/save wiring yet — Slice 3.
 */

const ZONE_ROUTE = "/zones/zone-z1.json";
const ATLAS_ROUTE = "/atlas.json";

function mustEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`map-editor: missing #${id} in index.html`);
  return el as unknown as T;
}

const canvasEl = mustEl<HTMLCanvasElement>("zone-canvas");
const paletteEl = mustEl<HTMLDivElement>("terrain-palette");
const statusEl = mustEl<HTMLDivElement>("status");
const selectedTerrainLabelEl = mustEl<HTMLSpanElement>("selected-terrain");

function loadTilesetImage(imageName: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load tileset image "${imageName}"`));
    img.src = `/${imageName}`;
  });
}

async function boot(): Promise<void> {
  statusEl.textContent = "Loading…";
  try {
    const [atlasRes, zoneRes] = await Promise.all([fetch(ATLAS_ROUTE, { cache: "no-store" }), fetch(ZONE_ROUTE, { cache: "no-store" })]);
    if (!atlasRes.ok) throw new Error(`atlas.json: HTTP ${atlasRes.status}`);
    if (!zoneRes.ok) throw new Error(`zone-z1.json: HTTP ${zoneRes.status}`);

    const atlas: Atlas = parseAtlas(await atlasRes.json());
    const template = (await zoneRes.json()) as ZoneTemplate;
    const tilesetImage = await loadTilesetImage(atlas.image);

    const zoneCanvas = createZoneCanvas(canvasEl);
    zoneCanvas.render(template, atlas, tilesetImage);

    statusEl.textContent = `Loaded zone z1: ${template.width}x${template.height}, ${template.objects.length} objects (read-only).`;

    await createTerrainPalette({
      mountEl: paletteEl,
      onSelect: (terrainId) => {
        selectedTerrainLabelEl.textContent = terrainId;
      },
    });
  } catch (e) {
    statusEl.textContent = `Failed to load: ${e instanceof Error ? e.message : String(e)}`;
  }
}

void boot();
