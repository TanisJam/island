import type { Position } from "../contract";
import type { Frame } from "../view/viewstate";

/**
 * Minimal render-technology-agnostic interface (design.md SEAM 4). The loop
 * drives `render(frame, selection, busy)` every animation frame; `Frame`
 * already carries interpolated positions and visibility — implementations
 * must not reach for `ClientSnapshot` or `visibilityOf`.
 */
export interface Renderer {
  resize(width: number, height: number): void;
  /** `busy` (default false) draws a purely cosmetic "action in progress" cue
   * over the avatar — sourced from `ActionPacing.isWorking()`, so it shows for
   * exactly the deferred `durationMs` window the "Trabajando…" teletype does. */
  render(frame: Frame, selection: Position | null, busy?: boolean): void;
  destroy(): void;
}
