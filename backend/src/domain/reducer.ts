import type { Event } from "../contract/events";
import type { CatalogIndex } from "./catalog";
import type { GameState, TerrainId } from "./state";
import { MIN_PILE, tileAt, tileKey } from "./state";
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
      } else if (to.type === "surface") {
        it.location = { type: "surface", surfaceId: to.surfaceId, x: to.x, y: to.y, rotation: to.rotation ?? 0 };
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
      // A pile groups >= 2 same-type world items on a tile; fewer than 2 means it
      // dissolved, so a PileChanged carrying < 2 members removes it (no PileRemoved event).
      const idx = s.piles.findIndex((p) => p.id === e.pile.id);
      if (e.pile.itemInstanceIds.length < MIN_PILE) {
        if (idx >= 0) s.piles.splice(idx, 1);
      } else if (idx >= 0) s.piles[idx] = e.pile;
      else s.piles.push(e.pile);
      return;
    }
    case "WorldObjectCreated": {
      if (!s.objects.some((o) => o.id === e.object.id)) s.objects.push(e.object);
      const def = index.objectById.get(e.object.objectTypeId);
      if (def?.surfaceGrid) {
        s.inventories[e.object.id] = { width: def.surfaceGrid.w, height: def.surfaceGrid.h };
      }
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
    case "CombinationAttempted": {
      s.combinationAttempts[e.signature] = (s.combinationAttempts[e.signature] ?? 0) + 1;
      return;
    }
  }
}

export function applyAll(s: GameState, index: CatalogIndex, events: Event[]): void {
  for (const e of events) applyEvent(s, index, e);
}
