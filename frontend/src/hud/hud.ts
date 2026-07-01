import type { Catalog, ItemInstance, Position, Thought } from "../contract";
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
