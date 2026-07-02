/**
 * Reusable labeled text-input widget (design.md "ADR-5 — Field-widget
 * toolkit"). Handles both single-line (id/name) and multiline (description,
 * observation) fields. Built to be reused by future collection editors, so
 * it carries no ItemTypeDef-specific knowledge.
 *
 * Applies ui-ux-pro-max Forms & Feedback rules: a visible `<label for>`
 * (never placeholder-only), an error slot rendered BELOW the field with
 * `role="alert"`, and `onChange` fires on blur (inline-validate on blur,
 * not on every keystroke).
 */

export interface TextFieldOptions {
  id: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
  helperText?: string;
}

export interface TextFieldWidget {
  root: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
  setError(message: string | null): void;
  onChange(cb: () => void): void;
  focus(): void;
}

/**
 * Converts a raw text-input value into the optional-field wire convention:
 * an empty (or whitespace-only) string means "cleared" -> `undefined`, never
 * `""` (gate-review note 3 — an unset optional is ABSENT, not empty).
 */
export function emptyToUndefined(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : raw;
}

export function createTextField(options: TextFieldOptions): TextFieldWidget {
  const root = document.createElement("div");
  root.className = "field";

  const label = document.createElement("label");
  label.htmlFor = options.id;
  label.textContent = options.required ? `${options.label} *` : options.label;
  root.appendChild(label);

  const input: HTMLInputElement | HTMLTextAreaElement = options.multiline
    ? document.createElement("textarea")
    : document.createElement("input");
  if (!(input instanceof HTMLTextAreaElement)) {
    input.type = "text";
  } else {
    input.rows = 3;
  }
  input.id = options.id;
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
    getValue: () => input.value,
    setValue: (value: string) => {
      input.value = value;
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
