import { test } from "node:test";
import assert from "node:assert/strict";
import type { Thought } from "../contract";
import { hasDiscoveryThought } from "./hud";

/**
 * `hud.ts` is otherwise DOM-heavy and only gets smoke coverage by design
 * (see window-manager.test.ts's docstring) — `hasDiscoveryThought` is the one
 * PURE decision extracted out of it (whether a batch of newly-appended
 * `thoughtLog` entries should trigger `flashDiscovery()`), so it gets a real
 * unit test.
 */

function thought(kind: Thought["kind"], text = "x"): Thought {
  return { id: `th_${kind}`, text, kind, timestamp: 0 };
}

test("hasDiscoveryThought: false for an empty batch", () => {
  assert.equal(hasDiscoveryThought([]), false);
});

test("hasDiscoveryThought: false when no thought in the batch is kind 'discovery'", () => {
  assert.equal(hasDiscoveryThought([thought("observation"), thought("warning"), thought("idea")]), false);
});

test("hasDiscoveryThought: true when at least one thought in the batch is kind 'discovery'", () => {
  assert.equal(hasDiscoveryThought([thought("observation"), thought("discovery")]), true);
});
