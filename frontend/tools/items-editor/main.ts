import type { ItemTypeDef } from "../../src/contract/catalog";
import { validateItems, type SchemaBundle, type SchemaError } from "./shared/validate-items";
import { normalizeItem, itemToFormState, type ItemFormState } from "./shared/normalize";
import { checkIdUnique } from "./shared/id-unique";
import { createTextField, emptyToUndefined, type TextFieldWidget } from "./widgets/text-field";
import { createNumberField, parseRequiredNumber, parseOptionalNumber, type NumberFieldWidget } from "./widgets/number-field";
import { createBooleanField, type BooleanFieldWidget } from "./widgets/boolean-field";
import { createTagsField, type TagsFieldWidget } from "./widgets/tags-field";
import { createPropsField, type PropsFieldWidget } from "./widgets/props-field";
import { createTexturePanel } from "./texture-panel";
import { mountCollectionEngine, type EngineElements } from "./engine";
import { KNOWLEDGE_DESCRIPTOR } from "./shared/descriptors/knowledge";
import { RESEARCH_DESCRIPTOR } from "./shared/descriptors/research";
import { TERRAINS_DESCRIPTOR } from "./shared/descriptors/terrains";

/**
 * Master-detail wiring for the items editor (design.md "Components & Data
 * Flow" + "ADR-5 — Field-widget toolkit + master-detail form"). Thin
 * impure shell: DOM orchestration + fetch/POST only. All parsing,
 * normalization, validation, and id-uniqueness logic lives in the pure
 * `shared/*` and `widgets/*` modules this file wires together.
 *
 * SECURITY (gate-review note 1): the browser POSTs ONLY `{ items }` to
 * `/__save-items` — never a path/file/filename/target field, even for
 * convenience. The server resolves its own write targets
 * (server/targets.ts); adding a path-like field here would be misleading
 * at best and is explicitly forbidden by the design's security model.
 */

const SAVE_ROUTE = "/__save-items";

function mustEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`items-editor: missing #${id} in index.html`);
  return el as unknown as T;
}

const catalogVersionEl = mustEl<HTMLDivElement>("catalog-version");
const addItemBtn = mustEl<HTMLButtonElement>("add-item-btn");
const itemListEl = mustEl<HTMLUListElement>("item-list");
const masterEmptyEl = mustEl<HTMLDivElement>("master-empty");
const masterLoadingEl = mustEl<HTMLDivElement>("master-loading");
const masterErrorEl = mustEl<HTMLDivElement>("master-error");
const detailEmptyEl = mustEl<HTMLDivElement>("detail-empty");
const detailFormEl = mustEl<HTMLFormElement>("detail-form");
const errorSummaryEl = mustEl<HTMLDivElement>("error-summary");
const errorSummaryListEl = mustEl<HTMLUListElement>("error-summary-list");
const fieldsEl = mustEl<HTMLDivElement>("fields");
const deleteItemBtn = mustEl<HTMLButtonElement>("delete-item-btn");
const saveBtn = mustEl<HTMLButtonElement>("save-btn");
const saveStatusEl = mustEl<HTMLSpanElement>("save-status");
const texturePanelMountEl = mustEl<HTMLDivElement>("texture-panel-mount");

/**
 * The texture panel (design.md "Slice C") writes atlas.json via its own
 * `/__save-atlas` POST — fully decoupled from `items`/`isDirty()`/
 * `savedSnapshot` and the `/__save-items` flow above. It is only told which
 * item is selected/deselected.
 */
const texturePanel = createTexturePanel({ mountEl: texturePanelMountEl, atlasKind: "item" });

interface Fields {
  id: TextFieldWidget;
  name: TextFieldWidget;
  description: TextFieldWidget;
  width: NumberFieldWidget;
  height: NumberFieldWidget;
  rotatable: BooleanFieldWidget;
  properties: PropsFieldWidget;
  tags: TagsFieldWidget;
  durability: NumberFieldWidget;
  observation: TextFieldWidget;
}

let items: ItemTypeDef[] = [];
let schemas: SchemaBundle | null = null;
let selectedIndex: number | null = null;
let savedSnapshot = "[]";
let fields: Fields | null = null;

