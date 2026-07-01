import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommandEnvelope, CommandResult } from "../contract";
import { createHttpTransport } from "./transport";

const ORIGINAL_FETCH = globalThis.fetch;

function stubFetch(result: CommandResult): void {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => result,
    }) as unknown as Response) as typeof fetch;
}

test("send: delegates to postCommand (existing net/api.ts request/response call)", async () => {
  const expected: CommandResult = { clientCommandId: "c1", accepted: true, events: [{ type: "EnergyChanged", energy: 9 }] };
  stubFetch(expected);
  try {
    const transport = createHttpTransport("http://localhost:3000");
    const env: CommandEnvelope = { playerId: "p1", clientCommandId: "c1", command: { type: "Rest" } };
    const result = await transport.send(env);
    assert.deepEqual(result, expected);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test("onEvents: registers a handler and returns a working unsubscribe (never fires today)", () => {
  const transport = createHttpTransport("http://localhost:3000");
  let calls = 0;
  const unsubscribe = transport.onEvents(() => calls++);
  assert.equal(typeof unsubscribe, "function");
  unsubscribe();
  assert.equal(calls, 0, "no push implementation exists yet, so the handler never fires");
});

test("onEvents: supports registering and unsubscribing multiple handlers independently", () => {
  const transport = createHttpTransport("http://localhost:3000");
  const unsubA = transport.onEvents(() => {});
  const unsubB = transport.onEvents(() => {});
  assert.doesNotThrow(() => unsubA());
  assert.doesNotThrow(() => unsubB());
});
