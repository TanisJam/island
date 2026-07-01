import type { Catalog, ItemInstance, Position, Thought } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { findCraftable } from "../actions/available";
import { createEmojiAssets } from "../render/assets";
import type { CellDescriptor } from "./drag";

export type HudHandlers = {
  onEquip: (itemInstanceId: string) => void;
  onDrop: (itemInstanceId: string) => void;
  /** Registers a rendered cell with the drag engine (design.md "Drag
   * wiring") — optional so callers/tests that don't care about drag (yet)
   * don't need to stub it; `game/game.ts` is the only real caller that sets
   * it, wired to `createDragController(...).bindCell`. */
  bindDrag?: (cellEl: HTMLElement, descriptor: CellDescriptor) => void;
};

/** 4x4 player inventory grid dimensions (mirrors the backend's
 * `INV_W`/`INV_H` in `backend/src/domain/inventory.ts` — never hardcode
 * these two numbers anywhere else in this module). */
const INV_W = 4;
const INV_H = 4;

// Reused only for its glyph lookup (item emoji) — the HUD is not a Renderer
// and never touches visibility/fog, it just wants the same stand-in art the
// canvas draws so a hand slot / inventory cell reads at a glance (design.md
// "Asset Resolver Behind a Function" — one glyph table, not a duplicate).
const assets = createEmojiAssets();

function sameSlot(item: ItemInstance, slot: Position): boolean {
  return item.location.type === "player_inventory" && item.location.x === slot.x && item.location.y === slot.y;
}

function itemAtSlot(snapshot: ClientSnapshot, slot: Position): ItemInstance | undefined {
  return snapshot.items.find((it) => sameSlot(it, slot));
}

function itemName(catalog: Catalog, itemTypeId: string): string {
  return catalog.items.find((i) => i.id === itemTypeId)?.name ?? itemTypeId;
}

function itemGlyph(itemTypeId: string): string {
  return assets.resolve("item", itemTypeId).glyph ?? "";
}

function renderHandSlot(catalog: Catalog, item: ItemInstance | undefined, slotId: string, nameId: string): void {
  const slotEl = document.getElementById(slotId);
  const nameEl = document.getElementById(nameId);
  if (slotEl) {
    slotEl.textContent = item ? itemGlyph(item.itemTypeId) : "";
    // Equip-reactive glow (spec "Light-Semantics State Treatments" — the
    // brasa glow around a hand slot reacts to equip state instead of being a
    // static ambient flicker regardless of contents): `.hslot::after` is
    // dormant by default in style.css, `.filled` is what turns the flicker
    // animation on.
    slotEl.classList.toggle("filled", Boolean(item));
  }
  if (nameEl) nameEl.textContent = item ? itemName(catalog, item.itemTypeId) : "-";
}

/**
 * Frameless bottom overlay (spec "Darkness Vignette and Frameless Bottom
 * Overlay" / design.md File Changes): `[left hand] [thought + energy] [right
 * hand]`, no framed panel container. Replaces the old boxed
 * `#hands`/`#energy`/`#inventory` flat list — same data (hand contents,
 * energy, craft hint), new DOM ids (tasks.md 3.3). The flat inventory list is
 * gone; inventory now lives in the floating window rendered by
 * `renderInventoryGrid` below (opened via `Ui.toggleInventory`).
 */
export function renderHud(catalog: Catalog, snapshot: ClientSnapshot, _handlers: HudHandlers): void {
  const left = itemAtSlot(snapshot, snapshot.handSlots.left);
  const right = itemAtSlot(snapshot, snapshot.handSlots.right);
  renderHandSlot(catalog, left, "hand-left", "hand-left-name");
  renderHandSlot(catalog, right, "hand-right", "hand-right-name");

  const energyBarEl = document.getElementById("energy-bar");
  const energyNumEl = document.getElementById("energy-num");
  const pct = snapshot.player.maxEnergy > 0 ? Math.round((100 * snapshot.player.energy) / snapshot.player.maxEnergy) : 0;
  if (energyBarEl) energyBarEl.style.width = `${pct}%`;
  if (energyNumEl) energyNumEl.textContent = `${snapshot.player.energy}/${snapshot.player.maxEnergy}`;

  const hintEl = document.getElementById("hint");
  if (hintEl) {
    const craftable = findCraftable(catalog, snapshot);
    // Voz del juego: mostramos el pensamiento en primera persona ya autorado en el
    // catálogo (thoughts.preview), NO un instructivo con el nombre de la receta. El
    // descubrimiento nace de probar, no de un libro de recetas (pilares §9, §17).
    hintEl.textContent = craftable ? (craftable.thoughts?.preview ?? "Estas piezas cerca... siento que podría armar algo con ellas.") : "";
  }
}

