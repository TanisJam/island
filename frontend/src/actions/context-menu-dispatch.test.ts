import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command } from "../contract";
import type { ContextMenuItem } from "./context-menu";
import { dispatchMenuItem, type MenuDispatchDeps } from "./context-menu-dispatch";

/**
 * `dispatchMenuItem` is a faithful pure extraction of `input/mouse.ts`'s
 * former inline onSelect switch (item-context-menu change, design.md
 * Component 2) plus the new `"info"` branch. `mouse.test.ts`'s uiIntent
 * routing tests exercise the same behavior through the real click flow —
 * these tests exercise the extracted function directly, with fakes/spies.
 */

function makeDeps(overrides: Partial<MenuDispatchDeps> = {}): { deps: MenuDispatchDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: MenuDispatchDeps = {
    sendCommand: (c: Command) => {
      calls.push(`sendCommand:${c.type}`);
    },
    toggleInventory: () => calls.push("toggleInventory"),
    toggleThoughts: () => calls.push("toggleThoughts"),
    toggleSurface: (surfaceId: string) => calls.push(`toggleSurface:${surfaceId}`),
    toggleCrouch: (pos) => calls.push(`toggleCrouch:${pos.x},${pos.y}`),
    showThought: (text: string) => calls.push(`showThought:${text}`),
    ...overrides,
  };
  return { deps, calls };
}

test("dispatchMenuItem: 'action' with a command dispatches via sendCommand, never onMove", () => {
  const { deps, calls } = makeDeps();
  const onMoveCalls: string[] = [];
  dispatchMenuItem(
    { id: "rest", label: "Descansar", kind: "action", command: { type: "Rest" } },
    { ...deps, onMove: () => onMoveCalls.push("move") },
  );
  assert.deepEqual(calls, ["sendCommand:Rest"]);
  assert.deepEqual(onMoveCalls, []);
});

test("dispatchMenuItem: 'move' with a command dispatches via sendCommand AND calls onMove", () => {
  const { deps, calls } = makeDeps();
  const onMoveCalls: string[] = [];
  dispatchMenuItem(
    { id: "move:adjacent", label: "Ir hasta acá", kind: "move", command: { type: "MovePlayer", to: { x: 3, y: 4 } } },
    { ...deps, onMove: () => onMoveCalls.push("move") },
  );
  assert.deepEqual(calls, ["sendCommand:MovePlayer"]);
  assert.deepEqual(onMoveCalls, ["move"]);
});

test("dispatchMenuItem: 'action'/'move' without a command is a no-op (defensive — never reachable in practice)", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "x", label: "X", kind: "action" }, deps);
  assert.deepEqual(calls, []);
});

test("dispatchMenuItem: 'ui' + uiIntent 'thoughts' calls toggleThoughts only", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "ui:thoughts", label: "Ver mis pensamientos", kind: "ui", uiIntent: "thoughts" }, deps);
  assert.deepEqual(calls, ["toggleThoughts"]);
});

test("dispatchMenuItem: 'ui' + uiIntent 'surface' with surfaceId calls toggleSurface with that id", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "ui:surface", label: "Usar la mesa", kind: "ui", uiIntent: "surface", surfaceId: "wo_table" }, deps);
  assert.deepEqual(calls, ["toggleSurface:wo_table"]);
});

test("dispatchMenuItem: 'ui' + uiIntent 'surface' with no surfaceId is a defensive no-op", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "ui:surface", label: "Usar la mesa", kind: "ui", uiIntent: "surface" }, deps);
  assert.deepEqual(calls, []);
});

test("dispatchMenuItem: 'ui' + uiIntent 'crouch' with crouchAt calls toggleCrouch with that position", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "ui:crouch:6,5", label: "Examinar de cerca", kind: "ui", uiIntent: "crouch", crouchAt: { x: 6, y: 5 } }, deps);
  assert.deepEqual(calls, ["toggleCrouch:6,5"]);
});

test("dispatchMenuItem: 'ui' + uiIntent 'crouch' with no crouchAt is a defensive no-op (never falls back to toggleInventory)", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "ui:crouch:stale", label: "Examinar de cerca", kind: "ui", uiIntent: "crouch" }, deps);
  assert.deepEqual(calls, []);
});

test("dispatchMenuItem: 'ui' + uiIntent 'inventory' calls toggleInventory", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "ui:inventory", label: "Ver mis cosas", kind: "ui", uiIntent: "inventory" }, deps);
  assert.deepEqual(calls, ["toggleInventory"]);
});

test("dispatchMenuItem: 'ui' with no uiIntent defaults to toggleInventory", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "ui:whatever", label: "Whatever", kind: "ui" }, deps);
  assert.deepEqual(calls, ["toggleInventory"]);
});

test("dispatchMenuItem: 'info' shows the item's thought via showThought, never dispatches a command", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "examinar", label: "Examinar", kind: "info", thought: "Veo un hacha de cerca." }, deps);
  assert.deepEqual(calls, ["showThought:Veo un hacha de cerca."]);
});

test("dispatchMenuItem: 'info' with no thought falls back to an empty string", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "examinar", label: "Examinar", kind: "info" }, deps);
  assert.deepEqual(calls, ["showThought:"]);
});

test("dispatchMenuItem: 'mute' is a no-op (unreachable in practice — no click listener is ever wired for it)", () => {
  const { deps, calls } = makeDeps();
  dispatchMenuItem({ id: "mute:unseen", label: "No alcanzo a ver qué hay ahí.", kind: "mute" }, deps);
  assert.deepEqual(calls, []);
});

test("dispatchMenuItem: a throwing dep is caught and routed to onError, never propagates", () => {
  const { deps, calls } = makeDeps({
    toggleThoughts: () => {
      throw new Error("boom");
    },
  });
  const errorCalls: string[] = [];
  assert.doesNotThrow(() =>
    dispatchMenuItem(
      { id: "ui:thoughts", label: "Ver mis pensamientos", kind: "ui", uiIntent: "thoughts" },
      { ...deps, onError: () => errorCalls.push("error") },
    ),
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(errorCalls, ["error"]);
});

test("dispatchMenuItem: a throwing dep with no onError is silently swallowed (no crash)", () => {
  const { deps } = makeDeps({
    sendCommand: () => {
      throw new Error("boom");
    },
  });
  assert.doesNotThrow(() => dispatchMenuItem({ id: "rest", label: "Descansar", kind: "action", command: { type: "Rest" } }, deps));
});
