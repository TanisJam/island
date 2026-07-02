import { footprintFromDrag, pastDragThreshold, type Footprint, type Point } from "./picking";
import { catalogTypeIdsByKind, type CatalogEntry } from "./catalog";
import { buildAtlasExport, type Mapping } from "./atlas-export";
import type { AtlasKind } from "../../src/render/assets";

/** Picking grid size, matches the frozen atlas schema's `tile` field
 * (design.md "Atlas JSON schema (frozen)"). */
const GRID = 16;
const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8] as const;
const DEFAULT_ZOOM = 4;

function mustEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`atlas-editor: missing #${id} in index.html`);
  return el as unknown as T;
}

const fileInput = mustEl<HTMLInputElement>("file-input");
const canvas = mustEl<HTMLCanvasElement>("picking-canvas");
const emptyState = mustEl<HTMLDivElement>("empty-state");
const zoomSelect = mustEl<HTMLSelectElement>("zoom-select");
const readout = mustEl<HTMLDivElement>("readout");
const assignBtn = mustEl<HTMLButtonElement>("assign-btn");
const exportBtn = mustEl<HTMLButtonElement>("export-btn");
const statusEl = mustEl<HTMLDivElement>("status");
const lists: Record<AtlasKind, HTMLUListElement> = {
  terrain: mustEl<HTMLUListElement>("list-terrain"),
  object: mustEl<HTMLUListElement>("list-object"),
  item: mustEl<HTMLUListElement>("list-item"),
  player: mustEl<HTMLUListElement>("list-player"),
};

const ctx: CanvasRenderingContext2D = (() => {
  const c = canvas.getContext("2d");
  if (!c) throw new Error("atlas-editor: no 2D context");
  return c;
})();

let image: HTMLImageElement | null = null;
let imageFilename = "tileset.png";
let zoom: number = DEFAULT_ZOOM;
let dragStart: Point | null = null;
let dragCurrent: Point | null = null;
let isDragging = false;
let selection: Footprint | null = null;
let currentTypeId: string | null = null;
let currentKind: AtlasKind | null = null;
let cachedTypeIdsByKind: Record<AtlasKind, string[]> | null = null;
const mappings = new Map<string, Mapping>();

for (const level of ZOOM_LEVELS) {
  const opt = document.createElement("option");
  opt.value = String(level);
  opt.textContent = `${level}x`;
  if (level === DEFAULT_ZOOM) opt.selected = true;
  zoomSelect.appendChild(opt);
}

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function canvasPointToImagePx(clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
}

/** Redraws the picking canvas: image, grid overlay, and the current
 * selection highlight (design.md "Dev tool architecture"). Called after any
 * state change that affects what should be on screen. */
function render(): void {
  if (!image) {
    canvas.width = 0;
    canvas.height = 0;
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  canvas.width = image.width * zoom;
  canvas.height = image.height * zoom;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= image.width; x += GRID) {
    ctx.beginPath();
    ctx.moveTo(x * zoom + 0.5, 0);
    ctx.lineTo(x * zoom + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= image.height; y += GRID) {
    ctx.beginPath();
    ctx.moveTo(0, y * zoom + 0.5);
    ctx.lineTo(canvas.width, y * zoom + 0.5);
    ctx.stroke();
  }

  const live = isDragging && dragStart && dragCurrent ? footprintFromDrag(dragStart, dragCurrent, GRID) : selection;
  if (live) {
    ctx.strokeStyle = "#f0a24e";
    ctx.lineWidth = 2;
    ctx.strokeRect(live.x * zoom + 1, live.y * zoom + 1, live.w * zoom - 2, live.h * zoom - 2);
    ctx.fillStyle = "rgba(240,162,78,0.15)";
    ctx.fillRect(live.x * zoom, live.y * zoom, live.w * zoom, live.h * zoom);
  }
}

function updateReadout(): void {
  readout.textContent = selection ? `x:${selection.x} y:${selection.y} w:${selection.w} h:${selection.h}` : "No selection";
}

function updateAssignEnabled(): void {
  assignBtn.disabled = !(image && selection && currentTypeId && currentKind);
}

/** Rebuilds the sidebar lists from the currently loaded catalog + the tool's
 * in-memory mappings (spec "Catalog typeId enumeration in the mapping
 * tool"). Re-run after every assignment so "mapped" badges stay in sync. */
function renderSidebar(typeIdsByKind: Record<AtlasKind, string[]>): void {
  (Object.keys(lists) as AtlasKind[]).forEach((kind) => {
    const list = lists[kind];
    list.innerHTML = "";
    for (const typeId of typeIdsByKind[kind]) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-item";
      btn.textContent = typeId;
      const isMapped = mappings.has(typeId);
      btn.classList.toggle("mapped", isMapped);
      btn.classList.toggle("active", currentTypeId === typeId && currentKind === kind);
      if (isMapped) {
        const dot = document.createElement("span");
        dot.className = "mapped-dot";
        dot.setAttribute("aria-label", "assigned");
        btn.appendChild(dot);
      }
      btn.addEventListener("click", () => {
        currentTypeId = typeId;
        currentKind = kind;
        const existing = mappings.get(typeId);
        if (existing) selection = { ...existing.region };
        updateReadout();
        updateAssignEnabled();
        render();
        renderSidebar(typeIdsByKind);
      });
      li.appendChild(btn);
      list.appendChild(li);
    }
  });
}

