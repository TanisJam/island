import type { CollectionDescriptor } from "./types";

/**
 * `research` collection descriptor (design.md section 5, tasks.md Slice 2).
 * Proves "new collection = descriptor addition, not a code fork" — reuses
 * the `enum` widget (Slice 1) and the plain `tags` widget for `revealedBy`.
 * `refCollection: "knowledge"` is set as the future ref-picker seam
 * (design.md section 8) but the widget stays `tags` this cycle, per the
 * confirmed deferral (cross-collection reference picker is out of scope).
 * Field keys and required-ness are verified against
 * `schemas/catalog.json#/definitions/ResearchDef` by
 * `research.test.ts`'s guardrail.
 */
export const RESEARCH_DESCRIPTOR: CollectionDescriptor = {
  collectionId: "research",
  fields: [
    { key: "id", label: "Id", kind: "text", required: true, isId: true },
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "status", label: "Status", kind: "enum", required: true, enumValues: ["hidden", "idea", "active", "completed"] },
    {
      key: "revealedBy",
      label: "Revealed by",
      kind: "tags",
      required: false,
      fullWidth: true,
      helperText: "Optional — knowledge ids that reveal this research entry.",
      refCollection: "knowledge",
    },
    {
      key: "teaserThought",
      label: "Teaser thought",
      kind: "text",
      required: false,
      helperText: "Optional — leave empty to omit.",
    },
  ],
};
