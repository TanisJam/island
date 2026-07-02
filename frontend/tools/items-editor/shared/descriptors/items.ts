import type { CollectionDescriptor } from "./types";

/**
 * `items` collection descriptor (design.md section 6 "items migration",
 * tasks.md Slice 5 — the FINAL slice). Reproduces `main.ts`'s former
 * hand-written `Fields`/`buildFields` exactly, field-for-field, so the
 * migration onto the generic engine is behavior-preserving:
 *
 * - `shape` uses the `shape` widget (Slice 4) in its REQUIRED/always-present
 *   mode (`optionalObject` unset) — reproduces the old separate
 *   `width`/`height` number fields as one composite `{w,h}` field. This is
 *   the one intentional visual-layout change: previously width/height were
 *   two separate half-column grid cells; now they are one field with two
 *   inline inputs. Data/validation semantics (`min:1`, `integer:true` on
 *   both) are unchanged (`shape-field.ts`'s `SHAPE_CONSTRAINTS`).
 * - `properties` uses the `numberMap` widget kind — a thin adapter over the
 *   EXISTING `props-field.ts` (`widgets/adapters.ts::createNumberMapFieldAdapter`,
 *   built in Slice 1, unused until now) rather than a new widget.
 * - `durability` deliberately has NO `min` set on the descriptor. The
 *   original widget rendered an HTML5 `min="0"` attribute, but the pure
 *   validator (`main.ts`'s old `parseOptionalNumber(f.durability.getRawValue())`)
 *   was called WITHOUT that constraint, so negative durability was always
 *   accepted by both client and server (the schema itself has no
 *   `minimum`). Setting `min: 0` here would route through
 *   `createNumberFieldAdapter`'s constraints and NEWLY reject negative
 *   values — a validation-semantics change the migration must not make.
 *
 * Field keys and required-ness are verified against
 * `schemas/catalog.json#/definitions/ItemTypeDef` by `items.test.ts`'s
 * guardrail. `atlasKind: "item"` (already registered in
 * `shared/collection-registry.ts` since Slice 1) means `engine.ts` mounts
 * the generalized texture panel for this collection.
 */
export const ITEMS_DESCRIPTOR: CollectionDescriptor = {
  collectionId: "items",
  fields: [
    { key: "id", label: "Id", kind: "text", required: true, isId: true },
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "description", label: "Description", kind: "multiline", required: true, fullWidth: true },
    { key: "shape", label: "Shape", kind: "shape", required: true },
    { key: "rotatable", label: "Rotatable", kind: "boolean", required: true },
    { key: "properties", label: "Properties", kind: "numberMap", required: true, fullWidth: true },
    { key: "tags", label: "Tags", kind: "tags", required: true, fullWidth: true },
    {
      key: "durability",
      label: "Durability",
      kind: "number",
      required: false,
      helperText: "Optional — leave empty to omit.",
    },
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
