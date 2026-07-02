import type { ItemTypeDef } from "../../../src/contract/catalog";

/**
 * The in-memory form state for an `ItemTypeDef` edit. Optional fields
 * (`durability`, `observation`) are modeled as `undefined` rather than
 * `null`/`0` so a cleared field can be told apart from an explicit `0`
 * (spec "Optional field can be cleared").
 */
export interface ItemFormState {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  rotatable: boolean;
  properties: Record<string, number>;
  tags: string[];
  durability?: number;
  observation?: string;
}

/**
 * Converts an in-memory form state into a schema-valid `ItemTypeDef`.
 * Absent optionals are OMITTED entirely — never emitted as `null`/`0` —
 * because every level of the schema has `additionalProperties: false`, so
 * any stray key would fail the backend's fail-fast boot validation
 * (design.md "Pure, testable modules").
 */
export function normalizeItem(form: ItemFormState): ItemTypeDef {
  const item: ItemTypeDef = {
    id: form.id,
    name: form.name,
    description: form.description,
    shape: { w: form.width, h: form.height },
    rotatable: form.rotatable,
    properties: { ...form.properties },
    tags: [...form.tags],
  };
  if (form.durability !== undefined) {
    item.durability = form.durability;
  }
  if (form.observation !== undefined) {
    item.observation = form.observation;
  }
  return item;
}

/** Inverse of `normalizeItem` — used to seed the form when an item is selected. */
export function itemToFormState(item: ItemTypeDef): ItemFormState {
  const form: ItemFormState = {
    id: item.id,
    name: item.name,
    description: item.description,
    width: item.shape.w,
    height: item.shape.h,
    rotatable: item.rotatable,
    properties: { ...item.properties },
    tags: [...item.tags],
  };
  if (item.durability !== undefined) {
    form.durability = item.durability;
  }
  if (item.observation !== undefined) {
    form.observation = item.observation;
  }
  return form;
}
