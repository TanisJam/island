/**
 * Composite `{w,h}` shape widget (design.md "2. The 3 new widgets — shape
 * widget", section 5's "surfaceGrid(shape, optionalObject)"). Two number
 * sub-fields reusing `number-field.ts`'s pure `parseRequiredNumber` (no
 * duplicated numeric-parsing logic). Two modes:
 *
 * - Required mode (`optionalObject` unset/false, e.g. a future `items.shape`
 *   migration): always present, `read()` fails if either sub-field is
 *   invalid.
 * - Optional mode (`optionalObject: true`, `world-objects.surfaceGrid`):
 *   adds a present/absent checkbox; unchecked -> `read()` returns
 *   `value: undefined` (the field is omitted entirely), matching the
 *   project's optional-field convention.
 *
 * Implements `FieldWidget` directly (new widget, no legacy API to
 * reconcile). `parseShapeValue` is pure and unit-tested without touching
 * the DOM.
 */

import { parseRequiredNumber } from "./number-field";
import type { FieldParseResult, FieldWidget } from "./field-widget";

export interface ShapeValue {
  w: number;
  h: number;
}

export interface ParsedShapeOk {
  ok: true;
  value: ShapeValue | undefined;
}
export interface ParsedShapeErr {
  ok: false;
  message: string;
}
export type ParsedShapeResult = ParsedShapeOk | ParsedShapeErr;

const SHAPE_CONSTRAINTS = { min: 1, integer: true } as const;

/**
 * `present` is only consulted when `optionalObject` is true — required
 * shapes are always parsed from `wRaw`/`hRaw` regardless of `present`.
 */
export function parseShapeValue(wRaw: string, hRaw: string, present: boolean, optionalObject: boolean): ParsedShapeResult {
  if (optionalObject && !present) return { ok: true, value: undefined };
  const w = parseRequiredNumber(wRaw, SHAPE_CONSTRAINTS);
  const h = parseRequiredNumber(hRaw, SHAPE_CONSTRAINTS);
  if (!w.ok || !h.ok) return { ok: false, message: "Width and height must be whole numbers >= 1" };
  return { ok: true, value: { w: w.value, h: h.value } };
}

export interface ShapeFieldOptions {
  id: string;
  label: string;
  required?: boolean;
  optionalObject?: boolean;
  helperText?: string;
}

export function createShapeField(options: ShapeFieldOptions): FieldWidget {
  const root = document.createElement("div");
  root.className = "field field-shape";

  const label = document.createElement("label");
  label.id = `${options.id}-label`;
  label.textContent = options.required ? `${options.label} *` : options.label;
  root.appendChild(label);

  let presentCheckbox: HTMLInputElement | null = null;
  if (options.optionalObject) {
    const presentRow = document.createElement("div");
    presentRow.className = "shape-present-row";
    presentCheckbox = document.createElement("input");
    presentCheckbox.type = "checkbox";
    presentCheckbox.id = `${options.id}-present`;
    const presentLabel = document.createElement("label");
    presentLabel.htmlFor = presentCheckbox.id;
    presentLabel.textContent = "Set";
    presentRow.appendChild(presentCheckbox);
    presentRow.appendChild(presentLabel);
    root.appendChild(presentRow);
  }

  const inputsRow = document.createElement("div");
  inputsRow.className = "shape-inputs-row";
  const wInput = document.createElement("input");
  wInput.type = "number";
  wInput.min = "1";
  wInput.step = "1";
  wInput.id = `${options.id}-w`;
  wInput.setAttribute("aria-label", `${options.label} width`);
  const hInput = document.createElement("input");
  hInput.type = "number";
  hInput.min = "1";
  hInput.step = "1";
  hInput.id = `${options.id}-h`;
  hInput.setAttribute("aria-label", `${options.label} height`);
  inputsRow.appendChild(wInput);
  inputsRow.appendChild(hInput);
  root.appendChild(inputsRow);

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

  function updateInputsEnabled(): void {
    const disabled = options.optionalObject === true && presentCheckbox !== null && !presentCheckbox.checked;
    wInput.disabled = disabled;
    hInput.disabled = disabled;
  }
  updateInputsEnabled();

  const changeCallbacks: Array<() => void> = [];
  const emitChange = () => changeCallbacks.forEach((cb) => cb());
  wInput.addEventListener("blur", emitChange);
  hInput.addEventListener("blur", emitChange);
  presentCheckbox?.addEventListener("change", () => {
    updateInputsEnabled();
    emitChange();
  });

  return {
    root,
    read: (): FieldParseResult => {
      const present = presentCheckbox ? presentCheckbox.checked : true;
      return parseShapeValue(wInput.value, hInput.value, present, options.optionalObject ?? false);
    },
    write: (value: unknown) => {
      const shape = value !== null && typeof value === "object" ? (value as Partial<ShapeValue>) : undefined;
      if (presentCheckbox) presentCheckbox.checked = shape !== undefined;
      wInput.value = shape?.w !== undefined ? String(shape.w) : "";
      hInput.value = shape?.h !== undefined ? String(shape.h) : "";
      updateInputsEnabled();
    },
    setError: (message: string | null) => {
      error.hidden = message === null;
      error.textContent = message ?? "";
      wInput.setAttribute("aria-invalid", message === null ? "false" : "true");
      hInput.setAttribute("aria-invalid", message === null ? "false" : "true");
    },
    onChange: (cb: () => void) => changeCallbacks.push(cb),
    focus: () => wInput.focus(),
  };
}
