import type { CommandResult, Event } from "../contract";

/**
 * Slice C — Action Duration (Decision 1, engram #2854): the backend resolves a
 * command's outcome ATOMICALLY and reports an optional `durationMs` on the
 * `CommandResult`; THIS module is the frontend seam that gates on it — no
 * server-side realtime loop, no in-flight `GameState`.
 *
 * `durationMs` absent/0 reproduces today's exact instant behavior (ingest
 * immediately, no gating) — this is what keeps every pre-Slice-C test green.
 *
 * Fresh-context-review hardening (post-ship fix): `busy` is a SINGLE
 * synchronous flag covering the WHOLE command lifecycle — dispatch →
 * network round-trip → (instant ingest) OR (deferred duration window) —
 * not just the deferred-ingest window. Without this, a second command fired
 * WHILE the first's `transport.send` promise is still pending (the network
 * round-trip itself) would see `isBusy()===false` and slip through, since
 * the old `handleResult`-only gate only ever ran AFTER the round-trip
 * resolved. `beginDispatch()`/`endDispatch()` close that gap; `applyResult`
 * keeps the existing instant-vs-deferred ingest behavior, now reporting
 * back whether it deferred so the caller's `finally` knows whether it's
 * safe to clear busy itself (see `game.ts`'s `sendCommand`).
 */

/** Injectable in place of `setTimeout` so tests can control elapsed time
 * deterministically instead of racing real timers (design note: "do NOT call
 * setTimeout directly in a way tests can't control"). Production default
 * below just wraps `setTimeout`. */
export type Scheduler = (run: () => void, ms: number) => void;

const defaultSchedule: Scheduler = (run, ms) => {
  setTimeout(run, ms);
};

/** True under `prefers-reduced-motion` — treated exactly like `durationMs=0`
 * (instant apply, no gating). Guarded for environments with no `window`/
 * `matchMedia` (e.g. `node --test`, no jsdom in this repo) so importing this
 * module never throws outside a browser. */
const defaultReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface ActionPacingDeps {
  /** Applies a command result's events to the store — same signature as
   * `Store.ingest`. */
  ingest: (events: Event[]) => void;
  /** Surfaces a transient "working…" HUD message while gated. Same signature
   * as `Ui.showThought` — reuses the existing teletype, no new DOM. */
  showBusy: (text: string) => void;
  schedule?: Scheduler;
  reducedMotion?: () => boolean;
}

export interface ActionPacing {
  /** True from the moment `beginDispatch()` succeeds until the command's
   * lifecycle FULLY completes (immediate ingest, deferred-window ingest, a
   * transport rejection, or a not-accepted result) — a single source of
   * truth consulted by BOTH `sendCommand`'s own early-return and
   * `input/mouse.ts`'s click gate. */
  isBusy(): boolean;
  /**
   * Synchronously attempts to start a new command's lifecycle. MUST be
   * called BEFORE the network round-trip begins (i.e. before `await
   * transport.send(...)`) — this is what closes the double-send race during
   * the round-trip itself, which gating only inside `applyResult` (which
   * only runs once the round-trip has already resolved) cannot catch.
   * Returns `false` (and does nothing) if already busy — the caller MUST
   * treat that as "drop this command entirely", never queue it. Returns
   * `true` and marks busy otherwise.
   */
  beginDispatch(): boolean;
  /**
   * Applies an ACCEPTED result once the round-trip resolves: ingests
   * immediately when `durationMs` is absent/0 or under reduced motion, or
   * defers ingest until the scheduled duration elapses. Returns `true` when
   * ingest was DEFERRED — busy stays set, and the caller must NOT call
   * `endDispatch()` itself; this module's own scheduled callback clears
   * busy once the deferred ingest (and `onApplied`) actually runs. Returns
   * `false` when applied immediately — busy is left set on purpose; the
   * caller is responsible for calling `endDispatch()` right after (typically
   * from a `finally`), so the SAME clearing path also covers a transport
   * rejection or a not-accepted result that never reaches this method.
   */
  applyResult(result: CommandResult, onApplied?: () => void): boolean;
  /**
   * Synchronously clears busy. Call from a `finally` guarding every
   * non-deferred exit out of a dispatch that a prior `beginDispatch()`
   * started — a rejected/errored round-trip, a not-accepted `CommandResult`,
   * or an instantly-applied result (`applyResult` returned `false`). Idempotent.
   */
  endDispatch(): void;
}

export const BUSY_MESSAGE = "Trabajando…";

export function createActionPacing(deps: ActionPacingDeps): ActionPacing {
  const schedule = deps.schedule ?? defaultSchedule;
  const reducedMotion = deps.reducedMotion ?? defaultReducedMotion;
  let busy = false;

  function beginDispatch(): boolean {
    if (busy) return false;
    busy = true;
    return true;
  }

  function endDispatch(): void {
    busy = false;
  }

  function applyResult(result: CommandResult, onApplied?: () => void): boolean {
    const durationMs = result.durationMs ?? 0;
    if (durationMs <= 0 || reducedMotion()) {
      deps.ingest(result.events);
      onApplied?.();
      return false;
    }
    deps.showBusy(BUSY_MESSAGE);
    schedule(() => {
      busy = false;
      deps.ingest(result.events);
      onApplied?.();
    }, durationMs);
    return true;
  }

  return { isBusy: () => busy, beginDispatch, applyResult, endDispatch };
}
