/**
 * Reusable labeled number-input widget (design.md "ADR-5 — Field-widget
 * toolkit"). Covers both required numbers with a `min` (shape.w/shape.h,
 * `min:1` integers) and the optional `durability` field, whose empty value
 * means "cleared" -> `undefined` (gate-review note 3), never `0`.
 *
 * Parsing/validation is pure (`parseRequiredNumber`/`parseOptionalNumber`)
 * so it is unit-testable without touching the DOM.
 */

export interface ParsedNumberOk {
  ok: true;
  value: number;
}
export interface ParsedNumberFail {
  ok: false;
}
export type ParsedNumberResult = ParsedNumberOk | ParsedNumberFail;

export interface ParsedOptionalNumberOk {
  ok: true;
  value: number | undefined;
}
export type ParsedOptionalNumberResult = ParsedOptionalNumberOk | ParsedNumberFail;

export interface NumberConstraints {
  min?: number;
  integer?: boolean;
}

/** Parses a required numeric field. Empty/non-numeric/out-of-range input fails. */
export function parseRequiredNumber(raw: string, constraints: NumberConstraints = {}): ParsedNumberResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false };
  if (constraints.integer && !Number.isInteger(value)) return { ok: false };
  if (constraints.min !== undefined && value < constraints.min) return { ok: false };
  return { ok: true, value };
}

/**
 * Parses an optional numeric field. An empty string is a valid "cleared"
 * state (`value: undefined`); a non-numeric or out-of-range non-empty value
 * still fails.
 */
export function parseOptionalNumber(raw: string, constraints: NumberConstraints = {}): ParsedOptionalNumberResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  return parseRequiredNumber(raw, constraints);
}

export interface NumberFieldOptions {
  id: string;
  label: string;
  required?: boolean;
  min?: number;
  integer?: boolean;
  helperText?: string;
}

export interface NumberFieldWidget {
  root: HTMLElement;
  /** Raw string as typed — callers parse via `parseRequiredNumber`/`parseOptionalNumber`. */
  getRawValue(): string;
  setValue(value: number | undefined): void;
  setError(message: string | null): void;
  onChange(cb: () => void): void;
  focus(): void;
}

export function createNumberField(options: NumberFieldOptions): NumberFieldWidget {
  const root = document.createElement("div");
  root.className = "field";

  const label = document.createElement("label");
  label.htmlFor = options.id;
  label.textContent = options.required ? `${options.label} *` : options.label;
  root.appendChild(label);

  const input = document.createElement("input");
  input.type = "number";
  input.id = options.id;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.integer) input.step = "1";
  if (options.required) input.required = true;
  root.appendChild(input);

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
  input.setAttribute("aria-describedby", error.id);

  const changeCallbacks: Array<() => void> = [];
  input.addEventListener("blur", () => changeCallbacks.forEach((cb) => cb()));

  return {
    root,
    getRawValue: () => input.value,
    setValue: (value: number | undefined) => {
      input.value = value === undefined ? "" : String(value);
    },
    setError: (message: string | null) => {
      error.hidden = message === null;
      error.textContent = message ?? "";
      input.setAttribute("aria-invalid", message === null ? "false" : "true");
    },
    onChange: (cb: () => void) => changeCallbacks.push(cb),
    focus: () => input.focus(),
  };
}
