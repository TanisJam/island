/**
 * Reusable key -> string map widget (design.md "2. The 3 new widgets —
 * string-map"). Structural clone of `props-field.ts` with the
 * `Number(rawValue)` coercion (props-field.ts's `setProp`) REMOVED — values
 * stay `<input type=text>` end to end. Used for `world-objects.observationByState`
 * (spec "String-to-String Map Widget").
 *
 * Row add/edit/remove logic is pure (`setStringProp`/`removeStringProp`) so
 * it is unit-testable without touching the DOM, mirroring `setProp`/`removeProp`.
 *
 * Unlike `props-field.ts` (wrapped by an adapter for the legacy `properties`
 * field, which is always required), this widget implements `FieldWidget`
 * directly and applies the descriptor's optional-omission convention itself:
 * when the field is not required and the map is empty, `read()` returns
 * `value: undefined` so the record omits the key entirely (spec "Empty ->
 * omitted").
 */

import type { FieldParseResult, FieldWidget } from "./field-widget";

export interface SetStringPropOk {
  ok: true;
  props: Record<string, string>;
}
export interface SetStringPropFail {
  ok: false;
}
export type SetStringPropResult = SetStringPropOk | SetStringPropFail;

/**
 * Sets `key -> value` on a copy of `props`. Fails (does not mutate) only on
 * an empty key — unlike `setProp`, ANY string value (including empty
 * string) is valid, so there is no numeric-coercion failure mode.
 */
export function setStringProp(props: Readonly<Record<string, string>>, key: string, rawValue: string): SetStringPropResult {
  const trimmedKey = key.trim();
  if (trimmedKey === "") return { ok: false };
  return { ok: true, props: { ...props, [trimmedKey]: rawValue } };
}

/** Removes `key` from a copy of `props`. Returns a NEW object (never mutates). */
export function removeStringProp(props: Readonly<Record<string, string>>, key: string): Record<string, string> {
  const next = { ...props };
  delete next[key];
  return next;
}

export interface StringMapFieldOptions {
  id: string;
  label: string;
  required?: boolean;
  helperText?: string;
}

export function createStringMapField(options: StringMapFieldOptions): FieldWidget {
  const root = document.createElement("div");
  root.className = "field field-props";

  const label = document.createElement("label");
  label.id = `${options.id}-label`;
  label.textContent = options.required ? `${options.label} *` : options.label;
  root.appendChild(label);

  const rowList = document.createElement("div");
  rowList.className = "props-rows";
  rowList.setAttribute("role", "group");
  rowList.setAttribute("aria-labelledby", label.id);
  root.appendChild(rowList);

  const addRow = document.createElement("div");
  addRow.className = "props-add-row";
  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.placeholder = "key";
  keyInput.setAttribute("aria-label", "New key");
  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.placeholder = "value";
  valueInput.setAttribute("aria-label", "New value");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-secondary";
  addBtn.textContent = "Add";
  addRow.appendChild(keyInput);
  addRow.appendChild(valueInput);
  addRow.appendChild(addBtn);
  root.appendChild(addRow);

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

  let props: Record<string, string> = {};
  const changeCallbacks: Array<() => void> = [];
  const emitChange = () => changeCallbacks.forEach((cb) => cb());

  function showError(message: string | null): void {
    error.hidden = message === null;
    error.textContent = message ?? "";
  }

  function renderRows(): void {
    rowList.innerHTML = "";
    for (const [key, value] of Object.entries(props)) {
      const row = document.createElement("div");
      row.className = "props-row";
      const keyLabel = document.createElement("span");
      keyLabel.className = "props-key";
      keyLabel.textContent = key;
      row.appendChild(keyLabel);

      const editValue = document.createElement("input");
      editValue.type = "text";
      editValue.value = value;
      editValue.setAttribute("aria-label", `${key} value`);
      editValue.addEventListener("blur", () => {
        const result = setStringProp(props, key, editValue.value);
        if (!result.ok) {
          showError(`"${key}" needs a key`);
          return;
        }
        showError(null);
        props = result.props;
        emitChange();
      });
      row.appendChild(editValue);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "chip-remove";
      removeBtn.textContent = "x";
      removeBtn.setAttribute("aria-label", `Remove ${key}`);
      removeBtn.addEventListener("click", () => {
        props = removeStringProp(props, key);
        renderRows();
        emitChange();
      });
      row.appendChild(removeBtn);

      rowList.appendChild(row);
    }
  }

  addBtn.addEventListener("click", () => {
    const result = setStringProp(props, keyInput.value, valueInput.value);
    if (!result.ok) {
      showError("Enter a key");
      return;
    }
    showError(null);
    props = result.props;
    keyInput.value = "";
    valueInput.value = "";
    renderRows();
    emitChange();
  });

  return {
    root,
    read: (): FieldParseResult => {
      if (!options.required && Object.keys(props).length === 0) return { ok: true, value: undefined };
      return { ok: true, value: { ...props } };
    },
    write: (value: unknown) => {
      props = value !== null && typeof value === "object" ? { ...(value as Record<string, string>) } : {};
      renderRows();
    },
    setError: showError,
    onChange: (cb: () => void) => changeCallbacks.push(cb),
    focus: () => keyInput.focus(),
  };
}
