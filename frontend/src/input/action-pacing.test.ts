import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommandResult, Event } from "../contract";
import { BUSY_MESSAGE, createActionPacing, type Scheduler } from "./action-pacing";

/** Deterministic fake scheduler (design note: never race real timers in
 * tests) — captures every scheduled call instead of running it, so a test
 * can assert "not yet applied" BEFORE manually firing it and "applied"
 * AFTER. */
function fakeScheduler(): { schedule: Scheduler; fire: () => void; pending: number } {
  const calls: Array<{ run: () => void; ms: number }> = [];
  const schedule: Scheduler = (run, ms) => {
    calls.push({ run, ms });
  };
  return {
    schedule,
    fire: () => {
      const call = calls.shift();
      if (!call) throw new Error("fakeScheduler.fire(): no pending scheduled call");
      call.run();
    },
    get pending() {
      return calls.length;
    },
  };
}

function acceptedResult(events: Event[], durationMs?: number): CommandResult {
  return { clientCommandId: "c1", accepted: true, events, ...(durationMs !== undefined ? { durationMs } : {}) };
}

const THOUGHT_EVENT: Event = { type: "ThoughtAdded", thought: { id: "t1", text: "hola", kind: "observation", timestamp: 1 } };

// --- applyResult: instant vs. deferred ingest -----------------------------

test("action-pacing: durationMs absent -> applyResult ingests immediately, returns false (not deferred)", () => {
  const ingested: Event[][] = [];
  const busyMessages: string[] = [];
  const scheduler = fakeScheduler();
  const pacing = createActionPacing({ ingest: (e) => ingested.push(e), showBusy: (t) => busyMessages.push(t), schedule: scheduler.schedule });

  const deferred = pacing.applyResult(acceptedResult([THOUGHT_EVENT]));

  assert.equal(deferred, false);
  assert.deepEqual(ingested, [[THOUGHT_EVENT]], "ingest ran synchronously");
  assert.deepEqual(busyMessages, [], "no 'Trabajando…' shown for an instant action");
  assert.equal(scheduler.pending, 0, "nothing was scheduled");
});

test("action-pacing: durationMs=0 -> applyResult ingests immediately, returns false (explicit zero behaves exactly like absent)", () => {
  const ingested: Event[][] = [];
  const scheduler = fakeScheduler();
  const pacing = createActionPacing({ ingest: (e) => ingested.push(e), showBusy: () => {}, schedule: scheduler.schedule });

  const deferred = pacing.applyResult(acceptedResult([THOUGHT_EVENT], 0));

  assert.equal(deferred, false);
  assert.deepEqual(ingested, [[THOUGHT_EVENT]]);
});

test("action-pacing: durationMs>0 -> applyResult returns true (deferred) and DEFERS ingest until the scheduled timer fires", () => {
  const ingested: Event[][] = [];
  const busyMessages: string[] = [];
  const scheduler = fakeScheduler();
  const pacing = createActionPacing({ ingest: (e) => ingested.push(e), showBusy: (t) => busyMessages.push(t), schedule: scheduler.schedule });

  pacing.beginDispatch();
  const deferred = pacing.applyResult(acceptedResult([THOUGHT_EVENT], 900));

  assert.equal(deferred, true);
  // Not yet applied — this is the core Slice C assertion (frontend gates
  // input and animates a progress state BEFORE ingesting the events).
  assert.deepEqual(ingested, [], "ingest must NOT run before the timer fires");
  assert.equal(pacing.isBusy(), true, "busy while the timer is pending");
  assert.deepEqual(busyMessages, [BUSY_MESSAGE], "shows the 'Trabajando…' HUD affordance immediately");
  assert.equal(scheduler.pending, 1);

  scheduler.fire();

  assert.deepEqual(ingested, [[THOUGHT_EVENT]], "ingest runs once the duration elapses");
  assert.equal(pacing.isBusy(), false, "busy clears once applied (the scheduled callback owns clearing it)");
});

test("action-pacing: isWorking() tracks ONLY the deferred window — false before, true during, false after; never set for an instant action", () => {
  const scheduler = fakeScheduler();
  const pacing = createActionPacing({ ingest: () => {}, showBusy: () => {}, schedule: scheduler.schedule });

  assert.equal(pacing.isWorking(), false, "not working before anything runs");

  // Instant action: busy briefly (round-trip) but NEVER working — no cue flicker.
  pacing.beginDispatch();
  pacing.applyResult(acceptedResult([THOUGHT_EVENT]));
  assert.equal(pacing.isWorking(), false, "an instant (durationMs absent) action never enters the working window");
  pacing.endDispatch();

  // Deferred action: working across the whole "Trabajando…" window.
  pacing.beginDispatch();
  pacing.applyResult(acceptedResult([THOUGHT_EVENT], 900));
  assert.equal(pacing.isWorking(), true, "working while the deferred timer is pending");
  scheduler.fire();
  assert.equal(pacing.isWorking(), false, "working clears once the deferred window elapses");
});

