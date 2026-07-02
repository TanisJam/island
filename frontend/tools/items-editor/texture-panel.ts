import { footprintFromDrag, pastDragThreshold, type Footprint, type Point } from "../shared/picking";
import { parseAtlas, type Atlas } from "../../src/render/assets";
import { buildSavePayload, imagePxFromClientPoint, previewScale } from "./texture-panel-math";

/**
 * Self-contained texture panel controller for the items-editor detail view
 * (design.md "Slice C — Texture panel UI"). Owns its own DOM subtree
 * (mounted into `#texture-panel-mount`), the one-time tileset `Image` load,
 * a fresh-every-select `/atlas.json` fetch, the small panel-local render
 * loop, mouse wiring, and the `/__save-atlas` POSTs. Deliberately NOT
 * extracted into a shared renderer with atlas-editor (design.md Decision 1).
 *
 * DECOUPLING (ui-ux-pro-max + design.md): this panel has its OWN save
 * button, OWN status, OWN POST path (`/__save-atlas`). It never touches
 * `items[]`, `isDirty()`, `beforeunload`, or the `/__save-items` flow in
 * `main.ts` — atlas edits persist immediately and independently of the item
 * form's save.
 *
 * SECURITY (gate-review note 1): every POST to `/__save-atlas` is built via
 * `buildSavePayload`, which emits ONLY `{typeId, region}` or
 * `{typeId, clear:true}` — never a full atlas, never a path/file field.
 *
 * FRESHNESS (gate-review note 2): `/atlas.json` is re-fetched fresh
 * (`cache: "no-store"`) on every `selectItem` call and again after a
 * successful save/clear — the panel never trusts a stale client-side copy,
 * matching the server's own fresh-read guarantee (spec "Concurrent edit is
 * not clobbered").
 */

const GRID = 16;
const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8] as const;
const DEFAULT_ZOOM = 4;
const PREVIEW_MAX_PX = 96;
const SAVE_ROUTE = "/__save-atlas";
const ATLAS_ROUTE = "/atlas.json";

export interface TexturePanelOptions {
  mountEl: HTMLElement;
}

export interface TexturePanelHandle {
  selectItem(typeId: string): void;
  clearSelection(): void;
  destroy(): void;
}

