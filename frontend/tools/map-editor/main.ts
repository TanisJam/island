import { parseAtlas, type Atlas } from "../../src/render/assets";
import type { ZoneTemplate } from "../../src/contract/zone";
import { footprintFromDrag, type Point } from "../shared/picking";
import { createZoneCanvas, DEFAULT_ZOOM, ZOOM_LEVELS, type ZoneCanvasHandle } from "./zone-canvas";
import { createTerrainPalette, createObjectPalette } from "./palette";
import { paintTile, placeObject, removeObjectAt } from "./zone-model";
import { saveZone } from "./save";

/**
 * Bootstrap for the map editor (design.md Slice 3 — "paint/place/save" +
 * the user-requested zoom control). Fetches `atlas.json` (served from
 * `publicDir`), the tileset image, `zone-z1.json` (served by
 * `zone-read-middleware.ts`, live from repo source), and both catalogs
 * (served by the reused `itemsEditorCatalogReadPlugin`), then renders the
 * grid with real sprites and wires:
 *  - the terrain palette to a click/click-drag PAINT tool,
 *  - the object palette to a click-only PLACE tool,
 *  - an explicit "Erase objects" button to a click/click-drag ERASE tool,
 *  - a zoom `<select>` that keeps picking correct at every zoom level
 *    (`zoneCanvas.cellPx()` is always asked fresh, never hard-coded),
 *  - a Save button that POSTs the full in-memory `ZoneTemplate` to
 *    `zone-write-middleware.ts`'s `POST /__save-zone/:zoneId`.
 *
 * ONE tool is active at a time — selecting a terrain swatch, an object
 * swatch, or the erase button all switch `activeTool`, mirroring a classic
 * paint-program tool palette rather than needing separate modal state.
 */

const ZONE_ID = "z1";
const ZONE_ROUTE = `/zones/zone-${ZONE_ID}.json`;
const ATLAS_ROUTE = "/atlas.json";

type Tool = "terrain" | "object" | "erase";

function mustEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`map-editor: missing #${id} in index.html`);
  return el as unknown as T;
}

const canvasEl = mustEl<HTMLCanvasElement>("zone-canvas");
const terrainPaletteEl = mustEl<HTMLDivElement>("terrain-palette");
const objectPaletteEl = mustEl<HTMLDivElement>("object-palette");
const eraseBtn = mustEl<HTMLButtonElement>("erase-btn");
const zoomSelect = mustEl<HTMLSelectElement>("zoom-select");
const activeToolEl = mustEl<HTMLSpanElement>("active-tool");
const saveBtn = mustEl<HTMLButtonElement>("save-btn");
const saveStatusEl = mustEl<HTMLSpanElement>("save-status");
const statusEl = mustEl<HTMLDivElement>("status");
const selectedTerrainLabelEl = mustEl<HTMLSpanElement>("selected-terrain");
const selectedObjectLabelEl = mustEl<HTMLSpanElement>("selected-object");

const zoneCanvas: ZoneCanvasHandle = createZoneCanvas(canvasEl);

let currentTemplate: ZoneTemplate | null = null;
let atlas: Atlas | null = null;
let tilesetImage: HTMLImageElement | null = null;

let activeTool: Tool = "terrain";
let selectedTerrainId: string | null = null;
let selectedObjectTypeId: string | null = null;

let isPointerDown = false;
let lastPaintedCell: { x: number; y: number } | null = null;

