import type { Event } from "../contract";
import { applyClientEvents } from "./reducer";
import type { ClientSnapshot } from "./snapshot";

export type Listener = (snapshot: ClientSnapshot) => void;

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
  /** Applies `events` to the snapshot via the existing reducer, then notifies subscribers. */
  ingest(events: Event[]): void;
}

export function createStore(initial: ClientSnapshot): Store {
  const snapshot = initial;
  const listeners = new Set<Listener>();

  function notify(): void {
    for (const listener of listeners) listener(snapshot);
  }

  return {
    getState(): ClientSnapshot {
      return snapshot;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ingest(events: Event[]): void {
      applyClientEvents(snapshot, events);
      notify();
    },
  };
}
