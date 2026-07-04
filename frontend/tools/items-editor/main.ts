import "./style.css";
import { mountCollectionEngine, type EngineElements } from "./engine";
import { KNOWLEDGE_DESCRIPTOR } from "./shared/descriptors/knowledge";
import { RESEARCH_DESCRIPTOR } from "./shared/descriptors/research";
import { TERRAINS_DESCRIPTOR } from "./shared/descriptors/terrains";
import { WORLD_OBJECTS_DESCRIPTOR } from "./shared/descriptors/world-objects";
import { ITEMS_DESCRIPTOR } from "./shared/descriptors/items";

/**
 * Mountable bootstrap for the items editor (design.md "1. Chosen
 * architecture — Layer 4: Generic engine", "6. items migration"; converted
 * to `mount(container)` for the unified-app shell — tasks.md Phase 3,
 * mirroring the atlas-editor migration in `tools/atlas-editor/main.ts`).
 * ALL five collections (`items`, `knowledge`, `research`, `terrains`,
 * `world-objects`) mount through the SAME `mountCollectionEngine` — this
 * file only wires DOM element lookups per pane and the
 * collection-switcher's tab-visibility toggling. No field/validation/save
 * logic lives here anymore; that is `engine.ts` (generic) +
 * `shared/descriptors/*.ts` (per-collection data) + `widgets/*` (per-kind
 * rendering).
 *
 * `items` is the DEFAULT/active pane on mount, so its engine instance boots
 * eagerly (matching its pre-migration eager `void boot()`) rather than
 * lazily on first tab click like the other four.
 */

/** Was `index.html`'s body markup before the unified-app migration
 * (tasks.md "Migrate items-editor" — Phase 3). Injected into the mounting
 * container's `innerHTML` by `mount()`; DOM structure/ids unchanged so the
 * lookups below still work exactly as they did against the old
 * bespoke-entry `index.html`. */