function isDirty(): boolean {
  return JSON.stringify(items) !== savedSnapshot;
}

window.addEventListener("beforeunload", (e) => {
  if (!isDirty()) return;
  e.preventDefault();
  e.returnValue = "";
});

/** Generates a default id guaranteed unique among `items` for a new item. */
function nextDefaultId(existing: readonly ItemTypeDef[]): string {
  let n = existing.length + 1;
  let candidate = `new_item_${n}`;
  while (existing.some((item) => item.id === candidate)) {
    n += 1;
    candidate = `new_item_${n}`;
  }
  return candidate;
}

function buildFields(): Fields {
  fieldsEl.innerHTML = "";
  const built: Fields = {
    id: createTextField({ id: "field-id", label: "Id", required: true }),
    name: createTextField({ id: "field-name", label: "Name", required: true }),
    description: createTextField({ id: "field-description", label: "Description", required: true, multiline: true }),
    width: createNumberField({ id: "field-width", label: "Shape width", required: true, min: 1, integer: true }),
    height: createNumberField({ id: "field-height", label: "Shape height", required: true, min: 1, integer: true }),
    rotatable: createBooleanField({ id: "field-rotatable", label: "Rotatable" }),
    properties: createPropsField({ id: "field-properties", label: "Properties", required: true }),
    tags: createTagsField({ id: "field-tags", label: "Tags", required: true }),
    durability: createNumberField({ id: "field-durability", label: "Durability", min: 0, helperText: "Optional — leave empty to omit." }),
    observation: createTextField({ id: "field-observation", label: "Observation", multiline: true, helperText: "Optional — leave empty to omit." }),
  };
  const order: Array<[TextFieldWidget | NumberFieldWidget | BooleanFieldWidget | TagsFieldWidget | PropsFieldWidget, boolean]> = [
    [built.id, false],
    [built.name, false],
    [built.description, true],
    [built.width, false],
    [built.height, false],
    [built.rotatable, false],
    [built.properties, true],
    [built.tags, true],
    [built.durability, false],
    [built.observation, true],
  ];
  for (const [widget, fullWidth] of order) {
    if (fullWidth) widget.root.dataset.fullWidth = "true";
    fieldsEl.appendChild(widget.root);
  }

  const syncAndValidate = () => syncFormIntoSelectedItem();
  built.id.onChange(syncAndValidate);
  built.name.onChange(syncAndValidate);
  built.description.onChange(syncAndValidate);
  built.width.onChange(syncAndValidate);
  built.height.onChange(syncAndValidate);
  built.rotatable.onChange(syncAndValidate);
  built.properties.onChange(syncAndValidate);
  built.tags.onChange(syncAndValidate);
  built.durability.onChange(syncAndValidate);
  built.observation.onChange(syncAndValidate);

  return built;
}

function setSaveStatus(message: string, tone: "success" | "info" = "info"): void {
  saveStatusEl.textContent = message;
  saveStatusEl.classList.toggle("save-status-error", tone !== "success");
}

/**
 * Reads the current form's raw values, parses each field with the pure
 * widget helpers, and — only if every required field parses successfully
 * AND the id is unique — writes a normalized `ItemTypeDef` back into
 * `items[selectedIndex]` (spec "Edit and view a required field", "Item id
 * uniqueness"). Clears/sets per-field errors as it goes (inline-validate
 * on blur, per ui-ux-pro-max).
 */
