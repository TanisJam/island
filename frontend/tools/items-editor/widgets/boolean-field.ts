/**
 * Reusable labeled checkbox widget (design.md "ADR-5 — Field-widget
 * toolkit"). Used for `rotatable`. No parsing/serialization beyond the
 * checkbox's own boolean state, so there is no separate pure module here —
 * unlike text/number/tags/props, a checkbox's `checked` IS the value.
 */

export interface BooleanFieldOptions {
  id: string;
  label: string;
}

export interface BooleanFieldWidget {
  root: HTMLElement;
  getValue(): boolean;
  setValue(value: boolean): void;
  onChange(cb: () => void): void;
}

export function createBooleanField(options: BooleanFieldOptions): BooleanFieldWidget {
  const root = document.createElement("div");
  root.className = "field field-boolean";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = options.id;
  root.appendChild(input);

  const label = document.createElement("label");
  label.htmlFor = options.id;
  label.textContent = options.label;
  root.appendChild(label);

  const changeCallbacks: Array<() => void> = [];
  input.addEventListener("change", () => changeCallbacks.forEach((cb) => cb()));

  return {
    root,
    getValue: () => input.checked,
    setValue: (value: boolean) => {
      input.checked = value;
    },
    onChange: (cb: () => void) => changeCallbacks.push(cb),
  };
}
