import type { CollectionDescriptor } from "./types";

/**
 * `world-objects` collection descriptor (design.md section 5, tasks.md
 * Slice 4). Concentrates the 2 new widget kinds built this slice:
 * `surfaceGrid` (`shape`, `optionalObject: true` — present/absent, unlike
 * `items.shape`'s always-present required mode), `defaultState` (`rawJson`
 * — freeform object, ajv `{type:object}` stays the server-side authority),
 * and `observationByState` (`stringMap`). `states` reuses the plain `tags`
 * widget (an array of free strings, same as `items.tags`).
 *
 * `atlasKind: "object"` on the registry entry (already set) means
 * `engine.ts` mounts the generalized texture panel (Slice 3b) for this
 * collection with zero new panel code.
 *
 * Field keys and required-ness are verified against
 * `schemas/catalog.json#/definitions/WorldObjectTypeDef` by
 * `world-objects.test.ts`'s guardrail.
 */
export const WORLD_OBJECTS_DESCRIPTOR: CollectionDescriptor = {
  collectionId: "world-objects",
  fields: [
    { key: "id", label: "Id", kind: "text", required: true, isId: true },
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "description", label: "Description", kind: "multiline", required: true, fullWidth: true },
    { key: "tags", label: "Tags", kind: "tags", required: true, fullWidth: true },
    { key: "blocksMovement", label: "Blocks movement", kind: "boolean", required: true },
    {
      key: "states",
      label: "States",
      kind: "tags",
      required: false,
      fullWidth: true,
      helperText: "Optional — free-form state names this object can be in.",
    },
    {
      key: "surfaceGrid",
      label: "Surface grid",
      kind: "shape",
      required: false,
      optionalObject: true,
      helperText: 'Optional — check "Set" to give this object a surface grid (width x height).',
    },
    {
      key: "observation",
      label: "Observation",
      kind: "multiline",
      required: false,
      fullWidth: true,
      helperText: "Optional — leave empty to omit.",
    },
    {
      key: "defaultState",
      label: "Default state",
      kind: "rawJson",
      required: false,
      fullWidth: true,
      helperText: 'Optional — raw JSON object, e.g. {"lit":false,"fuel":0}. Leave empty to omit.',
    },
    {
      key: "observationByState",
      label: "Observation by state",
      kind: "stringMap",
      required: false,
      fullWidth: true,
      helperText: "Optional — per-state observation text overrides.",
    },
  ],
};
