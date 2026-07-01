import type { Catalog } from "../contract";
import type { Store } from "../state/store";
import { renderHud, showLatestThought, showThought as showThoughtDom, type HudHandlers } from "./hud";

/**
 * Sits in front of the DOM HUD (design.md SEAM 7) so a future reactive
 * framework implementation could replace `createDomUi` without touching
 * `Store`/`Game`/`Renderer`.
 */
export interface Ui {
  /** Subscribes to `store` and re-renders the HUD on every notification. */
  mount(store: Store, catalog: Catalog, handlers: HudHandlers): void;
  showThought(text: string): void;
  destroy(): void;
}

/**
 * DOM implementation of `Ui`. Wraps the existing `renderHud`/`showThought`/
 * `showLatestThought` DOM functions (hud/hud.ts logic unchanged — tasks.md
 * 3.3) behind the interface above.
 */
export function createDomUi(): Ui {
  let unsubscribe: (() => void) | null = null;

  return {
    mount(store: Store, catalog: Catalog, handlers: HudHandlers): void {
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
    },
  };
}