/** Cells (in the PLAYER's own 4x4 inventory coordinates) an inventory-placed
 * item occupies, honoring rotation exactly like `occupiedCellsForItem` does
 * for the mesa — sibling function, NOT a replacement: `occupiedCellsForItem`
 * stays untouched (hud.test.ts asserts it returns `[]` for a player_inventory
 * item, and `renderSurfaceGrid` depends on that). Returns `[]` for any item
 * not currently in `player_inventory` (spec R4 / design.md "New pure fn
 * inventoryCellsForItem"). */
export function inventoryCellsForItem(item: ItemInstance, catalog: Catalog): Position[] {
  if (item.location.type !== "player_inventory") return [];
  const def = catalog.items.find((i) => i.id === item.itemTypeId);
  const w0 = def?.shape.w ?? 1;
  const h0 = def?.shape.h ?? 1;
  const [w, h] = item.location.rotation === 90 ? [h0, w0] : [w0, h0];
  const cells: Position[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: item.location.x + dx, y: item.location.y + dy });
  return cells;
}

/**
 * Renders the "MIS COSAS" inventory as a REAL 4x4 spatial grid (spec R4,
 * AMENDED rev 2 — per-coordinate fill, mirroring `renderSurfaceGrid`'s
 * approach, NOT the mockup's `.cell.span2` spanning model, which would
 * collapse a multi-cell item's coordinates into one DOM element and destroy
 * the lower-half drop target). Always renders exactly 16 cells, including
 * every empty coordinate and both hand slots — there is no "mochila vacía"
 * empty-state branch anymore; an empty inventory is still a full 4x4 grid of
 * drop targets. Tap (equip/drop) is routed through `descriptor.onTap`,
 * invoked by the drag controller on a below-threshold pointerup — NOT a
 * `click` listener — so tap and drag share one deterministic pointer
 * pipeline (design.md decision 5).
 */
export function renderInventoryGrid(catalog: Catalog, snapshot: ClientSnapshot, handlers: HudHandlers): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "grid";

  const items = snapshot.items.filter((it) => it.location.type === "player_inventory");
  const occupantAt = (x: number, y: number): ItemInstance | undefined =>
    items.find((it) => inventoryCellsForItem(it, catalog).some((c) => c.x === x && c.y === y));

  for (let y = 0; y < INV_H; y++) {
    for (let x = 0; x < INV_W; x++) {
      const occupant = occupantAt(x, y);
      // Hand-slot coordinates come from the live snapshot (backend-sourced),
      // never hardcoded (spec R4 / design.md "hand-slot detection sourced
      // from snapshot.handSlots.left/right").
      const isLeftHand = x === snapshot.handSlots.left.x && y === snapshot.handSlots.left.y;
      const isRightHand = x === snapshot.handSlots.right.x && y === snapshot.handSlots.right.y;
      const isHandSlot = isLeftHand || isRightHand;

      const cell = document.createElement("div");
      const classes = ["cell"];
      let onTap: (() => void) | undefined;

      if (occupant) {
        classes.push("filled");
        if (isHandSlot) classes.push("equipped");
        const name = itemName(catalog, occupant.itemTypeId);
        cell.textContent = itemGlyph(occupant.itemTypeId) || name;
        cell.title = `${name} — ${isHandSlot ? "equipado, click para soltar" : "en la mochila, click para equipar"}`;
        const occupantId = occupant.id;
        onTap = isHandSlot ? () => handlers.onDrop(occupantId) : () => handlers.onEquip(occupantId);
      } else if (isHandSlot) {
        // Empty hand slot: dashed border + "mano" label (style.css), no tap
        // action — nothing to equip/drop from an empty slot.
        classes.push("hand");
      }
      cell.className = classes.join(" ");

      const descriptor: CellDescriptor = isLeftHand
        ? { kind: "hand", hand: "left", occupant, onTap }
        : isRightHand
          ? { kind: "hand", hand: "right", occupant, onTap }
          : { kind: "inventory", x, y, occupant, onTap };
      handlers.bindDrag?.(cell, descriptor);

      grid.appendChild(cell);
    }
  }
  return grid;
}

