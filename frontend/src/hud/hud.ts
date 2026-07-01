import type { Catalog, ItemInstance, Position } from "../contract";
import type { ClientSnapshot } from "../state/snapshot";
import { findCraftable } from "../actions/available";

export type HudHandlers = {
  onEquip: (itemInstanceId: string) => void;
  onDrop: (itemInstanceId: string) => void;
};

function sameSlot(item: ItemInstance, slot: Position): boolean {
  return item.location.type === "player_inventory" && item.location.x === slot.x && item.location.y === slot.y;
}

function itemAtSlot(snapshot: ClientSnapshot, slot: Position): ItemInstance | undefined {
  return snapshot.items.find((it) => sameSlot(it, slot));
}

function itemName(catalog: Catalog, itemTypeId: string): string {
  return catalog.items.find((i) => i.id === itemTypeId)?.name ?? itemTypeId;
}

function actionLink(text: string, onClick: () => void): HTMLElement {
  const a = document.createElement("a");
  a.textContent = text;
  a.className = "inv-action";
  a.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return a;
}

/** HUD DOM: resumen de manos + energía, y un inventario interactivo donde cada item
 *  (en mano o en la mochila) se puede equipar y/o soltar. Es lo que hace jugable el
 *  loop: soltar materiales al lado para improvisar, equipar la herramienta, etc. */
export function renderHud(catalog: Catalog, snapshot: ClientSnapshot, handlers: HudHandlers): void {
  const handsEl = document.getElementById("hands");
  const energyEl = document.getElementById("energy");
  const inventoryEl = document.getElementById("inventory");

  const left = itemAtSlot(snapshot, snapshot.handSlots.left);
  const right = itemAtSlot(snapshot, snapshot.handSlots.right);
  if (handsEl) {
    const leftName = left ? itemName(catalog, left.itemTypeId) : "-";
    const rightName = right ? itemName(catalog, right.itemTypeId) : "-";
    handsEl.textContent = `manos: ${leftName} / ${rightName}`;
  }

  if (energyEl) energyEl.textContent = `energía: ${snapshot.player.energy}/${snapshot.player.maxEnergy}`;

  const hintEl = document.getElementById("hint");
  if (hintEl) {
    const craftable = findCraftable(catalog, snapshot);
    // Voz del juego: mostramos el pensamiento en primera persona ya autorado en el
    // catálogo (thoughts.preview), NO un instructivo con el nombre de la receta. El
    // descubrimiento nace de probar, no de un libro de recetas (pilares §9, §17).
    hintEl.textContent = craftable ? (craftable.thoughts?.preview ?? "Estas piezas cerca... siento que podría armar algo con ellas.") : "";
  }

  if (!inventoryEl) return;
  inventoryEl.innerHTML = "";
  const items = snapshot.items.filter((it) => it.location.type === "player_inventory");
  if (items.length === 0) {
    inventoryEl.textContent = "mochila vacía";
    return;
  }
  const handFree = !left || !right;
  for (const it of items) {
    const inHand = sameSlot(it, snapshot.handSlots.left) || sameSlot(it, snapshot.handSlots.right);
    const row = document.createElement("span");
    row.className = "inv-item";

    const label = document.createElement("b");
    label.textContent = `${inHand ? "✋ " : ""}${itemName(catalog, it.itemTypeId)}`;
    row.appendChild(label);

    if (!inHand && handFree) row.appendChild(actionLink("equipar", () => handlers.onEquip(it.id)));
    row.appendChild(actionLink("soltar", () => handlers.onDrop(it.id)));

    inventoryEl.appendChild(row);
  }
}

export function showThought(text: string): void {
  const teletypeEl = document.getElementById("teletype");
  if (teletypeEl) teletypeEl.textContent = text;
}

export function showLatestThought(snapshot: ClientSnapshot): void {
  const last = snapshot.thoughtLog[snapshot.thoughtLog.length - 1];
  showThought(last ? last.text : "");
}
