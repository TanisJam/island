import type { CollectionDescriptor } from "./types";

/**
 * `knowledge` collection descriptor (design.md section 5), proving the
 * full client<->server descriptor pipeline end-to-end for the first time
 * (Slice 1). Field keys and required-ness are verified against
 * `schemas/catalog.json#/definitions/KnowledgeDef` by
 * `knowledge.test.ts`'s guardrail.
 */
export const KNOWLEDGE_DESCRIPTOR: CollectionDescriptor = {
  collectionId: "knowledge",
  fields: [
    { key: "id", label: "Id", kind: "text", required: true, isId: true },
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "kind", label: "Kind", kind: "enum", required: true, enumValues: ["idea", "technique", "discovery"] },
    {
      key: "unlockOnObserveTags",
      label: "Unlock on observe tags",
      kind: "tags",
      required: false,
      fullWidth: true,
      helperText: "Optional — tags that, when observed, unlock this knowledge entry.",
    },
    {
      key: "unlockThought",
      label: "Unlock thought",
      kind: "text",
      required: false,
      helperText: "Optional — leave empty to omit.",
    },
  ],
};
