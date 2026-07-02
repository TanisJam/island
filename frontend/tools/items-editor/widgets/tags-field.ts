/**
 * Reusable string-array "chips" widget (design.md "ADR-5 — Field-widget
 * toolkit"). Used for `tags`. Chip add/remove logic is pure
 * (`addTag`/`removeTag`) so it is unit-testable without touching the DOM;
 * the DOM builder just renders the current list and delegates mutation to
 * these functions.
 */

/** Adds a trimmed, non-empty, de-duplicated tag. Returns a NEW array (never mutates). */
export function addTag(tags: readonly string[], raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "" || tags.includes(trimmed)) return [...tags];
  return [...tags, trimmed];
}

/** Removes every occurrence of `tag`. Returns a NEW array (never mutates). */
export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => t !== tag);
}

export interface TagsFieldOptions {
  id: string;
  label: string;
  required?: boolean;
}

export interface TagsFieldWidget {
  root: HTMLElement;
  getValue(): string[];
  setValue(value: string[]): void;
  setError(message: string | null): void;
  onChange(cb: () => void): void;
}

export function createTagsField(options: TagsFieldOptions): TagsFieldWidget {
  const root = document.createElement("div");
  root.className = "field field-tags";

  const label = document.createElement("label");
  label.htmlFor = options.id;
  label.textContent = options.required ? `${options.label} *` : options.label;
  root.appendChild(label);

  const chipList = document.createElement("ul");
  chipList.className = "chip-list";
  chipList.id = `${options.id}-chips`;
  root.appendChild(chipList);

  const inputRow = document.createElement("div");
  inputRow.className = "chip-input-row";
  const input = document.createElement("input");
  input.type = "text";
  input.id = options.id;
  input.placeholder = "Add a tag and press Enter";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-secondary";
  addBtn.textContent = "Add";
  inputRow.appendChild(input);
  inputRow.appendChild(addBtn);
  root.appendChild(inputRow);

  const error = document.createElement("p");
  error.className = "field-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  root.appendChild(error);

  let tags: string[] = [];
  const changeCallbacks: Array<() => void> = [];
  const emitChange = () => changeCallbacks.forEach((cb) => cb());

  function renderChips(): void {
    chipList.innerHTML = "";
    for (const tag of tags) {
      const li = document.createElement("li");
      li.className = "chip";
      const text = document.createElement("span");
      text.textContent = tag;
      li.appendChild(text);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "chip-remove";
      removeBtn.textContent = "x";
      removeBtn.setAttribute("aria-label", `Remove tag ${tag}`);
      removeBtn.addEventListener("click", () => {
        tags = removeTag(tags, tag);
        renderChips();
        emitChange();
      });
      li.appendChild(removeBtn);
      chipList.appendChild(li);
    }
  }

  function commitInput(): void {
    if (input.value.trim() === "") return;
    tags = addTag(tags, input.value);
    input.value = "";
    renderChips();
    emitChange();
  }

  addBtn.addEventListener("click", commitInput);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitInput();
    }
  });
  input.addEventListener("blur", emitChange);

  return {
    root,
    getValue: () => [...tags],
    setValue: (value: string[]) => {
      tags = [...value];
      renderChips();
    },
    setError: (message: string | null) => {
      error.hidden = message === null;
      error.textContent = message ?? "";
    },
    onChange: (cb: () => void) => changeCallbacks.push(cb),
  };
}
