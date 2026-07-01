import { test } from "node:test";
import assert from "node:assert/strict";
import type { Event, Tile } from "../contract";
import type { ClientSnapshot } from "./snapshot";
import { createStore } from "./store";

function makeTile(x: number, y: number): Tile {
  return { x, y, terrain: "grass", walkable: true, tags: ["ground"], visibility: "visible" };
}

function makeSnapshot(): ClientSnapshot {
  return {
    zone: { id: "z1", width: 16, height: 12 },
    visionRadius: 5,
    tiles: [makeTile(8, 9)],
    objects: [],
    piles: [],
    items: [],
    player: {
      id: "p1",
      name: "Náufrago",
      position: { x: 8, y: 9 },
      energy: 100,
      maxEnergy: 100,
      health: 100,
      maxHealth: 100,
      knowledge: [],
    },
    handSlots: { left: { x: 0, y: 0 }, right: { x: 3, y: 0 } },
    thoughtLog: [],
    discovered: new Set<string>(),
    catalogVersion: "v1",
  };
}

test("getState returns the same snapshot reference passed at creation", () => {
  const initial = makeSnapshot();
  const store = createStore(initial);
  assert.equal(store.getState(), initial);
});

test("ingest applies events via the reducer and getState reflects them", () => {
  const store = createStore(makeSnapshot());
  const events: Event[] = [{ type: "EnergyChanged", energy: 42 }];
  store.ingest(events);
  assert.equal(store.getState().player.energy, 42);
});

test("subscribe: listener fires after ingest, with the updated snapshot", () => {
  const store = createStore(makeSnapshot());
  const seenEnergies: number[] = [];
  let calls = 0;
  store.subscribe((snapshot) => {
    calls++;
    seenEnergies.push(snapshot.player.energy);
  });

  store.ingest([{ type: "EnergyChanged", energy: 7 }]);

  assert.equal(calls, 1);
  assert.deepEqual(seenEnergies, [7]);
});

test("subscribe: unsubscribe stops further notifications", () => {
  const store = createStore(makeSnapshot());
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);

  store.ingest([{ type: "EnergyChanged", energy: 1 }]);
  assert.equal(calls, 1);

  unsubscribe();
  store.ingest([{ type: "EnergyChanged", energy: 2 }]);
  assert.equal(calls, 1, "listener should not fire again after unsubscribe");
});

test("subscribeEvents: listener receives the raw events array, called before the post-mutation snapshot listener", () => {
  const store = createStore(makeSnapshot());
  const order: string[] = [];
  let seenEvents: Event[] = [];

  store.subscribeEvents((events) => {
    order.push("events");
    seenEvents = events;
  });
  store.subscribe(() => order.push("snapshot"));

  const events: Event[] = [{ type: "EnergyChanged", energy: 3 }];
  store.ingest(events);

  assert.deepEqual(order, ["events", "snapshot"], "raw events fire before the post-mutation snapshot listener");
  assert.deepEqual(seenEvents, events);
});

test("subscribeEvents: unsubscribe stops further notifications", () => {
  const store = createStore(makeSnapshot());
  let calls = 0;
  const unsubscribe = store.subscribeEvents(() => calls++);

  store.ingest([{ type: "EnergyChanged", energy: 1 }]);
  assert.equal(calls, 1);

  unsubscribe();
  store.ingest([{ type: "EnergyChanged", energy: 2 }]);
  assert.equal(calls, 1, "listener should not fire again after unsubscribe");
});

test("subscribe: supports multiple independent listeners", () => {
  const store = createStore(makeSnapshot());
  let a = 0;
  let b = 0;
  store.subscribe(() => a++);
  store.subscribe(() => b++);

  store.ingest([{ type: "EnergyChanged", energy: 5 }]);

  assert.equal(a, 1);
  assert.equal(b, 1);
});
