import type { FieldDescriptor, FieldKind } from "../shared/descriptors/types";
import type { FieldWidget } from "./field-widget";
import { createTextField } from "./text-field";
import { createNumberField } from "./number-field";
import { createBooleanField } from "./boolean-field";
import { createTagsField } from "./tags-field";
import { createEnumField } from "./enum-field";
import { createBooleanFieldAdapter, createNumberFieldAdapter, createTagsFieldAdapter, createTextFieldAdapter } from "./adapters";

/**
 * `FieldKind -> WidgetFactory` renderer registry (design.md "1. Chosen
 * architecture — Layer 3: Field-renderer registry"). `engine.ts` calls
 * `createFieldWidget(descriptor, domId)` once per descriptor field — no
 * collection-specific branching anywhere in the engine.
 *
 * Only the 6 kinds needed through Slice 3 are registered here (`text`,
 * `multiline`, `number`, `boolean`, `tags`, `enum`). `numberMap`,
 * `stringMap`, `shape`, and `rawJson` register in later slices as their
 * widgets are built (Slice 4/5) — a descriptor referencing an unregistered
 * kind throws loudly at mount time rather than silently rendering nothing.
 */
export type WidgetFactory = (descriptor: FieldDescriptor, domId: string) => FieldWidget;

export const WIDGET_REGISTRY: Partial<Record<FieldKind, WidgetFactory>> = {
  text: (d, id) => createTextFieldAdapter(createTextField({ id, label: d.label, required: d.required, helperText: d.helperText }), { required: d.required }),
  multiline: (d, id) =>
    createTextFieldAdapter(createTextField({ id, label: d.label, required: d.required, multiline: true, helperText: d.helperText }), { required: d.required }),
  number: (d, id) =>
    createNumberFieldAdapter(createNumberField({ id, label: d.label, required: d.required, min: d.min, integer: d.integer, helperText: d.helperText }), {
      required: d.required,
      min: d.min,
      integer: d.integer,
    }),
  boolean: (d, id) => createBooleanFieldAdapter(createBooleanField({ id, label: d.label })),
  tags: (d, id) => createTagsFieldAdapter(createTagsField({ id, label: d.label, required: d.required })),
  enum: (d, id) => createEnumField({ id, label: d.label, required: d.required, values: d.enumValues ?? [], helperText: d.helperText }),
};

export function createFieldWidget(descriptor: FieldDescriptor, domId: string): FieldWidget {
  const factory = WIDGET_REGISTRY[descriptor.kind];
  if (!factory) {
    throw new Error(`items-editor: no widget registered for field kind "${descriptor.kind}" (field "${descriptor.key}")`);
  }
  return factory(descriptor, domId);
}