function syncFormIntoSelectedItem(): void {
  if (selectedIndex === null || !fields) return;
  const f = fields;
  let hasFieldError = false;

  const idRaw = f.id.getValue().trim();
  if (idRaw === "") {
    f.id.setError("Id is required");
    hasFieldError = true;
  } else {
    const idCheck = checkIdUnique(items, idRaw, selectedIndex);
    if (!idCheck.ok) {
      f.id.setError(`Id "${idRaw}" is already used by another item`);
      hasFieldError = true;
    } else {
      f.id.setError(null);
    }
  }

  const nameRaw = f.name.getValue().trim();
  if (nameRaw === "") {
    f.name.setError("Name is required");
    hasFieldError = true;
  } else {
    f.name.setError(null);
  }

  const descriptionRaw = f.description.getValue().trim();
  if (descriptionRaw === "") {
    f.description.setError("Description is required");
    hasFieldError = true;
  } else {
    f.description.setError(null);
  }

  const width = parseRequiredNumber(f.width.getRawValue(), { min: 1, integer: true });
  if (!width.ok) {
    f.width.setError("Must be a whole number >= 1");
    hasFieldError = true;
  } else {
    f.width.setError(null);
  }

  const height = parseRequiredNumber(f.height.getRawValue(), { min: 1, integer: true });
  if (!height.ok) {
    f.height.setError("Must be a whole number >= 1");
    hasFieldError = true;
  } else {
    f.height.setError(null);
  }

  const durability = parseOptionalNumber(f.durability.getRawValue());
  if (!durability.ok) {
    f.durability.setError("Must be a number, or left empty");
    hasFieldError = true;
  } else {
    f.durability.setError(null);
  }

  if (hasFieldError || !width.ok || !height.ok || !durability.ok) {
    updateSaveEnabled();
    return;
  }

  const form: ItemFormState = {
    id: idRaw,
    name: f.name.getValue(),
    description: f.description.getValue(),
    width: width.value,
    height: height.value,
    rotatable: f.rotatable.getValue(),
    properties: f.properties.getValue(),
    tags: f.tags.getValue(),
  };
  const observation = emptyToUndefined(f.observation.getValue());
  if (observation !== undefined) form.observation = observation;
  if (durability.value !== undefined) form.durability = durability.value;

  items[selectedIndex] = normalizeItem(form);
  renderItemList();
  updateSaveEnabled();
}

function updateSaveEnabled(): void {
  const hasFieldError = fieldsEl.querySelector('[aria-invalid="true"]') !== null;
  saveBtn.disabled = hasFieldError || items.length === 0;
}

function renderItemList(): void {
  itemListEl.innerHTML = "";
  masterEmptyEl.hidden = items.length > 0;
  items.forEach((item, index) => {
    const li = document.createElement("li");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "item-row";
    row.classList.toggle("active", index === selectedIndex);
    const idEl = document.createElement("span");
    idEl.className = "item-id";
    idEl.textContent = item.id || "(no id)";
    const nameEl = document.createElement("span");
    nameEl.className = "item-name";
    nameEl.textContent = item.name || "(untitled)";
    row.appendChild(idEl);
    row.appendChild(nameEl);
    row.addEventListener("click", () => selectItem(index));
    li.appendChild(row);
    itemListEl.appendChild(li);
  });
}

function selectItem(index: number): void {
  const item = items[index];
  if (!item) return;
  selectedIndex = index;
  if (!fields) fields = buildFields();
  const form = itemToFormState(item);
  fields.id.setValue(form.id);
  fields.id.setError(null);
  fields.name.setValue(form.name);
  fields.name.setError(null);
  fields.description.setValue(form.description);
  fields.description.setError(null);
  fields.width.setValue(form.width);
  fields.width.setError(null);
  fields.height.setValue(form.height);
  fields.height.setError(null);
  fields.rotatable.setValue(form.rotatable);
  fields.properties.setValue(form.properties);
  fields.properties.setError(null);
  fields.tags.setValue(form.tags);
  fields.tags.setError(null);
  fields.durability.setValue(form.durability);
  fields.durability.setError(null);
  fields.observation.setValue(form.observation ?? "");
  fields.observation.setError(null);

  clearErrorSummary();
  setSaveStatus("");
  detailEmptyEl.hidden = true;
  detailFormEl.hidden = false;
  renderItemList();
  updateSaveEnabled();
  texturePanel.selectItem(item.id);
}

function clearErrorSummary(): void {
  errorSummaryEl.hidden = true;
  errorSummaryListEl.innerHTML = "";
}

function fieldIdForInstancePath(instancePath: string, itemIndex: number): string | null {
  if (itemIndex !== selectedIndex) return null;
  const map: Record<string, string> = {
    "/id": "field-id",
    "/name": "field-name",
    "/description": "field-description",
    "/shape/w": "field-width",
    "/shape/h": "field-height",
    "/rotatable": "field-rotatable",
    "/properties": "field-properties",
    "/tags": "field-tags",
    "/durability": "field-durability",
    "/observation": "field-observation",
  };
  const relative = instancePath.replace(/^\/\d+/, "");
  return map[relative] ?? null;
}

