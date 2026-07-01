import type { CommandEnvelope, CommandResult, Event } from "../contract";
import { postCommand } from "./api";

export type EventsHandler = (events: Event[]) => void;

/**
 * Abstracts request/response and push-style backend communication so a
 * future WebSocket/SSE implementation can feed `Store.ingest` without any
 * caller (Game controller, input) changing (design.md "Transport push
 * today"). `send` is today's request/response path; `onEvents` is a real
 * subscription registry kept ready for tomorrow's push channel, even though
 * this HTTP implementation never emits through it.
 */
export interface Transport {
  send(env: CommandEnvelope): Promise<CommandResult>;
  /** Registers `handler` for pushed events. Returns an unsubscribe function. */
  onEvents(handler: EventsHandler): () => void;
  start?(): void;
  stop?(): void;
}

/**
 * HTTP-only `Transport`: `send` wraps the existing `postCommand` request/
 * response call from `net/api.ts` (unchanged — see design.md File Changes).
 * `onEvents` never fires today because nothing calls `emit` internally;
 * `baseUrl` is accepted to match the seam's future shape but is currently
 * unused since `net/api.ts` owns its own `BASE_URL` constant.
 */
export function createHttpTransport(baseUrl: string): Transport {
  void baseUrl;
  const handlers = new Set<EventsHandler>();

  return {
    send(env: CommandEnvelope): Promise<CommandResult> {
      return postCommand(env);
    },
    onEvents(handler: EventsHandler): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
