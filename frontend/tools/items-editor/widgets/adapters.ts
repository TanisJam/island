import type { TextFieldWidget } from "./text-field";
import { emptyToUndefined } from "./text-field";
import type { NumberFieldWidget } from "./number-field";
import { parseOptionalNumber, parseRequiredNumber, type NumberConstraints } from "./number-field";
import type { BooleanFieldWidget } from "./boolean-field";
import type { TagsFieldWidget } from "./tags-field";
import type { PropsFieldWidget } from "./props-field";
import type { FieldParseResult, FieldWidget } from "./field-widget";

/**
 * Adapters wrapping the 5 existing (pre-descriptor-engine) widgets in the
 * uniform `FieldWidget` contract (design.md "1. Chosen architecture — the
 * uniform widget contract"). Each adapter's `read()` delegates to the SAME
 * pure parse helpers `main.ts`'s hand-written `syncFormIntoSelectedItem`
 * already used (`parseRequiredNumber`/`parseOptionalNumber`,
 * `emptyToUndefined`) — no new parsing logic, just a uniform seam around it.
 *
 * `focusFirstControl` covers the 3 legacy widgets (`boolean`, `tags`,
 * `props`) that never needed their own `.focus()` because
 * `main.ts`'s hand-written field-focus map only ever pointed at
 * `id`/`name`/`description`/`width`/`height`/`durability`/`observation` —
 * none of which are boolean/tags/props. The generic engine's error-summary
 * links can point at ANY field, so every adapter must be focusable.
 */
function focusFirstControl(root: HTMLElement): void {
  const control = root.querySelector<HTMLElement>("input, textarea, select, button");
  control?.focus();
}

export interface RequiredOption {
  required: boolean;
}

export function createTextFieldAdapter(widget: TextFieldWidget, options: RequiredOption): FieldWidget {
  return {
    root: widget.root,
    read: (): FieldParseResult => {
      const raw = widget.getValue();
      if (options.required) {
        const trimmed = raw.trim();
        if (trimmed === "") return { ok: false, message: "This field is required" };
        return { ok: true, value: raw };
      }
      return { ok: true, value: emptyToUndefined(raw) };
    },
    write: (value: unknown) => widget.setValue(typeof value === "string" ? value : ""),
    setError: widget.setError,
    onChange: widget.onChange,
    focus: widget.focus,
  };
}

export interface NumberFieldAdapterOptions extends RequiredOption, NumberConstraints {}

export function createNumberFieldAdapter(widget: NumberFieldWidget, options: NumberFieldAdapterOptions): FieldWidget {
  return {
    root: widget.root,
    read: (): FieldParseResult => {
      const raw = widget.getRawValue();
      const result = options.required ? parseRequiredNumber(raw, options) : parseOptionalNumber(raw, options);
      if (!result.ok) {
        return { ok: false, message: options.required ? "This field is required and must be a valid number" : "Must be a number, or left empty" };
      }
      return { ok: true, value: result.value };
    },
    write: (value: unknown) => widget.setValue(typeof value === "number" ? value : undefined),
    setError: widget.setError,
    onChange: widget.onChange,
    focus: widget.focus,
  };
}

/** Booleans always have a value (checked/unchecked) — there is no "empty"
 * invalid state, so `read()` is always `ok`. */
export function createBooleanFieldAdapter(widget: BooleanFieldWidget): FieldWidget {
  return {
    root: widget.root,
    read: (): FieldParseResult => ({ ok: true, value: widget.getValue() }),
    write: (value: unknown) => widget.setValue(Boolean(value)),
    setError: () => {},
    onChange: widget.onChange,
    focus: () => focusFirstControl(widget.root),
  };
}

/** Tag arrays are always valid (an empty array is a legitimate value, not a
 * "cleared" state) — `read()` is always `ok`. */
export function createTagsFieldAdapter(widget: TagsFieldWidget): FieldWidget {
  return {
    root: widget.root,
    read: (): FieldParseResult => ({ ok: true, value: widget.getValue() }),
    write: (value: unknown) => widget.setValue(Array.isArray(value) ? (value as string[]) : []),
    setError: widget.setError,
    onChange: widget.onChange,
    focus: () => focusFirstControl(widget.root),
  };
}

/** Number-map (`properties`-style) records are always valid as a whole —
 * per-row validation happens inside `props-field.ts` itself on add/edit. */
export function createNumberMapFieldAdapter(widget: PropsFieldWidget): FieldWidget {
  return {
    root: widget.root,
    read: (): FieldParseResult => ({ ok: true, value: widget.getValue() }),
    write: (value: unknown) => widget.setValue(value !== null && typeof value === "object" ? (value as Record<string, number>) : {}),
    setError: widget.setError,
    onChange: widget.onChange,
    focus: () => focusFirstControl(widget.root),
  };
}
