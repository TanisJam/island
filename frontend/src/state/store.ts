import type { Event } from "../contract";
import { applyClientEvents } from "./reducer";
import type { ClientSnapshot } from "./snapshot";

export type Listener = (snapshot: ClientSnapshot) => void;
/** Raw-events listener (fix: "walk along `PlayerMoved.path`"). `ViewState`
 * uses this to see the EVENT that produced a snapshot change (e.g. the A*
 * `path` on `PlayerMoved`) — something `Listener`'s post-mutation snapshot
 * alone can't carry, since the reducer only writes the resulting position. */
export type EventListener = (events: Event[]) => void;

/**
 * Reactive wrapper around a `ClientSnapshot`. This is the ONLY place snapshot
 * mutation happens going forward: command-response events AND future pushed
 * events (from a WS/SSE `Transport`) converge through the same `ingest` path,
 * so no caller needs to know which source produced the events (design.md
 * "Event merge point").
 *
 * Mutation stays in-place (same reducer, same snapshot reference) — the store
 * only adds subscribe/notify around it. No structural sharing / immutability;
 * not needed yet and keeps the diff against the existing reducer minimal.
 */
export interface Store {
  getState(): ClientSnapshot;
  /** Registers `listener`, called after every `ingest`. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void;
  /** Registers `listener`, called with the raw `events` array on every `ingest`
   *  — BEFORE the post-mutation `Listener`s (see `EventListener`). Returns an
   *  unsubscribe function. */
  subscribeEvents(listener: EventListener): () => void;
  /** Applies `events` to the snapshot via the existing reducer, then notifies subscribers. */
  ingest(events: Event[]): void;
}

export function createStore(initial: ClientSnapshot): Store {
  const snapshot = initial;
  const listeners = new Set<Listener>();
  const eventListeners = new Set<EventListener>();

  function notify(): void {
    for (const listener of listeners) listener(snapshot);
  }

  function notifyEvents(events: Event[]): void {
    for (const listener of eventListeners) listener(events);
  }

  return {
    getState(): ClientSnapshot {
      return snapshot;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeEvents(listener: EventListener): () => void {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    ingest(events: Event[]): void {
      applyClientEvents(snapshot, events);
      // Raw events first: `ViewState` captures `PlayerMoved.path` here so
      // it's already available by the time the post-mutation `Listener`s
      // (e.g. `ViewState`'s own `reconcile`, subscribed via `subscribe`)
      // run below and build the tween off the new position.
      notifyEvents(events);
      notify();
    },
  };
}