/** Cells (in the SURFACE's own local grid coordinates) a surface-placed item
 * occupies, honoring rotation the same way the backend's `occupiedCells`/
 * `cellsOnGrid` does (`backend/src/domain/inventory.ts`) — a 90° rotation
 * swaps the catalog-declared `shape.w`/`shape.h`. Pure and pairs with
 * `renderSurfaceGrid` below: items not currently on ANY surface
 * (`location.type !== "surface"`) occupy nothing. */
export function occupiedCellsForItem(item: ItemInstance, catalog: Catalog): Position[] {
  if (item.location.type !== "surface") return [];
  const def = catalog.items.find((i) => i.id === item.itemTypeId);
  const w0 = def?.shape.w ?? 1;
  const h0 = def?.shape.h ?? 1;
  const [w, h] = item.location.rotation === 90 ? [h0, w0] : [w0, h0];
  const cells: Position[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: item.location.x + dx, y: item.location.y + dy });
  return cells;
}

export type SurfaceGridHandlers = {
  /** Fired when a grid cell is clicked; `item` is the occupant at that cell,
   * or `undefined` for an empty cell — same "always react, never silently
   * ignore a click" pattern used across this module. */
  onCellClick: (item: ItemInstance | undefined) => void;
  /** Same drag registration as `HudHandlers.bindDrag` — the mesa is a valid
   * drop target (inventory/hand -> surface) AND its occupied cells are drag
   * sources (surface -> inventory), design.md "Registration covers ...
   * surface cells". The existing `click` listener below is UNCHANGED (no
   * regression to the surface-inspect click) — `bindCell` only ADDS drag
   * capability alongside it, it never replaces the tap path here. */
  bindDrag?: (cellEl: HTMLElement, descriptor: CellDescriptor) => void;
};

/** First-person cell-inspect line for the "Usar la mesa" window (mirrors
 * `describeSelection`'s style in `input/mouse.ts`) — exported so it's a pure,
 * independently testable unit, not buried inside a DOM click listener. */
export function surfaceCellMessage(catalog: Catalog, item: ItemInstance | undefined): string {
  if (!item) return "Esa celda está vacía.";
  return `Ahí está ${itemName(catalog, item.itemTypeId)}.`;
}

/**
 * Renders the "LA MESA" surface-grid window body (spec R7 / design.md 7c): a
 * REAL `dims.width`×`dims.height` spatial grid — unlike `renderInventoryGrid`
 * (a flat list), cell position here is the whole point, since it's what
 * placement means. Reflects `snapshot.items` filtered to
 * `location.type==="surface" && location.surfaceId===surfaceId` (R7, merged
 * client-side by `state/snapshot.ts`'s `buildSnapshot`) — never mock/static
 * data. Reuses the `.grid`/`.cell` styling `renderInventoryGrid` already
 * uses, with an inline `grid-template-columns` override sized to `dims.width`
 * (the shared CSS rule hardcodes 4 columns for the 4×4 player inventory).
 */
export function renderSurfaceGrid(
  catalog: Catalog,
  snapshot: ClientSnapshot,
  surfaceId: string,
  dims: { width: number; height: number },
  handlers: SurfaceGridHandlers,
): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "grid";
  grid.style.gridTemplateColumns = `repeat(${dims.width}, 52px)`;

  const placed = snapshot.items.filter((it) => it.location.type === "surface" && it.location.surfaceId === surfaceId);
  const occupantAt = (x: number, y: number): ItemInstance | undefined =>
    placed.find((it) => occupiedCellsForItem(it, catalog).some((c) => c.x === x && c.y === y));

  for (let y = 0; y < dims.height; y++) {
    for (let x = 0; x < dims.width; x++) {
      const occupant = occupantAt(x, y);
      const cell = document.createElement("div");
      cell.className = occupant ? "cell filled" : "cell";
      if (occupant) {
        const name = itemName(catalog, occupant.itemTypeId);
        cell.textContent = itemGlyph(occupant.itemTypeId) || name;
        cell.title = name;
      }
      cell.addEventListener("click", () => handlers.onCellClick(occupant));
      handlers.bindDrag?.(cell, { kind: "surface", surfaceId, x, y, occupant });
      grid.appendChild(cell);
    }
  }
  return grid;
}

export function showThought(text: string): void {
  const thoughtEl = document.getElementById("thought");
  if (thoughtEl) thoughtEl.textContent = text;
}