const TEMPLATE = `
  <header class="topbar">
    <h1>Items Editor</h1>
    <span class="subtitle">Dev-only catalog editor — not part of the game build</span>
    <nav id="collection-switcher" class="collection-switcher" aria-label="Collection selector">
      <button id="collection-tab-items" type="button" class="collection-tab active" aria-pressed="true">Items</button>
      <button id="collection-tab-knowledge" type="button" class="collection-tab" aria-pressed="false">Knowledge</button>
      <button id="collection-tab-research" type="button" class="collection-tab" aria-pressed="false">Research</button>
      <button id="collection-tab-terrains" type="button" class="collection-tab" aria-pressed="false">Terrains</button>
      <button id="collection-tab-world-objects" type="button" class="collection-tab" aria-pressed="false">World Objects</button>
    </nav>
    <div id="catalog-version" class="catalog-version"></div>
  </header>

  <main id="items-pane" class="layout">
    <section class="master-pane" aria-label="Item list">
      <div class="master-header">
        <h2>Items</h2>
        <button id="add-item-btn" type="button" class="btn btn-primary" disabled>+ New item</button>
      </div>
      <ul id="item-list" class="item-list"></ul>
      <div id="master-empty" class="empty-state" hidden>No items yet. Add one to get started.</div>
      <div id="master-loading" class="loading-state">Loading catalog…</div>
      <div id="master-error" class="error-state" role="alert" hidden></div>
    </section>

    <section class="detail-pane" aria-label="Item detail form">
      <div id="detail-empty" class="empty-state">Select an item on the left, or add a new one.</div>

      <form id="detail-form" novalidate hidden>
        <div id="error-summary" class="error-summary" role="alert" hidden>
          <p class="error-summary-title">Fix the following before saving:</p>
          <ul id="error-summary-list"></ul>
        </div>

        <section class="texture-panel" aria-label="Item sprite">
          <h3 class="texture-panel-heading">Sprite</h3>
          <div id="texture-panel-mount"></div>
        </section>

        <div id="fields" class="fields-grid"></div>

        <div class="detail-actions">
          <button id="delete-item-btn" type="button" class="btn btn-danger">Delete item</button>
          <div class="detail-actions-right">
            <span id="save-status" class="save-status" role="status" aria-live="polite"></span>
            <button id="save-btn" type="submit" class="btn btn-primary">Save</button>
          </div>
        </div>
      </form>
    </section>
  </main>

  <main id="knowledge-pane" class="layout" hidden>
    <section class="master-pane" aria-label="Knowledge list">
      <div class="master-header">
        <h2>Knowledge</h2>
        <button id="add-record-btn" type="button" class="btn btn-primary" disabled>+ New entry</button>
      </div>
      <ul id="record-list" class="item-list"></ul>
      <div id="generic-master-empty" class="empty-state" hidden>No entries yet. Add one to get started.</div>
      <div id="generic-master-loading" class="loading-state">Loading catalog…</div>
      <div id="generic-master-error" class="error-state" role="alert" hidden></div>
    </section>

    <section class="detail-pane" aria-label="Entry detail form">
      <div id="generic-detail-empty" class="empty-state">Select an entry on the left, or add a new one.</div>

      <form id="generic-detail-form" novalidate hidden>
        <div id="generic-error-summary" class="error-summary" role="alert" hidden>
          <p class="error-summary-title">Fix the following before saving:</p>
          <ul id="generic-error-summary-list"></ul>
        </div>

        <div id="generic-fields" class="fields-grid"></div>

        <div class="detail-actions">
          <button id="delete-record-btn" type="button" class="btn btn-danger">Delete entry</button>
          <div class="detail-actions-right">
            <span id="generic-save-status" class="save-status" role="status" aria-live="polite"></span>
            <button id="generic-save-btn" type="submit" class="btn btn-primary">Save</button>
          </div>
        </div>
      </form>
    </section>
  </main>

  <main id="research-pane" class="layout" hidden>
    <section class="master-pane" aria-label="Research list">
      <div class="master-header">
        <h2>Research</h2>
        <button id="add-research-record-btn" type="button" class="btn btn-primary" disabled>+ New entry</button>
      </div>
      <ul id="research-record-list" class="item-list"></ul>
      <div id="research-master-empty" class="empty-state" hidden>No entries yet. Add one to get started.</div>
      <div id="research-master-loading" class="loading-state">Loading catalog…</div>
      <div id="research-master-error" class="error-state" role="alert" hidden></div>
    </section>

    <section class="detail-pane" aria-label="Entry detail form">
      <div id="research-detail-empty" class="empty-state">Select an entry on the left, or add a new one.</div>

      <form id="research-detail-form" novalidate hidden>
        <div id="research-error-summary" class="error-summary" role="alert" hidden>
          <p class="error-summary-title">Fix the following before saving:</p>
          <ul id="research-error-summary-list"></ul>
        </div>

        <div id="research-fields" class="fields-grid"></div>

        <div class="detail-actions">
          <button id="delete-research-record-btn" type="button" class="btn btn-danger">Delete entry</button>
          <div class="detail-actions-right">
            <span id="research-save-status" class="save-status" role="status" aria-live="polite"></span>
            <button id="research-save-btn" type="submit" class="btn btn-primary">Save</button>
          </div>
        </div>
      </form>
    </section>
  </main>

  <main id="terrains-pane" class="layout" hidden>
    <section class="master-pane" aria-label="Terrains list">
      <div class="master-header">
        <h2>Terrains</h2>
        <button id="add-terrains-record-btn" type="button" class="btn btn-primary" disabled>+ New entry</button>
      </div>
      <ul id="terrains-record-list" class="item-list"></ul>
      <div id="terrains-master-empty" class="empty-state" hidden>No entries yet. Add one to get started.</div>
      <div id="terrains-master-loading" class="loading-state">Loading catalog…</div>
      <div id="terrains-master-error" class="error-state" role="alert" hidden></div>
    </section>

    <section class="detail-pane" aria-label="Entry detail form">
      <div id="terrains-detail-empty" class="empty-state">Select an entry on the left, or add a new one.</div>

      <form id="terrains-detail-form" novalidate hidden>
        <div id="terrains-error-summary" class="error-summary" role="alert" hidden>
          <p class="error-summary-title">Fix the following before saving:</p>
          <ul id="terrains-error-summary-list"></ul>
        </div>

        <section class="texture-panel" aria-label="Terrain sprite">
          <h3 class="texture-panel-heading">Sprite</h3>
          <div id="terrains-texture-panel-mount"></div>
        </section>

        <div id="terrains-fields" class="fields-grid"></div>

        <div class="detail-actions">
          <button id="delete-terrains-record-btn" type="button" class="btn btn-danger">Delete entry</button>
          <div class="detail-actions-right">
            <span id="terrains-save-status" class="save-status" role="status" aria-live="polite"></span>
            <button id="terrains-save-btn" type="submit" class="btn btn-primary">Save</button>
          </div>
        </div>
      </form>
    </section>
  </main>

  <main id="world-objects-pane" class="layout" hidden>
    <section class="master-pane" aria-label="World objects list">
      <div class="master-header">
        <h2>World Objects</h2>
        <button id="add-world-objects-record-btn" type="button" class="btn btn-primary" disabled>+ New entry</button>
      </div>
      <ul id="world-objects-record-list" class="item-list"></ul>
      <div id="world-objects-master-empty" class="empty-state" hidden>No entries yet. Add one to get started.</div>
      <div id="world-objects-master-loading" class="loading-state">Loading catalog…</div>
      <div id="world-objects-master-error" class="error-state" role="alert" hidden></div>
    </section>

    <section class="detail-pane" aria-label="Entry detail form">
      <div id="world-objects-detail-empty" class="empty-state">Select an entry on the left, or add a new one.</div>

      <form id="world-objects-detail-form" novalidate hidden>
        <div id="world-objects-error-summary" class="error-summary" role="alert" hidden>
          <p class="error-summary-title">Fix the following before saving:</p>
          <ul id="world-objects-error-summary-list"></ul>
        </div>

        <section class="texture-panel" aria-label="World object sprite">
          <h3 class="texture-panel-heading">Sprite</h3>
          <div id="world-objects-texture-panel-mount"></div>
        </section>

        <div id="world-objects-fields" class="fields-grid"></div>

        <div class="detail-actions">
          <button id="delete-world-objects-record-btn" type="button" class="btn btn-danger">Delete entry</button>
          <div class="detail-actions-right">
            <span id="world-objects-save-status" class="save-status" role="status" aria-live="polite"></span>
            <button id="world-objects-save-btn" type="submit" class="btn btn-primary">Save</button>
          </div>
        </div>
      </form>
    </section>
  </main>
`;