function renderErrorSummary(errors: SchemaError[]): void {
  errorSummaryListEl.innerHTML = "";
  for (const error of errors) {
    const match = /^\/(\d+)(.*)$/.exec(error.instancePath);
    const itemIndex = match ? Number(match[1]) : (selectedIndex ?? 0);
    const rest = match ? match[2] : error.instancePath;
    const item = items[itemIndex];
    const li = document.createElement("li");
    const link = document.createElement("a");
    const fieldId = fieldIdForInstancePath(match ? error.instancePath : `/${rest}`, itemIndex);
    link.href = fieldId ? `#${fieldId}` : "#";
    link.textContent = `${item ? item.id || `item ${itemIndex}` : `item ${itemIndex}`} ${rest || "/"}: ${error.message}`;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      if (itemIndex !== selectedIndex) selectItem(itemIndex);
      const target = fieldId ? document.getElementById(fieldId) : null;
      target?.focus();
    });
    li.appendChild(link);
    errorSummaryListEl.appendChild(li);
  }
  errorSummaryEl.hidden = errors.length === 0;
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function boot(): Promise<void> {
  masterLoadingEl.hidden = false;
  masterErrorEl.hidden = true;
  try {
    const [loadedItems, common, catalog, meta] = await Promise.all([
      fetchJson("./catalog/items.json") as Promise<ItemTypeDef[]>,
      fetchJson("./schemas/common.json"),
      fetchJson("./schemas/catalog.json"),
      fetchJson("./catalog/meta.json") as Promise<{ catalogVersion: string }>,
    ]);
    items = loadedItems;
    schemas = { common, catalog };
    savedSnapshot = JSON.stringify(items);
    catalogVersionEl.textContent = `catalogVersion ${meta.catalogVersion}`;
    masterLoadingEl.hidden = true;
    addItemBtn.disabled = false;
    renderItemList();
  } catch (e) {
    masterLoadingEl.hidden = true;
    masterErrorEl.hidden = false;
    masterErrorEl.textContent = `Failed to load catalog — run "pnpm sync:catalog:items && pnpm sync:schemas:items" first. (${e instanceof Error ? e.message : String(e)})`;
  }
}

addItemBtn.addEventListener("click", () => {
  const id = nextDefaultId(items);
  const blank: ItemTypeDef = {
    id,
    name: "",
    description: "",
    shape: { w: 1, h: 1 },
    rotatable: false,
    properties: {},
    tags: [],
  };
  items.push(blank);
  renderItemList();
  selectItem(items.length - 1);
  fields?.name.focus();
});

deleteItemBtn.addEventListener("click", () => {
  if (selectedIndex === null) return;
  const item = items[selectedIndex];
  if (!item) return;
  const confirmed = window.confirm(`Delete "${item.name || item.id}"? This cannot be undone once saved.`);
  if (!confirmed) return;
  items.splice(selectedIndex, 1);
  selectedIndex = null;
  detailFormEl.hidden = true;
  detailEmptyEl.hidden = false;
  clearErrorSummary();
  renderItemList();
  texturePanel.clearSelection();
});

detailFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  void save();
});

async function save(): Promise<void> {
  if (!schemas) return;
  syncFormIntoSelectedItem();
  const { schemaErrors, idErrors } = validateItems(schemas, items);
  const idFieldErrors: SchemaError[] = idErrors.map((message) => ({ instancePath: "/items", message }));
  const allErrors = [...schemaErrors, ...idFieldErrors];
  if (allErrors.length > 0) {
    renderErrorSummary(allErrors);
    const firstFieldId = allErrors.map((err) => fieldIdForInstancePath(err.instancePath, selectedIndex ?? 0)).find((id) => id !== null);
    if (firstFieldId) document.getElementById(firstFieldId)?.focus();
    setSaveStatus("Save blocked — fix the errors above.", "info");
    return;
  }
  clearErrorSummary();
  saveBtn.disabled = true;
  setSaveStatus("Saving…");
  try {
    // gate-review note 1: the body is EXACTLY { items } — no path/file/
    // filename/target field is ever added, by design (server/targets.ts
    // resolves the write location on its own).
    const res = await fetch(SAVE_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const body = (await res.json()) as { ok: boolean; catalogVersion?: string; errors?: SchemaError[] };
    if (!res.ok || !body.ok) {
      renderErrorSummary(body.errors ?? [{ instancePath: "/", message: `save failed (HTTP ${res.status})` }]);
      setSaveStatus("Save failed.", "info");
      return;
    }
    savedSnapshot = JSON.stringify(items);
    catalogVersionEl.textContent = `catalogVersion ${body.catalogVersion}`;
    setSaveStatus(`Saved — catalogVersion ${body.catalogVersion}`, "success");
  } catch (e) {
    setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "info");
  } finally {
    updateSaveEnabled();
  }
}

