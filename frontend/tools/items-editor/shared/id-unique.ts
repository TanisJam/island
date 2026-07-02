/**
 * Editor-enforced id uniqueness (design.md "ADR-6 — Editor-enforced id
 * uniqueness"). Runs on add (new id must not collide) and rename (changed
 * id must not collide with a sibling), blocking Save before it happens.
 * Also enforced server-side inside `planSave` for defense in depth.
 */

export interface IdUniqueCheckable {
  id: string;
}

export interface IdUniqueResult {
  ok: boolean;
  conflictIndex: number | null;
}

/**
 * Checks whether `id` is unique among `items`, excluding `editingIndex`
 * (the item currently being edited/renamed, if any) from the comparison.
 */
export function checkIdUnique(
  items: readonly IdUniqueCheckable[],
  id: string,
  editingIndex?: number,
): IdUniqueResult {
  const conflictIndex = items.findIndex((item, index) => index !== editingIndex && item.id === id);
  return conflictIndex === -1 ? { ok: true, conflictIndex: null } : { ok: false, conflictIndex };
}
