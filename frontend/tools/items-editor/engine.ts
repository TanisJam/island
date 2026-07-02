import type { CollectionDescriptor, FieldDescriptor } from "./shared/descriptors/types";
import { validateCollection, type SchemaBundle, type SchemaError } from "./shared/validate-collection";
import { checkIdUnique } from "./shared/id-unique";
import { COLLECTIONS } from "./shared/collection-registry";
import { createFieldWidget } from "./widgets/registry";
import type { FieldWidget } from "./widgets/field-widget";
import { createTexturePanel, type TexturePanelHandle } from "./texture-panel";

/**
 * Generic, descriptor-driven master-detail engine (design.md "1. Chosen
 * architecture — Layer 4: Generic engine"). Parameterized entirely by a
 * `CollectionDescriptor` — NO collection-specific code lives here. Mirrors
 * `main.ts`'s items-only `buildFields`/`syncFormIntoSelectedItem`/
 * `fieldIdForInstancePath`/`boot`/`save`, generalized into descriptor
 * loops (design.md section 1's crux snippet).
 *
 * Fetches `./catalog/${collectionId}.json` dynamically and POSTs
 * `{ records }` to `/__save/${collectionId}` — the mirror image of
 * `server/plan-save.ts::planSaveCollection` on the client side. Proven
 * end-to-end on `knowledge` this slice; `items` stays on its own
 * hand-written path in `main.ts` until Slice 5.
 *
 * Texture panel mounting (Slice 3b atlasKind generalization, design.md
 * "Texture panel mounts by atlasKind"): when the collection's registry
 * entry has a non-null `atlasKind` AND the caller supplied
 * `els.texturePanelMountEl`, the generic engine mounts its OWN
 * `createTexturePanel` instance parameterized by that atlasKind — no
 * collection-specific branching. `knowledge`/`research` (`atlasKind: null`)
 * never get a `texturePanelMountEl` from `main.ts`, so no panel mounts for
 * them, matching pre-Slice-3b behavior exactly.
 */

export interface EngineElements {
  catalogVersionEl: HTMLElement;
  addBtn: HTMLButtonElement;
  listEl: HTMLUListElement;
  masterEmptyEl: HTMLElement;
  masterLoadingEl: HTMLElement;
  masterErrorEl: HTMLElement;
  detailEmptyEl: HTMLElement;
  detailFormEl: HTMLFormElement;
  errorSummaryEl: HTMLElement;
  errorSummaryListEl: HTMLElement;
  fieldsEl: HTMLElement;
  deleteBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
  saveStatusEl: HTMLElement;
  /** Only required when the collection's `atlasKind` is non-null (e.g.
   * `terrains`); omit for `atlasKind: null` collections (`knowledge`,
   * `research`). */
  texturePanelMountEl?: HTMLElement;
}

export interface EngineHandle {
  boot(): Promise<void>;
}

type Record_ = Record<string, unknown>;

function fieldDomId(collectionId: string, key: string): string {
  return `field-${collectionId}-${key}`;
}

function requiredIdField(descriptor: CollectionDescriptor): FieldDescriptor {
  const idField = descriptor.fields.find((f) => f.isId);
  if (!idField) throw new Error(`items-editor: descriptor "${descriptor.collectionId}" has no isId field`);
  return idField;
}

/** Picks a second field to show as the list-row's secondary label — prefers
 * a field literally named "name", else the first non-id field. */
function labelField(descriptor: CollectionDescriptor, idField: FieldDescriptor): FieldDescriptor | null {
  return descriptor.fields.find((f) => f.key === "name") ?? descriptor.fields.find((f) => f.key !== idField.key) ?? null;
}