/**
 * Collection switcher (design.md "1. Chosen architecture — Layer 4",
 * spec "Descriptor-Driven Form Engine"). Toggles which top-level `<main>`
 * pane is visible; each generic collection's engine mounts lazily on first
 * switch to it (not on page load) so items — the default/only view before
 * Slice 1 — keeps booting exactly as it always has. `items` intentionally
 * stays on its own hand-written path above; only Slice 5 migrates it onto
 * `engine.ts`.
 */
const collectionSwitcherEl = mustEl<HTMLElement>("collection-switcher");
const itemsTabBtn = mustEl<HTMLButtonElement>("collection-tab-items");
const knowledgeTabBtn = mustEl<HTMLButtonElement>("collection-tab-knowledge");
const researchTabBtn = mustEl<HTMLButtonElement>("collection-tab-research");
const terrainsTabBtn = mustEl<HTMLButtonElement>("collection-tab-terrains");
const itemsPaneEl = mustEl<HTMLElement>("items-pane");
const knowledgePaneEl = mustEl<HTMLElement>("knowledge-pane");
const researchPaneEl = mustEl<HTMLElement>("research-pane");
const terrainsPaneEl = mustEl<HTMLElement>("terrains-pane");

let knowledgeEngineBooted = false;
let researchEngineBooted = false;
let terrainsEngineBooted = false;

function activateTab(activeBtn: HTMLButtonElement, ...inactiveBtns: HTMLButtonElement[]): void {
  activeBtn.classList.add("active");
  activeBtn.setAttribute("aria-pressed", "true");
  for (const btn of inactiveBtns) {
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
  }
}

itemsTabBtn.addEventListener("click", () => {
  itemsPaneEl.hidden = false;
  knowledgePaneEl.hidden = true;
  researchPaneEl.hidden = true;
  terrainsPaneEl.hidden = true;
  activateTab(itemsTabBtn, knowledgeTabBtn, researchTabBtn, terrainsTabBtn);
});

knowledgeTabBtn.addEventListener("click", () => {
  itemsPaneEl.hidden = true;
  knowledgePaneEl.hidden = false;
  researchPaneEl.hidden = true;
  terrainsPaneEl.hidden = true;
  activateTab(knowledgeTabBtn, itemsTabBtn, researchTabBtn, terrainsTabBtn);
  if (!knowledgeEngineBooted) {
    knowledgeEngineBooted = true;
    const knowledgeEls: EngineElements = {
      catalogVersionEl,
      addBtn: mustEl<HTMLButtonElement>("add-record-btn"),
      listEl: mustEl<HTMLUListElement>("record-list"),
      masterEmptyEl: mustEl<HTMLDivElement>("generic-master-empty"),
      masterLoadingEl: mustEl<HTMLDivElement>("generic-master-loading"),
      masterErrorEl: mustEl<HTMLDivElement>("generic-master-error"),
      detailEmptyEl: mustEl<HTMLDivElement>("generic-detail-empty"),
      detailFormEl: mustEl<HTMLFormElement>("generic-detail-form"),
      errorSummaryEl: mustEl<HTMLDivElement>("generic-error-summary"),
      errorSummaryListEl: mustEl<HTMLUListElement>("generic-error-summary-list"),
      fieldsEl: mustEl<HTMLDivElement>("generic-fields"),
      deleteBtn: mustEl<HTMLButtonElement>("delete-record-btn"),
      saveBtn: mustEl<HTMLButtonElement>("generic-save-btn"),
      saveStatusEl: mustEl<HTMLSpanElement>("generic-save-status"),
    };
    void mountCollectionEngine(KNOWLEDGE_DESCRIPTOR, knowledgeEls).boot();
  }
});