const ACTIVE_TAB_KEY = "items-editor:active-collection";

/** Mounts the items editor (all five collections) into `container`
 * (tasks.md 3.1 — replaces the old bespoke `index.html` bootstrap). Safe to
 * call more than once (e.g. navigating away and back via the hash router):
 * rebuilds the DOM inside `container` and re-runs all wiring/engine boots
 * fresh, mirroring `tools/atlas-editor/main.ts::mount`. Unlike the atlas
 * editor, this tool re-fetches its catalog data from the server on every
 * mount (no long-lived module-scope tool state to preserve across mounts). */
export function mount(container: HTMLElement): void {
  container.innerHTML = TEMPLATE;

  function mustEl<T extends Element>(id: string): T {
    const el = container.querySelector(`#${id}`);
    if (!el) throw new Error(`items-editor: missing #${id} in mount template`);
    return el as unknown as T;
  }

  const catalogVersionEl = mustEl<HTMLDivElement>("catalog-version");

  /**
   * Collection switcher (design.md "1. Chosen architecture — Layer 4",
   * spec "Descriptor-Driven Form Engine"). Toggles which top-level `<main>`
   * pane is visible; each collection's engine mounts lazily on first switch
   * to it — except `items`, which mounts eagerly below since it is the
   * default/active pane on mount.
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
  void collectionSwitcherEl; // referenced only to fail fast via mustEl if the mount template drifts

  /**
   * `items` boots eagerly, not lazily behind a tab click, because
   * `#items-pane` is the visible/active pane on mount (matches the
   * pre-migration behavior where `boot()` ran unconditionally at the bottom
   * of this file). Element ids are the ORIGINAL, pre-generic-engine ids
   * (`#fields`, `#item-list`, `#add-item-btn`, etc.) — kept unchanged rather
   * than renamed to the `items-*` convention the other four panes use.
   * `atlasKind: "item"` means the engine mounts its own texture panel into
   * `#texture-panel-mount`.
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
   * `items` after a remount; this remembers the last tab the user was on
   * (localStorage) and re-selects it. Restoring simply re-fires the
   * existing tab handler via `.click()`, so pane visibility AND the lazy
   * engine mount are reused with no duplicated logic. `items` is the eager
   * default, so a stored `items` (or an unknown/removed id) needs no action.
   */
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
}