test("action-pacing: reducedMotion() opens no working window (durationMs applied instantly)", () => {
  const scheduler = fakeScheduler();
  const pacing = createActionPacing({ ingest: () => {}, showBusy: () => {}, schedule: scheduler.schedule, reducedMotion: () => true });

  pacing.beginDispatch();
  pacing.applyResult(acceptedResult([THOUGHT_EVENT], 5000));
  assert.equal(pacing.isWorking(), false, "reduced motion never enters the working window");
});

test("action-pacing: onApplied runs AFTER ingest, both for instant and deferred results", () => {
  const order: string[] = [];
  const scheduler = fakeScheduler();

  const instant = createActionPacing({ ingest: () => order.push("ingest-instant"), showBusy: () => {}, schedule: scheduler.schedule });
  instant.applyResult(acceptedResult([]), () => order.push("applied-instant"));
  assert.deepEqual(order, ["ingest-instant", "applied-instant"]);

  order.length = 0;
  const deferred = createActionPacing({ ingest: () => order.push("ingest-deferred"), showBusy: () => {}, schedule: scheduler.schedule });
  deferred.beginDispatch();
  deferred.applyResult(acceptedResult([], 500), () => order.push("applied-deferred"));
  assert.deepEqual(order, [], "neither ingest nor onApplied should run before the timer fires");
  scheduler.fire();
  assert.deepEqual(order, ["ingest-deferred", "applied-deferred"], "onApplied fires strictly after ingest, once the deferred window elapses");
});

test("action-pacing: reducedMotion() true treats ANY durationMs as instant (no gating, no busy)", () => {
  const ingested: Event[][] = [];
  const scheduler = fakeScheduler();
  const pacing = createActionPacing({
    ingest: (e) => ingested.push(e),
    showBusy: () => {},
    schedule: scheduler.schedule,
    reducedMotion: () => true,
  });

  const deferred = pacing.applyResult(acceptedResult([THOUGHT_EVENT], 5000));

  assert.equal(deferred, false);
  assert.deepEqual(ingested, [[THOUGHT_EVENT]], "reduced motion applies immediately regardless of durationMs");
  assert.equal(scheduler.pending, 0, "nothing scheduled under reduced motion");
});

// --- beginDispatch/endDispatch: the synchronous whole-lifecycle guard ----
// (fresh-context review fix: the double-send race during the network
// round-trip itself, which `applyResult` alone — only ever called AFTER the
// round-trip resolves — cannot catch.) -------------------------------------

test("beginDispatch: returns true and marks busy on the first call", () => {
  const pacing = createActionPacing({ ingest: () => {}, showBusy: () => {} });
  assert.equal(pacing.isBusy(), false);
  assert.equal(pacing.beginDispatch(), true);
  assert.equal(pacing.isBusy(), true, "busy is set the instant beginDispatch succeeds — BEFORE any network round-trip");
});

test("beginDispatch: a second call while already busy returns false (dropped, not queued)", () => {
  const pacing = createActionPacing({ ingest: () => {}, showBusy: () => {} });
  assert.equal(pacing.beginDispatch(), true);
  assert.equal(pacing.beginDispatch(), false, "already in flight — must be dropped");
  assert.equal(pacing.beginDispatch(), false, "still dropped on a third overlapping attempt");
});

test("endDispatch: clears busy, allowing a subsequent beginDispatch to succeed again", () => {
  const pacing = createActionPacing({ ingest: () => {}, showBusy: () => {} });
  pacing.beginDispatch();
  assert.equal(pacing.beginDispatch(), false);
  pacing.endDispatch();
  assert.equal(pacing.isBusy(), false);
  assert.equal(pacing.beginDispatch(), true, "a new dispatch is accepted once busy clears");
});

test("endDispatch: idempotent — calling it when not busy is a harmless no-op", () => {
  const pacing = createActionPacing({ ingest: () => {}, showBusy: () => {} });
  assert.doesNotThrow(() => pacing.endDispatch());
  assert.equal(pacing.isBusy(), false);
});

test("full lifecycle: beginDispatch -> applyResult(deferred) -> busy stays true until the scheduled callback clears it, even past where a caller's finally would run", () => {
  const scheduler = fakeScheduler();
  const pacing = createActionPacing({ ingest: () => {}, showBusy: () => {}, schedule: scheduler.schedule });

  assert.equal(pacing.beginDispatch(), true);
  const deferred = pacing.applyResult(acceptedResult([], 700));
  assert.equal(deferred, true);
  // A caller's `finally` block (see game.ts's sendCommand) must NOT call
  // endDispatch() here — busy has to survive the whole "Trabajando…" window.
  assert.equal(pacing.isBusy(), true);
  assert.equal(pacing.beginDispatch(), false, "a concurrent second dispatch is still dropped mid-window");

  scheduler.fire();
  assert.equal(pacing.isBusy(), false, "cleared only once the deferred window's own callback runs");
  assert.equal(pacing.beginDispatch(), true, "a new dispatch is accepted once the window elapses");
});
