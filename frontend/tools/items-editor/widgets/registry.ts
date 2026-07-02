import type { FieldDescriptor, FieldKind } from "../shared/descriptors/types";
import type { FieldWidget } from "./field-widget";
import { createTextField } from "./text-field";
import { createNumberField } from "./number-field";
import { createBooleanField } from "./boolean-field";
import { createTagsField } from "./tags-field";
import { createEnumField } from "./enum-field";
import { createStringMapField } from "./string-map-field";
import { createRawJsonField } from "./raw-json-field";
import { createShapeField } from "./shape-field";
import { createPropsField } from "./props-field";
import {
  createBooleanFieldAdapter,
  createNumberFieldAdapter,
  createNumberMapFieldAdapter,
  createTagsFieldAdapter,
  createTextFieldAdapter,
} from "./adapters";

/**
 * `FieldKind -> WidgetFactory` renderer registry (design.md "1. Chosen
 * architecture — Layer 3: Field-renderer registry"). `engine.ts` calls
 * `createFieldWidget(descriptor, domId)` once per descriptor field — no
 * collection-specific branching anywhere in the engine.
 *
 * All 10 `FieldKind`s are now registered: the 6 from Slice 1-3 (`text`,
 * `multiline`, `number`, `boolean`, `tags`, `enum`), the 3 from Slice 4
 * (`stringMap`, `rawJson`, `shape`), and `numberMap` (Slice 5, `items`
 * migration) — a thin `createNumberMapFieldAdapter` wrapper over the
 * EXISTING `props-field.ts` (built in Slice 1, unused as a registry entry
 * until `items` needed it). A descriptor referencing an unregistered kind
 * throws loudly at mount time rather than silently rendering nothing.
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
  stringMap: (d, id) => createStringMapField({ id, label: d.label, required: d.required, helperText: d.helperText }),
  rawJson: (d, id) => createRawJsonField({ id, label: d.label, required: d.required, helperText: d.helperText }),
  shape: (d, id) => createShapeField({ id, label: d.label, required: d.required, optionalObject: d.optionalObject, helperText: d.helperText }),
  numberMap: (d, id) => createNumberMapFieldAdapter(createPropsField({ id, label: d.label, required: d.required })),
};

export function createFieldWidget(descriptor: FieldDescriptor, domId: string): FieldWidget {
  const factory = WIDGET_REGISTRY[descriptor.kind];
  if (!factory) {
    throw new Error(`items-editor: no widget registered for field kind "${descriptor.kind}" (field "${descriptor.key}")`);
  }
  return factory(descriptor, domId);
}