function loadTilesetImage(imageName: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load tileset image "${imageName}"`));
    img.src = `/${imageName}`;
  });
}

function updateActiveToolLabel(): void {
  activeToolEl.textContent = activeTool;
  eraseBtn.classList.toggle("active", activeTool === "erase");
}

function updateStatusLine(): void {
  if (!currentTemplate) return;
  statusEl.textContent = `Zone ${ZONE_ID}: ${currentTemplate.width}x${currentTemplate.height}, ${currentTemplate.objects.length} objects.`;
}

function rerender(): void {
  if (!currentTemplate || !atlas || !tilesetImage) return;
  zoneCanvas.render(currentTemplate, atlas, tilesetImage);
  updateStatusLine();
}

/** Converts a canvas-local pixel point into a tile `(x, y)`, using
 * `zoneCanvas.cellPx()` (the LIVE effective cell size at the current zoom)
 * so painting stays correct after `setZoom` changes it. Reuses
 * `picking.ts::footprintFromDrag` for the pixel->cell math (a
 * single-point "drag" degenerates to one grid-aligned cell — same trick
 * `texture-panel.ts` relies on), rather than hand-rolling the same
 * `Math.floor(v / cell)` division a second time in this module. Returns
 * `null` for a point outside the current template's bounds. */
function tileFromPoint(point: Point): { x: number; y: number } | null {
  if (!currentTemplate) return null;
  const cell = zoneCanvas.cellPx();
  const footprint = footprintFromDrag(point, point, cell);
  const x = footprint.x / cell;
  const y = footprint.y / cell;
  if (x < 0 || y < 0 || x >= currentTemplate.width || y >= currentTemplate.height) return null;
  return { x, y };
}

function pointFromEvent(e: MouseEvent): Point {
  const rect = canvasEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function applyToolAt(x: number, y: number): void {
  if (!currentTemplate) return;
  if (activeTool === "terrain") {
    if (!selectedTerrainId) return;
    currentTemplate = paintTile(currentTemplate, x, y, selectedTerrainId);
  } else if (activeTool === "object") {
    if (!selectedObjectTypeId) return;
    currentTemplate = placeObject(currentTemplate, selectedObjectTypeId, x, y);
  } else {
    // erase — a no-op when nothing is placed there, safe to call on every
    // cell a click-drag passes over.
    currentTemplate = removeObjectAt(currentTemplate, x, y);
  }
  rerender();
}

function onCanvasMouseDown(e: MouseEvent): void {
  const tile = tileFromPoint(pointFromEvent(e));
  if (!tile) return;
  isPointerDown = true;
  lastPaintedCell = tile;
  applyToolAt(tile.x, tile.y);
}

function onCanvasMouseMove(e: MouseEvent): void {
  // Object placement is deliberately click-ONLY (no drag-spam of
  // duplicate placements) — only terrain paint and erase continue on drag.
  if (!isPointerDown || activeTool === "object") return;
  const tile = tileFromPoint(pointFromEvent(e));
  if (!tile) return;
  if (lastPaintedCell && lastPaintedCell.x === tile.x && lastPaintedCell.y === tile.y) return;
  lastPaintedCell = tile;
  applyToolAt(tile.x, tile.y);
}

function onWindowMouseUp(): void {
  isPointerDown = false;
  lastPaintedCell = null;
}

function setupZoomSelect(): void {
  for (const level of ZOOM_LEVELS) {
    const opt = document.createElement("option");
    opt.value = String(level);
    opt.textContent = `${level}x`;
    if (level === DEFAULT_ZOOM) opt.selected = true;
    zoomSelect.appendChild(opt);
  }
  zoomSelect.addEventListener("change", () => {
    zoneCanvas.setZoom(Number(zoomSelect.value) || DEFAULT_ZOOM);
  });
}

async function handleSave(): Promise<void> {
  if (!currentTemplate) return;
  saveBtn.disabled = true;
  saveStatusEl.textContent = "Saving…";
  saveStatusEl.classList.remove("save-status-success");
  try {
    const result = await saveZone(ZONE_ID, currentTemplate);
    if (!result.ok) {
      saveStatusEl.textContent = `Save failed${result.errors[0] ? `: ${result.errors[0].message}` : ""}.`;
      return;
    }
    saveStatusEl.textContent = "Saved. Restart the backend to load the new layout.";
    saveStatusEl.classList.add("save-status-success");
  } catch (e) {
    saveStatusEl.textContent = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    saveBtn.disabled = false;
  }
}

async function boot(): Promise<void> {
  statusEl.textContent = "Loading…";
  try {
    const [atlasRes, zoneRes] = await Promise.all([fetch(ATLAS_ROUTE, { cache: "no-store" }), fetch(ZONE_ROUTE, { cache: "no-store" })]);
    if (!atlasRes.ok) throw new Error(`atlas.json: HTTP ${atlasRes.status}`);
    if (!zoneRes.ok) throw new Error(`zone-${ZONE_ID}.json: HTTP ${zoneRes.status}`);

    atlas = parseAtlas(await atlasRes.json());
    currentTemplate = (await zoneRes.json()) as ZoneTemplate;
    tilesetImage = await loadTilesetImage(atlas.image);

    setupZoomSelect();
    rerender();
    updateActiveToolLabel();

    canvasEl.addEventListener("mousedown", onCanvasMouseDown);
    canvasEl.addEventListener("mousemove", onCanvasMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    saveBtn.addEventListener("click", () => void handleSave());
    eraseBtn.addEventListener("click", () => {
      activeTool = "erase";
      updateActiveToolLabel();
    });

    await createTerrainPalette({
      mountEl: terrainPaletteEl,
      onSelect: (terrainId) => {
        selectedTerrainId = terrainId;
        activeTool = "terrain";
        selectedTerrainLabelEl.textContent = terrainId;
        updateActiveToolLabel();
      },
    });

    await createObjectPalette({
      mountEl: objectPaletteEl,
      onSelect: (objectTypeId) => {
        selectedObjectTypeId = objectTypeId;
        activeTool = "object";
        selectedObjectLabelEl.textContent = objectTypeId;
        updateActiveToolLabel();
      },
    });
  } catch (e) {
    statusEl.textContent = `Failed to load: ${e instanceof Error ? e.message : String(e)}`;
  }
}

void boot();
