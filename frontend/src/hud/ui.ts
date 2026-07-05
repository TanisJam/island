import type { Catalog, Position, Thought } from "../contract";
import type { Store } from "../state/store";
import type { ContextMenu, ContextMenuItem } from "../actions/context-menu";
import { createWindowManager, type ScreenPoint, type WindowManager } from "./window-manager";
import {
  flashDiscovery,
  hasDiscoveryThought,
  inventoryAddedMessage,
  inventoryItemIds,
  newlyAddedToInventory,
  renderCrouchFrame,
  renderHud,
  renderInventoryGrid,
  renderSurfaceGrid,
  renderThoughtsBody,
  showLatestThought,
  showThought as showThoughtDom,
  surfaceCellMessage,
  type HudHandlers,
} from "./hud";
import type { ClientSnapshot } from "../state/snapshot";
import { createObservedStore } from "../state/observed";

export type { ScreenPoint };

const INVENTORY_WINDOW_ID = "inventory";
const THOUGHTS_WINDOW_ID = "thoughts";
const CROUCH_WINDOW_ID = "crouch";
const CONTEXT_MENU_ID = "context-menu";
const surfaceWindowId = (surfaceId: string): string => `surface:${surfaceId}`;

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
  /** Opens the "MIS COSAS · 4×4" inventory grid window if closed, closes it if
   * already open. Requires `mount` to have been called first (no-op
   * otherwise — mirrors the rest of this module's defensive style). Stays
   * live while open: every store notification re-renders its grid (fix for
   * the "stale inventory window" regression). */
  toggleInventory(): void;
  /** Opens the "Ver mis pensamientos" window (most-recent-first `thoughtLog`)
   * if closed, closes it if already open — same shape/lifecycle as
   * `toggleInventory`, previously missing entirely (spec names "view
   * inventory, view thoughts" as two distinct self actions). */
  toggleThoughts(): void;
  /** Opens the "LA MESA" surface-grid window for the world object identified
   * by `surfaceId` (spec R7, design.md 7c/7d) if closed, closes it if already
   * open. No-op (defensive, matches this module's style) if `surfaceId`
   * doesn't resolve to a world object whose type declares `surfaceGrid` —
   * `input/mouse.ts` only calls this for a `uiIntent === "surface"` item,
   * which is itself only synthesized for such an object, but state can be
   * stale between the click and this call. Stays live while open, same as
   * `toggleInventory`/`toggleThoughts`. */
  toggleSurface(surfaceId: string): void;
  /** Opens the crouch lens window (crouch-crafting rework: a PER-TILE spatial
   * "marco" over `pos`, superseding design.md Decision 2's self/flat-list
   * presentation per user playtest correction) if closed, closes it if
   * already open — a READ-ONLY, enlarged single-tile frame (terrain
   * background + that tile's loose ground items), rendered by
   * `renderCrouchFrame`. Same lifecycle as `toggleInventory`/`toggleSurface`:
   * stays live while open, so `rerender()` reflects the world as it changes.
   * `pos` is the TARGET TILE (the player's own tile or an adjacent one) —
   * carried by the `crouch` uiIntent's `crouchAt` field, analogous to
   * `toggleSurface`'s `surfaceId`. */
  toggleCrouch(pos: Position): void;
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
/** Resolves the `{width,height}` of the surface-grid window body from real
 * catalog + snapshot data (design.md 7a: dims are static catalog data, never
 * carried on the runtime snapshot) — `null` if `surfaceId` isn't a currently
 * known world object, or its type doesn't declare `surfaceGrid`. */
function resolveSurfaceDims(catalog: Catalog, snapshot: ClientSnapshot, surfaceId: string): { width: number; height: number } | null {
  const object = snapshot.objects.find((o) => o.id === surfaceId);
  if (!object) return null;
  const def = catalog.worldObjects.find((o) => o.id === object.objectTypeId);
  if (!def?.surfaceGrid) return null;
  return { width: def.surfaceGrid.w, height: def.surfaceGrid.h };
}

