import type { Command, Position } from "../contract";
import type { ContextMenuItem } from "./context-menu";

/**
 * Pure extraction of `input/mouse.ts`'s `openMenuFor` onSelect switch
 * (item-context-menu change, design.md Component 2). Kept DI-only — no
 * direct DOM/`Ui` import — mirroring `hud/drag.ts`'s pure/DOM separation so
 * this stays unit-testable with fakes and reusable by any future caller of
 * `ContextMenuItem` selection (both the canvas menu and the new per-item
 * menu route through this).
 */
export interface MenuDispatchDeps {
  sendCommand: (command: Command) => Promise<void> | void;
  toggleInventory: () => void;
  toggleThoughts: () => void;
  toggleSurface: (surfaceId: string) => void;
  /** Per-tile trigger (crouch-crafting rework, drift map item 1): forwards
   * `item.crouchAt` to `Ui.toggleCrouch`. Must be preserved by any caller
   * that routes canvas-menu `uiIntent: "crouch"` entries through here. */
  toggleCrouch: (pos: Position) => void;
  /** Backs the new `"info"` (Examinar) entry — shows `item.thought` directly,
   * no `Command` involved (item-context-menu change). */
  showThought: (text: string) => void;
  /** Called only for `kind === "move"` selections, after `sendCommand` is
   * invoked — lets the caller clear its own selection state. */
  onMove?: () => void;
  /** Called instead of throwing when anything above fails. */
  onError?: () => void;
}

/**
 * Routes a selected `ContextMenuItem` to the appropriate side effect
 * (design.md Component 2). Faithful extraction of the current inline switch
 * in `input/mouse.ts` (`openMenuFor`'s `deps.ui.openContextMenu` callback),
 * plus the new `"info"` branch:
 * - `action`/`move` with a `command` -> `sendCommand`; `move` also calls
 *   `onMove?.()`.
 * - `ui` -> switch on `uiIntent`: `thoughts`/`surface`(`surfaceId`)/
 *   `crouch`(`crouchAt`)/`inventory` (default).
 * - `info` -> `showThought(item.thought ?? "")`.
 * - `mute` -> unreachable (no click listener is ever wired for it).
 * Wrapped in try/catch -> `onError?.()`, matching `mouse.ts`'s existing
 * "Algo salió mal" defensive fallback.
 */
export function dispatchMenuItem(item: ContextMenuItem, deps: MenuDispatchDeps): void {
  try {
    if ((item.kind === "action" || item.kind === "move") && item.command) {
      if (item.kind === "move") deps.onMove?.();
      void deps.sendCommand(item.command);
      return;
    }
    if (item.kind === "ui") {
      // Explicit switch (NOT a binary ternary) — see mouse.ts's original
      // comment: a plain ternary would silently misroute any new uiIntent
      // (e.g. "surface", "crouch") into `toggleInventory()` if it were merely
      // appended without its own branch.
      switch (item.uiIntent) {
        case "thoughts":
          deps.toggleThoughts();
          break;
        case "surface":
          if (item.surfaceId) deps.toggleSurface(item.surfaceId);
          break;
        case "crouch":
          if (item.crouchAt) deps.toggleCrouch(item.crouchAt);
          break;
        case "inventory":
        default:
          deps.toggleInventory();
          break;
      }
      return;
    }
    if (item.kind === "info") {
      deps.showThought(item.thought ?? "");
    }
    // item.kind === "mute" never reaches here — no click listener is ever
    // wired for it (see `hud/ui.ts`'s `renderContextMenuBody`).
  } catch {
    deps.onError?.();
  }
}