type SaveAtlasResponse = { ok: true; region: { x: number; y: number; w: number; h: number } | null } | { ok: false; errors?: Array<{ instancePath: string; message: string }> };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createTexturePanel({ mountEl }: TexturePanelOptions): TexturePanelHandle {
  mountEl.innerHTML = "";
  mountEl.classList.add("texture-panel-body");

  const idleEl = el("div", "tp-state tp-idle", "Select an item to edit its sprite.");
  const loadingEl = el("div", "tp-state tp-loading", "Loading tileset…");
  const errorEl = el("div", "tp-state tp-error");
  errorEl.setAttribute("role", "alert");
  const errorMessageEl = el("p", "tp-error-message");
  const retryBtn = el("button", "btn btn-secondary tp-retry-btn", "Retry");
  retryBtn.type = "button";
  errorEl.append(errorMessageEl, retryBtn);

  const contentEl = el("div", "tp-content");

  const previewRow = el("div", "tp-preview-row");
  const previewBox = el("div", "tp-preview-box");
  const previewCanvas = el("canvas", "tp-preview-canvas");
  previewCanvas.setAttribute("role", "img");
  const previewEmptyEl = el("div", "tp-preview-empty", "No sprite assigned — pick one below.");
  previewBox.append(previewCanvas, previewEmptyEl);
  const previewCtx = previewCanvas.getContext("2d");
  previewRow.append(previewBox);
  contentEl.append(previewRow);

  const toolbar = el("div", "tp-toolbar");
  const zoomLabel = el("label", "tp-zoom-label", "Zoom ");
  const zoomSelect = el("select", "tp-zoom-select");
  for (const level of ZOOM_LEVELS) {
    const opt = document.createElement("option");
    opt.value = String(level);
    opt.textContent = `${level}x`;
    if (level === DEFAULT_ZOOM) opt.selected = true;
    zoomSelect.appendChild(opt);
  }
  zoomLabel.appendChild(zoomSelect);
  const readoutEl = el("div", "tp-readout", "No selection");
  toolbar.append(zoomLabel, readoutEl);
  contentEl.append(toolbar);

  const canvasWrap = el("div", "tp-canvas-wrap");
  const pickerCanvas = el("canvas", "tp-picker-canvas");
  pickerCanvas.setAttribute("role", "img");
  pickerCanvas.setAttribute("aria-label", "Tileset picker — click a cell or drag to select a sprite region");
  const pickerCtx = pickerCanvas.getContext("2d");
  canvasWrap.appendChild(pickerCanvas);
  contentEl.append(canvasWrap);

  const actionsEl = el("div", "tp-actions");
  const saveBtn = el("button", "btn btn-primary tp-save-btn", "Save texture");
  saveBtn.type = "button";
  const clearBtn = el("button", "btn btn-danger tp-clear-btn", "Clear texture");
  clearBtn.type = "button";
  const statusEl = el("span", "tp-status", "");
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");
  actionsEl.append(saveBtn, clearBtn, statusEl);
  contentEl.append(actionsEl);

  mountEl.append(idleEl, loadingEl, errorEl, contentEl);

  let currentTypeId: string | null = null;
  let atlas: Atlas | null = null;
  let selection: Footprint | null = null;
  let tilesetImage: HTMLImageElement | null = null;
  let tilesetImageName: string | null = null;
  let zoom: number = DEFAULT_ZOOM;
  let dragStart: Point | null = null;
  let dragCurrent: Point | null = null;
  let isDragging = false;
  let requestToken = 0;

  function setPanelState(state: "idle" | "loading" | "error" | "ready", message?: string): void {
    idleEl.hidden = state !== "idle";
    loadingEl.hidden = state !== "loading";
    errorEl.hidden = state !== "error";
    contentEl.hidden = state !== "ready";
    if (state === "error") errorMessageEl.textContent = message ?? "Failed to load the tileset.";
  }

  function setStatus(message: string, tone: "success" | "info" = "info"): void {
    statusEl.textContent = message;
    statusEl.classList.toggle("tp-status-success", tone === "success");
  }

  function updateReadout(): void {
    readoutEl.textContent = selection ? `x:${selection.x} y:${selection.y} w:${selection.w} h:${selection.h}` : "No selection";
  }

  function updateActionsEnabled(): void {
    saveBtn.disabled = !currentTypeId || !selection;
    clearBtn.disabled = !currentTypeId;
  }

  function renderPreview(): void {
    const hasRegion = selection !== null;
    previewEmptyEl.hidden = hasRegion;
    previewCanvas.hidden = !hasRegion;
    if (!hasRegion || !tilesetImage || !previewCtx) return;
    const { dw, dh } = previewScale({ w: selection!.w, h: selection!.h }, PREVIEW_MAX_PX);
    previewCanvas.width = dw;
    previewCanvas.height = dh;
    previewCanvas.setAttribute("aria-label", `Sprite preview for ${currentTypeId} (${selection!.w}x${selection!.h}px)`);
    previewCtx.imageSmoothingEnabled = false;
    previewCtx.clearRect(0, 0, dw, dh);
    previewCtx.drawImage(tilesetImage, selection!.x, selection!.y, selection!.w, selection!.h, 0, 0, dw, dh);
  }

  /** ~40-line panel-local render loop (design.md Decision 1 — no shared
   * renderer extraction in v1); draws the tileset, a grid overlay, and the
   * live-drag or committed selection highlight. */
  function renderPicker(): void {
    if (!tilesetImage || !pickerCtx) {
      pickerCanvas.width = 0;
      pickerCanvas.height = 0;
      return;
    }
    const img = tilesetImage;
    pickerCanvas.width = img.width * zoom;
    pickerCanvas.height = img.height * zoom;
    pickerCtx.imageSmoothingEnabled = false;
    pickerCtx.drawImage(img, 0, 0, pickerCanvas.width, pickerCanvas.height);

    pickerCtx.strokeStyle = "rgba(255,255,255,0.25)";
    pickerCtx.lineWidth = 1;
    for (let x = 0; x <= img.width; x += GRID) {
      pickerCtx.beginPath();
      pickerCtx.moveTo(x * zoom + 0.5, 0);
      pickerCtx.lineTo(x * zoom + 0.5, pickerCanvas.height);
      pickerCtx.stroke();
    }
    for (let y = 0; y <= img.height; y += GRID) {
      pickerCtx.beginPath();
      pickerCtx.moveTo(0, y * zoom + 0.5);
      pickerCtx.lineTo(pickerCanvas.width, y * zoom + 0.5);
      pickerCtx.stroke();
    }

    const live = isDragging && dragStart && dragCurrent ? footprintFromDrag(dragStart, dragCurrent, GRID) : selection;
    if (live) {
      pickerCtx.strokeStyle = "#f0a24e";
      pickerCtx.lineWidth = 2;
      pickerCtx.strokeRect(live.x * zoom + 1, live.y * zoom + 1, live.w * zoom - 2, live.h * zoom - 2);
      pickerCtx.fillStyle = "rgba(240,162,78,0.15)";
      pickerCtx.fillRect(live.x * zoom, live.y * zoom, live.w * zoom, live.h * zoom);
    }
  }

  function renderAll(): void {
    renderPreview();
    renderPicker();
    updateReadout();
    updateActionsEnabled();
  }

  async function loadAtlasFresh(): Promise<Atlas> {
    const res = await fetch(ATLAS_ROUTE, { cache: "no-store" });
    if (!res.ok) throw new Error(`atlas.json: HTTP ${res.status}`);
    return parseAtlas(await res.json());
  }

  async function ensureTileset(imageName: string): Promise<HTMLImageElement> {
    if (tilesetImage && tilesetImageName === imageName) return tilesetImage;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error(`Failed to load tileset image "${imageName}"`));
      candidate.src = `/${imageName}`;
    });
    tilesetImage = img;
    tilesetImageName = imageName;
    return img;
  }

  function selectItem(typeId: string): void {
    currentTypeId = typeId;
    selection = null;
    const token = ++requestToken;
    setPanelState("loading");
    void (async () => {
      try {
        const freshAtlas = await loadAtlasFresh();
        await ensureTileset(freshAtlas.image);
        if (token !== requestToken) return; // superseded by a newer selectItem/clearSelection
        atlas = freshAtlas;
        const region = atlas.item?.[typeId] ?? null;
        selection = region ? { x: region.x, y: region.y, w: region.w, h: region.h } : null;
        setStatus("");
        setPanelState("ready");
        renderAll();
      } catch (e) {
        if (token !== requestToken) return;
        setPanelState("error", e instanceof Error ? e.message : String(e));
      }
    })();
  }

  function clearSelection(): void {
    currentTypeId = null;
    atlas = null;
    selection = null;
    isDragging = false;
    dragStart = null;
    dragCurrent = null;
    requestToken += 1; // invalidate any in-flight selectItem load
    setStatus("");
    setPanelState("idle");
  }

  async function postAtlasSave(typeId: string, region: Footprint | null): Promise<SaveAtlasResponse> {
    const res = await fetch(SAVE_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // gate-review note 1: EXACTLY {typeId, region} or {typeId, clear:true}
      // — never a full atlas, path, or file field.
      body: JSON.stringify(buildSavePayload(typeId, region)),
    });
    return (await res.json()) as SaveAtlasResponse;
  }

  async function handleSave(): Promise<void> {
    if (!currentTypeId || !selection) return;
    const typeId = currentTypeId;
    saveBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("Saving…");
    try {
      const body = await postAtlasSave(typeId, selection);
      if (!body.ok) {
        setStatus(`Save failed${body.errors?.[0] ? `: ${body.errors[0].message}` : ""}.`);
        return;
      }
      // gate-review note 2: re-fetch fresh rather than trusting our own
      // in-memory copy after the write.
      atlas = await loadAtlasFresh();
      const region = atlas.item?.[typeId] ?? null;
      selection = region ? { x: region.x, y: region.y, w: region.w, h: region.h } : null;
      setStatus("Saved.", "success");
      renderPreview();
      renderPicker();
      updateReadout();
    } catch (e) {
      setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      updateActionsEnabled();
    }
  }

  async function handleClear(): Promise<void> {
    if (!currentTypeId) return;
    const typeId = currentTypeId;
    const confirmed = window.confirm(`Clear the sprite mapping for "${typeId}"? This cannot be undone once saved.`);
    if (!confirmed) return;
    saveBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("Clearing…");
    try {
      const body = await postAtlasSave(typeId, null);
      if (!body.ok) {
        setStatus(`Clear failed${body.errors?.[0] ? `: ${body.errors[0].message}` : ""}.`);
        return;
      }
      atlas = await loadAtlasFresh();
      selection = null;
      setStatus("Cleared.", "success");
      renderPreview();
      renderPicker();
      updateReadout();
    } catch (e) {
      setStatus(`Clear failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      updateActionsEnabled();
    }
  }

  function canvasOrigin(): Point {
    const rect = pickerCanvas.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  function onMouseDown(e: MouseEvent): void {
    if (!tilesetImage) return;
    dragStart = imagePxFromClientPoint({ x: e.clientX, y: e.clientY }, canvasOrigin(), zoom);
    dragCurrent = dragStart;
    isDragging = true;
  }

  function onMouseMove(e: MouseEvent): void {
    if (!isDragging || !dragStart) return;
    dragCurrent = imagePxFromClientPoint({ x: e.clientX, y: e.clientY }, canvasOrigin(), zoom);
    renderPicker();
  }

  function onWindowMouseUp(e: MouseEvent): void {
    if (!isDragging || !dragStart) return;
    const end = imagePxFromClientPoint({ x: e.clientX, y: e.clientY }, canvasOrigin(), zoom);
    const startScreen = { x: dragStart.x * zoom, y: dragStart.y * zoom };
    const endScreen = { x: end.x * zoom, y: end.y * zoom };
    const effectiveEnd = pastDragThreshold(startScreen, endScreen) ? end : dragStart;
    selection = footprintFromDrag(dragStart, effectiveEnd, GRID);
    isDragging = false;
    dragStart = null;
    dragCurrent = null;
    updateReadout();
    updateActionsEnabled();
    renderPicker();
    renderPreview();
  }

  zoomSelect.addEventListener("change", () => {
    zoom = Number(zoomSelect.value) || DEFAULT_ZOOM;
    renderPicker();
  });
  pickerCanvas.addEventListener("mousedown", onMouseDown);
  pickerCanvas.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);
  saveBtn.addEventListener("click", () => void handleSave());
  clearBtn.addEventListener("click", () => void handleClear());
  retryBtn.addEventListener("click", () => {
    if (currentTypeId) selectItem(currentTypeId);
  });

  setPanelState("idle");
  updateActionsEnabled();

  function destroy(): void {
    window.removeEventListener("mouseup", onWindowMouseUp);
    mountEl.innerHTML = "";
  }

  return { selectItem, clearSelection, destroy };
}
