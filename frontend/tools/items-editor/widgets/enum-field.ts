import type { FieldParseResult, FieldWidget } from "./field-widget";

/**
 * `<select>` widget constrained to a fixed set of values (spec "Enum/Select
 * Widget", design.md "2. The 3 new widgets — enum-select"). Used for
 * `knowledge.kind`, `research.status` (Slice 2), and future enum fields.
 * Free text is STRUCTURALLY impossible — there is no text input, only a
 * native `<select>` populated exclusively from `enumValues` — so unlike the
 * other widgets there is no "invalid free text" case to parse; the only
 * pure decision left is whether an unselected placeholder should block a
 * required field, which is what `parseEnumValue` covers.
 *
 * Implements `FieldWidget` directly (not via an adapter in `adapters.ts`)
 * because there is no legacy heterogeneous API to reconcile — this is a
 * brand-new widget built straight to the uniform contract.
 *
 * Follows ui-ux-pro-max Forms & Feedback rules: a visible `<label for>`,
 * an error slot below the field with `role="alert"`, and `onChange` fires
 * on the select's native `change` event (the select's equivalent of
 * "commit", since there is no keystroke-level input to debounce).
 */

/** The reserved placeholder value: never a real enum member, always fails a required read. */
const PLACEHOLDER_VALUE = "";

export function parseEnumValue(raw: string, required: boolean): FieldParseResult {
  if (raw === PLACEHOLDER_VALUE) {
    return required ? { ok: false, message: "Select a value" } : { ok: true, value: undefined };
  }
  return { ok: true, value: raw };
}

export interface EnumFieldOptions {
  id: string;
  label: string;
  required?: boolean;
  values: readonly string[];
  helperText?: string;
}

export function createEnumField(options: EnumFieldOptions): FieldWidget {
  const root = document.createElement("div");
  root.className = "field";

  const label = document.createElement("label");
  label.htmlFor = options.id;
  label.textContent = options.required ? `${options.label} *` : options.label;
  root.appendChild(label);

  const select = document.createElement("select");
  select.id = options.id;
  if (options.required) select.required = true;

  const placeholder = document.createElement("option");
  placeholder.value = PLACEHOLDER_VALUE;
  placeholder.textContent = "Select…";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  for (const value of options.values) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  }
  root.appendChild(select);

  if (options.helperText) {
    const helper = document.createElement("p");
    helper.className = "field-helper";
    helper.textContent = options.helperText;
    root.appendChild(helper);
  }

  const error = document.createElement("p");
  error.className = "field-error";
  error.id = `${options.id}-error`;
  error.setAttribute("role", "alert");
  error.hidden = true;
  root.appendChild(error);
  select.setAttribute("aria-describedby", error.id);

  const changeCallbacks: Array<() => void> = [];
  select.addEventListener("change", () => changeCallbacks.forEach((cb) => cb()));

  return {
    root,
    read: () => parseEnumValue(select.value, options.required ?? false),
    write: (value: unknown) => {
      const next = typeof value === "string" ? value : PLACEHOLDER_VALUE;
      select.value = next;
      if (select.value !== next) select.value = PLACEHOLDER_VALUE; // unknown value -> back to placeholder
    },
    setError: (message: string | null) => {
      error.hidden = message === null;
      error.textContent = message ?? "";
      select.setAttribute("aria-invalid", message === null ? "false" : "true");
    },
    onChange: (cb: () => void) => changeCallbacks.push(cb),
    focus: () => select.focus(),
  };
}
