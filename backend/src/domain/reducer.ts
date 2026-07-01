import type { Event } from "../contract/events";
import type { CatalogIndex } from "./catalog";
import type { GameState, TerrainId } from "./state";
import { tileAt, tileKey } from "./state";
import { HAND_LEFT, HAND_RIGHT } from "./inventory";
import { markVisibleAround } from "./visibility";

/** Aplica un evento autoritativo al estado en runtime. Es el único lugar que muta el
 *  estado; el motor genera eventos y los aplica con esta función (event-sourced). */
export function applyEvent(s: GameState, index: CatalogIndex, e: Event): void {
  switch (e.type) {
    case "PlayerMoved": {
      s.player.position = e.position;
      markVisibleAround(s, e.position);
      return;
    }
    case "ItemMoved": {
      const it = s.items.find((i) => i.id === e.itemInstanceId);
      if (!it) return;
      const to = e.to;
      if (to.type === "hand") {
        const slot = to.hand === "left" ? HAND_LEFT : HAND_RIGHT;
        it.location = { type: "player_inventory", playerId: s.player.id, x: slot.x, y: slot.y, rotation: 0 };
      } else if (to.type === "inventory") {
        it.location = { type: "player_inventory", playerId: to.ownerId, x: to.x, y: to.y, rotation: to.rotation ?? 0 };
      } else if (to.type === "world") {
        it.location = { type: "world", zoneId: to.zoneId, x: to.x, y: to.y };
      }
      return;
    }
    case "ActiveHandsChanged":
      return; // derivado del estado del inventario; no se persiste aparte
    case "ItemAddedToInventory":
    case "ItemPlacedInWorld": {
      const item = e.item;
      if (!s.items.some((i) => i.id === item.id)) s.items.push(item);
      return;
    }
    case "ItemRemovedFromInventory":
    case "ItemRemovedFromWorld":
    case "ItemBroke": {
      s.items = s.items.filter((i) => i.id !== e.itemInstanceId);
      return;
    }
    case "PileChanged": {
      const idx = s.piles.findIndex((p) => p.id === e.pile.id);
      if (idx >= 0) s.piles[idx] = e.pile;
      else s.piles.push(e.pile);
      return;
    }
    case "WorldObjectCreated": {
      if (!s.objects.some((o) => o.id === e.object.id)) s.objects.push(e.object);
      return;
    }
    case "WorldObjectStateChanged": {
      const o = s.objects.find((x) => x.id === e.objectId);
      if (o) o.state = { ...o.state, ...e.state };
      return;
    }
    case "WorldObjectRemoved": {
      s.objects = s.objects.filter((o) => o.id !== e.objectId);
      return;
    }
    case "TileChanged": {
      const t = tileAt(s, e.position.x, e.position.y);
      if (t) {
        t.terrain = e.terrain as TerrainId;
        t.walkable = e.walkable;
      }
      return;
    }
    case "TilesRevealed": {
      for (const t of e.tiles) s.discovered.add(tileKey(t.x, t.y));
      return;
    }
    case "EnergyChanged": {
      s.player.energy = e.energy;
      return;
    }
    case "ToolDamaged": {
      const it = s.items.find((i) => i.id === e.itemInstanceId);
      if (it) it.durability = e.durability;
      return;
    }
    case "KnowledgeUnlocked": {
      if (!s.player.knowledge.includes(e.knowledgeId)) s.player.knowledge.push(e.knowledgeId);
      return;
    }
    case "ThoughtAdded": {
      s.player.thoughtLog.push(e.thought);
      return;
    }
    case "ActionFailed": {
      if (e.thought) s.player.thoughtLog.push(e.thought);
      return;
    }
  }
}

export function applyAll(s: GameState, index: CatalogIndex, events: Event[]): void {
  for (const e of events) applyEvent(s, index, e);
}
