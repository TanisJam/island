import type { Catalog, ItemInstance } from "../contract";
import type { ClientSnapshot } from "./snapshot";

/**
 * Session-only client store of item TYPE ids the player has explicitly
 * "Observado" via the crouch lens (design.md Decision 4, spec Slice A
 * "Observe Dispatched From The Crouch View"). NOT persisted — resets on page
 * reload, same tolerance as every other presentation-only state in this
 * codebase (e.g. `WindowManager`'s open/closed windows). Whether an item's
 * properties are actually REVEALED also depends on unlocked knowledge (see
 * `isRevealed` below), which IS authoritative (`snapshot.player.knowledge`)
 * — this store only covers the client-side "I clicked Observar" fallback for
 * items with no knowledge tie-in.
 */
export type ObservedStore = {
  has(itemTypeId: string): boolean;
  add(itemTypeId: string): void;
};

export function createObservedStore(): ObservedStore {
  const seen = new Set<string>();
  return {
    has: (itemTypeId: string): boolean => seen.has(itemTypeId),
    add: (itemTypeId: string): void => {
      seen.add(itemTypeId);
    },
  };
}

/**
 * Pure: whether `item`'s `properties`/`tags` should be shown in the crouch
 * lens (design.md Decision 4, spec Slice A "Properties hidden before
 * observation" / "Observing unlocks knowledge and reveals properties").
 * True when either:
 *  - the item's TYPE is already in the session `observed` set (optimistic,
 *    set the moment "Observar" is clicked), OR
 *  - a `KnowledgeDef` whose `unlockOnObserveTags` intersects the item's
 *    catalog `tags` is already present in `snapshot.player.knowledge`
 *    (authoritative — the backend already unlocked it via a PRIOR Observe).
 */
export function isRevealed(observed: ObservedStore, catalog: Catalog, snapshot: ClientSnapshot, item: ItemInstance): boolean {
  if (observed.has(item.itemTypeId)) return true;
  const def = catalog.items.find((i) => i.id === item.itemTypeId);
  if (!def) return false;
  return catalog.knowledge.some(
    (k) => snapshot.player.knowledge.includes(k.id) && (k.unlockOnObserveTags ?? []).some((tag) => def.tags.includes(tag)),
  );
}
