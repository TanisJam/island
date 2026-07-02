/**
 * Raw-JSON object editor widget (design.md "2. The 3 new widgets —
 * raw-JSON object editor", spec "Raw-JSON Object Widget"). A textarea whose
 * `read()` is `JSON.parse` guarded by `typeof parsed === "object" &&
 * parsed !== null && !Array.isArray(parsed)` — REJECTING arrays and
 * scalars, not just parse failures, since the schema field
 * (`world-objects.defaultState`) is `{type: "object"}` freeform. `ajv`
 * against `schemas/catalog.json` remains the authoritative server-side
 * gate; this is a client-side pre-check only (design.md Risk 4).
 *
 * Implements `FieldWidget` directly (new widget, no legacy API to
 * reconcile), mirroring `enum-field.ts`'s pattern. Parsing is a pure
 * function (`parseRawJson`) so it is unit-testable without touching the DOM.
 *
 * Empty/absent textarea content means "omit this optional field" (spec
 * "Empty -> omitted"), matching the project's optional-field convention
 * (`emptyToUndefined` in `text-field.ts`).
 */

import type { FieldParseResult, FieldWidget } from "./field-widget";

export function parseRawJson(raw: string, required: boolean): FieldParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return required ? { ok: false, message: "This field is required" } : { ok: true, value: undefined };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: "Must be valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: "Must be a JSON object, not an array or scalar" };
  }
  return { ok: true, value: parsed };
}

export interface RawJsonFieldOptions {
  id: string;
  label: string;
  required?: boolean;
  helperText?: string;
}

export function createRawJsonField(options: RawJsonFieldOptions): FieldWidget {
  const root = document.createElement("div");
  root.className = "field field-raw-json";

  const label = document.createElement("label");
  label.htmlFor = options.id;
  label.textContent = options.required ? `${options.label} *` : options.label;
  root.appendChild(label);

  const textarea = document.createElement("textarea");
  textarea.id = options.id;
  textarea.rows = 4;
  textarea.spellcheck = false;
  if (options.required) textarea.required = true;
  root.appendChild(textarea);

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
  textarea.setAttribute("aria-describedby", error.id);

  const changeCallbacks: Array<() => void> = [];
  textarea.addEventListener("blur", () => changeCallbacks.forEach((cb) => cb()));

  return {
    root,
    read: () => parseRawJson(textarea.value, options.required ?? false),
    write: (value: unknown) => {
      textarea.value = value === undefined ? "" : JSON.stringify(value, null, 2);
    },
    setError: (message: string | null) => {
      error.hidden = message === null;
      error.textContent = message ?? "";
      textarea.setAttribute("aria-invalid", message === null ? "false" : "true");
    },
    onChange: (cb: () => void) => changeCallbacks.push(cb),
    focus: () => textarea.focus(),
  };
}
