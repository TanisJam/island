import { mountCollectionEngine, type EngineElements } from "./engine";
import { KNOWLEDGE_DESCRIPTOR } from "./shared/descriptors/knowledge";
import { RESEARCH_DESCRIPTOR } from "./shared/descriptors/research";
import { TERRAINS_DESCRIPTOR } from "./shared/descriptors/terrains";
import { WORLD_OBJECTS_DESCRIPTOR } from "./shared/descriptors/world-objects";
import { ITEMS_DESCRIPTOR } from "./shared/descriptors/items";

/**
 * Thin bootstrap for the items editor (design.md "1. Chosen architecture —
 * Layer 4: Generic engine", "6. items migration"). ALL five collections
 * (`items`, `knowledge`, `research`, `terrains`, `world-objects`) now mount
 * through the SAME `mountCollectionEngine` — this file only wires DOM
 * element lookups per pane and the collection-switcher's tab-visibility
 * toggling. No field/validation/save logic lives here anymore; that is
 * `engine.ts` (generic) + `shared/descriptors/*.ts` (per-collection data)
 * + `widgets/*` (per-kind rendering).
 *
 * `items` is the DEFAULT/active pane on load, so its engine instance boots
 * eagerly at the bottom of this file (matching its pre-Slice-5 eager
 * `void boot()`) rather than lazily on first tab click like the other four.
 */

function mustEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`items-editor: missing #${id} in index.html`);
  return el as unknown as T;
}

const catalogVersionEl = mustEl<HTMLDivElement>("catalog-version");

/**
 * Collection switcher (design.md "1. Chosen architecture — Layer 4",
 * spec "Descriptor-Driven Form Engine"). Toggles which top-level `<main>`
 * pane is visible; each collection's engine mounts lazily on first switch
 * to it — except `items`, which mounts eagerly below since it is the
 * default/active pane on load.
 */
const collectionSwitcherEl = mustEl<HTMLElement>("collection-switcher");
const itemsTabBtn = mustEl<HTMLButtonElement>("collection-tab-items");
const knowledgeTabBtn = mustEl<HTMLButtonElement>("collection-tab-knowledge");
const researchTabBtn = mustEl<HTMLButtonElement>("collection-tab-research");
const terrainsTabBtn = mustEl<HTMLButtonElement>("collection-tab-terrains");
const worldObjectsTabBtn = mustEl<HTMLButtonElement>("collection-tab-world-objects");
const itemsPaneEl = mustEl<HTMLElement>("items-pane");
const knowledgePaneEl = mustEl<HTMLElement>("knowledge-pane");
const researchPaneEl = mustEl<HTMLElement>("research-pane");
const terrainsPaneEl = mustEl<HTMLElement>("terrains-pane");
const worldObjectsPaneEl = mustEl<HTMLElement>("world-objects-pane");

let knowledgeEngineBooted = false;
let researchEngineBooted = false;
let terrainsEngineBooted = false;
let worldObjectsEngineBooted = false;

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
  worldObjectsPaneEl.hidden = true;
  activateTab(itemsTabBtn, knowledgeTabBtn, researchTabBtn, terrainsTabBtn, worldObjectsTabBtn);
});

