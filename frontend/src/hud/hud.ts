import type { Catalog, ItemInstance, Position } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { findCraftable } from "../actions/available";
import { createEmojiAssets } from "../render/assets";

export type HudHandlers = {
  onEquip: (itemInstanceId: string) => void;
  onDrop: (itemInstanceId: string) => void;
};

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
  if (slotEl) slotEl.textContent = item ? itemGlyph(item.itemTypeId) : "";
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

/**
 * Renders the "MIS COSAS" inventory as a `.grid`/`.cell` body (mockup shape,
 * style.css) for the floating window `hud/ui.ts` opens via
 * `Ui.toggleInventory()` (spec "Inventory as Floating Window", design.md
 * File Changes). Equip/drop behavior is unchanged from the old flat list:
 * click an unequipped cell to equip it, click an equipped one to drop it.
 */
export function renderInventoryGrid(catalog: Catalog, snapshot: ClientSnapshot, handlers: HudHandlers): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "grid";

  const items = snapshot.items.filter((it) => it.location.type === "player_inventory");
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "mochila vacía";
    grid.appendChild(empty);
    return grid;
  }

  for (const it of items) {
    const inHand = sameSlot(it, snapshot.handSlots.left) || sameSlot(it, snapshot.handSlots.right);
    const name = itemName(catalog, it.itemTypeId);
    const cell = document.createElement("div");
    cell.className = inHand ? "cell equipped" : "cell";
    cell.textContent = itemGlyph(it.itemTypeId) || name;
    cell.title = `${name} — ${inHand ? "equipado, click para soltar" : "en la mochila, click para equipar"}`;
    cell.addEventListener("click", () => {
      if (inHand) handlers.onDrop(it.id);
      else handlers.onEquip(it.id);
    });
    grid.appendChild(cell);
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
