/**
 * Field descriptor types (design.md "1. Chosen architecture — Layer 2:
 * Field descriptors"). A `CollectionDescriptor` is the single source of
 * truth an entire collection's form is rendered from AND its record is
 * reconstructed from (both client `engine.ts` and server
 * `server/plan-save.ts::reconstructRecord` build their allow-list off the
 * SAME descriptor — design.md Risk 4/6).
 *
 * Isomorphic — no DOM or Node imports here, safe for both client and server.
 */

export type FieldKind =
  | "text"
  | "multiline"
  | "number"
  | "boolean"
  | "tags"
  | "enum"
  | "numberMap"
  | "stringMap"
  | "shape"
  | "rawJson";

export interface FieldDescriptor {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  fullWidth?: boolean;
  helperText?: string;
  /** `enum` kind only — the allowed values, rendered as `<option>`s. */
  enumValues?: readonly string[];
  /** `number` kind only. */
  min?: number;
  integer?: boolean;
  /** `shape` kind only — adds a present/absent toggle (e.g. `world-objects.surfaceGrid`). */
  optionalObject?: boolean;
  /** Marks the field used for id-uniqueness checks and as the list-row primary label. */
  isId?: boolean;
  /** UNBUILT seam (Cycle 2 ref-picker) — hints a future dropdown sourced from another
   * collection's loaded records. Ships as a plain `tags` field this cycle. */
  refCollection?: string;
  // Future (actions, Cycle 2): `variants?: Record<string, FieldDescriptor[]>` for a
  // discriminated-union ("oneOf") field kind — no engine redesign needed, see design.md
  // section 8. Deliberately NOT added yet; this comment documents the seam.
}

export interface CollectionDescriptor {
  collectionId: string;
  fields: readonly FieldDescriptor[];
}