knowledgeTabBtn.addEventListener("click", () => {
  itemsPaneEl.hidden = true;
  knowledgePaneEl.hidden = false;
  researchPaneEl.hidden = true;
  terrainsPaneEl.hidden = true;
  worldObjectsPaneEl.hidden = true;
  activateTab(knowledgeTabBtn, itemsTabBtn, researchTabBtn, terrainsTabBtn, worldObjectsTabBtn);
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
  worldObjectsPaneEl.hidden = true;
  activateTab(researchTabBtn, itemsTabBtn, knowledgeTabBtn, terrainsTabBtn, worldObjectsTabBtn);
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
  worldObjectsPaneEl.hidden = true;
  activateTab(terrainsTabBtn, itemsTabBtn, knowledgeTabBtn, researchTabBtn, worldObjectsTabBtn);
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

worldObjectsTabBtn.addEventListener("click", () => {
  itemsPaneEl.hidden = true;
  knowledgePaneEl.hidden = true;
  researchPaneEl.hidden = true;
  terrainsPaneEl.hidden = true;
  worldObjectsPaneEl.hidden = false;
  activateTab(worldObjectsTabBtn, itemsTabBtn, knowledgeTabBtn, researchTabBtn, terrainsTabBtn);
  if (!worldObjectsEngineBooted) {
    worldObjectsEngineBooted = true;
    const worldObjectsEls: EngineElements = {
      catalogVersionEl,
      addBtn: mustEl<HTMLButtonElement>("add-world-objects-record-btn"),
      listEl: mustEl<HTMLUListElement>("world-objects-record-list"),
      masterEmptyEl: mustEl<HTMLDivElement>("world-objects-master-empty"),
      masterLoadingEl: mustEl<HTMLDivElement>("world-objects-master-loading"),
      masterErrorEl: mustEl<HTMLDivElement>("world-objects-master-error"),
      detailEmptyEl: mustEl<HTMLDivElement>("world-objects-detail-empty"),
      detailFormEl: mustEl<HTMLFormElement>("world-objects-detail-form"),
      errorSummaryEl: mustEl<HTMLDivElement>("world-objects-error-summary"),
      errorSummaryListEl: mustEl<HTMLUListElement>("world-objects-error-summary-list"),
      fieldsEl: mustEl<HTMLDivElement>("world-objects-fields"),
      deleteBtn: mustEl<HTMLButtonElement>("delete-world-objects-record-btn"),
      saveBtn: mustEl<HTMLButtonElement>("world-objects-save-btn"),
      saveStatusEl: mustEl<HTMLSpanElement>("world-objects-save-status"),
      // atlasKind:"object" (Slice 3b generalization, reused as-is) — the
      // generic engine mounts its own texture panel into this element.
      texturePanelMountEl: mustEl<HTMLDivElement>("world-objects-texture-panel-mount"),
    };
    void mountCollectionEngine(WORLD_OBJECTS_DESCRIPTOR, worldObjectsEls).boot();
  }
});
void collectionSwitcherEl; // referenced only to fail fast via mustEl if index.html's markup drifts

/**
 * `items` (Slice 5 — the FINAL migrated collection). Boots eagerly, not
 * lazily behind a tab click, because `#items-pane` is the visible/active
 * pane on page load (matches the pre-Slice-5 behavior where `boot()` ran
 * unconditionally at the bottom of this file). Element ids are the
 * ORIGINAL, pre-generic-engine ids (`#fields`, `#item-list`,
 * `#add-item-btn`, etc.) — kept unchanged rather than renamed to the
 * `items-*` convention the other four panes use, to minimize `index.html`
 * churn on the collection with real authoring traffic. `atlasKind: "item"`
 * (registered since Slice 1) means the engine mounts its own texture panel
 * into `#texture-panel-mount`, replacing the standalone `createTexturePanel`
 * call this file used to make directly.
 */
const itemsEls: EngineElements = {
  catalogVersionEl,
  addBtn: mustEl<HTMLButtonElement>("add-item-btn"),
  listEl: mustEl<HTMLUListElement>("item-list"),
  masterEmptyEl: mustEl<HTMLDivElement>("master-empty"),
  masterLoadingEl: mustEl<HTMLDivElement>("master-loading"),
  masterErrorEl: mustEl<HTMLDivElement>("master-error"),
  detailEmptyEl: mustEl<HTMLDivElement>("detail-empty"),
  detailFormEl: mustEl<HTMLFormElement>("detail-form"),
  errorSummaryEl: mustEl<HTMLDivElement>("error-summary"),
  errorSummaryListEl: mustEl<HTMLUListElement>("error-summary-list"),
  fieldsEl: mustEl<HTMLDivElement>("fields"),
  deleteBtn: mustEl<HTMLButtonElement>("delete-item-btn"),
  saveBtn: mustEl<HTMLButtonElement>("save-btn"),
  saveStatusEl: mustEl<HTMLSpanElement>("save-status"),
  texturePanelMountEl: mustEl<HTMLDivElement>("texture-panel-mount"),
};
void mountCollectionEngine(ITEMS_DESCRIPTOR, itemsEls).boot();

/**
 * Active-collection persistence. The switcher otherwise always reopens on
 * `items` after a reload; this remembers the last tab the user was on
 * (localStorage) and re-selects it on load. Restoring simply re-fires the
 * existing tab handler via `.click()`, so pane visibility AND the lazy
 * engine mount are reused with no duplicated logic. `items` is the eager
 * default, so a stored `items` (or an unknown/removed id) needs no action.
 */
const ACTIVE_TAB_KEY = "items-editor:active-collection";
const tabButtons: ReadonlyArray<readonly [string, HTMLButtonElement]> = [
  ["items", itemsTabBtn],
  ["knowledge", knowledgeTabBtn],
  ["research", researchTabBtn],
  ["terrains", terrainsTabBtn],
  ["world-objects", worldObjectsTabBtn],
];
for (const [id, btn] of tabButtons) {
  btn.addEventListener("click", () => localStorage.setItem(ACTIVE_TAB_KEY, id));
}
const storedTab = localStorage.getItem(ACTIVE_TAB_KEY);
if (storedTab && storedTab !== "items") {
  tabButtons.find(([id]) => id === storedTab)?.[1].click();
}