export function showLatestThought(snapshot: ClientSnapshot): void {
  const last = snapshot.thoughtLog[snapshot.thoughtLog.length - 1];
  showThought(last ? last.text : "");
}

/**
 * Renders `snapshot.thoughtLog` as a `.body`-shaped list, MOST RECENT FIRST,
 * for the "Ver mis pensamientos" floating window (spec "Self Click-Target
 * Resolution" names "view inventory, view thoughts" as two distinct self
 * actions — before this fix both routed to the inventory window). Read-only:
 * no `HudHandlers` needed, unlike the inventory grid.
 */
export function renderThoughtsBody(snapshot: ClientSnapshot): HTMLElement {
  const list = document.createElement("div");
  list.className = "thoughts-list";

  if (snapshot.thoughtLog.length === 0) {
    const empty = document.createElement("div");
    empty.className = "act mute";
    empty.textContent = "Todavía no pensé nada digno de recordar.";
    list.appendChild(empty);
    return list;
  }

  for (const t of [...snapshot.thoughtLog].reverse()) {
    const row = document.createElement("div");
    row.className = "act";
    row.textContent = t.text;
    list.appendChild(row);
  }
  return list;
}

/**
 * One-shot warm "descubrimiento" flare (spec "Light-Semantics State
 * Treatments", explicit MUST — previously unimplemented). Triggered by
 * `hud/ui.ts` whenever a NEW `discovery`-kind thought lands in the store.
 * Adds `.flare` to `#vignette` for one animation cycle then removes it, so it
 * can retrigger on the next discovery even mid-flare. Respects
 * `prefers-reduced-motion` (the global kill-switch in style.css already
 * neutralizes the animation, but skipping the class entirely avoids a
 * pointless reflow/timer under that preference).
 */
export function flashDiscovery(): void {
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const vignette = document.getElementById("vignette");
  if (!vignette) return;
  vignette.classList.remove("flare");
  void vignette.offsetWidth; // force a reflow so re-adding the class restarts the animation
  vignette.classList.add("flare");
  window.setTimeout(() => vignette.classList.remove("flare"), 900);
}

/** Pure: true when `thoughts` contains at least one `discovery`-kind entry —
 * the trigger condition for `flashDiscovery()`. Split out so the "should a
 * new batch of thoughts trigger a flare" decision is unit-testable without a
 * DOM (`hud/ui.test.ts`). */
export function hasDiscoveryThought(thoughts: Thought[]): boolean {
  return thoughts.some((t) => t.kind === "discovery");
}

/** Ids of every item CURRENTLY in `player_inventory`. Used by `hud/ui.ts`'s
 * `mount()` rerender to snapshot "what's in the inventory right now" before
 * and after each `Store.ingest`, so it can diff the two and detect items
 * that just entered the inventory (see `newlyAddedToInventory`). */
export function inventoryItemIds(snapshot: ClientSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const it of snapshot.items) if (it.location.type === "player_inventory") ids.add(it.id);
  return ids;
}

/**
 * Pure: items in `snapshot`'s inventory whose id was NOT in `previousIds` —
 * i.e. items whose `location.type` just became `"player_inventory"` since
 * the last snapshot read (frontend-only "item added to inventory"
 * notification — a fix-list item explicitly calling for detecting this from
 * the event/state flow, e.g. "compare inventory contents before/after
 * `Store.ingest`"). Split out from `hud/ui.ts` (same "extract the pure
 * decision" pattern as `hasDiscoveryThought`) so the detection logic is
 * unit-testable without a DOM. */
export function newlyAddedToInventory(previousIds: ReadonlySet<string>, snapshot: ClientSnapshot): ItemInstance[] {
  return snapshot.items.filter((it) => it.location.type === "player_inventory" && !previousIds.has(it.id));
}

/**
 * Builds the one-line, first-person "just added to inventory" notification
 * for a batch of newly-added items (fix-list: "No feedback when an item is
 * added to the inventory" — frontend-only, game voice, Spanish). One line
 * per BATCH (not per item) so e.g. picking up a pile in one action doesn't
 * spam multiple lines.
 */
export function inventoryAddedMessage(catalog: Catalog, items: ItemInstance[]): string {
  const names = items.map((it) => itemName(catalog, it.itemTypeId));
  const last = names[names.length - 1];
  const joined = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${last}` : (last ?? "");
  return `Guardé ${joined} en la mochila.`;
}
