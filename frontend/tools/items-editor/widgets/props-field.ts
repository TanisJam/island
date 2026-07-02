/**
 * Reusable key -> number map widget (design.md "ADR-5 — Field-widget
 * toolkit"). Used for `properties` (`PropertyBag`). Row add/remove/edit
 * logic is pure (`setProp`/`removeProp`) so it is unit-testable without
 * touching the DOM.
 */

export interface SetPropOk {
  ok: true;
  props: Record<string, number>;
}
export interface SetPropFail {
  ok: false;
}
export type SetPropResult = SetPropOk | SetPropFail;

/**
 * Sets `key -> value` on a copy of `props`. Fails (does not mutate) on an
 * empty key or a non-numeric value — callers surface the failure as a
 * field error rather than silently dropping the row.
 */
export function setProp(props: Readonly<Record<string, number>>, key: string, rawValue: string): SetPropResult {
  const trimmedKey = key.trim();
  if (trimmedKey === "") return { ok: false };
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, props: { ...props, [trimmedKey]: value } };
}

/** Removes `key` from a copy of `props`. Returns a NEW object (never mutates). */
export function removeProp(props: Readonly<Record<string, number>>, key: string): Record<string, number> {
  const next = { ...props };
  delete next[key];
  return next;
}

export interface PropsFieldOptions {
  id: string;
  label: string;
  required?: boolean;
}

export interface PropsFieldWidget {
  root: HTMLElement;
  getValue(): Record<string, number>;
  setValue(value: Record<string, number>): void;
  setError(message: string | null): void;
  onChange(cb: () => void): void;
}

export function createPropsField(options: PropsFieldOptions): PropsFieldWidget {
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
  keyInput.placeholder = "property";
  keyInput.setAttribute("aria-label", "New property key");
  const valueInput = document.createElement("input");
  valueInput.type = "number";
  valueInput.placeholder = "value";
  valueInput.setAttribute("aria-label", "New property value");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-secondary";
  addBtn.textContent = "Add";
  addRow.appendChild(keyInput);
  addRow.appendChild(valueInput);
  addRow.appendChild(addBtn);
  root.appendChild(addRow);

  const error = document.createElement("p");
  error.className = "field-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  root.appendChild(error);

  let props: Record<string, number> = {};
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
      editValue.type = "number";
      editValue.value = String(value);
      editValue.setAttribute("aria-label", `${key} value`);
      editValue.addEventListener("blur", () => {
        const result = setProp(props, key, editValue.value);
        if (!result.ok) {
          showError(`"${key}" needs a numeric value`);
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
      removeBtn.setAttribute("aria-label", `Remove property ${key}`);
      removeBtn.addEventListener("click", () => {
        props = removeProp(props, key);
        renderRows();
        emitChange();
      });
      row.appendChild(removeBtn);

      rowList.appendChild(row);
    }
  }

  addBtn.addEventListener("click", () => {
    const result = setProp(props, keyInput.value, valueInput.value);
    if (!result.ok) {
      showError("Enter a property name and a numeric value");
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
    getValue: () => ({ ...props }),
    setValue: (value: Record<string, number>) => {
      props = { ...value };
      renderRows();
    },
    setError: showError,
    onChange: (cb: () => void) => changeCallbacks.push(cb),
  };
}