export function mountCollectionEngine(descriptor: CollectionDescriptor, els: EngineElements): EngineHandle {
  const collectionId = descriptor.collectionId;
  const meta = COLLECTIONS[collectionId];
  if (!meta) throw new Error(`items-editor: unknown collection "${collectionId}"`);
  const defName = meta.defName;
  const idField = requiredIdField(descriptor);
  const secondaryField = labelField(descriptor, idField);

  const texturePanel: TexturePanelHandle | null =
    meta.atlasKind && els.texturePanelMountEl ? createTexturePanel({ mountEl: els.texturePanelMountEl, atlasKind: meta.atlasKind }) : null;

  let records: Record_[] = [];
  let schemas: SchemaBundle | null = null;
  let selectedIndex: number | null = null;
  let widgets: Record<string, FieldWidget> | null = null;

  function buildWidgets(): Record<string, FieldWidget> {
    els.fieldsEl.innerHTML = "";
    const built: Record<string, FieldWidget> = {};
    for (const field of descriptor.fields) {
      const widget = createFieldWidget(field, fieldDomId(collectionId, field.key));
      if (field.fullWidth) widget.root.dataset.fullWidth = "true";
      els.fieldsEl.appendChild(widget.root);
      widget.onChange(() => syncFormIntoSelectedRecord());
      built[field.key] = widget;
    }
    return built;
  }

  function setSaveStatus(message: string, tone: "success" | "info" = "info"): void {
    els.saveStatusEl.textContent = message;
    els.saveStatusEl.classList.toggle("save-status-error", tone !== "success");
  }

  function updateSaveEnabled(): void {
    const hasFieldError = els.fieldsEl.querySelector('[aria-invalid="true"]') !== null;
    els.saveBtn.disabled = hasFieldError || records.length === 0;
  }

  function nextDefaultId(): string {
    let n = records.length + 1;
    let candidate = `new_${collectionId}_${n}`;
    while (records.some((r) => r[idField.key] === candidate)) {
      n += 1;
      candidate = `new_${collectionId}_${n}`;
    }
    return candidate;
  }

  function renderList(): void {
    els.listEl.innerHTML = "";
    els.masterEmptyEl.hidden = records.length > 0;
    records.forEach((record, index) => {
      const li = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "item-row";
      row.classList.toggle("active", index === selectedIndex);
      const idEl = document.createElement("span");
      idEl.className = "item-id";
      idEl.textContent = String(record[idField.key] ?? "(no id)") || "(no id)";
      row.appendChild(idEl);
      if (secondaryField) {
        const labelEl = document.createElement("span");
        labelEl.className = "item-name";
        labelEl.textContent = String(record[secondaryField.key] ?? "") || "(untitled)";
        row.appendChild(labelEl);
      }
      row.addEventListener("click", () => selectRecord(index));
      li.appendChild(row);
      els.listEl.appendChild(li);
    });
  }

  function clearErrorSummary(): void {
    els.errorSummaryEl.hidden = true;
    els.errorSummaryListEl.innerHTML = "";
  }

  function fieldIdForInstancePath(instancePath: string, recordIndex: number): string | null {
    if (recordIndex !== selectedIndex) return null;
    const relative = instancePath.replace(/^\/\d+/, "");
    const key = relative.replace(/^\//, "").split("/")[0];
    const field = descriptor.fields.find((f) => f.key === key);
    return field ? fieldDomId(collectionId, field.key) : null;
  }

  function renderErrorSummary(errors: SchemaError[]): void {
    els.errorSummaryListEl.innerHTML = "";
    for (const error of errors) {
      const match = /^\/(\d+)(.*)$/.exec(error.instancePath);
      const recordIndex = match ? Number(match[1]) : (selectedIndex ?? 0);
      const rest = match ? match[2] : error.instancePath;
      const record = records[recordIndex];
      const li = document.createElement("li");
      const link = document.createElement("a");
      const fieldId = fieldIdForInstancePath(match ? error.instancePath : `/${rest}`, recordIndex);
      link.href = fieldId ? `#${fieldId}` : "#";
      link.textContent = `${record ? String(record[idField.key] ?? `record ${recordIndex}`) : `record ${recordIndex}`} ${rest || "/"}: ${error.message}`;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (recordIndex !== selectedIndex) selectRecord(recordIndex);
        const target = fieldId ? document.getElementById(fieldId) : null;
        target?.focus();
      });
      li.appendChild(link);
      els.errorSummaryListEl.appendChild(li);
    }
    els.errorSummaryEl.hidden = errors.length === 0;
  }

  /**
   * Descriptor-driven sync loop (design.md section 1's crux snippet): reads
   * every widget, only writes the record back if EVERY field parses
   * successfully AND (for the id field) is unique among sibling records.
   * `r.value !== undefined` mirrors `reconstructRecord`'s optional-omission
   * convention — this IS the client-side mirror allow-list, generic over
   * ANY descriptor (design.md "one descriptor, two allow-lists").
   */
  function syncFormIntoSelectedRecord(): void {
    if (selectedIndex === null || !widgets) return;
    const w = widgets;
    let hasError = false;
    const draft: Record_ = {};

    for (const field of descriptor.fields) {
      const result = w[field.key]?.read();
      if (!result) continue;
      if (!result.ok) {
        w[field.key]?.setError(result.message);
        hasError = true;
        continue;
      }
      w[field.key]?.setError(null);
      if (field.isId) {
        const idValue = typeof result.value === "string" ? result.value : "";
        const existing = records.map((r) => ({ id: String(r[idField.key] ?? "") }));
        const idCheck = checkIdUnique(existing, idValue, selectedIndex);
        if (!idCheck.ok) {
          w[field.key]?.setError(`Id "${idValue}" is already used by another entry`);
          hasError = true;
          continue;
        }
      }
      if (result.value !== undefined) draft[field.key] = result.value;
    }

    if (hasError) {
      updateSaveEnabled();
      return;
    }

    records[selectedIndex] = draft;
    renderList();
    updateSaveEnabled();
  }

  function selectRecord(index: number): void {
    const record = records[index];
    if (!record) return;
    selectedIndex = index;
    if (!widgets) widgets = buildWidgets();
    for (const field of descriptor.fields) {
      widgets[field.key]?.write(record[field.key]);
      widgets[field.key]?.setError(null);
    }
    clearErrorSummary();
    setSaveStatus("");
    els.detailEmptyEl.hidden = true;
    els.detailFormEl.hidden = false;
    renderList();
    updateSaveEnabled();
    texturePanel?.selectItem(String(record[idField.key] ?? ""));
  }

  let savedSnapshot = "[]";

  function isDirty(): boolean {
    return JSON.stringify(records) !== savedSnapshot;
  }

  window.addEventListener("beforeunload", (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  async function fetchJson(path: string): Promise<unknown> {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function boot(): Promise<void> {
    els.masterLoadingEl.hidden = false;
    els.masterErrorEl.hidden = true;
    try {
      const [loadedRecords, common, catalog] = await Promise.all([
        fetchJson(`./catalog/${collectionId}.json`) as Promise<Record_[]>,
        fetchJson("./schemas/common.json"),
        fetchJson("./schemas/catalog.json"),
      ]);
      records = loadedRecords;
      schemas = { common, catalog };
      savedSnapshot = JSON.stringify(records);
      els.masterLoadingEl.hidden = true;
      els.addBtn.disabled = false;
      renderList();
    } catch (e) {
      els.masterLoadingEl.hidden = true;
      els.masterErrorEl.hidden = false;
      els.masterErrorEl.textContent = `Failed to load "${collectionId}" — run "pnpm sync:catalog:items && pnpm sync:schemas:items" first. (${e instanceof Error ? e.message : String(e)})`;
    }
  }

  els.addBtn.addEventListener("click", () => {
    const blank: Record_ = { [idField.key]: nextDefaultId() };
    for (const field of descriptor.fields) {
      if (field.key === idField.key) continue;
      if (field.kind === "boolean") blank[field.key] = false;
      if (field.kind === "tags") blank[field.key] = [];
    }
    records.push(blank);
    renderList();
    selectRecord(records.length - 1);
    if (secondaryField) widgets?.[secondaryField.key]?.focus();
  });

  els.deleteBtn.addEventListener("click", () => {
    if (selectedIndex === null) return;
    const record = records[selectedIndex];
    if (!record) return;
    const label = secondaryField ? String(record[secondaryField.key] ?? "") : String(record[idField.key] ?? "");
    const confirmed = window.confirm(`Delete "${label || record[idField.key]}"? This cannot be undone once saved.`);
    if (!confirmed) return;
    records.splice(selectedIndex, 1);
    selectedIndex = null;
    els.detailFormEl.hidden = true;
    els.detailEmptyEl.hidden = false;
    clearErrorSummary();
    renderList();
    texturePanel?.clearSelection();
  });

  els.detailFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    void save();
  });

  async function save(): Promise<void> {
    if (!schemas) return;
    syncFormIntoSelectedRecord();
    const { schemaErrors, idErrors } = validateCollection(schemas, defName, records);
    const idFieldErrors: SchemaError[] = idErrors.map((message) => ({ instancePath: `/${collectionId}`, message }));
    const allErrors = [...schemaErrors, ...idFieldErrors];
    if (allErrors.length > 0) {
      renderErrorSummary(allErrors);
      const firstFieldId = allErrors.map((err) => fieldIdForInstancePath(err.instancePath, selectedIndex ?? 0)).find((id) => id !== null);
      if (firstFieldId) document.getElementById(firstFieldId)?.focus();
      setSaveStatus("Save blocked — fix the errors above.", "info");
      return;
    }
    clearErrorSummary();
    els.saveBtn.disabled = true;
    setSaveStatus("Saving…");
    try {
      // gate-review note 1 (mirrors main.ts's items flow): the body is
      // EXACTLY { records } — no path/file/filename/target field, ever.
      const res = await fetch(`/__save/${collectionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records }),
      });
      const body = (await res.json()) as { ok: boolean; catalogVersion?: string; errors?: SchemaError[] };
      if (!res.ok || !body.ok) {
        renderErrorSummary(body.errors ?? [{ instancePath: "/", message: `save failed (HTTP ${res.status})` }]);
        setSaveStatus("Save failed.", "info");
        return;
      }
      savedSnapshot = JSON.stringify(records);
      els.catalogVersionEl.textContent = `catalogVersion ${body.catalogVersion}`;
      setSaveStatus(`Saved — catalogVersion ${body.catalogVersion}`, "success");
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "info");
    } finally {
      updateSaveEnabled();
    }
  }

  return { boot };
}