researchTabBtn.addEventListener("click", () => {
  itemsPaneEl.hidden = true;
  knowledgePaneEl.hidden = true;
  researchPaneEl.hidden = false;
  terrainsPaneEl.hidden = true;
  activateTab(researchTabBtn, itemsTabBtn, knowledgeTabBtn, terrainsTabBtn);
  if (!researchEngineBooted) {
    researchEngineBooted = true;
    const researchEls: EngineElements = {
      catalogVersionEl,
      addBtn: mustEl<HTMLButtonElement>("add-research-record-btn"),
      listEl: mustEl<HTMLUListElement>("research-record-list"),
      masterEmptyEl: mustEl<HTMLDivElement>("research-master-empty"),
      masterLoadingEl: mustEl<HTMLDivElement>("research-master-loading"),
      masterErrorEl: mustEl<HTMLDivElement>("research-master-error"),
      detailEmptyEl: mustEl<HTMLDivElement>("research-detail-empty"),
      detailFormEl: mustEl<HTMLFormElement>("research-detail-form"),
      errorSummaryEl: mustEl<HTMLDivElement>("research-error-summary"),
      errorSummaryListEl: mustEl<HTMLUListElement>("research-error-summary-list"),
      fieldsEl: mustEl<HTMLDivElement>("research-fields"),
      deleteBtn: mustEl<HTMLButtonElement>("delete-research-record-btn"),
      saveBtn: mustEl<HTMLButtonElement>("research-save-btn"),
      saveStatusEl: mustEl<HTMLSpanElement>("research-save-status"),
    };
    void mountCollectionEngine(RESEARCH_DESCRIPTOR, researchEls).boot();
  }
});

terrainsTabBtn.addEventListener("click", () => {
  itemsPaneEl.hidden = true;
  knowledgePaneEl.hidden = true;
  researchPaneEl.hidden = true;
  terrainsPaneEl.hidden = false;
  activateTab(terrainsTabBtn, itemsTabBtn, knowledgeTabBtn, researchTabBtn);
  if (!terrainsEngineBooted) {
    terrainsEngineBooted = true;
    const terrainsEls: EngineElements = {
      catalogVersionEl,
      addBtn: mustEl<HTMLButtonElement>("add-terrains-record-btn"),
      listEl: mustEl<HTMLUListElement>("terrains-record-list"),
      masterEmptyEl: mustEl<HTMLDivElement>("terrains-master-empty"),
      masterLoadingEl: mustEl<HTMLDivElement>("terrains-master-loading"),
      masterErrorEl: mustEl<HTMLDivElement>("terrains-master-error"),
      detailEmptyEl: mustEl<HTMLDivElement>("terrains-detail-empty"),
      detailFormEl: mustEl<HTMLFormElement>("terrains-detail-form"),
      errorSummaryEl: mustEl<HTMLDivElement>("terrains-error-summary"),
      errorSummaryListEl: mustEl<HTMLUListElement>("terrains-error-summary-list"),
      fieldsEl: mustEl<HTMLDivElement>("terrains-fields"),
      deleteBtn: mustEl<HTMLButtonElement>("delete-terrains-record-btn"),
      saveBtn: mustEl<HTMLButtonElement>("terrains-save-btn"),
      saveStatusEl: mustEl<HTMLSpanElement>("terrains-save-status"),
      // atlasKind:"terrain" (Slice 3b) — the generic engine mounts its own
      // texture panel into this element; `knowledge`/`research` never pass
      // this field, so no panel mounts for them (atlasKind: null).
      texturePanelMountEl: mustEl<HTMLDivElement>("terrains-texture-panel-mount"),
    };
    void mountCollectionEngine(TERRAINS_DESCRIPTOR, terrainsEls).boot();
  }
});
void collectionSwitcherEl; // referenced only to fail fast via mustEl if index.html's markup drifts

void boot();