export function createDomUi(): Ui {
  let unsubscribe: (() => void) | null = null;
  let mounted: { store: Store; catalog: Catalog; handlers: HudHandlers } | null = null;
  const windows: WindowManager = createWindowManager();
  // Tracks the currently-open surface window's id (unlike the fixed
  // INVENTORY/THOUGHTS ids, a surface window's id is dynamic — one per table
  // instance) so `rerender()` can live-refresh it, matching the inventory/
  // thoughts windows. Reset to `null` once `windows.get` reports it's no
  // longer open (e.g. the player closed it via the ✕ button).
  let openSurfaceId: string | null = null;
  // Tracks the currently-open crouch lens's TARGET TILE position (crouch-
  // crafting rework: per-tile, not a boolean self-lens flag anymore) so
  // `rerender()` can re-render the same tile's frame live and detect the
  // player closing it via the ✕ button, mirroring `openSurfaceId`'s lifecycle.
  let openCrouchAt: Position | null = null;
  // Session-only observed-types store (design.md Decision 4) — lives here
  // (not module-level) so it resets whenever a fresh `createDomUi()` mounts,
  // same scoping as `windows`.
  const observedStore = createObservedStore();
  // Persists WHICH item's info is currently shown in the crouch frame's info
  // strip (crouch-crafting fix: the info strip must SURVIVE the Observe
  // command's own rerender). `windows.setBody` discards the previous body's
  // DOM — including the just-populated info strip — on EVERY store
  // notification, and the Observe command's async response is exactly one
  // such notification. Without persisting the selection here, a fresh
  // `renderCrouchFrame` call rebuilds the info strip back to its placeholder,
  // so the revealed properties flash and vanish right after the click that
  // revealed them. Keyed by itemTypeId (not instance id): `properties`/`tags`
  // are TYPE-level catalog data, and a tile's same-type instances are grouped
  // into a single glyph anyway (see `groupByItemType`/`buildCrouchGlyph` in
  // hud.ts) — so the type id is the right granularity and also survives the
  // clicked INSTANCE being picked up as long as a sibling instance remains.
  // Reset on every `toggleCrouch` (fresh open OR close) and whenever the
  // window is found closed during a rerender — never bleeds into a different
  // tile's frame or a stale prior session.
  let crouchSelectedItemTypeId: string | null = null;

  /** Wraps `handlers.onObserve` to first optimistically mark the item's TYPE
   * as observed (design.md Decision 4: "Clicking Observar optimistically adds
   * the itemTypeId... AND dispatches Observe") before forwarding the real
   * dispatch — kept here (not in `hud/hud.ts`, which stays presentation-only)
   * since `observedStore` is owned by this `createDomUi()` instance. Also
   * forwards the persisted `crouchSelectedItemTypeId` (see above) and a
   * setter so `renderCrouchFrame` can update it when a glyph is clicked. */
  function buildCrouchBody(catalog: Catalog, snapshot: ClientSnapshot, pos: Position, handlers: HudHandlers): HTMLElement {
    const wrapped: HudHandlers = {
      ...handlers,
      onObserve: (itemInstanceId: string) => {
        const item = snapshot.items.find((it) => it.id === itemInstanceId);
        if (item) observedStore.add(item.itemTypeId);
        handlers.onObserve?.(itemInstanceId);
      },
    };
    return renderCrouchFrame(catalog, snapshot, pos, wrapped, observedStore, crouchSelectedItemTypeId, (itemTypeId) => {
      crouchSelectedItemTypeId = itemTypeId;
    });
  }

  function buildSurfaceBody(catalog: Catalog, snapshot: ClientSnapshot, surfaceId: string, handlers: HudHandlers): HTMLElement | null {
    const dims = resolveSurfaceDims(catalog, snapshot, surfaceId);
    if (!dims) return null;
    return renderSurfaceGrid(catalog, snapshot, surfaceId, dims, {
      onCellClick: (item) => showThoughtDom(surfaceCellMessage(catalog, item)),
      bindDrag: handlers.bindDrag,
      bindGrid: handlers.bindGrid,
    });
  }

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
      let lastThoughtCount = store.getState().thoughtLog.length;
      // Seeded from the CURRENT snapshot, before the first `rerender()` call
      // below — so items already in the inventory at mount time are never
      // mistaken for "just added" (fix-list: "No feedback when an item is
      // added to the inventory").
      let lastInventoryIds = inventoryItemIds(store.getState());

      const rerender = (): void => {
        const snapshot = store.getState();
        renderHud(catalog, snapshot, handlers);

        // Live-refresh the inventory/thoughts windows WHILE OPEN (fix for the
        // "stale inventory window" CRITICAL: previously only `renderHud` ran
        // on every store notification, so an already-open floating window's
        // own body never updated after an equip/drop click inside it).
        // `setBody` is a documented no-op when the id isn't currently open,
        // so these two calls are safe unconditionally.
        windows.setBody(INVENTORY_WINDOW_ID, renderInventoryGrid(catalog, snapshot, handlers));
        windows.setBody(THOUGHTS_WINDOW_ID, renderThoughtsBody(snapshot));

        // Live-refresh the surface window WHILE OPEN, same rationale as
        // inventory/thoughts above — placements/removals must reflect
        // instantly, not only on next toggle.
        if (openSurfaceId) {
          const id = surfaceWindowId(openSurfaceId);
          if (windows.get(id)) {
            const body = buildSurfaceBody(catalog, snapshot, openSurfaceId, handlers);
            if (body) windows.setBody(id, body);
          } else {
            openSurfaceId = null; // closed by the player (e.g. the ✕ button) since the last render
          }
        }

        // Live-refresh the crouch lens WHILE OPEN, same rationale as the
        // surface window above — the framed tile's ground items must reflect
        // pickups/new arrivals instantly.
        if (openCrouchAt) {
          if (windows.get(CROUCH_WINDOW_ID)) {
            windows.setBody(CROUCH_WINDOW_ID, buildCrouchBody(catalog, snapshot, openCrouchAt, handlers));
          } else {
            openCrouchAt = null; // closed by the player (e.g. the ✕ button) since the last render
            crouchSelectedItemTypeId = null; // never let a stale selection bleed into the next open
          }
        }

        // Frontend-only "item entered inventory" notification (fix-list,
        // client-side only — never a backend thought): diff the inventory's
        // item ids against the last render's ids. Any id present now that
        // wasn't before just had its `location.type` become
        // `"player_inventory"` (TakeItem, or a MoveItem landing in a free
        // cell) — equip (hand-slot MoveItem) never trips this, the item's id
        // was already in the set from the moment it entered the inventory.
        const addedItems = newlyAddedToInventory(lastInventoryIds, snapshot);
        lastInventoryIds = inventoryItemIds(snapshot);
        if (addedItems.length > 0) showThoughtDom(inventoryAddedMessage(catalog, addedItems));

        // One-shot discovery flare (spec "Light-Semantics State Treatments",
        // MUST — previously unimplemented). Driven off the thought stream
        // available to the client: any newly-appended `thoughtLog` entry of
        // kind "discovery" since the last render triggers it.
        const newThoughts: Thought[] = snapshot.thoughtLog.slice(lastThoughtCount);
        lastThoughtCount = snapshot.thoughtLog.length;
        if (hasDiscoveryThought(newThoughts)) flashDiscovery();
      };
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
      windows.toggle({
        id: INVENTORY_WINDOW_ID,
        title: "MIS COSAS · 4×4",
        body,
        variant: "window",
        closable: true,
        draggable: true,
        onClose: () => handlers.unbindGrid?.("inventory"),
      });
    },

    toggleThoughts(): void {
      if (!mounted) return;
      const { store } = mounted;
      const body = renderThoughtsBody(store.getState());
      windows.toggle({ id: THOUGHTS_WINDOW_ID, title: "MIS PENSAMIENTOS", body, variant: "window", closable: true, draggable: true });
    },

    toggleSurface(surfaceId: string): void {
      if (!mounted) return;
      const { store, catalog, handlers } = mounted;
      const body = buildSurfaceBody(catalog, store.getState(), surfaceId, handlers);
      if (!body) return; // defensive: surfaceId no longer resolves to a surfaceGrid-bearing object
      const handle = windows.toggle({
        id: surfaceWindowId(surfaceId),
        title: "LA MESA",
        body,
        variant: "window",
        closable: true,
        draggable: true,
        onClose: () => handlers.unbindGrid?.(`surface:${surfaceId}`),
      });
      openSurfaceId = handle ? surfaceId : null;
    },

    toggleCrouch(pos: Position): void {
      if (!mounted) return;
      const { store, catalog, handlers } = mounted;
      // A fresh open (or a close) never carries over a stale selection from a
      // previous tile/session — only a LIVE rerender of the SAME open window
      // is allowed to read `crouchSelectedItemTypeId` back.
      crouchSelectedItemTypeId = null;
      const body = buildCrouchBody(catalog, store.getState(), pos, handlers);
      const handle = windows.toggle({ id: CROUCH_WINDOW_ID, title: "EXAMINAR DE CERCA", body, variant: "window", closable: true, draggable: true });
      openCrouchAt = handle ? pos : null;
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