async function fetchJsonArray(path: string): Promise<CatalogEntry[]> {
  try {
    const res = await fetch(path);
    if (!res.ok) return [];
    return (await res.json()) as CatalogEntry[];
  } catch {
    return [];
  }
}

async function loadCatalog(): Promise<Record<AtlasKind, string[]>> {
  const [terrains, worldObjects, items] = await Promise.all([
    fetchJsonArray("./catalog/terrains.json"),
    fetchJsonArray("./catalog/world-objects.json"),
    fetchJsonArray("./catalog/items.json"),
  ]);
  return catalogTypeIdsByKind(terrains, worldObjects, items);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  imageFilename = file.name;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    image = img;
    URL.revokeObjectURL(url);
    setStatus(`Loaded ${imageFilename} (${img.width}x${img.height})`);
    render();
    updateAssignEnabled();
  };
  img.onerror = () => setStatus(`Failed to load ${file.name}`);
  img.src = url;
});

zoomSelect.addEventListener("change", () => {
  zoom = Number(zoomSelect.value) || DEFAULT_ZOOM;
  render();
});

canvas.addEventListener("mousedown", (e) => {
  if (!image) return;
  dragStart = canvasPointToImagePx(e.clientX, e.clientY);
  dragCurrent = dragStart;
  isDragging = true;
});

canvas.addEventListener("mousemove", (e) => {
  if (!isDragging || !dragStart) return;
  dragCurrent = canvasPointToImagePx(e.clientX, e.clientY);
  render();
});

window.addEventListener("mouseup", (e) => {
  if (!isDragging || !dragStart) return;
  const end = canvasPointToImagePx(e.clientX, e.clientY);
  const startScreen = { x: dragStart.x * zoom, y: dragStart.y * zoom };
  const endScreen = { x: end.x * zoom, y: end.y * zoom };
  const effectiveEnd = pastDragThreshold(startScreen, endScreen) ? end : dragStart;
  selection = footprintFromDrag(dragStart, effectiveEnd, GRID);
  isDragging = false;
  dragStart = null;
  dragCurrent = null;
  updateReadout();
  updateAssignEnabled();
  render();
});

assignBtn.addEventListener("click", () => {
  if (!selection || !currentTypeId || !currentKind) return;
  mappings.set(currentTypeId, { kind: currentKind, typeId: currentTypeId, region: { ...selection } });
  setStatus(`Assigned ${currentTypeId} -> {x:${selection.x}, y:${selection.y}, w:${selection.w}, h:${selection.h}}`);
  if (cachedTypeIdsByKind) renderSidebar(cachedTypeIdsByKind);
});

exportBtn.addEventListener("click", () => {
  const atlas = buildAtlasExport(Array.from(mappings.values()), imageFilename, GRID);
  const blob = new Blob([JSON.stringify(atlas, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "atlas.json";
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported atlas.json (${mappings.size} typeId${mappings.size === 1 ? "" : "s"} mapped)`);
});

async function boot(): Promise<void> {
  setStatus("Loading catalog...");
  try {
    cachedTypeIdsByKind = await loadCatalog();
    renderSidebar(cachedTypeIdsByKind);
    const total = Object.values(cachedTypeIdsByKind).reduce((sum, ids) => sum + ids.length, 0);
    setStatus(`Catalog loaded: ${total} typeIds. Load a tileset PNG to begin.`);
  } catch (e) {
    setStatus(`Failed to load catalog — run "pnpm sync:catalog" first. (${e instanceof Error ? e.message : String(e)})`);
  }
  render();
  updateReadout();
  updateAssignEnabled();
}

void boot();
