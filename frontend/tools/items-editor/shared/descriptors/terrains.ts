import type { CollectionDescriptor } from "./types";

/**
 * `terrains` collection descriptor (design.md section 5, tasks.md Slice
 * 3b). Unlike Slice 1/2's `knowledge`/`research`, `id` here is a plain,
 * freely-addable text field — Slice 3a (commit `33d5e0b`) already opened
 * `TerrainType` from a closed 6-value enum to `{type:string}` across every
 * contract, so a brand-new terrain id is type-valid everywhere and needs
 * no enum-select widget. This supersedes proposal PROVISIONAL-1
 * ("terrains = edit-only, no add") — full add/edit/remove.
 *
 * `atlasKind: "terrain"` on the registry entry means `engine.ts` mounts
 * the generalized texture panel for this collection (design.md section 3
 * "Texture panel mounts by atlasKind").
 *
 * Field keys and required-ness are verified against
 * `schemas/catalog.json#/definitions/TerrainTypeDef` by
 * `terrains.test.ts`'s guardrail.
 */
export const TERRAINS_DESCRIPTOR: CollectionDescriptor = {
  collectionId: "terrains",
  fields: [
    {
      key: "id",
      label: "Id",
      kind: "text",
      required: true,
      isId: true,
      helperText: "Freely addable — a new id renders with a gray fallback color until art is added.",
    },
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "walkable", label: "Walkable", kind: "boolean", required: true },
    { key: "tags", label: "Tags", kind: "tags", required: true, fullWidth: true },
    {
      key: "observation",
      label: "Observation",
      kind: "multiline",
      required: false,
      fullWidth: true,
      helperText: "Optional — leave empty to omit.",
    },
  ],
};
