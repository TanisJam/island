import type { Event } from "../contract";
import type { ClientSnapshot } from "./snapshot";
import { markVisibleAround } from "./visibility";

/**
 * Mirrors backend/src/domain/reducer.ts `applyEvent` in miniature. This is the ONLY
 * place the client mutates `snapshot` — the client has zero local prediction: every
 * event applied here came back from `POST /commands` as part of a `CommandResult`.
 *
 * `ItemMoved` mapping is the most bug-prone case (per design.md "Risks"): the
 * command-side `Location` (`MoveItem.to` / `ItemMoved.to`) and the resulting
 * `ItemInstance.location` are NOT the same shape — `to.type === "hand"` has no
 * `ItemInstance.location` counterpart at all (there is no "hand" location variant;
 * a hand is just the inventory cell at `handSlots.left`/`handSlots.right`). The
 * mapping below is explicit and intentionally mirrors the backend 1:1 instead of
 * trying to cast `to` directly into `location`.
 */
export function applyClientEvent(snapshot: ClientSnapshot, event: Event): void {
  switch (event.type) {
    case "PlayerMoved": {
      snapshot.player.position = event.position;
      markVisibleAround(snapshot, event.position);
      return;
    }
    case "ItemMoved": {
      const item = snapshot.items.find((i) => i.id === event.itemInstanceId);
      if (!item) return;
      const to = event.to;
      if (to.type === "hand") {
        // No "hand" location variant exists on ItemInstance — a hand IS the
        // player_inventory cell at the matching hand slot coordinates.
        const slot = to.hand === "left" ? snapshot.handSlots.left : snapshot.handSlots.right;
        item.location = { type: "player_inventory", playerId: snapshot.player.id, x: slot.x, y: slot.y, rotation: 0 };
      } else if (to.type === "inventory") {
        item.location = { type: "player_inventory", playerId: to.ownerId, x: to.x, y: to.y, rotation: to.rotation ?? 0 };
      } else if (to.type === "world") {
        item.location = { type: "world", zoneId: to.zoneId, x: to.x, y: to.y };
      } else if (to.type === "surface") {
        item.location = { type: "surface", surfaceId: to.surfaceId, x: to.x, y: to.y, rotation: to.rotation ?? 0 };
      }
      // `container` destinations are out of MVP scope (no containers exist yet in
      // the catalog/seed) — intentionally left unhandled, matching the backend.
      return;
    }
    case "ActiveHandsChanged":
      return; // derived from inventory state; nothing to store client-side either
    case "ItemAddedToInventory":
    case "ItemPlacedInWorld": {
      const item = event.item;
      if (!snapshot.items.some((i) => i.id === item.id)) snapshot.items.push(item);
      return;
    }
    case "ItemRemovedFromInventory":
    case "ItemRemovedFromWorld":
    case "ItemBroke": {
      snapshot.items = snapshot.items.filter((i) => i.id !== event.itemInstanceId);
      return;
    }
    case "PileChanged": {
      // Mirrors the backend reducer: a pile groups >= 2 same-type world items on a
      // tile, so a PileChanged carrying < 2 members means it dissolved and is removed.
      const pile = event.pile;
      const idx = snapshot.piles.findIndex((p) => p.id === pile.id);
      if (pile.itemInstanceIds.length < 2) {
        if (idx >= 0) snapshot.piles.splice(idx, 1);
      } else if (idx >= 0) snapshot.piles[idx] = pile;
      else snapshot.piles.push(pile);
      return;
    }
    case "WorldObjectCreated": {
      if (!snapshot.objects.some((o) => o.id === event.object.id)) snapshot.objects.push(event.object);
      return;
    }
    case "WorldObjectStateChanged": {
      const obj = snapshot.objects.find((o) => o.id === event.objectId);
      if (obj) obj.state = { ...obj.state, ...event.state };
      return;
    }
    case "WorldObjectRemoved": {
      snapshot.objects = snapshot.objects.filter((o) => o.id !== event.objectId);
      return;
    }
    case "TileChanged": {
      const tile = snapshot.tiles.find((t) => t.x === event.position.x && t.y === event.position.y);
      if (tile) {
        tile.terrain = event.terrain;
        tile.walkable = event.walkable;
      }
      return;
    }
    case "TilesRevealed": {
      for (const t of event.tiles) snapshot.discovered.add(`${t.x},${t.y}`);
      return;
    }
    case "EnergyChanged": {
      snapshot.player.energy = event.energy;
      return;
    }
    case "ToolDamaged": {
      const item = snapshot.items.find((i) => i.id === event.itemInstanceId);
      if (item) item.durability = event.durability;
      return;
    }
    case "KnowledgeUnlocked": {
      if (!snapshot.player.knowledge.includes(event.knowledgeId)) snapshot.player.knowledge.push(event.knowledgeId);
      return;
    }
    case "ThoughtAdded": {
      snapshot.thoughtLog.push(event.thought);
      return;
    }
    case "ActionFailed": {
      if (event.thought) snapshot.thoughtLog.push(event.thought);
      return;
    }
  }
}

export function applyClientEvents(snapshot: ClientSnapshot, events: Event[]): void {
  for (const e of events) applyClientEvent(snapshot, e);
}
