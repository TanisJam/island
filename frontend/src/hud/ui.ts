import type { Catalog } from "../contract";
import type { Store } from "../state/store";
import type { ContextMenu, ContextMenuItem } from "../actions/context-menu";
import { createWindowManager, type ScreenPoint, type WindowManager } from "./window-manager";
import { renderHud, renderInventoryGrid, showLatestThought, showThought as showThoughtDom, type HudHandlers } from "./hud";

export type { ScreenPoint };

const INVENTORY_WINDOW_ID = "inventory";
const CONTEXT_MENU_ID = "context-menu";

/**
 * Sits in front of the DOM HUD (design.md SEAM 7) so a future reactive
 * framework implementation could replace `createDomUi` without touching
 * `Store`/`Game`/`Renderer`.
 *
 * Additive extension (tasks.md 2.6, design.md "Ui extension"): the original
 * `mount`/`showThought`/`destroy` contract is unchanged; the three new
 * methods give callers (input/mouse.ts, in Phase 4) a way to open/close the
 * floating inventory window and the contextual menu without reaching for
 * the `WindowManager` directly — it stays internal to `createDomUi`.
 */
export interface Ui {
  /** Subscribes to `store` and re-renders the HUD on every notification. */
  mount(store: Store, catalog: Catalog, handlers: HudHandlers): void;
  showThought(text: string): void;
  destroy(): void;
  /** Opens the "MIS COSAS" inventory grid window if closed, closes it if
   * already open. Requires `mount` to have been called first (no-op
   * otherwise — mirrors the rest of this module's defensive style). */
  toggleInventory(): void;
  /** Renders `menu` as a floating window at `at` (clamped to the viewport)
   * and invokes `onSelect` when a non-mute item is clicked. */
  openContextMenu(menu: ContextMenu, at: ScreenPoint, onSelect: (item: ContextMenuItem) => void): void;
  closeContextMenu(): void;
}

/** Renders a `ContextMenu` data model (actions/context-menu.ts, PURE) into
 * the `.sect-h`/`.act` DOM structure from the mockup. Never builds commands
 * itself — every item already carries its prebuilt `command`/`uiIntent`. */
function renderContextMenuBody(menu: ContextMenu, onSelect: (item: ContextMenuItem) => void): HTMLElement {
  const body = document.createElement("div");
  for (const section of menu.sections) {
    const heading = document.createElement("div");
    heading.className = section.dim ? "sect-h dim" : "sect-h";
    heading.textContent = section.title;
    body.appendChild(heading);

    for (const item of section.items) {
      const button = document.createElement("button");
      button.className = item.kind === "mute" ? "act mute" : "act";
      button.textContent = item.label;
      if (item.hint) {
        const hint = document.createElement("small");
        hint.textContent = item.hint;
        button.appendChild(hint);
      }
      if (item.kind !== "mute") {
        button.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onSelect(item);
        });
      }
      body.appendChild(button);
    }
  }
  return body;
}

/**
 * DOM implementation of `Ui`. Wraps the existing `renderHud`/`showThought`/
 * `showLatestThought` DOM functions (hud/hud.ts logic unchanged — tasks.md
 * 3.3) behind the interface above, and owns an internal `WindowManager`
 * (design.md decision) for the inventory window and contextual menu.
 */
export function createDomUi(): Ui {
  let unsubscribe: (() => void) | null = null;
  let mounted: { store: Store; catalog: Catalog; handlers: HudHandlers } | null = null;
  const windows: WindowManager = createWindowManager();

  // Outside-click dismissal is fully self-contained here — `WindowManager`
  // is internal, so `input/mouse.ts` never needs to reach into it directly
  // (design.md "Pin-aware outside dismiss handled by WindowManager.dismissTransient").
  const onOutsideClick = (ev: MouseEvent): void => {
    windows.dismissTransient(ev.target);
  };
  document.addEventListener("click", onOutsideClick);

  return {
    mount(store: Store, catalog: Catalog, handlers: HudHandlers): void {
      mounted = { store, catalog, handlers };
      const rerender = (): void => renderHud(catalog, store.getState(), handlers);
      rerender();
      showLatestThought(store.getState());
      unsubscribe = store.subscribe(rerender);
    },

    showThought(text: string): void {
      showThoughtDom(text);
    },

    destroy(): void {
      unsubscribe?.();
      unsubscribe = null;
      mounted = null;
      document.removeEventListener("click", onOutsideClick);
      windows.destroy();
    },

    toggleInventory(): void {
      if (!mounted) return;
      const { store, catalog, handlers } = mounted;
      const body = renderInventoryGrid(catalog, store.getState(), handlers);
      windows.toggle({ id: INVENTORY_WINDOW_ID, title: "MIS COSAS", body, variant: "window", closable: true, draggable: true });
    },

    openContextMenu(menu: ContextMenu, at: ScreenPoint, onSelect: (item: ContextMenuItem) => void): void {
      const body = renderContextMenuBody(menu, (item) => {
        onSelect(item);
        // "closes on select unless pinned" (design.md interface 2 / tasks.md 2.3)
        if (!windows.get(CONTEXT_MENU_ID)?.isPinned()) windows.close(CONTEXT_MENU_ID);
      });
      windows.open({ id: CONTEXT_MENU_ID, title: menu.title, body, at, variant: "menu", closable: true, draggable: true });
    },

    closeContextMenu(): void {
      windows.close(CONTEXT_MENU_ID);
    },
  };
}
